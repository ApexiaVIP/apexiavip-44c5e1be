/**
 * How old a driver's reported position is.
 *
 * Dispatch sends the location time as "DD-MMM-YYYY HH:MM" in UK local time
 * with no offset, so both sides are compared as UK wall-clock readings. That
 * keeps the answer right whether the member is in Manchester or Cape Town.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Minutes since the position was reported, or null if we cannot tell. */
export const minutesSinceLocation = (raw: string | null, now: Date = new Date()): number | null => {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const reported = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]));

  // The same instant as the clock on a wall in London
  const uk = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string) => Number(uk.find((p) => p.type === type)?.value ?? 0);
  const hour = part("hour") % 24;
  const nowUk = Date.UTC(part("year"), part("month") - 1, part("day"), hour, part("minute"));

  return Math.round((nowUk - reported) / 60000);
};

/** Plain words for how fresh the position is. */
export const locationFreshness = (
  raw: string | null,
  now: Date = new Date()
): { text: string; stale: boolean } => {
  const mins = minutesSinceLocation(raw, now);
  if (mins === null) return { text: raw ? `updated ${raw}` : "", stale: false };
  if (mins < 0) return { text: "updated just now", stale: false };
  if (mins < 2) return { text: "updated just now", stale: false };
  if (mins < 60) return { text: `updated ${mins} min ago`, stale: mins >= 10 };
  const hours = Math.floor(mins / 60);
  return { text: `last seen ${hours} hr${hours > 1 ? "s" : ""} ago`, stale: true };
};
