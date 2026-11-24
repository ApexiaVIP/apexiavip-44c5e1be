/**
 * Whether a journey is still running, and so still worth tracking.
 *
 * This used to be a flat six hours from the pickup time, which quietly broke
 * as-directed hires: a twelve hour day went dark halfway through, and any
 * overrun stopped being tracked while the car was still out. A journey now
 * runs until somebody says it has finished.
 */

/** Statuses where the journey is over */
export const FINAL_STATUSES = [
  "Clear/Completed",
  "Completed",
  "Cancelled",
  "No Show",
  "Invoice",
  "Failed",
];

/** Statuses meaning a chauffeur is actively working the job */
export const ACTIVE_STATUSES = [
  "Dispatched",
  "En route to pickup",
  "At Pickup",
  "Passenger on board",
  "Soon to clear",
];

/**
 * What the chauffeur presses in their own app, said in the words Dispatch
 * uses. Their app reports in seconds where Dispatch is polled, so when the
 * chauffeur has told us something it is the newer answer and it wins.
 */
export const DRIVER_STATUS_AS_DISPATCH: Record<string, string> = {
  en_route: "En route to pickup",
  arrived: "At Pickup",
  pob: "Passenger on board",
  waiting: "Passenger on board",
  clear: "Clear/Completed",
};

/**
 * Statuses Dispatch holds a booking at before the job is sent to a chauffeur.
 *
 * Dever have confirmed the Driver and Vehicle details come back empty in this
 * state even when a chauffeur has already been allocated, so an empty name
 * here does not mean nobody is on the job.
 */
export const PRE_DISPATCH_STATUSES = ["Pending", "Quotation"];

/**
 * One status compared against another the way Dispatch writes them, which is
 * not reliably the way we do.
 *
 * Dever's documentation gives "At pickup" where this file has "At Pickup",
 * and on a case-sensitive match that one letter takes a car at the kerb off
 * the map, out of its badge and to the wrong end of the sort. Which casing
 * Dispatch actually sends is not ours to depend on, so depend on neither.
 */
const sameStatus = (a: string | null | undefined, b: string): boolean =>
  typeof a === "string" && a.trim().toLowerCase() === b.toLowerCase();

/** Is a chauffeur actively working this job, in Dispatch's words? */
export const isActiveStatus = (status: string | null | undefined): boolean =>
  ACTIVE_STATUSES.some((s) => sameStatus(status, s));

/** Is the journey over, in Dispatch's words? */
export const isFinalStatus = (status: string | null | undefined): boolean =>
  FINAL_STATUSES.some((s) => sameStatus(status, s));

/** Has the job yet to be sent to a chauffeur, in Dispatch's words? */
export const isPreDispatchStatus = (status: string | null | undefined): boolean =>
  PRE_DISPATCH_STATUSES.some((s) => sameStatus(status, s));

/** Does this status mean this exact thing, whatever casing it arrives in? */
export const statusIs = sameStatus;

export interface LiveBooking {
  status: string;
  driver_status?: string | null;
  collection_at?: string | null;
  journey_type?: string | null;
  as_directed_hours?: number | null;
}

/** The newest answer about where a journey has got to. */
export const effectiveStatus = (b: LiveBooking, dispatchStatus?: string | null): string =>
  (b.driver_status ? DRIVER_STATUS_AS_DISPATCH[b.driver_status] : undefined) ??
  dispatchStatus ??
  b.status;

/** How long after the pickup we still expect the car to be out. */
const GRACE_HOURS = 6;
/** Nothing runs forever, however a status gets stuck. */
const BACKSTOP_EXTRA_HOURS = 12;

export const expectedRunHours = (b: LiveBooking): number =>
  (b.journey_type === "hourly" && b.as_directed_hours ? b.as_directed_hours : 0) + GRACE_HOURS;

export const stillRunning = (b: LiveBooking, now: number = Date.now()): boolean => {
  if (isFinalStatus(effectiveStatus(b))) return false;

  const pickup = b.collection_at ? new Date(b.collection_at).getTime() : null;
  if (pickup !== null && Number.isNaN(pickup)) return true;

  // However a status gets stuck, a journey stops being live eventually
  if (
    pickup !== null &&
    pickup < now - (expectedRunHours(b) + BACKSTOP_EXTRA_HOURS) * 3600 * 1000
  ) {
    return false;
  }

  // The chauffeur has the job in hand and has not cleared it. An as-directed
  // day that overruns is exactly this, so no clock applies.
  if (b.driver_status && b.driver_status !== "clear") return true;

  // Or Dispatch says someone is on it, for a chauffeur working their app
  if (isActiveStatus(effectiveStatus(b))) return true;

  if (pickup === null) return true;
  return pickup > now - expectedRunHours(b) * 3600 * 1000;
};

/** How fresh our own position has to be before we trust it over Dispatch's. */
export const OUR_POSITION_FRESH_MS = 2 * 60 * 1000;

export interface Positioned {
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_position_at?: string | null;
}

export interface Fix {
  lat: number;
  lng: number;
  /** True when this came from the chauffeur's own app rather than Dispatch */
  fromOurApp: boolean;
  /** Milliseconds old, when we know. Dispatch reports its own age separately. */
  ageMs: number;
}

/**
 * Whether a pair of coordinates is somewhere a car can actually be.
 *
 * Dever have confirmed Dispatch answers 0 for both coordinates on every
 * booking more than fifteen minutes from its collection time, so this is the
 * ordinary answer for most of a booking's life rather than an edge case.
 * Taken literally it is a point in the Gulf of Guinea, and drawing a car
 * there is worse than drawing no car at all.
 */
const placeable = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

/**
 * Dispatch sends a coordinate as a number in Dever's own sample and as a
 * string elsewhere in their documentation. Read either rather than betting on
 * one.
 */
const coord = (v: string | number | null | undefined): number =>
  typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : Number.NaN;

/**
 * Where to draw the car.
 *
 * Our own app reports every twenty seconds while a job is running, where
 * Dispatch refreshes rarely enough that a passenger sees a car that never
 * moves. So a recent position of ours wins. Dispatch is the fallback, and a
 * stale position of ours still beats showing nothing at all.
 */
export const chauffeurPosition = (
  booking: Positioned,
  dispatch?: { latitude?: string | number | null; longitude?: string | number | null } | null,
  now: number = Date.now()
): Fix | null => {
  const reportedAt = booking.driver_position_at ? Date.parse(booking.driver_position_at) : NaN;
  const age = Number.isNaN(reportedAt) ? Number.POSITIVE_INFINITY : now - reportedAt;
  const ours =
    typeof booking.driver_lat === "number" &&
    typeof booking.driver_lng === "number" &&
    placeable(booking.driver_lat, booking.driver_lng)
      ? { lat: booking.driver_lat, lng: booking.driver_lng, fromOurApp: true, ageMs: age }
      : null;

  if (ours && age >= 0 && age < OUR_POSITION_FRESH_MS) return ours;

  const lat = coord(dispatch?.latitude);
  const lng = coord(dispatch?.longitude);
  if (placeable(lat, lng)) {
    return { lat, lng, fromOurApp: false, ageMs: Number.NaN };
  }
  return ours;
};

/**
 * How many journeys we may ask Dispatch about in one go. The booking-status
 * function enforces the same number; keep the two together.
 */
export const MAX_LIVE_CHECKS = 15;

export interface Referenced extends LiveBooking {
  reference?: string | null;
}

/**
 * Which journeys to ask Dispatch about, when we can only ask about so many.
 *
 * The cap used to fall wherever the list happened to be ordered, which is
 * newest keyed first. A car going out tonight could be pushed past the cap by
 * ten jobs keyed after it, and then read "Not yet assigned" on the desk no
 * matter who Dispatch had allocated to it. Ask about the ones running soonest
 * instead, and about a chauffeur already working a job before anything else.
 */
export const refsToCheck = <T extends Referenced>(
  bookings: T[],
  cap: number = MAX_LIVE_CHECKS,
  now: number = Date.now()
): string[] => {
  const working = (b: T) => (isActiveStatus(effectiveStatus(b)) ? 0 : 1);
  const pickup = (b: T) =>
    b.collection_at ? new Date(b.collection_at).getTime() : Number.POSITIVE_INFINITY;

  return bookings
    .filter((b) => b.reference && stillRunning(b, now))
    .sort((a, b) => working(a) - working(b) || pickup(a) - pickup(b))
    .slice(0, cap)
    .map((b) => b.reference as string);
};

/**
 * Dispatch refuses a status check made within thirty seconds of the last one
 * for the same booking, in its own words: "Please wait 30 seconds since the
 * last status check for this booking." It refuses the whole request when one
 * booking in it is too soon, so asking faster than this does not just waste
 * the call, it loses the answer for every other booking asked about at the
 * same time.
 */
export const DISPATCH_RECHECK_MS = 30_000;

/**
 * How often the member app asks Dispatch for status while a chauffeur is
 * working a job, and in the run up to a pickup.
 *
 * Both sit above DISPATCH_RECHECK_MS with a margin. At fifteen seconds every
 * second poll was refused and surfaced to the member as "we could not reach
 * the booking system", and it was colliding with the five minute sweep as
 * well. Slower here is genuinely faster.
 */
export const LIVE_POLL_MS = 35_000;
export const PENDING_POLL_MS = 45_000;

/**
 * The least the booking-status ceiling can be without stopping our own app
 * mid journey: one member, one device, watching continuously for an hour.
 */
export const MIN_CHECKS_PER_HOUR = Math.ceil(3600_000 / LIVE_POLL_MS);
