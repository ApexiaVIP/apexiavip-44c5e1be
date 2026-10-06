/**
 * Working in UK days from a server that runs on UTC.
 *
 * A timesheet day has to mean a day in Manchester, not a day in UTC, or an
 * evening job lands on the wrong sheet for half the year.
 */

/** How far ahead of UTC the UK clock is at this instant, in minutes. */
export const ukOffsetMinutes = (at: Date): number => {
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const uk = new Date(at.toLocaleString("en-US", { timeZone: "Europe/London" }));
  return Math.round((uk.getTime() - utc.getTime()) / 60000);
};

/** The UK calendar day an instant falls in, as YYYY-MM-DD. */
export const ukDay = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/** Midnight at the start of a UK day, as an instant. */
export const ukDayStart = (ymd: string): Date => {
  const naive = Date.parse(`${ymd}T00:00:00Z`);
  // Correct by the offset in force at that moment, then settle once more in
  // case the first guess landed the other side of a clock change
  let instant = naive - ukOffsetMinutes(new Date(naive)) * 60000;
  instant = naive - ukOffsetMinutes(new Date(instant)) * 60000;
  return new Date(instant);
};

/** The day after, so a day is [start, end). */
export const ukDayEnd = (ymd: string): Date => {
  const next = new Date(ukDayStart(ymd).getTime() + 36 * 3600 * 1000);
  return ukDayStart(ukDay(next));
};

/** Shift the UK day by a number of days. */
export const ukDayPlus = (ymd: string, days: number): string =>
  ukDay(new Date(ukDayStart(ymd).getTime() + days * 24 * 3600 * 1000 + 12 * 3600 * 1000));

export const ukTimeOf = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
    : "";

export const ukDayName = (ymd: string): string =>
  ukDayStart(ymd).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });

/** Hours and minutes, the way a timesheet reads. */
export const asHours = (minutes: number): string => {
  if (minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
