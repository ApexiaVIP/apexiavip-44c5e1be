/**
 * The speed cameras on the road ahead.
 *
 * This is the one thing chauffeurs said Waze had and we did not, and it is
 * the reason some of them were still driving with a second phone on the
 * windscreen. A camera is only worth showing if it is on the road being
 * driven, pointing the way the car is going, and announced far enough back
 * that nobody has to brake for it.
 *
 * The cameras themselves come from OpenStreetMap and ship inside the app
 * rather than being queried live, because a chauffeur on the M56 with one bar
 * of signal cannot wait on somebody else's API and should not have to.
 */

import { cumulative, locate } from "@/lib/navGuidance";
import type { LatLng, NavRoute } from "@/lib/navRoute";
import { metresBetween } from "@/lib/trackMarker";

/** A fixed camera, or a stretch of road watched end to end. */
export type CameraKind = "fixed" | "average";

export interface SpeedCamera {
  id: string;
  lat: number;
  lng: number;
  kind: CameraKind;
  /** The limit on that stretch where it is known, in miles per hour. */
  limitMph: number | null;
  /**
   * The way the camera looks, in degrees, where OpenStreetMap says.
   *
   * Most cameras on a dual carriageway only watch one carriageway, so a
   * camera facing the other way is not the chauffeur's problem and warning
   * about it is how an app teaches a driver to ignore it.
   */
  direction: number | null;
}

/** A camera that sits on the route, with its place along it worked out. */
export interface CameraOnRoute {
  camera: SpeedCamera;
  /** Metres from the start of the route to the camera. */
  along: number;
  /** How far the camera sits from the line of the route. */
  offBy: number;
}

/**
 * How close to the route a camera has to be to count.
 *
 * A camera on the far carriageway of a motorway is around twenty metres from
 * the line we are driving, and one on the parallel side street is fifty. This
 * keeps the first and drops the second.
 */
export const ON_ROUTE_M = 30;

/** How far back the chauffeur is told, which is about ten seconds at 70. */
export const WARN_M = 300;

/** Degrees of disagreement allowed before a camera is facing the other way. */
const FACING_M = 70;

/** How much road either side of the route to ask the table for. */
const BOX_PAD_M = 400;

/** Metres in a degree of latitude, near enough anywhere in Britain. */
const M_PER_DEG_LAT = 111_320;

export interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * A box around the whole route, padded, for asking the table.
 *
 * One rectangle for the journey rather than a query per step: a run to London
 * is one request of a few hundred rows, which is cheaper than two hundred
 * small ones and works the same when the signal goes.
 */
export const boxAround = (line: LatLng[], padM = BOX_PAD_M): Box | null => {
  if (!line.length) return null;
  let south = line[0].lat;
  let north = line[0].lat;
  let west = line[0].lng;
  let east = line[0].lng;
  for (const p of line) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }
  const padLat = padM / M_PER_DEG_LAT;
  // A degree of longitude shortens as you go north, so the padding widens to
  // match. At our latitudes it is a little over half what it is at the equator
  const mid = ((south + north) / 2) * (Math.PI / 180);
  const padLng = padM / (M_PER_DEG_LAT * Math.max(0.1, Math.cos(mid)));
  return {
    south: south - padLat,
    west: west - padLng,
    north: north + padLat,
    east: east + padLng,
  };
};

/** Whether two bearings are pointing roughly the same way. */
export const facingSameWay = (a: number, b: number): boolean => {
  const apart = Math.abs(((a - b + 540) % 360) - 180);
  return apart <= FACING_M;
};

/**
 * Keep the cameras that are actually on this route, in the order they are met.
 *
 * Nothing here asks where the car is. The route does not change while it is
 * being driven, so the cameras on it are worked out once and only looked up
 * afterwards, rather than measuring every camera against every fix.
 */
export const onRoute = (
  route: NavRoute,
  cameras: SpeedCamera[],
  withinM = ON_ROUTE_M
): CameraOnRoute[] => {
  if (route.line.length < 2) return [];
  const cum = cumulative(route);
  const found: CameraOnRoute[] = [];

  for (const camera of cameras) {
    const at = locate(route, camera);
    if (at.offBy > withinM) continue;

    const from = route.line[at.lineIndex];
    const along = cum[at.lineIndex] + metresBetween(from.lat, from.lng, at.point.lat, at.point.lng);

    // Which way the road runs where the camera stands, so a camera watching
    // the other carriageway can be dropped
    if (camera.direction !== null) {
      const next = route.line[Math.min(at.lineIndex + 1, route.line.length - 1)];
      const course = bearingBetween(from, next);
      if (!facingSameWay(camera.direction, course)) continue;
    }

    found.push({ camera, along, offBy: at.offBy });
  }

  return found.sort((a, b) => a.along - b.along);
};

/** The way the road is heading between two points of the line. */
const bearingBetween = (a: LatLng, b: LatLng): number => {
  const toRad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
};

export interface CameraWarning {
  camera: SpeedCamera;
  /** Metres from the car to the camera. */
  toCamera: number;
}

/**
 * The camera to warn about, if there is one.
 *
 * Only the next one, and only once it is inside the warning distance. A
 * camera the car has drawn level with is left alone: telling a chauffeur
 * about a camera they have just passed is worse than saying nothing, because
 * it teaches them the warning is not about the road in front of them.
 */
export const cameraAhead = (
  cameras: CameraOnRoute[],
  along: number,
  warnM = WARN_M
): CameraWarning | null => {
  for (const c of cameras) {
    const toCamera = c.along - along;
    if (toCamera < 0) continue;
    if (toCamera > warnM) return null;
    return { camera: c.camera, toCamera };
  }
  return null;
};

/** How a camera is said out loud, and written on the card. */
export const cameraWords = (camera: SpeedCamera): string => {
  const what = camera.kind === "average" ? "Average speed check" : "Speed camera";
  return camera.limitMph ? `${what} at ${camera.limitMph}` : what;
};
