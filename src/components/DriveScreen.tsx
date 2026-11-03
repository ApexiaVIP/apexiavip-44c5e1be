import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Loader2,
  Merge,
  RotateCw,
  Split,
  Camera,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lookUpPostcode, metresBetween } from "@/lib/trackMarker";
import { destinationQuery, postcodeFor } from "@/lib/navigation";
import DestinationBox from "./DestinationBox";
import type { PlaceSuggestion } from "@/lib/mfa";
import {
  routesFromGoogle,
  routesFromOsrm,
  worthOffering,
  type LatLng,
  type NavRoute,
  type Turn,
} from "@/lib/navRoute";
import {
  announcement,
  arrivalAt,
  cueFor,
  follow,
  minutesLeft,
  offRoute,
  shownDistance,
  type Cue,
  type Guidance,
} from "@/lib/navGuidance";
import { canSpeak, hush, rememberVoice, say, voiceWanted, wakeVoice } from "@/lib/navVoice";
import { watchDriving, type Fix } from "@/lib/whereAmI";
import {
  otherTheme,
  preferredMapTheme,
  rememberMapTheme,
  type MapTheme,
} from "@/lib/mapTheme";
import { googleMapsConfigured } from "@/lib/googleMaps";
import {
  boxAround,
  cameraAhead,
  cameraWords,
  onRoute,
  type CameraOnRoute,
} from "@/lib/speedCameras";
import { camerasIn } from "@/lib/cameraSource";

const DriveMap = lazy(() => import("./DriveMap"));
const DriveMapGoogle = lazy(() => import("./DriveMapGoogle"));

/** Already there, so there is nothing to navigate. */
const ALREADY_THERE_M = 60;

/** Metres a second past which the car has plainly set off, about ten mph. */
const MOVING_OFF_MS = 4.5;

/** Two fixes off the route before asking for a new one, so one bad fix is ignored. */
const STRAY_FIXES = 2;
/**
 * How far the car has to have moved before another route is worth asking for.
 *
 * A standing car's position wanders by tens of metres, and wandering reads as
 * straying off route, so a parked car with this screen open was asking for a
 * fresh route every twenty seconds. That is up to a hundred and eighty an
 * hour against a cap of a hundred and fifty, and it is all spent on a car
 * that has not moved.
 */
const MOVED_M = 60;

/** No more than one route request this often, whatever the road is doing. */
const SETTLE_MS = 20000;

/**
 * How old a route gets before it is worth asking what the traffic is now.
 *
 * This is the dial that decides the bill. Every refresh is a Google Routes
 * request on the Pro tier, because asking about traffic is what makes it Pro,
 * and a long job refreshing every couple of minutes is twenty requests before
 * the passenger is even aboard. Five minutes keeps the arrival time honest
 * without paying to be told the same thing twice: a jam that appears between
 * refreshes still shows up well before the car reaches it.
 *
 * Going off route is handled separately and immediately, which is the case
 * where a stale route actually misleads anybody.
 */
const STALE_MS = 300000;

/** Close to the end, a new route is pointless. */
const NEARLY_THERE_M = 400;

const ARROWS: Record<Turn, typeof ArrowUp> = {
  depart: ArrowUp,
  straight: ArrowUp,
  "slight-left": ArrowUpLeft,
  left: CornerUpLeft,
  "sharp-left": CornerUpLeft,
  "slight-right": ArrowUpRight,
  right: CornerUpRight,
  "sharp-right": CornerUpRight,
  "u-turn": RotateCw,
  roundabout: RotateCw,
  merge: Merge,
  "keep-left": Split,
  "keep-right": Split,
  "slip-left": ArrowUpLeft,
  "slip-right": ArrowUpRight,
  arrive: Flag,
};

export interface DriveScreenProps {
  reference: string;
  /** The address being driven to, as the office recorded it. */
  to: { line1?: string | null; town?: string | null; postcode?: string | null } | null;
  /** Which end of the job, which changes every word on the screen. */
  what: "pickup" | "dropoff";
  /** Where the job has got to, so the screen offers the right next step. */
  status: string | null;
  /**
   * An hourly hire, where pulling up is a wait rather than the end.
   *
   * The passenger goes into a meeting and comes back out, so arriving offers
   * to wait, not to set them down and finish the job.
   */
  asDirected?: boolean;
  /**
   * Move the job on without leaving the drive.
   *
   * This is the part Waze could never do. Marking a passenger aboard here
   * turns the screen round to the destination and carries straight on, rather
   * than making a chauffeur come out of navigation, find the job, press a
   * button and start again.
   */
  onAdvance: (kind: "arrived" | "pob" | "waiting") => void;
  /** Setting down, which needs the office form and so ends the drive. */
  onSetDown: () => void;
  /**
   * How long this drive still has to run, so the passenger can be told.
   *
   * Null when there is nothing worth quoting, which also clears whatever the
   * passenger was last shown rather than leaving it to rot on their screen.
   */
  onEta?: (secondsLeft: number | null) => void;
  /**
   * The passenger has said where, while the chauffeur is still in the drive.
   *
   * On an hourly hire the destination only exists once it is said in the car,
   * so the drive has to be able to ask for it. Without this, marking the
   * passenger aboard turned the screen round to a destination that was not
   * there yet and the chauffeur was left looking at an error.
   */
  onDestination?: (picked: PlaceSuggestion) => void;
  onClose: () => void;
}

type Stage = "finding" | "asking" | "driving" | "arrived" | "stuck";

/**
 * What came back from asking for a route.
 *
 * These used to be one falsy value between them, so a request that was still
 * in the air read as a route that could not be found, and every genuine
 * failure read as the same sentence however it failed.
 */
type Plotted =
  | { ok: NavRoute }
  /** Another request is already out; whatever it finds will set the screen. */
  | { busy: true }
  | { failed: string };

/**
 * Why a route would not come, in words a chauffeur can read out down the phone.
 *
 * The route service tells us whether it was the hourly cap, a provider that
 * would not answer or a signed out session, and all of that was being thrown
 * away for one sentence that could not be acted on.
 */
const reasonFor = async (error: unknown, said: { error?: string } | null): Promise<string> => {
  if (said?.error) return said.error;
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.status === "number") {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    const message = (body as { error?: string } | null)?.error;
    return message
      ? `${message} (${response.status})`
      : `The route service answered ${response.status}.`;
  }
  const message = error instanceof Error ? error.message : "";
  return message || "No answer from the route service.";
};

/**
 * Navigating inside the app.
 *
 * Chauffeurs used to leave for Waze, and the moment they did the phone put
 * this app to sleep: no position went up, and the passenger watched a car
 * that never moved for the length of their journey. So the turns are given
 * here instead, and because the app is the thing on screen it keeps reporting
 * the whole way.
 *
 * It also means the job moves on from the same screen. Arriving is a button
 * under the chauffeur's thumb rather than something to remember to do after
 * switching back.
 */
const DriveScreen = ({
  reference,
  to,
  what,
  status,
  asDirected = false,
  onAdvance,
  onSetDown,
  onEta,
  onDestination,
  onClose,
}: DriveScreenProps) => {
  const [stage, setStage] = useState<Stage>("finding");
  /**
   * How fast the car is going, in metres a second, as the phone reports it.
   *
   * The phone has had this on every fix since the screen was written and it
   * was thrown away. A chauffeur asked for it, and he is right to: he is
   * being warned about a camera and its limit with no way to tell, without
   * looking down at the dashboard, whether the warning concerns him.
   */
  const [speed, setSpeed] = useState<number | null>(null);
  /** Every way there worth offering, best first. */
  const [choices, setChoices] = useState<NavRoute[]>([]);
  /** Whether the choice is on screen, which it is only before setting off. */
  const [choosing, setChoosing] = useState(false);
  const [trouble, setTrouble] = useState("");
  /** The detail under the trouble, which is what tells us what to fix. */
  const [reason, setReason] = useState("");
  /**
   * Bumped to ask for the route again.
   *
   * A route can fail for a minute of bad signal in a tunnel or a car park,
   * and the answer to that is to ask again rather than to send the chauffeur
   * out to another app, which is the one thing that stops the passenger
   * seeing the car.
   */
  const [attempt, setAttempt] = useState(0);
  /**
   * The passenger has asked for somewhere else while the car is moving.
   *
   * Held rather than acted on. A route that redraws itself at speed, for a
   * reason the chauffeur has not been told, is worse than a chauffeur who
   * has to be asked: they are shown the address and decide when to turn.
   */
  const [redirect, setRedirect] = useState<string | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [target, setTarget] = useState<LatLng | null>(null);
  const [speaking, setSpeaking] = useState(() => canSpeak() && voiceWanted());
  /**
   * Google's map is the one this screen is built around, and the one its
   * licence expects the routing to be drawn on. The open map is kept only so
   * that a chauffeur whose key or signal has failed still gets a screen with
   * a road on it rather than a black rectangle.
   */
  const [googleOut, setGoogleOut] = useState(false);
  /**
   * Light or dark. Dark is right before dawn and wrong at midday against a
   * bright windscreen, so it starts on whatever the phone is set to and the
   * chauffeur can flip it in one tap without leaving the drive.
   */
  const [theme, setTheme] = useState<MapTheme>(preferredMapTheme);
  /**
   * The cameras on this route, worked out once when the route arrives.
   *
   * The route does not move while it is being driven, so where the cameras
   * fall along it never changes. Measuring them per fix would be the same
   * answer, three thousand times a journey.
   */
  const [cameras, setCameras] = useState<CameraOnRoute[]>([]);
  const onGoogle = googleMapsConfigured() && !googleOut;

  const lineIndex = useRef(-1);
  /** The furthest along the route the car has got, so it never slips back. */
  const along = useRef(0);
  const strayed = useRef(0);
  const askedAt = useRef(0);
  const asking = useRef(false);
  const spoken = useRef<Set<string>>(new Set());
  const latest = useRef<Fix | null>(null);
  /** The address a choice of ways has already been put up for. */
  const offeredFor = useRef<string | null>(null);
  /** The address the route on screen was worked out for. */
  const routedFor = useRef("");
  /** Where the car was when that route was asked for. */
  const askedFrom = useRef<LatLng | null>(null);

  const where = what === "pickup" ? "the collection" : "the destination";
  // Rounded, because a speed that flickers through every digit is unreadable
  // at a glance and reads as a fault
  const mph = speed !== null && speed >= 0 ? Math.round(speed * 2.23694) : null;
  /**
   * An address the chauffeur typed because the job's own will not navigate.
   *
   * It is used to drive by and nothing else: the job keeps the address the
   * office gave it. The moment that address becomes usable it wins again,
   * so a passenger sending somewhere else is never overridden by this.
   */
  const [typed, setTyped] = useState<PlaceSuggestion | null>(null);
  const aiming = useMemo(
    () =>
      postcodeFor(to) || !typed
        ? to
        : { line1: typed.line1, town: typed.town, postcode: typed.postcode },
    [to, typed]
  );
  const address = useMemo(() => destinationQuery(aiming), [aiming]);
  /** The postcode to aim at, wherever in the address it was written. */
  const aimAt = useMemo(() => postcodeFor(aiming), [aiming]);

  /**
   * Ask for a route from wherever the car is now.
   *
   * The address is passed in rather than read from the props, because the
   * props can change under a drive in progress: the passenger asks for
   * somewhere else and, until the chauffeur takes it, a refresh has to keep
   * asking about the place they are actually driving to.
   */
  const plot = useCallback(
    async (from: Fix, door: LatLng, forAddress: string): Promise<Plotted> => {
      if (asking.current) return { busy: true };
      asking.current = true;
      askedAt.current = Date.now();
      askedFrom.current = { lat: from.lat, lng: from.lng };
      try {
        const { data, error } = await supabase.functions.invoke("route", {
          body: {
            from: { lat: from.lat, lng: from.lng },
            to: door,
            address: forAddress,
            heading: from.heading,
            reference,
            // Only on the first route to this address, which is the only
            // time the choice is put up
            alternatives: offeredFor.current !== forAddress,
          },
        });
        if (error || data?.error) return { failed: await reasonFor(error, data) };
        const ways = worthOffering(
          data.provider === "google"
            ? routesFromGoogle(data.route)
            : routesFromOsrm(data.route, data.withTraffic === true)
        );
        const worked = ways[0];
        if (!worked) {
          // Engineer's words on a chauffeur's screen, and no use to him. By
          // the time it says this, both routers have been tried.
          return { failed: "No route could be found to this address." };
        }
        setChoices(ways);
        // Offered at the kerb, where the decision belongs, and only when
        // there is a real one to make. A chauffeur picking roads at speed is
        // worse than a chauffeur on the road he would not have chosen.
        //
        // Once per destination, and no more. A car that strays asks for a
        // fresh route, and without this the choice would spring back over
        // the map at seventy on the motorway, every time.
        if (ways.length > 1 && offeredFor.current !== forAddress) {
          offeredFor.current = forAddress;
          setChoosing(true);
        }
        spoken.current = new Set();
        // Put the car on the new route straight away, from the fix the route
        // was asked for. Waiting for the next fix left the chauffeur looking
        // at an empty screen for a second or two every time
        const first = follow(worked, from, -1);
        lineIndex.current = first.lineIndex;
        along.current = first.along;
        routedFor.current = forAddress;
        setRoute(worked);
        setGuidance(first);
        setStage((was) => (was === "arrived" ? was : "driving"));
        return { ok: worked };
      } catch (err) {
        return { failed: err instanceof Error && err.message ? err.message : "Nothing came back." };
      } finally {
        asking.current = false;
      }
    },
    [reference]
  );

  /**
   * Drive the way the chauffeur picked instead.
   *
   * Nothing is asked of the router: every way came back in the one answer,
   * so switching is instant and costs nothing. The spoken turns are cleared
   * so the first instruction on the new road is given rather than skipped
   * for having been said once already on the old one.
   */
  const switchTo = useCallback((way: NavRoute) => {
    const from = latest.current;
    setChoosing(false);
    if (!from) return;
    spoken.current = new Set();
    const next = follow(way, from, -1);
    lineIndex.current = next.lineIndex;
    along.current = next.along;
    setRoute(way);
    setGuidance(next);
  }, []);

  /**
   * Whether this drive is waiting to be told where it is going.
   *
   * An hourly hire has no destination until the passenger says one, so an
   * empty address here is the normal state of the job rather than a fault
   * with it, and the screen asks instead of complaining.
   */
  const askingWhere = asDirected && what === "dropoff" && !aimAt && !!onDestination;

  /**
   * The job has an address and the sat nav cannot work with it.
   *
   * This used to be a dead end: a chauffeur at the kerb got the reason and
   * two buttons, neither of which got him moving. Asking him for one is the
   * only thing that does, and it beats him leaving the app to do it.
   */
  const cannotAim = !askingWhere && !aimAt;

  /** Find the door, find the car, and work out the way there. */
  useEffect(() => {
    let dropped = false;
    const begin = async () => {
      if (askingWhere || cannotAim) {
        setStage("asking");
        return;
      }
      // Somewhere else has been asked for since this route was worked out.
      // Hold it up and tell the chauffeur rather than turning the car
      if (routedFor.current && address && address !== routedFor.current) {
        setRedirect(address);
        return;
      }
      const postcode = aimAt;
      if (!postcode) {
        setTrouble("This job has no postcode, so there is nothing to navigate to.");
        setReason("");
        setStage("stuck");
        return;
      }
      const door = await lookUpPostcode(postcode);
      if (dropped) return;
      if (!door) {
        setTrouble(`Could not find ${postcode} on the map.`);
        setReason("");
        setStage("stuck");
        return;
      }
      setTarget(door);

      const { currentFix } = await import("@/lib/whereAmI");
      const from = await currentFix();
      if (dropped) return;
      if (!from) {
        setTrouble("Could not work out where you are. Check location is on for this app.");
        setReason("");
        setStage("stuck");
        return;
      }
      latest.current = from;

      if (metresBetween(from.lat, from.lng, door.lat, door.lng) < ALREADY_THERE_M) {
        setStage("arrived");
        return;
      }
      const plotted = await plot(from, door, address);
      if (dropped) return;
      if ("failed" in plotted) {
        setTrouble("Could not work out a route just now.");
        setReason(plotted.failed);
        setStage("stuck");
      }
    };
    void begin();
    return () => {
      dropped = true;
    };
  }, [aimAt, plot, askingWhere, cannotAim, attempt, address]);

  /** Have another go at finding the way, after a route would not come. */
  const tryAgain = useCallback(() => {
    if (asking.current) return;
    setTrouble("");
    setReason("");
    setStage("finding");
    setAttempt((n) => n + 1);
  }, []);

  /** Follow the car along the route. */
  useEffect(() => {
    if (!route || !target) return;
    const stop = watchDriving((fix) => {
      latest.current = fix;
      setSpeed(fix.speed);
      // Moving is the chauffeur's answer. Whatever he was going to pick, he
      // has set off on the one underneath, and a panel over the map at
      // twenty miles an hour is a hazard rather than a choice.
      if (fix.speed !== null && fix.speed > MOVING_OFF_MS) setChoosing(false);
      const next = follow(route, fix, lineIndex.current, along.current);
      lineIndex.current = next.lineIndex;
      along.current = next.along;
      setGuidance(next);

      if (next.arrived) {
        setStage("arrived");
        return;
      }

      if (offRoute(next)) {
        strayed.current += 1;
      } else {
        strayed.current = 0;
      }

      const settled = Date.now() - askedAt.current > SETTLE_MS;
      const stale = Date.now() - route.at > STALE_MS;
      const worthIt = next.metresLeft > NEARLY_THERE_M;
      // A route is only worth asking for again from somewhere else
      const moved =
        !askedFrom.current ||
        metresBetween(fix.lat, fix.lng, askedFrom.current.lat, askedFrom.current.lng) > MOVED_M;
      // Never refresh while somewhere else is waiting to be accepted: the
      // door on screen belongs to the old address and the words would belong
      // to the new one, which is a route to neither
      if (settled && worthIt && moved && (strayed.current >= STRAY_FIXES || stale)) {
        strayed.current = 0;
        // Against the address this route was plotted for, which is not
        // necessarily the one on the props any more
        void plot(fix, target, routedFor.current);
      }
    });
    return stop;
  }, [route, target, plot]);

  /**
   * Tell the chauffeur out loud that somewhere else has been asked for.
   *
   * They are looking at the road, not at the screen, so a banner on its own
   * would be missed until the next set of lights.
   */
  useEffect(() => {
    if (!redirect || !speaking) return;
    say(`Your passenger has asked for ${redirect}`, { urgent: true });
  }, [redirect, speaking]);

  /**
   * Work out the cameras on the route, once, when the route arrives.
   *
   * A failed read gives an empty list, which is a drive with no warnings
   * rather than a drive with no screen.
   */
  useEffect(() => {
    if (!route) {
      setCameras([]);
      return;
    }
    let dropped = false;
    void (async () => {
      const found = await camerasIn(boxAround(route.line));
      if (!dropped) setCameras(onRoute(route, found));
    })();
    return () => {
      dropped = true;
    };
  }, [route]);

  /** The one to warn about, once it is close enough to matter. */
  const camera = useMemo(
    () => (guidance && stage === "driving" ? cameraAhead(cameras, guidance.along) : null),
    [cameras, guidance, stage]
  );

  /**
   * Say the camera, once, three hundred metres out.
   *
   * Not urgent, so it waits its turn behind a turn instruction. A chauffeur
   * who needs to know about the junction first needs that more than this.
   */
  useEffect(() => {
    if (!speaking || !camera) return;
    const said = `camera:${camera.camera.id}`;
    if (spoken.current.has(said)) return;
    spoken.current.add(said);
    say(cameraWords(camera.camera));
  }, [camera, speaking]);

  /** Read the turns out. */
  useEffect(() => {
    if (!speaking || !guidance || stage !== "driving") return;
    const cue: Cue | null = cueFor(guidance.toTurn, guidance.step.metres);
    if (!cue) return;
    const said = `${route?.at ?? 0}:${guidance.stepIndex}:${cue}`;
    if (spoken.current.has(said)) return;
    spoken.current.add(said);
    say(announcement(guidance.next, cue, guidance.toTurn), { urgent: cue === "now" });
  }, [guidance, speaking, stage, route?.at]);

  /** Say so on arrival, once. */
  useEffect(() => {
    if (stage !== "arrived") return;
    hush();
    if (speaking) say(`You have arrived at ${where}`, { urgent: true });
    // Said once, on arriving
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => () => hush(), []);

  /**
   * Pass the arrival time out while navigating, and withdraw it on the way
   * out. A time left behind after the chauffeur stops navigating is exactly
   * the stale number a passenger would ring about.
   */
  useEffect(() => {
    if (!onEta) return;
    onEta(stage === "driving" && guidance ? Math.round(guidance.secondsLeft) : null);
  }, [onEta, stage, guidance]);

  useEffect(() => () => onEta?.(null), [onEta]);

  const toggleVoice = () => {
    const wanted = !speaking;
    setSpeaking(wanted);
    rememberVoice(wanted);
    if (wanted) wakeVoice();
    else hush();
  };

  /**
   * The one thing the chauffeur would press next, if anything.
   *
   * Only ever one, and only when it is actually due: a screen with four
   * buttons on it at seventy miles an hour is a screen nobody reads.
   */
  const due: "arrived" | "pob" | "waiting" | "setdown" | null =
    what === "pickup" && status !== "arrived" && stage === "arrived"
      ? "arrived"
      : status === "arrived"
        ? "pob"
        : what === "dropoff" && stage === "arrived"
          ? // An hourly hire pulls up and waits; a booked journey ends here
            asDirected
            ? "waiting"
            : "setdown"
          : null;

  const Arrow = guidance ? ARROWS[guidance.next.turn] : ArrowUp;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="relative flex-1 min-h-0">
      {route && guidance && stage !== "stuck" && (
        <Suspense fallback={null}>
          {onGoogle ? (
            <DriveMapGoogle
              key={theme}
              theme={theme}
              line={route.line}
              car={guidance.snapped}
              lineIndex={guidance.lineIndex}
              course={guidance.course}
              to={target}
              cameras={cameras}
              toTurn={guidance.toTurn}
              onUnavailable={() => setGoogleOut(true)}
            />
          ) : (
            <DriveMap
              key={theme}
              theme={theme}
              line={route.line}
              car={guidance.snapped}
              lineIndex={guidance.lineIndex}
              course={guidance.course}
              to={target}
              cameras={cameras}
              toTurn={guidance.toTurn}
            />
          )}
        </Suspense>
      )}

      {/*
        The camera on the road ahead.

        Sits over the map rather than in the strip along the bottom, because
        it belongs to the piece of road being looked at and because it comes
        and goes. The limit beside it is the one that camera is watching, so a
        chauffeur can see at a glance whether they need to do anything at all.
      */}
      {/*
        Which way there.

        A car was sent down country lanes all day because the fastest way and
        the sensible way are not the same thing, and no setting anywhere says
        prefer main roads. The fastest is already being driven by the time
        this appears, so ignoring it costs nothing and the choice is real.
      */}
      {choosing && choices.length > 1 && (
        <div className="absolute inset-x-3 bottom-4 z-10 bg-charcoal/95 border border-champagne/30 shadow-2xl">
          <p className="px-4 pt-3 text-[10px] tracking-[0.2em] uppercase text-smoke">
            Which way?
          </p>
          <div className="p-3 pt-2 space-y-2">
            {choices.map((way, i) => {
              const mine = way === route;
              return (
                <button
                  key={`${way.via ?? i}-${Math.round(way.seconds)}`}
                  type="button"
                  onClick={() => switchTo(way)}
                  className={`w-full flex items-baseline justify-between gap-3 px-3 py-3 text-left border ${
                    mine ? "border-champagne bg-champagne/10" : "border-border"
                  }`}
                >
                  <span className="text-sm text-foreground truncate">
                    {way.via || (i === 0 ? "Fastest" : "Another way")}
                  </span>
                  <span className="text-xs tracking-[0.1em] text-smoke shrink-0">
                    {Math.max(1, Math.round(way.seconds / 60))} min
                    {i === 0 ? " · fastest" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {camera && !choosing && (
        <div className="absolute left-4 bottom-4 flex items-center gap-3 rounded-2xl bg-charcoal/95 border border-champagne/30 px-4 py-3 shadow-2xl">
          <div className="w-10 h-10 rounded-full bg-champagne/15 border border-champagne/40 grid place-items-center shrink-0">
            <Camera className="w-5 h-5 text-champagne" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-foreground leading-tight">
              {cameraWords(camera.camera)}
            </p>
            <p className="text-[11px] tracking-[0.15em] uppercase text-smoke">
              {shownDistance(camera.toCamera)}
            </p>
          </div>
          {camera.camera.limitMph !== null && (
            <div className="w-12 h-12 rounded-full bg-white border-[4px] border-red-600 grid place-items-center shrink-0">
              <span className="text-base font-semibold text-black leading-none">
                {camera.camera.limitMph}
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        How fast the car is going.

        Bottom right, opposite the camera warning, which is where every sat
        nav puts it and so where a chauffeur's eye already goes. It shows
        only while there is a speed to show: standing still the phone often
        reports nothing at all, and a nought that is really a shrug is worse
        than an empty corner.
      */}
      {stage === "driving" && mph !== null && !choosing && (
        <div className="absolute right-4 bottom-4 w-[4.5rem] h-[4.5rem] rounded-full bg-charcoal/95 border border-champagne/30 grid place-items-center shadow-2xl">
          <span className="text-2xl font-light text-foreground leading-none">{mph}</span>
          <span className="text-[9px] tracking-[0.2em] uppercase text-smoke mt-0.5">mph</span>
        </div>
      )}

      </div>

      {/*
        Somewhere else, asked for from the back seat.

        Sits above the turn because it matters more, and takes one tap. The
        turn underneath still belongs to the route being driven, so a
        chauffeur who ignores this carries on to where they were going.
      */}
      {redirect && (
        <div className="order-first shrink-0 bg-champagne/15 border-b border-champagne pt-[env(safe-area-inset-top)]">
          <div className="px-4 py-3 space-y-2">
            <p className="text-[10px] tracking-[0.2em] uppercase text-champagne">
              Your passenger has asked for
            </p>
            <p className="text-sm text-foreground">{redirect}</p>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setRedirect(null);
                  routedFor.current = address;
                  setStage("finding");
                  setAttempt((n) => n + 1);
                }}
                className="flex-1 h-12 rounded-none text-xs tracking-[0.15em] uppercase font-light"
              >
                Drive there
              </Button>
              <Button
                variant="outline"
                onClick={() => setRedirect(null)}
                className="h-12 px-4 rounded-none text-xs tracking-[0.15em] uppercase font-light text-smoke"
              >
                Not yet
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* What to do next, across the top where it can be read at a glance */}
      {stage === "driving" && guidance && (
        <div className="order-first shrink-0 bg-charcoal border-b border-champagne/20 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-4 px-4 py-4">
            <Arrow className="w-10 h-10 shrink-0 text-champagne" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-2xl font-light text-champagne leading-none">
                {shownDistance(guidance.toTurn)}
              </p>
              <p className="mt-1 text-sm text-foreground truncate">{guidance.next.instruction}</p>
            </div>
          </div>
          {guidance.then && guidance.then.turn !== "arrive" && (
            <p className="px-4 pb-3 text-[11px] tracking-[0.1em] uppercase text-smoke truncate">
              Then {guidance.then.instruction.toLowerCase()}
            </p>
          )}
        </div>
      )}

      {stage === "finding" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-champagne" />
          <p className="text-xs tracking-[0.15em] uppercase text-smoke">
            Working out the way to {where}
          </p>
        </div>
      )}

      {/*
        Where to, asked in the car.

        This is the whole of an hourly hire: the passenger gets in, says a
        place, and this is where it goes. It sits on the drive screen so the
        chauffeur never has to come out of navigation to record it, and the
        route starts the moment it is picked.
      */}
      {stage === "asking" && (
        <div className="absolute inset-0 flex flex-col justify-center gap-4 px-5">
          <p className="text-center text-sm text-foreground">
            {askingWhere
              ? "Your passenger is aboard. Where have they asked for?"
              : `There is no postcode on this job, so the sat nav cannot take you to ${where}.`}
          </p>
          <DestinationBox
            chosen={null}
            changing={false}
            onChange={() => undefined}
            onPick={(picked) => (askingWhere ? onDestination?.(picked) : setTyped(picked))}
          />
          <p className="text-center text-[11px] text-smoke leading-relaxed">
            {askingWhere
              ? "Search the place, the address or the postcode. Driving starts as soon as you pick it, and the address goes on the job for the office."
              : "Search it and driving starts as soon as you pick it. The job keeps the address the office gave it."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-[0.15em] uppercase text-smoke"
          >
            Back to the job
          </button>
        </div>
      )}

      {stage === "stuck" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
          <p className="text-sm text-foreground">{trouble}</p>
          {reason && <p className="text-xs text-smoke leading-relaxed">{reason}</p>}
          <Button
            variant="outline"
            onClick={() => void tryAgain()}
            className="h-14 w-full rounded-none text-sm tracking-[0.15em] uppercase font-light"
          >
            Try again
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-[0.15em] uppercase text-smoke"
          >
            Back to the job
          </button>
        </div>
      )}

      {/* The strip along the bottom: the next step, when the car is due, the way out */}
      {stage !== "stuck" && stage !== "asking" && (
        <div className="shrink-0 bg-charcoal border-t border-champagne/20 pb-[env(safe-area-inset-bottom)]">
          {/* The cameras are open data, and the licence asks for the credit */}
          {cameras.length > 0 && stage === "driving" && (
            <p className="px-4 pt-2 text-[10px] tracking-[0.15em] uppercase text-smoke/60">
              Cameras: OpenStreetMap
            </p>
          )}
          {route && !route.withTraffic && stage !== "arrived" && (
            <p className="px-4 pt-2 text-[10px] tracking-[0.15em] uppercase text-smoke/70">
              Arrival time allows for no traffic
            </p>
          )}

          {/* The job moves on from here, so nobody has to leave the drive */}
          {due && (
            <div className="px-4 pt-3">
              {stage === "arrived" && (
                <p className="pb-2 text-center text-xs tracking-[0.15em] uppercase text-champagne">
                  You are at {where}
                </p>
              )}
              <Button
                onClick={() => {
                  if (due === "setdown") {
                    hush();
                    onSetDown();
                    return;
                  }
                  if (due === "waiting") hush();
                  onAdvance(due);
                }}
                className="h-16 w-full rounded-none text-sm tracking-[0.2em] uppercase font-light"
              >
                {due === "arrived"
                  ? "I have arrived"
                  : due === "pob"
                    ? "Passenger on board"
                    : due === "waiting"
                      ? "Wait here for the passenger"
                      : "Set the passenger down"}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-4 px-4 py-4">
            <div className="flex-1">
              <p className="text-2xl font-light text-champagne leading-none">
                {stage === "arrived" ? "Arrived" : guidance ? arrivalAt(guidance.secondsLeft) : "--:--"}
              </p>
              <p className="mt-1 text-[11px] tracking-[0.1em] uppercase text-smoke">
                {stage === "arrived"
                  ? where === "the collection"
                    ? "At the collection"
                    : "At the destination"
                  : guidance
                    ? `${minutesLeft(guidance.secondsLeft)} min · ${shownDistance(guidance.metresLeft)}`
                    : "Finding you"}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Switch to the ${otherTheme(theme)} map`}
              onClick={() => {
                const wanted = otherTheme(theme);
                setTheme(wanted);
                rememberMapTheme(wanted);
              }}
              className="p-3 text-champagne"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              aria-label={speaking ? "Turn the voice off" : "Turn the voice on"}
              onClick={toggleVoice}
              className="p-3 text-champagne"
            >
              {speaking ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button
              type="button"
              aria-label="Stop navigating"
              onClick={() => {
                hush();
                onClose();
              }}
              className="p-3 text-smoke"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriveScreen;
