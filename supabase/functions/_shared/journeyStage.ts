/**
 * How far along a journey is, and whether the passenger should hear about it.
 *
 * This has its own file because getting it wrong is visible to a client within
 * seconds. Two things text a passenger: the chauffeur's own app, which fires
 * the instant a button is pressed, and the Dispatch sweep, which reads the
 * booking system every few minutes. The slow one routinely arrives holding
 * older news than the passenger already has, and on 17 November a passenger
 * was told the car was on its way at 16:31 and that it was confirmed at 16:35.
 *
 * A journey only runs one way, so the rule is simply that we never announce a
 * stage we have already passed.
 */

export type Moment = "assigned" | "onroute" | "arrived" | "cancelled" | null;

/**
 * Dispatch wording varies, so statuses are matched loosely and only the moments
 * a passenger benefits from hearing about are texted. Anything unrecognised is
 * recorded but never texted, so a new status can never send nonsense.
 */
export const classify = (status: string): Moment => {
  const s = (status ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s.includes("cancel")) return "cancelled";
  if (
    s.includes("onroute") ||
    s.includes("enroute") ||
    s.includes("onway") ||
    s.includes("ontheway") ||
    s.includes("travelling")
  ) {
    return "onroute";
  }
  if (
    s.includes("arrived") ||
    s.includes("atpickup") ||
    s.includes("waiting") ||
    s.includes("onsite")
  ) {
    return "arrived";
  }
  if (
    s.includes("dispatch") ||
    s.includes("allocated") ||
    s.includes("assigned") ||
    s.includes("accepted")
  ) {
    return "assigned";
  }
  // Passenger on board, completed, no show: nothing useful to say to them
  return null;
};

/**
 * The order the journey actually happens in. Cancelled is deliberately absent:
 * it can follow any stage, it is never late news, and it must always go out.
 */
const RAIL: Moment[] = ["assigned", "onroute", "arrived"];

/** How far along a stage is, counting from 1. Zero means it is not a stage. */
export const reached = (moment: Moment | string | null | undefined): number => {
  const i = RAIL.indexOf((moment ?? null) as Moment);
  return i < 0 ? 0 : i + 1;
};

/**
 * Whether Dispatch reaching `moment` is worth texting about, given what the
 * passenger has already been told: `driverMoment` by the chauffeur's own app,
 * `notifiedStatus` by this sweep the last time it sent something.
 */
export const shouldAnnounce = (
  moment: Moment,
  told: { driverMoment?: string | null; notifiedStatus?: string | null }
): boolean => {
  if (!moment) return false;
  const here = reached(moment);
  // Off the rail, so nothing can make it stale
  if (here === 0) return true;
  const already = Math.max(
    reached(told.driverMoment),
    reached(classify(told.notifiedStatus ?? ""))
  );
  return here > already;
};
