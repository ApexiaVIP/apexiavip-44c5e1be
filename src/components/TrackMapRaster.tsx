import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
 * A clean, light map, close in on the car.
 *
 * A passenger wants one thing from this: where is my car, right now. So it is
 * drawn pale with the roads picked out in white, and it stays zoomed in on
 * the car rather than pulling back to fit the whole journey, which left the
 * car a speck somewhere in Greater Manchester.
 */
const BASE = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "&copy; Esri &copy; OpenStreetMap contributors";

/** Close enough to see which street the car is on. */
const FOLLOW_ZOOM = 16;

const carIcon = L.divIcon({ className: "", html: carElement().innerHTML, iconSize: [30, 30], iconAnchor: [15, 15] });
const pickupIcon = L.divIcon({ className: "", html: pickupElement().innerHTML, iconSize: [14, 14], iconAnchor: [7, 7] });

const TrackMapRaster = ({ lat, lng, pickupPostcode }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const carRef = useRef<L.Marker | null>(null);
  const pickupRef = useRef<L.Marker | null>(null);
  const headingRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false }).setView([lat, lng], FOLLOW_ZOOM);
    L.tileLayer(BASE, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
    L.tileLayer(LABELS, { maxZoom: 16 }).addTo(map);
    carRef.current = L.marker([lat, lng], { icon: carIcon }).addTo(map);
    mapRef.current = map;
    // The container's size may not be settled at construction time; without
    // this, any subsequent fitBounds computes against a zero-height box
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView([lat, lng], FOLLOW_ZOOM);
    });
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      map.remove();
      mapRef.current = null;
      carRef.current = null;
      pickupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const car = carRef.current;
    if (!map || !car) return;

    const from = car.getLatLng();
    const moved = metresBetween(from.lat, from.lng, lat, lng);
    if (shouldTurn(moved)) headingRef.current = bearing(from.lat, from.lng, lat, lng);
    const inner = car.getElement()?.querySelector<HTMLElement>(".apx-car");
    if (inner) inner.style.transform = `rotate(${headingRef.current}deg)`;

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (prefersReducedMotion() || moved < 1 || moved > 20000) {
      car.setLatLng([lat, lng]);
    } else {
      const started = performance.now();
      const step = (now: number) => {
        const e = easeInOut(Math.min(1, (now - started) / GLIDE_MS));
        car.setLatLng([from.lat + (lat - from.lat) * e, from.lng + (lng - from.lng) * e]);
        if (e < 1) frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    }

    // Keep the car near the middle at the same zoom, rather than letting it
    // wander to an edge and clip. Below about twenty five metres the movement
    // is GPS jitter and panning for it would make the map twitch.
    const position = L.latLng(lat, lng);
    if (moved > 25 || !map.getBounds().pad(-0.25).contains(position)) {
      map.panTo(position, { animate: true, duration: 0.8 });
    }
  }, [lat, lng]);

  useEffect(() => {
    if (!pickupPostcode || pickupRef.current) return;
    let cancelled = false;
    lookUpPostcode(pickupPostcode).then((point) => {
      const map = mapRef.current;
      if (cancelled || !map || !point) return;
      pickupRef.current = L.marker([point.lat, point.lng], { icon: pickupIcon }).addTo(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPostcode]);

  return <div ref={containerRef} className="apx-map h-72 sm:h-80 w-full border border-border" />;
};

export default TrackMapRaster;
