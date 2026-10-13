import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The map engine builds its own worker from a path relative to its own
// module, which the bundler rewrites, so the worker is never emitted and the
// map comes up blank. Handing it a URL the bundler does emit fixes that.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(maplibreWorkerUrl);
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

interface Props {
  lat: number;
  lng: number;
  pickupPostcode?: string;
}

/**
 * The live map, drawn from vector tiles.
 *
 * Raster tiles are 256 pixel images: on a phone they are stretched and can
 * never be sharp, and zoom arrives in steps. Vector tiles are drawn by the
 * phone at its own resolution, so the map stays crisp at any size and pinch
 * zoom is continuous, which is what people mean when they compare it to the
 * ride apps. The tiles are free and need no key.
 */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Close enough to see which street the car is on. */
const FOLLOW_ZOOM = 16;

const TrackMapVector = ({ lat, lng, pickupPostcode }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const carRef = useRef<maplibregl.Marker | null>(null);
  const pickupRef = useRef<maplibregl.Marker | null>(null);
  const headingRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [lng, lat],
      zoom: FOLLOW_ZOOM,
      attributionControl: false,
      // The passenger is watching a car, not surveying
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    carRef.current = new maplibregl.Marker({ element: carElement() })
      .setLngLat([lng, lat])
      .addTo(map);
    mapRef.current = map;

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      map.remove();
      mapRef.current = null;
      carRef.current = null;
      pickupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Walk the car to each new position and keep it near the middle
  useEffect(() => {
    const map = mapRef.current;
    const car = carRef.current;
    if (!map || !car) return;

    const from = car.getLngLat();
    const moved = metresBetween(from.lat, from.lng, lat, lng);
    if (shouldTurn(moved)) headingRef.current = bearing(from.lat, from.lng, lat, lng);
    const inner = car.getElement().querySelector<HTMLElement>(".apx-car");
    if (inner) inner.style.transform = `rotate(${headingRef.current}deg)`;

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (prefersReducedMotion() || moved < 1 || moved > 20000) {
      car.setLngLat([lng, lat]);
    } else {
      const started = performance.now();
      const step = (now: number) => {
        const e = easeInOut(Math.min(1, (now - started) / GLIDE_MS));
        car.setLngLat([from.lng + (lng - from.lng) * e, from.lat + (lat - from.lat) * e]);
        if (e < 1) frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    }

    const b = map.getBounds();
    const padLng = (b.getEast() - b.getWest()) * 0.25;
    const padLat = (b.getNorth() - b.getSouth()) * 0.25;
    const comfortable =
      lng > b.getWest() + padLng &&
      lng < b.getEast() - padLng &&
      lat > b.getSouth() + padLat &&
      lat < b.getNorth() - padLat;
    if (moved > 25 || !comfortable) {
      map.easeTo({ center: [lng, lat], duration: 800 });
    }
  }, [lat, lng]);

  // Mark the pickup, which never decides the zoom
  useEffect(() => {
    if (!pickupPostcode || pickupRef.current) return;
    let cancelled = false;
    lookUpPostcode(pickupPostcode).then((point) => {
      const map = mapRef.current;
      if (cancelled || !map || !point) return;
      pickupRef.current = new maplibregl.Marker({ element: pickupElement() })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPostcode]);

  return <div ref={containerRef} className="apx-map h-72 sm:h-80 w-full border border-border" />;
};

export default TrackMapVector;
