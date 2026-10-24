import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Crosshair } from "lucide-react";
import { pickupElement } from "@/lib/trackMarker";
import type { LatLng } from "@/lib/navRoute";
import { openMapStyle, routeColours, type MapTheme } from "@/lib/mapTheme";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** Close enough to see which lane, tilted so the road ahead is visible. */
const DRIVE_ZOOM = 16.8;
const DRIVE_PITCH = 55;

/**
 * How much of the screen above the car is kept for the road ahead.
 *
 * The car sits low so that what is coming fills the screen, which is what
 * every sat nav does and what a driver expects to see.
 */
const AHEAD_SHARE = 0.55;

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
}

/**
 * The car, as it appears on the driving screen.
 *
 * The marker the passenger's map uses is a black car, which all but vanishes
 * on a dark map at night. This is the usual sat nav puck instead: a champagne
 * arrow that can be picked out at a glance, and always pointing up the screen
 * because the map turns underneath it.
 */
const driverElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.width = "38px";
  el.style.height = "38px";
  el.innerHTML = `
<svg viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">
  <circle cx="19" cy="19" r="15" fill="#14120f" stroke="#cdbb95" stroke-width="2"/>
  <path d="M19 9.5 27 27l-8-4.2L11 27Z" fill="#cdbb95"/>
</svg>`;
  el.style.filter = "drop-shadow(0 2px 6px rgba(0,0,0,0.6))";
  return el;
};

const asLine = (points: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
});

/**
 * The map a chauffeur drives by.
 *
 * It follows the car and turns with it, until the chauffeur drags it to look
 * at something, at which point it stays where they put it and offers to go
 * back. A map that fights the hand holding it is worse than no map.
 */
const DriveMap = ({ line, car, lineIndex, course, to, theme }: Props) => {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const carRef = useRef<maplibregl.Marker | null>(null);
  const toRef = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: holder.current,
      style: openMapStyle(theme),
      center: [car.lng, car.lat],
      zoom: DRIVE_ZOOM,
      pitch: DRIVE_PITCH,
      bearing: course,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    carRef.current = new maplibregl.Marker({ element: driverElement() })
      .setLngLat([car.lng, car.lat])
      .addTo(map);

    // A drag is the chauffeur saying they want to look somewhere else. Only
    // a real one: easing the camera after the car fires these too, and left
    // unchecked the map stopped following on the very first bend
    const letGo = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) setFollowing(false);
    };
    map.on("dragstart", letGo);
    map.on("rotatestart", letGo);
    map.on("zoomstart", letGo);
    map.once("load", () => setReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      carRef.current = null;
      toRef.current = null;
    };
    // Only ever built once: everything after this is an update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The route, drawn in two parts so the road already driven falls back. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || line.length < 2) return;

    const done = asLine([...line.slice(0, Math.max(1, lineIndex + 1)), car]);
    const left = asLine([car, ...line.slice(lineIndex + 1)]);

    const put = (id: string, data: GeoJSON.Feature) => {
      const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(id, { type: "geojson", data });
    };
    put("drive-done", done);
    put("drive-left", left);

    if (!map.getLayer("drive-done-line")) {
      map.addLayer({
        id: "drive-done-line",
        type: "line",
        source: "drive-done",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": routeColours(theme).done, "line-width": 7 },
      });
      map.addLayer({
        id: "drive-left-casing",
        type: "line",
        source: "drive-left",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": routeColours(theme).casing, "line-width": 12 },
      });
      map.addLayer({
        id: "drive-left-line",
        type: "line",
        source: "drive-left",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": routeColours(theme).line, "line-width": 6 },
      });
      // The car is drawn by a marker, which sits above every layer
    }
  }, [ready, line, lineIndex, car, theme]);

  /** The door. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !to) return;
    if (toRef.current) toRef.current.setLngLat([to.lng, to.lat]);
    else toRef.current = new maplibregl.Marker({ element: pickupElement() })
      .setLngLat([to.lng, to.lat])
      .addTo(map);
  }, [to]);

  /** Follow the car. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    carRef.current?.setLngLat([car.lng, car.lat]);
    if (!following) return;
    map.easeTo({
      center: [car.lng, car.lat],
      bearing: course,
      pitch: DRIVE_PITCH,
      zoom: DRIVE_ZOOM,
      // Padding the top pushes the car down the screen, leaving the road ahead
      padding: { top: Math.round(map.getContainer().clientHeight * AHEAD_SHARE), bottom: 0, left: 0, right: 0 },
      duration: 900,
      easing: (t) => t,
    });
  }, [car, course, following]);

  return (
    <div className="apx-drive absolute inset-0">
      {/* Sized rather than inset: MapLibre makes its own container
          relative, which leaves an inset-0 stretch with no height */}
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

export default DriveMap;
