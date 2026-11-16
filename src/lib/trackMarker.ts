/**
 * The chauffeur's marker, shared by both map implementations.
 *
 * Positions arrive from Dispatch every few seconds at best, so a marker that
 * jumps between them reads as a broken map. The car is walked to each new
 * position instead, and pointed the way it is travelling, which is what makes
 * the difference between "is this working?" and a live map.
 */

/**
 * How long the car takes to glide to a newly reported position.
 *
 * Matched to the gap between reports, so the car arrives just as the next
 * position does and never stops. At four seconds against a six second beat it
 * glided, then sat still for two, and a car that stutters every few seconds
 * reads as a map that keeps freezing rather than a car that keeps driving.
 */
export const GLIDE_MS = 6000;

/** Short of this a glide is not worth watching; past it the car is crawling. */
const MIN_GLIDE_MS = 1200;
const MAX_GLIDE_MS = 9000;

/**
 * How long to take gliding to the newest position.
 *
 * Six seconds was the chauffeur's reporting beat, but the passenger's screen
 * asks every four, so a glide was always still running when the next
 * position landed. The car never arrived, trailed further behind with every
 * report, and was re-aimed mid-stride each time, which is what a passenger
 * sees as a car that will not sit still.
 *
 * Taking the gap we actually observed means the car arrives just as the next
 * position does, whatever the beat turns out to be on the day.
 */
export const glideFor = (sinceLastMs: number): number => {
  if (!Number.isFinite(sinceLastMs) || sinceLastMs <= 0) return GLIDE_MS;
  return Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, sinceLastMs));
};

/** Below this many metres a new fix is GPS noise, not a change of direction. */
const HEADING_THRESHOLD_M = 8;

export const CAR_SVG = `
<svg viewBox="0 0 28 28" width="30" height="30" aria-hidden="true">
  <path d="M14 2.6c2.1 0 3.6 1.7 4 4l.6 3.4c.3 1.7.4 3.4.4 5.1v5.2c0 1.3-.5 2.4-1.4 3l-.8.5a1 1 0 0 1-.6.2h-4.4a1 1 0 0 1-.6-.2l-.8-.5c-.9-.6-1.4-1.7-1.4-3v-5.2c0-1.7.1-3.4.4-5.1l.6-3.4c.4-2.3 1.9-4 4-4Z" fill="#14120f"/>
  <path d="M11.5 7.3h5l.5 2.6a11 11 0 0 0-6 0Z" fill="#cdbb95"/>
  <path d="M11.2 19.2a13 13 0 0 0 5.6 0l-.3 1.9a12 12 0 0 1-5 0Z" fill="#cdbb95" opacity="0.85"/>
  <rect x="8.2" y="10.3" width="1.6" height="1.3" rx="0.65" fill="#14120f"/>
  <rect x="18.2" y="10.3" width="1.6" height="1.3" rx="0.65" fill="#14120f"/>
</svg>`;

/** The marker element: an outer box the map positions, an inner box we turn. */
export const carElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.width = "30px";
  el.style.height = "30px";
  el.innerHTML =
    `<div class="apx-car" style="width:30px;height:30px;transform:rotate(0deg);` +
    `transform-origin:50% 50%;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))">${CAR_SVG}</div>`;
  return el;
};

export const pickupElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.width = "14px";
  el.style.height = "14px";
  el.innerHTML =
    '<div style="width:14px;height:14px;border-radius:50%;background:#ffffff;' +
    'border:3px solid #14120f;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>';
  return el;
};

/** Metres between two points, near enough for deciding whether the car moved. */
export const metresBetween = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number => {
  const toRad = Math.PI / 180;
  const R = 6371000;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Which way the car is pointing, as degrees clockwise from north. */
export const bearing = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const toRad = Math.PI / 180;
  const y = Math.sin((bLng - aLng) * toRad) * Math.cos(bLat * toRad);
  const x =
    Math.cos(aLat * toRad) * Math.sin(bLat * toRad) -
    Math.sin(aLat * toRad) * Math.cos(bLat * toRad) * Math.cos((bLng - aLng) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
};

export const shouldTurn = (metres: number) => metres > HEADING_THRESHOLD_M;

/** A point on the road, as the route gives it. */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/**
 * How far ahead along the road to look when deciding which way the car faces.
 *
 * A route is made of points a few metres apart, so one of its segments on its
 * own is too short to read a direction from and jitters on every bend. Thirty
 * metres is about a car's length of road either side of a junction: long
 * enough to be steady, short enough that a turn still looks like a turn.
 */
const LOOK_AHEAD_M = 30;

/**
 * Beyond this the car is not on the route we have, so the route cannot say
 * which way it is pointing. A diversion, a closed road, or a stale route.
 */
const OFF_ROUTE_M = 60;

/**
 * The closest the car gets to one stretch of road, and the point on that
 * stretch where it happens. Flat earth is plenty over a few dozen metres.
 */
const ontoSegment = (
  lat: number,
  lng: number,
  a: RoutePoint,
  b: RoutePoint
): { metres: number; at: RoutePoint } => {
  const scale = Math.cos((lat * Math.PI) / 180);
  const mx = (d: number) => d * 111_320 * scale;
  const my = (d: number) => d * 110_540;
  const px = mx(lng - a.lng);
  const py = my(lat - a.lat);
  const bx = mx(b.lng - a.lng);
  const by = my(b.lat - a.lat);
  const length = bx * bx + by * by;
  // A route can repeat a point; that is a point, not a stretch
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length));
  return {
    metres: Math.hypot(px - bx * t, py - by * t),
    at: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
  };
};

/**
 * Which way the road runs where the car is, in degrees clockwise from north.
 *
 * The car's reports arrive the better part of a minute apart, so the line
 * between two of them is the straight hop across whatever the road did in
 * between: around a bend it points through the houses on the corner, and on
 * a dual carriageway slip road it points at the roundabout rather than along
 * the lane. We already know the route the car is driving, so the road itself
 * can say which way the car is facing.
 *
 * Null when there is no route, or the car is nowhere near it, and the caller
 * keeps whatever it had rather than swinging the car to a guess.
 */
export const headingAlongRoute = (
  line: RoutePoint[] | null | undefined,
  lat: number,
  lng: number
): number | null => {
  if (!line || line.length < 2) return null;

  let nearest = -1;
  let nearestM = Infinity;
  let on: RoutePoint = { lat, lng };
  for (let i = 0; i < line.length - 1; i++) {
    const got = ontoSegment(lat, lng, line[i], line[i + 1]);
    if (got.metres < nearestM) {
      nearestM = got.metres;
      nearest = i;
      on = got.at;
    }
  }
  if (nearest < 0 || nearestM > OFF_ROUTE_M) return null;

  // Taken from where the car sits on the road rather than from the fix
  // itself. A fix lands a lane or two off the drawn line often enough, and
  // measuring from there tips the car towards the kerb it is nearest.
  let i = nearest + 1;
  let ahead = line[i];
  let gone = metresBetween(on.lat, on.lng, ahead.lat, ahead.lng);
  while (gone < LOOK_AHEAD_M && i < line.length - 1) {
    i += 1;
    gone += metresBetween(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng);
    ahead = line[i];
  }
  // At the very end of the route there is no road left to point along
  if (gone < 1) return null;
  return bearing(on.lat, on.lng, ahead.lat, ahead.lng);
};

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Where the pickup postcode sits, so the map can frame both ends. */
export const lookUpPostcode = async (
  postcode: string
): Promise<{ lat: number; lng: number } | null> => {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ""))}`
    );
    if (!res.ok) return null;
    const body = await res.json();
    const result = body?.result;
    if (typeof result?.latitude !== "number") return null;
    return { lat: result.latitude, lng: result.longitude };
  } catch {
    return null;
  }
};

/**
 * Which way to point the car now.
 *
 * The road wins where we know it. Failing that, the line between the last two
 * positions, and failing that, whatever the car was already doing: a car that
 * has not really moved must not spin on the spot because a fix wobbled.
 */
export const turnTo = (
  route: RoutePoint[] | null | undefined,
  lat: number,
  lng: number,
  from: RoutePoint,
  moved: number,
  before: number
): number => {
  const road = headingAlongRoute(route, lat, lng);
  if (road !== null) return road;
  return shouldTurn(moved) ? bearing(from.lat, from.lng, lat, lng) : before;
};
