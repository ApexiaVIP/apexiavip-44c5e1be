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
  Moon,
  Sun,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lookUpPostcode, metresBetween } from "@/lib/trackMarker";
import { destinationQuery } from "@/lib/navigation";
import DestinationBox from "./DestinationBox";
import type { PlaceSuggestion } from "@/lib/mfa";
import { fromGoogle, fromOsrm, type LatLng, type NavRoute, type Turn } from "@/lib/navRoute";
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

const DriveMap = lazy(() => import("./DriveMap"));
const DriveMapGoogle = lazy(() => import("./DriveMapGoogle"));

/** Already there, so there is nothing to navigate. */
const ALREADY_THERE_M = 60;

/** Two fixes off the route before asking for a new one, so one bad fix is ignored. */
const STRAY_FIXES = 2;

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
  const [trouble, setTrouble] = useState("");
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
  const onGoogle = googleMapsConfigured() && !googleOut;

  const lineIndex = useRef(-1);
  /** The furthest along the route the car has got, so it never slips back. */
  const along = useRef(0);
  const strayed = useRef(0);
  const askedAt = useRef(0);
  const asking = useRef(false);
  const spoken = useRef<Set<string>>(new Set());
  const latest = useRef<Fix | null>(null);
  /** The address the route on screen was worked out for. */
  const routedFor = useRef("");

  const where = what === "pickup" ? "the collection" : "the destination";
  const address = useMemo(() => destinationQuery(to), [to]);

  /**
   * Ask for a route from wherever the car is now.
   *
   * The address is passed in rather than read from the props, because the
   * props can change under a drive in progress: the passenger asks for
   * somewhere else and, until the chauffeur takes it, a refresh has to keep
   * asking about the place they are actually driving to.
   */
  const plot = useCallback(
    async (from: Fix, door: LatLng, forAddress: string) => {
      if (asking.current) return;
      asking.current = true;
      askedAt.current = Date.now();
      try {
        const { data, error } = await supabase.functions.invoke("route", {
          body: {
            from: { lat: from.lat, lng: from.lng },
            to: door,
            address: forAddress,
            heading: from.heading,
            reference,
          },
        });
        if (error || data?.error) throw new Error(data?.error ?? "no route");
        const worked =
          data.provider === "google"
            ? fromGoogle(data.route)
            : fromOsrm(data.route, data.withTraffic === true);
        if (!worked) throw new Error("no route");
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
        return worked;
      } catch {
        return null;
      } finally {
        asking.current = false;
      }
    },
    [reference]
  );

  /**
   * Whether this drive is waiting to be told where it is going.
   *
   * An hourly hire has no destination until the passenger says one, so an
   * empty address here is the normal state of the job rather than a fault
   * with it, and the screen asks instead of complaining.
   */
  const askingWhere = asDirected && what === "dropoff" && !to?.postcode?.trim() && !!onDestination;

  /** Find the door, find the car, and work out the way there. */
  useEffect(() => {
    let dropped = false;
    const begin = async () => {
      if (askingWhere) {
        setStage("asking");
        return;
      }
      // Somewhere else has been asked for since this route was worked out.
      // Hold it up and tell the chauffeur rather than turning the car
      if (routedFor.current && address && address !== routedFor.current) {
        setRedirect(address);
        return;
      }
      const postcode = to?.postcode?.trim();
      if (!postcode) {
        setTrouble("This job has no postcode, so there is nothing to navigate to.");
        setStage("stuck");
        return;
      }
      const door = await lookUpPostcode(postcode);
      if (dropped) return;
      if (!door) {
        setTrouble(`Could not find ${postcode} on the map.`);
        setStage("stuck");
        return;
      }
      setTarget(door);

      const { currentFix } = await import("@/lib/whereAmI");
      const from = await currentFix();
      if (dropped) return;
      if (!from) {
        setTrouble("Could not work out where you are. Check location is on for this app.");
        setStage("stuck");
        return;
      }
      latest.current = from;

      if (metresBetween(from.lat, from.lng, door.lat, door.lng) < ALREADY_THERE_M) {
        setStage("arrived");
        return;
      }
      const worked = await plot(from, door, address);
      if (dropped) return;
      if (!worked) {
        setTrouble("Could not work out a route just now.");
        setStage("stuck");
      }
    };
    void begin();
    return () => {
      dropped = true;
    };
  }, [to?.postcode, plot, askingWhere, attempt, address]);

  /** Have another go at finding the way, after a route would not come. */
  const tryAgain = useCallback(() => {
    setTrouble("");
    setStage("finding");
    setAttempt((n) => n + 1);
  }, []);

  /** Follow the car along the route. */
  useEffect(() => {
    if (!route || !target) return;
    const stop = watchDriving((fix) => {
      latest.current = fix;
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
      // Never refresh while somewhere else is waiting to be accepted: the
      // door on screen belongs to the old address and the words would belong
      // to the new one, which is a route to neither
      if (settled && worthIt && (strayed.current >= STRAY_FIXES || stale)) {
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
            />
          )}
        </Suspense>
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
            Your passenger is aboard. Where have they asked for?
          </p>
          <DestinationBox
            chosen={null}
            changing={false}
            onChange={() => undefined}
            onPick={(picked) => onDestination?.(picked)}
          />
          <p className="text-center text-[11px] text-smoke leading-relaxed">
            Search the place, the address or the postcode. Driving starts as soon as you
            pick it, and the address goes on the job for the office.
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
