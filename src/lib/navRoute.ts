/**
 * The route a chauffeur is driving, in one shape whoever worked it out.
 *
 * Chauffeurs were leaving the app for Waze, and the moment they did the phone
 * suspended us and the passenger's map froze on wherever the car happened to
 * be. So the app does the driving itself and nobody leaves.
 *
 * Two routers are understood. Google Routes reads live traffic and is what
 * the office pays for. An open router stands in when Routes is unavailable,
 * which keeps the screen working but knows nothing about traffic, so it says
 * so rather than quietly showing an optimistic arrival time.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** What the chauffeur does at the end of a step. */
export type Turn =
  | "depart"
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "u-turn"
  | "roundabout"
  | "merge"
  | "keep-left"
  | "keep-right"
  | "slip-left"
  | "slip-right"
  | "arrive";

export interface Step {
  /** What to do, as it is read out and written across the top of the screen. */
  instruction: string;
  turn: Turn;
  /** The road this step puts the car on, for the line under the instruction. */
  road: string;
  /** Metres from the start of this step to the manoeuvre at its end. */
  metres: number;
  /** Seconds the router expects this step to take. */
  seconds: number;
  /** Where in `line` this step begins. */
  fromIndex: number;
  /** Which exit to take, on a roundabout that said. */
  exit?: number;
}

export interface NavRoute {
  /** Every point of the drive, in order, start to finish. */
  line: LatLng[];
  steps: Step[];
  metres: number;
  /** Seconds for the whole drive, allowing for traffic where we have it. */
  seconds: number;
  /**
   * Whether `seconds` accounts for the traffic that is actually out there.
   * False means the arrival time is a fair-weather estimate, and the screen
   * tells the chauffeur as much.
   */
  withTraffic: boolean;
  /** When this was worked out, so we know when to ask again. */
  at: number;
}

/**
 * Decode an encoded polyline.
 *
 * Google returns the shape of a step this way rather than as coordinates: a
 * string of offsets, each in five-bit chunks. It is a lot of bytes saved on
 * a motorway run.
 */
export const decodePolyline = (encoded: string, precision = 5): LatLng[] => {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const axis of ["lat", "lng"] as const) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      // The low bit marks a negative offset, and the rest is shifted up one
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === "lat") lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
};

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
];

/** "the third exit", for a roundabout. */
export const ordinal = (n: number): string =>
  ORDINALS[n - 1] ? `the ${ORDINALS[n - 1]} exit` : `exit ${n}`;

/**
 * The manoeuvre in the words a British driver uses.
 *
 * Written rather than taken from the router so that the voice is the same
 * whichever router answered, and so it says slip road and bear left rather
 * than ramp and slight left, which is what an American router calls them.
 */
export const phrase = (turn: Turn, road: string, exit?: number): string => {
  const onto = road ? ` onto ${road}` : "";
  switch (turn) {
    case "depart":
      return road ? `Set off along ${road}` : "Set off";
    case "straight":
      return road ? `Continue on ${road}` : "Carry straight on";
    case "left":
      return `Turn left${onto}`;
    case "right":
      return `Turn right${onto}`;
    case "slight-left":
      return `Bear left${onto}`;
    case "slight-right":
      return `Bear right${onto}`;
    case "sharp-left":
      return `Turn sharp left${onto}`;
    case "sharp-right":
      return `Turn sharp right${onto}`;
    case "u-turn":
      return "Make a U-turn";
    case "roundabout":
      return exit
        ? `At the roundabout, take ${ordinal(exit)}${onto}`
        : `At the roundabout${onto || ", carry on"}`;
    case "merge":
      return `Merge${onto}`;
    case "keep-left":
      return `Keep left${onto}`;
    case "keep-right":
      return `Keep right${onto}`;
    case "slip-left":
      return `Take the slip road on the left${onto}`;
    case "slip-right":
      return `Take the slip road${onto}`;
    case "arrive":
      return "You have arrived";
  }
};

const GOOGLE_TURNS: Record<string, Turn> = {
  DEPART: "depart",
  STRAIGHT: "straight",
  NAME_CHANGE: "straight",
  TURN_LEFT: "left",
  TURN_RIGHT: "right",
  TURN_SLIGHT_LEFT: "slight-left",
  TURN_SLIGHT_RIGHT: "slight-right",
  TURN_SHARP_LEFT: "sharp-left",
  TURN_SHARP_RIGHT: "sharp-right",
  UTURN_LEFT: "u-turn",
  UTURN_RIGHT: "u-turn",
  ROUNDABOUT_LEFT: "roundabout",
  ROUNDABOUT_RIGHT: "roundabout",
  MERGE: "merge",
  FORK_LEFT: "keep-left",
  FORK_RIGHT: "keep-right",
  RAMP_LEFT: "slip-left",
  RAMP_RIGHT: "slip-right",
};

/** An open router names its turns as a type and a modifier. */
const OSRM_TURNS: Record<string, Turn> = {
  "turn:left": "left",
  "turn:right": "right",
  "turn:slight left": "slight-left",
  "turn:slight right": "slight-right",
  "turn:sharp left": "sharp-left",
  "turn:sharp right": "sharp-right",
  "turn:straight": "straight",
  "turn:uturn": "u-turn",
  "continue:uturn": "u-turn",
  "new name:": "straight",
  "fork:left": "keep-left",
  "fork:slight left": "keep-left",
  "fork:right": "keep-right",
  "fork:slight right": "keep-right",
  "on ramp:left": "slip-left",
  "on ramp:right": "slip-right",
  "off ramp:left": "slip-left",
  "off ramp:right": "slip-right",
  merge: "merge",
  roundabout: "roundabout",
  rotary: "roundabout",
  "roundabout turn": "roundabout",
  depart: "depart",
  arrive: "arrive",
  "end of road:left": "left",
  "end of road:right": "right",
};

const osrmTurn = (type: string, modifier?: string): Turn =>
  OSRM_TURNS[`${type}:${modifier ?? ""}`] ??
  OSRM_TURNS[type] ??
  (modifier ? OSRM_TURNS[`turn:${modifier}`] : undefined) ??
  "straight";

/**
 * Join step shapes into one line, dropping the point each step repeats from
 * the end of the one before, and noting where every step begins.
 */
export const stitch = (shapes: LatLng[][]): { line: LatLng[]; starts: number[] } => {
  const line: LatLng[] = [];
  const starts: number[] = [];
  for (const shape of shapes) {
    const last = line[line.length - 1];
    const first = shape[0];
    if (!first) {
      // A step the router gave no shape for still needs somewhere to sit
      starts.push(Math.max(0, line.length - 1));
      continue;
    }
    const repeats = !!last && last.lat === first.lat && last.lng === first.lng;
    starts.push(repeats ? line.length - 1 : line.length);
    line.push(...(repeats ? shape.slice(1) : shape));
  }
  return { line, starts };
};

const seconds = (raw: unknown): number => {
  if (typeof raw === "number") return raw;
  // Google writes a duration as "132s"
  const match = typeof raw === "string" ? raw.match(/^([\d.]+)s$/) : null;
  return match ? Number(match[1]) : 0;
};

interface GoogleStep {
  navigationInstruction?: { maneuver?: string; instructions?: string };
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
}

/**
 * A route as Google Routes returns it.
 *
 * Only the route total allows for traffic; the per-step times do not. So the
 * step times are stretched to fit the total, which keeps the countdown to the
 * next turn honest in a queue instead of promising a clear road.
 */
export const fromGoogle = (body: unknown): NavRoute | null => {
  const route = (body as { routes?: unknown[] })?.routes?.[0] as
    | {
        duration?: string;
        distanceMeters?: number;
        legs?: { steps?: GoogleStep[] }[];
      }
    | undefined;
  const raw = route?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  if (!raw.length) return null;

  const shapes = raw.map((s) => decodePolyline(s.polyline?.encodedPolyline ?? ""));
  const { line, starts } = stitch(shapes);
  if (line.length < 2) return null;

  const total = seconds(route?.duration);
  const flat = raw.reduce((sum, s) => sum + seconds(s.staticDuration), 0);
  const stretch = total > 0 && flat > 0 ? total / flat : 1;

  const steps: Step[] = raw.map((s, i) => {
    const turn = GOOGLE_TURNS[s.navigationInstruction?.maneuver ?? ""] ?? "straight";
    const given = s.navigationInstruction?.instructions ?? "";
    const road = roadFrom(given);
    return {
      instruction: given || phrase(turn, road),
      turn,
      road,
      metres: s.distanceMeters ?? 0,
      seconds: seconds(s.staticDuration) * stretch,
      fromIndex: starts[i],
    };
  });

  return {
    line,
    steps: withArrival(steps, line),
    metres: route?.distanceMeters ?? steps.reduce((sum, s) => sum + s.metres, 0),
    seconds: total || steps.reduce((sum, s) => sum + s.seconds, 0),
    withTraffic: true,
    at: Date.now(),
  };
};

/**
 * The road out of a written instruction, for the line under it.
 *
 * Google writes "Turn left onto Deansgate", and the chauffeur wants the road
 * name in large type rather than reading the sentence twice.
 */
const roadFrom = (instruction: string): string => {
  const match = instruction.match(/\b(?:onto|on to|on|toward|towards)\s+(.+)$/i);
  return match ? match[1].replace(/<[^>]*>/g, "").trim() : "";
};

interface OsrmStep {
  maneuver?: { type?: string; modifier?: string; exit?: number; instruction?: string };
  name?: string;
  ref?: string;
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
}

/**
 * A route from an open router, which speaks the same shape as Mapbox.
 *
 * It gives turns as a type and a modifier and leaves the wording to us, so
 * every instruction here is phrased rather than quoted.
 */
export const fromOsrm = (body: unknown, withTraffic = false): NavRoute | null => {
  const route = (body as { routes?: unknown[] })?.routes?.[0] as
    | { distance?: number; duration?: number; legs?: { steps?: OsrmStep[] }[] }
    | undefined;
  const raw = route?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  if (!raw.length) return null;

  const shapes = raw.map((s) =>
    (s.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }))
  );
  const { line, starts } = stitch(shapes);
  if (line.length < 2) return null;

  const steps: Step[] = raw.map((s, i) => {
    const turn = osrmTurn(s.maneuver?.type ?? "", s.maneuver?.modifier);
    const road = s.name || s.ref || "";
    return {
      instruction: phrase(turn, road, s.maneuver?.exit),
      turn,
      road,
      metres: s.distance ?? 0,
      seconds: s.duration ?? 0,
      fromIndex: starts[i],
      ...(s.maneuver?.exit ? { exit: s.maneuver.exit } : {}),
    };
  });

  return {
    line,
    steps: withArrival(steps, line),
    metres: route?.distance ?? steps.reduce((sum, s) => sum + s.metres, 0),
    seconds: route?.duration ?? steps.reduce((sum, s) => sum + s.seconds, 0),
    withTraffic,
    at: Date.now(),
  };
};

/**
 * Make sure the last step is the arrival.
 *
 * Routers differ: one ends with a zero length arrive step, another stops at
 * the last turn. The screen counts down to a manoeuvre, so there has to be
 * one at the end or the final mile has nothing to count down to.
 */
const withArrival = (steps: Step[], line: LatLng[]): Step[] => {
  const last = steps[steps.length - 1];
  if (last?.turn === "arrive") {
    // A zero length arrive step at the end carries no distance of its own, so
    // it is the step before that counts down to the door
    return steps;
  }
  return [
    ...steps,
    {
      instruction: phrase("arrive", ""),
      turn: "arrive" as Turn,
      road: "",
      metres: 0,
      seconds: 0,
      fromIndex: Math.max(0, line.length - 1),
    },
  ];
};
