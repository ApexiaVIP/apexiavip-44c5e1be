import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface TrackMapProps {
  /** Driver position */
  lat: number;
  lng: number;
  /** Pickup postcode, used to place a destination marker */
  pickupPostcode?: string;
}

const driverIcon = L.divIcon({
  className: "",
  html:
    '<div style="width:16px;height:16px;border-radius:50%;background:#c2a468;' +
    'border:2px solid #0b0a08;box-shadow:0 0 10px rgba(194,164,104,0.9)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const pickupIcon = L.divIcon({
  className: "",
  html:
    '<div style="width:12px;height:12px;border-radius:50%;background:transparent;' +
    'border:2px solid #c2a468"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

/** Live driver map for a booking card: driver dot, pickup ring, auto-follow. */
const TrackMap = ({ lat, lng, pickupPostcode }: TrackMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverRef = useRef<L.Marker | null>(null);
  const pickupRef = useRef<L.Marker | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false }).setView([lat, lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    driverRef.current = L.marker([lat, lng], { icon: driverIcon }).addTo(map);
    mapRef.current = map;
    // The container's size may not be settled at construction time; without
    // this, any subsequent fitBounds computes against a zero-height box
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView([lat, lng], 14);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      driverRef.current = null;
      pickupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the driver as fresh positions arrive
  useEffect(() => {
    driverRef.current?.setLatLng([lat, lng]);
    if (mapRef.current && !pickupRef.current) {
      mapRef.current.panTo([lat, lng]);
    }
  }, [lat, lng]);

  // Mark the pickup point and frame both once
  useEffect(() => {
    if (!pickupPostcode || pickupRef.current) return;
    let cancelled = false;
    fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pickupPostcode.replace(/\s/g, ""))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const result = d?.result;
        if (cancelled || !mapRef.current || !result?.latitude) return;
        pickupRef.current = L.marker([result.latitude, result.longitude], {
          icon: pickupIcon,
        }).addTo(mapRef.current);
        if (!fittedRef.current) {
          fittedRef.current = true;
          const bounds = L.latLngBounds([lat, lng], [result.latitude, result.longitude]);
          requestAnimationFrame(() => {
            mapRef.current?.invalidateSize();
            mapRef.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupPostcode]);

  return <div ref={containerRef} className="dark-map h-64 w-full border border-border" />;
};

export default TrackMap;
