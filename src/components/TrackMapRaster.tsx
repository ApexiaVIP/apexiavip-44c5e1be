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
 * The map for devices without WebGL, which the vector map needs. Esri's dark
 * canvas is drawn dark at source, unlike the old arrangement of a light
 * OpenStreetMap turned dark with a CSS filter, which came out muddy and left
 * the labels fighting the roads.
 */
const BASE = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "&copy; Esri &copy; OpenStreetMap contributors";

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
    const map = L.map(containerRef.current, { zoomControl: false }).setView([lat, lng], 14);
    L.tileLayer(BASE, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
    L.tileLayer(LABELS, { maxZoom: 16 }).addTo(map);
    carRef.current = L.marker([lat, lng], { icon: carIcon }).addTo(map);
    mapRef.current = map;
    // The container's size may not be settled at construction time; without
    // this, any subsequent fitBounds computes against a zero-height box
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView([lat, lng], 14);
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

    // Keep the driver comfortably inside the view rather than hugging an edge
    const position = L.latLng(lat, lng);
    if (!map.getBounds().pad(-0.2).contains(position)) {
      const pickup = pickupRef.current?.getLatLng();
      if (pickup) map.fitBounds(L.latLngBounds(position, pickup), { padding: [40, 40], maxZoom: 15 });
      else map.panTo(position);
    }
  }, [lat, lng]);

  useEffect(() => {
    if (!pickupPostcode || pickupRef.current) return;
    let cancelled = false;
    lookUpPostcode(pickupPostcode).then((point) => {
      const map = mapRef.current;
      if (cancelled || !map || !point) return;
      pickupRef.current = L.marker([point.lat, point.lng], { icon: pickupIcon }).addTo(map);
      if (!fittedRef.current) {
        fittedRef.current = true;
        const bounds = L.latLngBounds([lat, lng], [point.lat, point.lng]);
        requestAnimationFrame(() => {
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPostcode]);

  return <div ref={containerRef} className="apx-map h-72 sm:h-80 w-full border border-border" />;
};

export default TrackMapRaster;
