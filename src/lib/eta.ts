/**
 * When the passenger's car is due.
 *
 * The chauffeur's app works out a traffic-aware arrival time to navigate by,
 * and until now it threw that away. A passenger who can see the car moving
 * still rings to ask how long, so the number the chauffeur is driving to is
 * the number the passenger should be reading.
 *
 * The rules here are all about not quoting a time we cannot stand behind. A
 * stale time is worse than no time: it is the difference between a passenger
 * who waits and a passenger who rings the office.
 */

/** Past this long without a fresh position, the time is not worth quoting. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Beyond this the number is nonsense rather than a long journey. */
const TOO_FAR_MS = 4 * 60 * 60 * 1000;

/** Inside this, saying a time is sillier than saying it is here. */
const ARRIVING_MS = 60 * 1000;

export interface Due {
  /** The line in large type: "Collecting you about 19:42". */
  headline: string;
  /** The line under it: "about 7 minutes away". */
  detail: string;
}

const ukTime = (at: Date) =>
  at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

/**
 * What to tell the passenger, or nothing at all.
 *
 * Nothing is a perfectly good answer: no estimate, a position old enough that
 * the estimate has rotted, or a time so far out it cannot be real.
 */
export const whenDue = (
  etaAt: string | null | undefined,
  positionAt: string | null | undefined,
  driverStatus: string | null | undefined,
  now: Date = new Date()
): Due | null => {
  if (!etaAt) return null;

  const due = Date.parse(etaAt);
  if (Number.isNaN(due)) return null;

  // An estimate is only as good as the position it was worked out from
  const reported = positionAt ? Date.parse(positionAt) : NaN;
  if (Number.isNaN(reported)) return null;
  if (now.getTime() - reported > STALE_AFTER_MS) return null;


  const left = due - now.getTime();
  if (left > TOO_FAR_MS) return null;

  // Once the passenger is aboard the car is taking them somewhere; before
  // that it is coming to get them, and those are different sentences
  const aboard = driverStatus === "pob" || driverStatus === "waiting";

  if (left <= ARRIVING_MS) {
    return {
      headline: aboard ? "Arriving now" : "Your chauffeur is arriving now",
      detail: aboard ? "At your destination" : "At the collection point",
    };
  }

  const minutes = Math.max(1, Math.round(left / 60000));
  return {
    headline: `${aboard ? "Arriving" : "Collecting you"} about ${ukTime(new Date(due))}`,
    detail: `about ${minutes} minute${minutes === 1 ? "" : "s"} away`,
  };
};

/**
 * An arrival time we worked out ourselves, held at the moment we worked it out.
 *
 * The passenger's screen refreshes every four seconds while a car is out.
 * Working the arrival back out from the clock each time would push it further
 * away on every refresh, so the car would never appear to get any closer. The
 * moment of the estimate travels with it and only the minutes count down.
 *
 * It is put through the same rules as the chauffeur's own number, so an
 * estimate off a position that has since gone stale is dropped rather than
 * quoted.
 */
export const dueFromRoute = (
  worked: { seconds: number; at: number } | null | undefined,
  positionAt: string | null | undefined,
  driverStatus: string | null | undefined,
  now: Date = new Date()
): Due | null =>
  worked
    ? whenDue(
        new Date(worked.at + worked.seconds * 1000).toISOString(),
        positionAt,
        driverStatus,
        now
      )
    : null;
