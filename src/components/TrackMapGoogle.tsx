import { useCallback, useEffect, useRef } from "react";
import { loadGoogleMaps, mapId } from "@/lib/googleMaps";
import {
  GLIDE_MS,
  bearing,
  carElement,
  easeInOut,
  lookUpPostcode,
  metresBetween,
  pickupElement,
  prefersReducedMotion,
  shouldTurn,
} from "@/lib/trackMarker";

/** Close enough to see which street the car is on. */
const FOLLOW_ZOOM = 16;

/** Beyond this the car has been dragged off screen and is worth recentring. */
const NUDGE_M = 25;

export interface Props {
  lat: number;
  lng: number;
  /** Where the car is going, as a pin that never decides the zoom. */
  pickupPostcode?: string;
  /** Google would not load, so the screen can fall back to the open map. */
  onUnavailable: () => void;
}

/**
 * The live map a member watches, drawn by Google.
 *
 * The chauffeur's screen and this one now draw from the same place, which is
 * the point: a member comparing the two sees one company rather than two
 * different maps, and Google's own tiles are what everybody already reads a
 * moving car on.
 *
 * It is flat and north up, unlike the chauffeur's, because a passenger is
 * watching a car rather than driving it, and a tilted map that swings with
 * every turn is harder to follow from the back seat.
 */
const TrackMapGoogle = ({ lat, lng, pickupPostcode, onUnavailable }: Props) => {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const carRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const pickupRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const headingRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const atRef = useRef({ lat, lng });

  /**
   * Run something against Google's map, and hand over to the open map if it
   * throws.
   *
   * This runs on every position report, so a missing API or a map id that is
   * not a vector one would throw every few seconds. Falling back costs the
   * member nothing they can see; throwing costs them the map.
   */
  const guarded = useCallback(
    (what: () => void) => {
      try {
        what();
      } catch (err) {
        console.error("track map: falling back", err);
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
        const map = new maps.Map(holder.current, {
          mapId: mapId(),
          center: { lat, lng },
          zoom: FOLLOW_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          // A passenger is following a car, not surveying the ground
          rotateControl: false,
          tilt: 0,
        });
        carRef.current = new maps.marker.AdvancedMarkerElement({
          map,
          position: { lat, lng },
          content: carElement(),
        });
        mapRef.current = map;
      } catch (err) {
        console.error("track map: Google would not load", err);
        if (!dropped) onUnavailable();
      }
    };
    void start();

    return () => {
      dropped = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (carRef.current) carRef.current.map = null;
      if (pickupRef.current) pickupRef.current.map = null;
      carRef.current = null;
      pickupRef.current = null;
      mapRef.current = null;
    };
    // Started once; every later position is handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Walk the car to each new position, turn it, and keep it in view. */
  useEffect(() => {
    const map = mapRef.current;
    const marker = carRef.current;
    if (!map || !marker) return;

    const from = atRef.current;
    const moved = metresBetween(from.lat, from.lng, lat, lng);
    if (shouldTurn(moved)) headingRef.current = bearing(from.lat, from.lng, lat, lng);
    const inner = (marker.content as HTMLElement)?.querySelector<HTMLElement>(".apx-car");
    if (inner) inner.style.transform = `rotate(${headingRef.current}deg)`;

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    guarded(() => {
      // A jump of this size is a different car or a bad fix, not a journey
      if (prefersReducedMotion() || moved < 1 || moved > 20000) {
        marker.position = { lat, lng };
      } else {
        const started = performance.now();
        const step = (now: number) => {
          const e = easeInOut(Math.min(1, (now - started) / GLIDE_MS));
          marker.position = {
            lat: from.lat + (lat - from.lat) * e,
            lng: from.lng + (lng - from.lng) * e,
          };
          if (e < 1) frameRef.current = requestAnimationFrame(step);
        };
        frameRef.current = requestAnimationFrame(step);
      }

      // Recentre when the car has moved, or when it has wandered near enough
      // to an edge that the next report would take it off screen
      const bounds = map.getBounds();
      let comfortable = false;
      if (bounds) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const padLng = (ne.lng() - sw.lng()) * 0.25;
        const padLat = (ne.lat() - sw.lat()) * 0.25;
        comfortable =
          lng > sw.lng() + padLng &&
          lng < ne.lng() - padLng &&
          lat > sw.lat() + padLat &&
          lat < ne.lat() - padLat;
      }
      if (moved > NUDGE_M || !comfortable) map.panTo({ lat, lng });
    });

    atRef.current = { lat, lng };
  }, [lat, lng, guarded]);

  /** Mark where the car is headed, once we know where that is. */
  useEffect(() => {
    if (!pickupPostcode || pickupRef.current) return;
    let cancelled = false;
    void lookUpPostcode(pickupPostcode).then(async (point) => {
      const map = mapRef.current;
      if (cancelled || !map || !point) return;
      try {
        const maps = await loadGoogleMaps();
        if (cancelled || !mapRef.current) return;
        pickupRef.current = new maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: point.lat, lng: point.lng },
          content: pickupElement(),
        });
      } catch (err) {
        console.error("track map: no pickup pin", err);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pickupPostcode]);

  return <div ref={holder} className="apx-map h-72 sm:h-80 w-full border border-border" />;
};

export default TrackMapGoogle;
