import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { loadGoogleMaps, mapId, pointAhead, turnTowards } from "@/lib/googleMaps";
import type { LatLng } from "@/lib/navRoute";
import { routeColours, type MapTheme } from "@/lib/mapTheme";

/** Close enough to see which lane, tilted so the road ahead fills the screen. */
const DRIVE_ZOOM = 17;
const DRIVE_TILT = 60;

/**
 * How far in front of the car the map is centred.
 *
 * Google's camera has no padding of its own, so the car is pushed down the
 * screen by aiming the camera at a spot up the road instead.
 */
const AHEAD_M = 130;

/** Roughly the gap between fixes, so the car is nearly always moving. */
const GLIDE_MS = 900;

const car = (theme: MapTheme) => `
<svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
  <circle cx="19" cy="19" r="15" fill="#14120f" stroke="${theme === "light" ? "#ffffff" : "#cdbb95"}" stroke-width="2"/>
  <path d="M19 9.5 27 27l-8-4.2L11 27Z" fill="${theme === "light" ? "#cdbb95" : "#cdbb95"}"/>
</svg>`;

/** The door, picked out against whichever map is underneath it. */
const door = (theme: MapTheme) => `
<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
  <circle cx="10" cy="10" r="6" fill="${theme === "light" ? "#14120f" : "#ffffff"}" stroke="${theme === "light" ? "#ffffff" : "#14120f"}" stroke-width="3"/>
</svg>`;

const pin = (svg: string): HTMLDivElement => {
  const el = document.createElement("div");
  el.innerHTML = svg;
  el.style.filter = "drop-shadow(0 2px 6px rgba(0,0,0,0.6))";
  return el;
};

interface Props {
  /** The whole route, start to finish. */
  line: LatLng[];
  /** The car, already pulled onto the route. */
  car: LatLng;
  /** The last point of the line the car has passed. */
  lineIndex: number;
  /** The direction of the road under the car. */
  course: number;
  /** The address itself, as a pin. */
  to: LatLng | null;
  /** Light or dark, as the chauffeur asked for. */
  theme: MapTheme;
  /** Google would not load, so the screen can fall back to the other map. */
  onUnavailable: () => void;
}

/**
 * The driving map, drawn by Google.
 *
 * Google's routing and Google's map go together: the traffic the route was
 * worked out from is the traffic drawn on the tiles, and it is the map every
 * chauffeur already knows from Waze and from Maps.
 *
 * It follows the car and turns with it, until the chauffeur drags it to look
 * at something, at which point it stays where they put it and offers to go
 * back. A map that fights the hand holding it is worse than no map.
 */
const DriveMapGoogle = ({ line, car: at, lineIndex, course, to, theme, onUnavailable }: Props) => {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const carRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const doorRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const doneRef = useRef<google.maps.Polyline | null>(null);
  const leftRef = useRef<google.maps.Polyline | null>(null);
  const camera = useRef({ lat: at.lat, lng: at.lng, heading: course });
  const gliding = useRef(0);
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(true);

  /**
   * Run something against Google's map, and hand the screen over to the other
   * map if it throws.
   *
   * The camera runs on every fix, so an API that is not there, or a map id
   * that turns out not to be a vector one, would throw once a second. Falling
   * back costs the chauffeur live traffic; throwing costs them the screen.
   */
  const guarded = useCallback(
    (what: () => void) => {
      try {
        what();
      } catch (err) {
        console.error("drive map: falling back", err);
        onUnavailable();
      }
    },
    [onUnavailable]
  );

  useEffect(() => {
    let dropped = false;
    const start = async () => {
      try {
        const maps = await loadGoogleMaps();
        if (dropped || !holder.current) return;

        const aim = pointAhead(at.lat, at.lng, course, AHEAD_M);
        const map = new maps.Map(holder.current, {
          mapId: mapId(),
          center: aim,
          zoom: DRIVE_ZOOM,
          tilt: DRIVE_TILT,
          heading: course,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          keyboardShortcuts: false,
          clickableIcons: false,
          // Night colours, which is what a chauffeur is driving in half the
          // year here. Asked for by name rather than built as a custom style,
          // so Google keeps it current. Older builds of the API ignore it and
          // simply draw the daytime map
          colorScheme: theme === "light" ? "LIGHT" : "DARK",
        } as google.maps.MapOptions);
        mapRef.current = map;
        camera.current = { lat: aim.lat, lng: aim.lng, heading: course };

        const { AdvancedMarkerElement } = (await maps.importLibrary(
          "marker"
        )) as google.maps.MarkerLibrary;
        if (dropped) return;

        carRef.current = new AdvancedMarkerElement({
          map,
          position: at,
          content: pin(car(theme)),
          zIndex: 3,
        });

        doneRef.current = new maps.Polyline({
          map,
          path: [],
          strokeColor: routeColours(theme).done,
          strokeOpacity: 1,
          strokeWeight: 7,
          zIndex: 1,
        });
        leftRef.current = new maps.Polyline({
          map,
          path: [],
          strokeColor: routeColours(theme).line,
          strokeOpacity: 1,
          strokeWeight: 7,
          zIndex: 2,
        });

        // Only a real drag counts. Moving the camera after the car does not
        // raise this, so the map keeps following through every bend
        map.addListener("dragstart", () => setFollowing(false));
        setReady(true);
      } catch {
        if (!dropped) onUnavailable();
      }
    };
    void start();
    return () => {
      dropped = true;
      cancelAnimationFrame(gliding.current);
      carRef.current = null;
      doorRef.current = null;
      doneRef.current?.setMap(null);
      leftRef.current?.setMap(null);
      mapRef.current = null;
    };
    // Built once; everything after this is an update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The route, in two parts, so the road already driven falls back. */
  useEffect(() => {
    if (!ready || line.length < 2) return;
    guarded(() => {
      doneRef.current?.setPath([...line.slice(0, Math.max(1, lineIndex + 1)), at]);
      leftRef.current?.setPath([at, ...line.slice(lineIndex + 1)]);
    });
  }, [ready, line, lineIndex, at, guarded]);

  /** The door. */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !to) return;
    if (doorRef.current) {
      guarded(() => {
        if (doorRef.current) doorRef.current.position = to;
      });
      return;
    }
    void (async () => {
      try {
        const { AdvancedMarkerElement } = (await loadGoogleMaps().then((m) =>
          m.importLibrary("marker")
        )) as google.maps.MarkerLibrary;
        if (!mapRef.current) return;
        doorRef.current = new AdvancedMarkerElement({
          map: mapRef.current,
          position: to,
          content: pin(door(theme)),
          zIndex: 2,
        });
      } catch (err) {
        // A missing pin is not worth losing the map over, so this one only
        // goes unmarked rather than handing the screen over
        console.error("drive map: could not place the destination pin", err);
      }
    })();
  }, [ready, to, guarded, theme]);

  /**
   * Follow the car.
   *
   * Google's camera moves in one jump, so each new fix is walked to over
   * about the time it takes the next one to arrive. Without it the map hops
   * once a second, which reads as a screen that keeps freezing.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    guarded(() => {
      if (carRef.current) carRef.current.position = at;
    });
    if (!following) return;

    const aim = pointAhead(at.lat, at.lng, course, AHEAD_M);
    const from = { ...camera.current };
    const toHeading = turnTowards(from.heading, course);
    const began = performance.now();

    cancelAnimationFrame(gliding.current);
    const walk = (now: number) => {
      const part = Math.min(1, (now - began) / GLIDE_MS);
      const at = {
        lat: from.lat + (aim.lat - from.lat) * part,
        lng: from.lng + (aim.lng - from.lng) * part,
        heading: from.heading + (toHeading - from.heading) * part,
      };
      camera.current = at;
      guarded(() =>
        map.moveCamera({
          center: { lat: at.lat, lng: at.lng },
          heading: ((at.heading % 360) + 360) % 360,
          tilt: DRIVE_TILT,
          zoom: DRIVE_ZOOM,
        })
      );
      if (part < 1) gliding.current = requestAnimationFrame(walk);
    };
    gliding.current = requestAnimationFrame(walk);
  }, [ready, at, course, following, guarded]);

  return (
    <div className="absolute inset-0">
      <div ref={holder} className="h-full w-full" />
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-40 right-4 z-10 flex items-center gap-2 bg-charcoal/90 border border-champagne/40 text-champagne px-4 py-3 text-xs tracking-[0.15em] uppercase"
        >
          <Crosshair className="w-4 h-4" />
          Re-centre
        </button>
      )}
    </div>
  );
};

export default DriveMapGoogle;
