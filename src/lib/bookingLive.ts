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
  if (FINAL_STATUSES.includes(effectiveStatus(b))) return false;

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
  if (ACTIVE_STATUSES.includes(effectiveStatus(b))) return true;

  if (pickup === null) return true;
  return pickup > now - expectedRunHours(b) * 3600 * 1000;
};
