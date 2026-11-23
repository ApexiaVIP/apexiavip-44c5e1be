import { useEffect, useMemo, useRef } from "react";
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

/** A car the booking system has given us a position for. */
export interface FleetCar {
  reference: string;
  lat: number;
  lng: number;
  /** When the booking system placed the car, so the age can be shown */
  at: string | null;
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

const ageOf = (at: string | null): string => {
  if (!at) return "position age unknown";
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "position age unknown";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "moments ago";
  if (mins === 1) return "a minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
};

const label = (car: FleetCar): string => {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const lines = [
    `<div style="font-weight:600">${esc(car.chauffeur || "Chauffeur not named")}</div>`,
    car.registration ? `<div>${esc(car.registration)}</div>` : "",
    car.passenger ? `<div style="opacity:.75">${esc(car.passenger)}</div>` : "",
    car.bookingStatus ? `<div style="opacity:.75">${esc(car.bookingStatus)}</div>` : "",
    `<div style="opacity:.55;font-size:11px;margin-top:2px">${esc(ageOf(car.at))}</div>`,
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
const FleetMap = ({ cars, waiting }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const held = useRef(new Map<string, Held>());
  const readyRef = useRef(false);
  /** Once the desk has moved the map, it belongs to them, not to us. */
  const takenOverRef = useRef(false);
  /** Which cars the last fit framed, so a new arrival reframes but a step does not. */
  const framedRef = useRef("");

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
    map.on("load", () => {
      readyRef.current = true;
    });
    // Dragging or zooming by hand is the desk saying where it wants to look
    map.on("dragstart", () => {
      takenOverRef.current = true;
    });
    map.on("zoomstart", (e) => {
      if ((e as unknown as { originalEvent?: unknown }).originalEvent) takenOverRef.current = true;
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
      readyRef.current = false;
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
    const framing = [...seen].sort().join(",");
    if (framing && framing !== framedRef.current && !takenOverRef.current) {
      framedRef.current = framing;
      const placed = cars.filter((c) => seen.has(c.reference));
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
              <p className="text-xs tracking-[0.22em] uppercase mb-2 opacity-60">
                No cars on the road yet
              </p>
              <p className="text-sm leading-relaxed opacity-80">
                A car appears here once the booking system starts reporting its position, which is
                fifteen minutes before the collection, or sooner if the chauffeur sets off early.
                {soonest
                  ? ` The next collection is at ${soonest.toLocaleTimeString("en-GB", {
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
          <p className="text-[11px] tracking-[0.22em] uppercase mb-3 opacity-60">
            Allocated, not yet on the map
          </p>
          <ul className="divide-y divide-border border border-border">
            {waiting.map((w) => (
              <li key={w.reference} className="px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-sm font-medium">
                  {w.collectionAt
                    ? new Date(w.collectionAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Time to confirm"}
                </span>
                <span className="text-sm opacity-85">{w.passenger || "Passenger to confirm"}</span>
                {/* Only when there is one. The reason beside it already says
                    so otherwise, and saying it twice reads as two faults. */}
                {w.chauffeur && <span className="text-sm opacity-70">{w.chauffeur}</span>}
                <span className="text-xs opacity-55 ml-auto">{w.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FleetMap;
