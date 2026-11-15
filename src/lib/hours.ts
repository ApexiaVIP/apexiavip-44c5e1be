/**
 * How hours read, in one place.
 *
 * A chauffeur sees his month in the app, the office sees everybody's when
 * allocating, and accounts are sent the same figure. Three screens rounding
 * three ways is three answers to what somebody is owed.
 */
export const asHours = (minutes: number): string => {
  // Rounded to the minute before it is split, or 119.6 reads as "1h 60m"
  const total = Math.round(minutes);
  const whole = Math.floor(total / 60);
  const rest = total % 60;
  if (whole === 0) return `${rest}m`;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
};

/** The month as a person reads it, from a "YYYY-MM". */
export const monthName = (ym: string): string =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

/**
 * Where a chauffeur stands against their contract.
 *
 * No contract set is not the same as a contract of none: the first wants
 * somebody to set one, the second would report a chauffeur who has worked
 * all month as having done more than was asked of them.
 */
export const against = (
  minutes: number,
  contractedHours: number | null
): { leftMinutes: number | null; percent: number | null } => {
  if (contractedHours === null || contractedHours <= 0) {
    return { leftMinutes: null, percent: null };
  }
  const target = contractedHours * 60;
  return {
    leftMinutes: Math.max(0, target - minutes),
    percent: Math.min(100, Math.round((minutes / target) * 100)),
  };
};

/**
 * When a running shift began, as the office needs to read it.
 *
 * "On duty" on its own cannot be told apart from a shift somebody left open
 * on Tuesday and went home, which is exactly the doubt that arises when the
 * hours look wrong. A shift that started today is given as a time; one that
 * started earlier is given its day as well, because that is the one worth
 * questioning.
 */
export const onDutySince = (iso: string | null, now: Date = new Date()): string => {
  if (!iso) return "";
  const started = new Date(iso);
  if (Number.isNaN(started.getTime())) return "";
  const day = (d: Date) =>
    d.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
  const time = started.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  if (day(started) === day(now)) return `since ${time}`;
  const when = started.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  return `since ${when}, ${time}`;
};
