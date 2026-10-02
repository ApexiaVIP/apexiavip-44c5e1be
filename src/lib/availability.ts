/**
 * When we can promise a car and when we can only try.
 *
 * Faz's rule: inside two hours we cannot guarantee cover, and a pickup
 * between midnight and 6am is subject to availability whatever the notice.
 * Everything else we can cover. These are the only numbers to change.
 */
export const PROVISIONAL_NOTICE_MINUTES = 120;
export const NIGHT_FROM_HOUR = 0;
export const NIGHT_UNTIL_HOUR = 6;

/** A booking still has to be in the future, with a few minutes to act on it. */
export const MIN_NOTICE_MINUTES = 15;

/** The hour of the pickup in UK time, whatever the device's own clock says. */
export const ukHour = (when: Date): number =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(when)
  ) % 24;

export type AvailabilityReason = "short-notice" | "overnight" | null;

/**
 * Why this journey cannot be promised, if it cannot. Short notice is judged
 * from the moment of booking, so the answer is fixed once a booking is made.
 */
export const availabilityReason = (pickup: Date, now: Date = new Date()): AvailabilityReason => {
  const minutes = (pickup.getTime() - now.getTime()) / 60000;
  if (minutes < PROVISIONAL_NOTICE_MINUTES) return "short-notice";
  const hour = ukHour(pickup);
  if (hour >= NIGHT_FROM_HOUR && hour < NIGHT_UNTIL_HOUR) return "overnight";
  return null;
};

export const isProvisional = (pickup: Date, now: Date = new Date()) =>
  availabilityReason(pickup, now) !== null;

/** What we say to the member, in their words rather than ours. */
export const availabilityNotice = (reason: AvailabilityReason): string => {
  if (reason === "short-notice") {
    return "This is a short-notice booking, so it is subject to availability. We will confirm by text as soon as a chauffeur is assigned, and call you if we cannot cover it.";
  }
  if (reason === "overnight") {
    return "Pickups between midnight and 6am are subject to availability. We will confirm by text as soon as a chauffeur is assigned, and call you if we cannot cover it.";
  }
  return "";
};
