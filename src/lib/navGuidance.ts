/**
 * Where the car is on its route, and what to tell the chauffeur next.
 *
 * All of this is arithmetic on a line and a position, with no map and no
 * network, which is the point: it can be tested to the yard, and it keeps
 * working in the Longdendale cutting where the signal goes.
 */

import { bearing, metresBetween } from "@/lib/trackMarker";
import type { LatLng, NavRoute, Step } from "@/lib/navRoute";

/** Past this far from the route the chauffeur has gone their own way. */
export const OFF_ROUTE_M = 50;

/** Within this of the door, they are there. */
export const ARRIVED_M = 40;

/** How far back and forward of the last known point to look for the car. */
const LOOK_BACK_M = 250;

/**
 * Far enough ahead to cover a gap in the fixes at motorway speed, and no
 * further. A window longer than the job is no window at all: a hotel and back
 * is under two miles, and the way home runs a lane's width from the way out.
 */
const LOOK_AHEAD_M = 800;

/** A match worse than this means the window was wrong, so look everywhere. */
const WINDOW_TRUST_M = 120;

const YARDS_PER_M = 1.09361;
const M_PER_MILE = 1609.344;

export interface Guidance {
  /** The step being driven. */
  stepIndex: number;
  step: Step;
  /**
   * The manoeuvre coming up, which is the one to show and to say.
   *
   * A router hangs each manoeuvre on the step it begins, so the turn at the
   * end of the street being driven belongs to the step after it. Reading the
   * current step instead puts "set off along Chapel Street" on the screen
   * while the chauffeur is a hundred yards from a left turn.
   */
  next: Step;
  /** The one after that, for the second line of the banner. */
  then: Step | null;
  /** Metres from the car to the next manoeuvre. */
  toTurn: number;
  metresLeft: number;
  secondsLeft: number;
  /** Metres from the car to the route itself. */
  offBy: number;
  /** The car's position, pulled onto the route. */
  snapped: LatLng;
  lineIndex: number;
  /** Which way the road is going here, for turning the map. */
  course: number;
  arrived: boolean;
}

/**
 * Cumulative metres to each point of the route, worked out once.
 *
 * A fifty mile run is thousands of points and the car asks where it is every
 * few seconds, so this is measured on first use and kept with the route.
 */
const measured = new WeakMap<NavRoute, number[]>();

export const cumulative = (route: NavRoute): number[] => {
  const held = measured.get(route);
  if (held) return held;
  const out = [0];
  for (let i = 1; i < route.line.length; i++) {
    const a = route.line[i - 1];
    const b = route.line[i];
    out.push(out[i - 1] + metresBetween(a.lat, a.lng, b.lat, b.lng));
  }
  measured.set(route, out);
  return out;
};

/**
 * The nearest point on a segment to the car, as a fraction along it.
 *
 * Over the length of one segment the world is flat enough to treat longitude
 * as a straight axis, once it is squeezed by the latitude.
 */
const ontoSegment = (
  p: LatLng,
  a: LatLng,
  b: LatLng
): { t: number; point: LatLng } => {
  const squeeze = Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lng * squeeze;
  const ay = a.lat;
  const bx = b.lng * squeeze;
  const by = b.lat;
  const px = p.lng * squeeze;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  if (length === 0) return { t: 0, point: a };
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  return { t, point: { lat: ay + t * dy, lng: (ax + t * dx) / squeeze } };
};

interface Found {
  lineIndex: number;
  t: number;
  point: LatLng;
  offBy: number;
}

const searchLine = (
  route: NavRoute,
  pos: LatLng,
  first: number,
  last: number
): Found => {
  let best: Found = { lineIndex: first, t: 0, point: route.line[first], offBy: Infinity };
  for (let i = first; i < last; i++) {
    const { t, point } = ontoSegment(pos, route.line[i], route.line[i + 1]);
    const offBy = metresBetween(pos.lat, pos.lng, point.lat, point.lng);
    if (offBy < best.offBy) best = { lineIndex: i, t, point, offBy };
  }
  return best;
};

/**
 * Find the car on the route.
 *
 * Looked for near where it was last seen rather than along the whole route,
 * because an out and back job passes within yards of its own outward leg and
 * the nearest point on the whole line can be the way home. When the near
 * search comes back with nothing convincing, the whole line is searched,
 * which is what happens on the first fix and after a new route.
 */
export const locate = (route: NavRoute, pos: LatLng, lastIndex = -1): Found => {
  const segments = route.line.length - 1;
  if (segments < 1) {
    return { lineIndex: 0, t: 0, point: route.line[0], offBy: 0 };
  }
  if (lastIndex >= 0 && lastIndex < segments) {
    const cum = cumulative(route);
    const at = cum[lastIndex];
    let first = lastIndex;
    while (first > 0 && cum[first] > at - LOOK_BACK_M) first--;
    let last = lastIndex;
    while (last < segments && cum[last] < at + LOOK_AHEAD_M) last++;
    const near = searchLine(route, pos, first, last);
    if (near.offBy <= WINDOW_TRUST_M) return near;
  }
  return searchLine(route, pos, 0, segments);
};

/** Where in the route's steps a point of the line falls. */
export const stepAt = (route: NavRoute, lineIndex: number): number => {
  let found = 0;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].fromIndex <= lineIndex) found = i;
    else break;
  }
  // The arrival is not a step anybody drives, so the last real step owns the
  // run up to the door
  const lastDriven = route.steps.length - (route.steps[route.steps.length - 1]?.turn === "arrive" ? 2 : 1);
  return Math.min(found, Math.max(0, lastDriven));
};

/** Where a step ends, in metres from the start of the route. */
const stepEnd = (route: NavRoute, stepIndex: number): number => {
  const cum = cumulative(route);
  const next = route.steps[stepIndex + 1];
  return next ? cum[next.fromIndex] : cum[cum.length - 1];
};

export const follow = (route: NavRoute, pos: LatLng, lastIndex = -1): Guidance => {
  const cum = cumulative(route);
  const total = cum[cum.length - 1];
  const found = locate(route, pos, lastIndex);

  const segment =
    cum[found.lineIndex + 1] !== undefined
      ? cum[found.lineIndex + 1] - cum[found.lineIndex]
      : 0;
  const along = cum[found.lineIndex] + found.t * segment;

  const stepIndex = stepAt(route, found.lineIndex);
  const step = route.steps[stepIndex];
  const toTurn = Math.max(0, stepEnd(route, stepIndex) - along);
  const metresLeft = Math.max(0, total - along);

  // The time left is the router's own times for the steps still to come, plus
  // however much of this step is left. Measured off the line rather than off
  // the router's step distances, so it agrees with the countdown on screen.
  let secondsLeft = 0;
  for (let i = stepIndex + 1; i < route.steps.length; i++) {
    secondsLeft += route.steps[i].seconds;
  }
  const stepLength = stepEnd(route, stepIndex) - cum[step.fromIndex];
  const leftOfStep = stepLength > 0 ? Math.min(1, toTurn / stepLength) : 0;
  secondsLeft += step.seconds * leftOfStep;

  const ahead = route.line[Math.min(found.lineIndex + 1, route.line.length - 1)];
  const behind = route.line[found.lineIndex];

  return {
    stepIndex,
    step,
    next: route.steps[stepIndex + 1] ?? step,
    then: route.steps[stepIndex + 2] ?? null,
    toTurn,
    metresLeft,
    secondsLeft,
    offBy: found.offBy,
    snapped: found.point,
    lineIndex: found.lineIndex,
    course: bearing(behind.lat, behind.lng, ahead.lat, ahead.lng),
    arrived: metresLeft <= ARRIVED_M,
  };
};

export const offRoute = (g: Guidance): boolean => g.offBy > OFF_ROUTE_M;

/**
 * A distance written out, as it sits on the screen beside the turn arrow.
 *
 * Yards close in, where a chauffeur is looking for a particular turning, and
 * miles once it stops mattering to the nearest hundred.
 */
export const shownDistance = (metres: number): string => {
  if (metres < 20) return "now";
  if (metres < 400) return `${Math.round((metres * YARDS_PER_M) / 10) * 10} yds`;
  const miles = metres / M_PER_MILE;
  return miles < 10 ? `${miles.toFixed(1)} miles` : `${Math.round(miles)} miles`;
};

/**
 * A distance said out loud, in the rounded steps a sat nav uses.
 *
 * Nobody wants to be told the turn is in three hundred and twenty yards.
 */
export const spokenDistance = (metres: number): string => {
  if (metres < 500) {
    const yards = Math.max(50, Math.round((metres * YARDS_PER_M) / 50) * 50);
    return `${yards} yards`;
  }
  if (metres < 1200) return "half a mile";
  if (metres < 2000) return "a mile";
  return `${Math.round(metres / M_PER_MILE)} miles`;
};

/** The points at which a manoeuvre is announced. */
export type Cue = "mile" | "near" | "now";

/**
 * Which announcement is due, if any.
 *
 * The length of the step decides how many a chauffeur gets: there is no sense
 * being told about a turn a mile off when the turn is two hundred yards away,
 * and no sense being told twice in the space of a bus length.
 */
export const cueFor = (toTurn: number, stepMetres: number): Cue | null => {
  if (toTurn <= 80) return "now";
  if (toTurn > 1600) return null;
  // The warning a mile out, on a run long enough to be worth one
  if (toTurn > 400) return stepMetres > 900 ? "mile" : null;
  // The warning as the turn comes up, unless the last one was yards back
  return stepMetres > 250 ? "near" : null;
};

/** "Turn" stays a verb when it follows a distance, so it loses its capital. */
const uncapitalise = (sentence: string): string => {
  const [first = ""] = sentence.split(" ");
  if (!/^[A-Za-z]+$/.test(first) || first === first.toUpperCase()) return sentence;
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
};

/** The whole announcement, distance and all. */
export const announcement = (step: Step, cue: Cue, toTurn: number): string =>
  cue === "now"
    ? step.instruction
    : `In ${spokenDistance(toTurn)}, ${uncapitalise(step.instruction)}`;

/** The clock time the car is due, which is what a passenger asks for. */
export const arrivalAt = (secondsLeft: number, now = new Date()): string =>
  new Date(now.getTime() + secondsLeft * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

/** Minutes left, never rounded down to nothing while the car is still moving. */
export const minutesLeft = (secondsLeft: number): number =>
  secondsLeft > 0 ? Math.max(1, Math.round(secondsLeft / 60)) : 0;
