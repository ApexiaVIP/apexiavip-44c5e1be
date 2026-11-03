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
