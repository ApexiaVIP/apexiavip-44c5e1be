import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The map engine builds its own worker from a path relative to its own
// module, which the bundler rewrites, so the worker is never emitted and the
// map comes up blank. Handing it a URL the bundler does emit fixes that.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

import {
  bearing,
  carElement,
  easeInOut,
  glideFor,
  metresBetween,
  prefersReducedMotion,
  shouldTurn,
} from "@/lib/trackMarker";
import { locationFreshness } from "@/lib/locationAge";

/** A car the booking system has given us a position for. */
export interface FleetCar {
  reference: string;
  lat: number;
  lng: number;
  /** When the booking system placed the car, so the age can be shown */
  at: string | null;
  /**
   * How old a position from our own chauffeur app is. Their app reports in
   * seconds and stamps the time in ISO, where the booking system sends UK
   * wall clock in its own format, so the two ages are worked out differently
   * and the source has to say which one this is.
   */
  ageMs: number | null;
  chauffeur: string | null;
  registration: string | null;
  passenger: string | null;
  bookingStatus: string | null;
}

/** A job with a chauffeur on it that the booking system has not placed yet. */
export interface FleetWaiting {
  reference: string;
  passenger: string | null;
  chauffeur: string | null;
  collectionAt: string | null;
  why: string;
}

interface Props {
  cars: FleetCar[];
  waiting: FleetWaiting[];
  /**
   * How many allocated jobs were left out of cars and waiting entirely.
   *
   * The booking system is only asked about a limited number of jobs at a
   * time, so on a full match day there can be more cars out than this screen
   * is told about. Dropping them silently would have the desk believe it is
   * looking at the whole convoy when it is not.
   */
  notShown?: number;
}

/** Free vector tiles, no key, the same style the member's own map draws. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Manchester, so an empty map opens somewhere meaningful rather than at sea. */
const HOME: [number, number] = [-2.2004, 53.4831];

/**
 * The club's navy, stated rather than inherited.
 *
 * This sits on a white panel inside a dark screen, so taking the colour it is
 * given paints light text onto white and the waiting list disappears. The one
 * thing this component must never do is make a job hard to see.
 */
const INK = "#1C2C5B";

/** Close enough to read a street name without losing the rest of the fleet. */
const MAX_FIT_ZOOM = 15;

/**
 * Dispatch send the position time as "DD-MMM-YYYY HH:MM" in UK local time
 * with no offset, so it cannot be handed to Date and subtracted: that reads
 * it as the viewer's own clock and quietly reports the wrong age the moment
 * anyone opens this outside the UK. locationAge.ts already does it properly
 * and the member's own tracking screen uses it, so this uses the same one.
 */
const ageOf = (car: Pick<FleetCar, "at" | "ageMs">): string => {
  // A position from our own chauffeur app carries its age directly
  if (car.ageMs != null && Number.isFinite(car.ageMs)) {
    const mins = Math.round(car.ageMs / 60000);
    if (mins < 2) return "updated just now";
    if (mins < 60) return `updated ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    return `last seen ${hours} hr${hours > 1 ? "s" : ""} ago`;
  }
  return car.at ? locationFreshness(car.at).text || "position age unknown" : "position age unknown";
};

/** Every time on this screen is a London time, as it is everywhere else here. */
const ukTime = (value: string | null): string | null => {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const label = (car: FleetCar): string => {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const lines = [
    `<div style="font-weight:600">${esc(car.chauffeur || "Chauffeur not named")}</div>`,
    car.registration ? `<div>${esc(car.registration)}</div>` : "",
    car.passenger ? `<div style="opacity:.75">${esc(car.passenger)}</div>` : "",
    car.bookingStatus ? `<div style="opacity:.75">${esc(car.bookingStatus)}</div>` : "",
    `<div style="opacity:.75;font-size:11px;margin-top:2px">${esc(ageOf(car))}</div>`,
  ];
  return `<div style="font-size:12px;line-height:1.45">${lines.filter(Boolean).join("")}</div>`;
};

interface Held {
  marker: maplibregl.Marker;
  popup: maplibregl.Popup;
  lat: number;
  lng: number;
  heading: number;
  at: number;
  frame: number | null;
}

/**
 * Every allocated car on one map.
 *
 * The member's own map follows a single car and keeps it centred. A desk is
 * watching several at once and wants to see them against each other, so this
 * one frames the whole fleet instead, and stops reframing once somebody has
 * taken hold of the map rather than dragging the view back under them.
 *
 * The booking system only releases a position from fifteen minutes before the
 * collection, or from the moment the chauffeur sets off if that is sooner, so
 * an empty map is the ordinary state for most of the day. It says as much on
 * the face of it, because a blank map with no explanation reads as broken.
 */
const FleetMap = ({ cars, waiting, notShown = 0 }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const held = useRef(new Map<string, Held>());
  /** Once the desk has moved the map, it belongs to them, not to us. */
  const takenOverRef = useRef(false);
  /** Which cars the last fit framed, so a new arrival reframes but a step does not. */
  const framedRef = useRef("");
  /** The latest framing, so the recentre control can call it. */
  const fitRef = useRef<(() => void) | null>(null);
  /** Shown once the desk has taken the map, so they can hand it back. */
  const [taken, setTaken] = useState(false);

  /** Put every car back in view, and resume following them. */
  const frameAll = () => {
    takenOverRef.current = false;
    framedRef.current = "";
    setTaken(false);
    fitRef.current?.();
  };

  // Build once. Rebuilding on every position would throw the view away.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: HOME,
      zoom: 10,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Dragging or zooming by hand is the desk saying where it wants to look
    map.on("dragstart", () => {
      takenOverRef.current = true;
      setTaken(true);
    });
    map.on("zoomstart", (e) => {
      if ((e as unknown as { originalEvent?: unknown }).originalEvent) {
        takenOverRef.current = true;
        setTaken(true);
      }
    });
    mapRef.current = map;
    return () => {
      for (const h of held.current.values()) {
        if (h.frame !== null) cancelAnimationFrame(h.frame);
        h.marker.remove();
      }
      held.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const car of cars) {
      if (!Number.isFinite(car.lat) || !Number.isFinite(car.lng)) continue;
      seen.add(car.reference);
      const existing = held.current.get(car.reference);

      if (!existing) {
        const popup = new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(label(car));
        const marker = new maplibregl.Marker({ element: carElement() })
          .setLngLat([car.lng, car.lat])
          .setPopup(popup)
          .addTo(map);
        held.current.set(car.reference, {
          marker,
          popup,
          lat: car.lat,
          lng: car.lng,
          heading: 0,
          at: Date.now(),
          frame: null,
        });
        continue;
      }

      existing.popup.setHTML(label(car));

      const moved = metresBetween(existing.lat, existing.lng, car.lat, car.lng);
      if (moved < 1) continue;

      const fromLat = existing.lat;
      const fromLng = existing.lng;
      const heading = shouldTurn(moved)
        ? bearing(fromLat, fromLng, car.lat, car.lng)
        : existing.heading;
      const turning = existing.marker.getElement().querySelector(".apx-car") as HTMLElement | null;
      if (turning) turning.style.transform = `rotate(${heading}deg)`;

      if (existing.frame !== null) cancelAnimationFrame(existing.frame);

      // Jumping between fixes reads as a glitch. Gliding at the beat the
      // positions actually arrive at means the car arrives as the next does.
      const span = prefersReducedMotion() ? 0 : glideFor(Date.now() - existing.at);
      const startedAt = performance.now();
      const step = (now: number) => {
        const t = span <= 0 ? 1 : Math.min(1, (now - startedAt) / span);
        const e = easeInOut(t);
        const lat = fromLat + (car.lat - fromLat) * e;
        const lng = fromLng + (car.lng - fromLng) * e;
        existing.marker.setLngLat([lng, lat]);
        if (t < 1) {
          existing.frame = requestAnimationFrame(step);
        } else {
          existing.frame = null;
        }
      };
      existing.lat = car.lat;
      existing.lng = car.lng;
      existing.heading = heading;
      existing.at = Date.now();
      existing.frame = requestAnimationFrame(step);
    }

    // A car that has finished, or lost its position, leaves the map
    for (const [reference, h] of held.current) {
      if (seen.has(reference)) continue;
      if (h.frame !== null) cancelAnimationFrame(h.frame);
      h.marker.remove();
      held.current.delete(reference);
    }

    // Frame the fleet when the set of cars changes, not when one of them
    // moves, and never once the desk has taken hold of the map themselves.
    const placed = cars.filter((c) => seen.has(c.reference));
    const fit = () => {
      if (placed.length === 1) {
        map.easeTo({ center: [placed[0].lng, placed[0].lat], zoom: MAX_FIT_ZOOM });
      } else if (placed.length > 1) {
        const bounds = new maplibregl.LngLatBounds(
          [placed[0].lng, placed[0].lat],
          [placed[0].lng, placed[0].lat]
        );
        for (const c of placed) bounds.extend([c.lng, c.lat]);
        map.fitBounds(bounds, { padding: 64, maxZoom: MAX_FIT_ZOOM, duration: 800 });
      }
    };
    fitRef.current = fit;

    const framing = [...seen].sort().join(",");
    if (framing && framing !== framedRef.current && !takenOverRef.current) {
      framedRef.current = framing;
      fit();
    }
    if (!framing) framedRef.current = "";
  }, [cars]);

  const nothingYet = cars.length === 0;
  const soonest = useMemo(() => {
    const times = waiting
      .map((w) => (w.collectionAt ? new Date(w.collectionAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t) && t > Date.now())
      .sort((a, b) => a - b);
    return times.length > 0 ? new Date(times[0]) : null;
  }, [waiting]);

  return (
    <div className="w-full" style={{ color: INK }}>
      <div className="relative">
        <div
          ref={containerRef}
          className="w-full h-[420px] sm:h-[560px] border border-border"
          aria-label="Live map of allocated cars"
        />
        {taken && cars.length > 0 && (
          <button
            type="button"
            onClick={frameAll}
            className="absolute left-3 bottom-3 px-3 py-2.5 text-[10px] tracking-[0.18em] uppercase border bg-white/95 hover:bg-white transition-colors"
            style={{ color: INK, borderColor: "rgba(0,0,0,0.15)" }}
          >
            Show all cars
          </button>
        )}
        {nothingYet && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div
              className="max-w-md text-center px-6 py-5 border"
              style={{
                backgroundColor: "rgba(255,255,255,0.97)",
                borderColor: "rgba(0,0,0,0.12)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              }}
            >
              <p className="text-xs tracking-[0.22em] uppercase mb-2 opacity-80">
                No cars on the road yet
              </p>
              <p className="text-sm leading-relaxed opacity-80">
                A car appears here once the booking system starts reporting its position, which is
                fifteen minutes before the collection, or sooner if the chauffeur sets off early.
                {soonest
                  ? ` The next collection is at ${soonest.toLocaleTimeString("en-GB", {
                      timeZone: "Europe/London",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}.`
                  : ""}
              </p>
            </div>
          </div>
        )}
      </div>

      {waiting.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] tracking-[0.22em] uppercase mb-3 opacity-80">
            Allocated, not yet on the map
          </p>
          <ul className="divide-y divide-border border border-border">
            {waiting.map((w) => (
              <li key={w.reference} className="px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-sm font-medium">
                  {ukTime(w.collectionAt) ?? "Time to confirm"}
                </span>
                <span className="text-sm opacity-85">{w.passenger || "Passenger to confirm"}</span>
                {/* Only when there is one. The reason beside it already says
                    so otherwise, and saying it twice reads as two faults. */}
                {w.chauffeur && <span className="text-sm opacity-85">{w.chauffeur}</span>}
                <span className="text-xs opacity-80 ml-auto">{w.why}</span>
              </li>
            ))}
          </ul>
          {notShown > 0 && (
            <p className="mt-3 text-xs opacity-80">
              {notShown} further {notShown === 1 ? "job is" : "jobs are"} booked and not shown
              here. The booking system is asked about the cars going soonest first.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FleetMap;
