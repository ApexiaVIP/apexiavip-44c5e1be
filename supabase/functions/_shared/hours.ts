/**
 * What counts as time on duty.
 *
 * This lived inside the timesheets that go to accounts. A chauffeur is now
 * shown his own month in the app and the office sees the same figure when
 * allocating, and three places working it out three ways is three different
 * answers to what somebody is owed. There is one definition and it is here.
 */

export interface Shift {
  started_at: string;
  ended_at: string | null;
}

/**
 * The longest a single shift can contribute to one day.
 *
 * A chauffeur who forgets to sign off leaves the clock running, and a shift
 * spanning a weekend would otherwise report a flat twenty four hours for the
 * Saturday as though it had been worked. Nobody is paid on a figure nobody
 * checked, so it is capped and said plainly instead.
 */
export const MAX_SHIFT_HOURS = 14;

export interface OnDuty {
  minutes: number;
  /** A shift still running, so the figure is a running total, not a final one. */
  stillOpen: boolean;
  /** A shift hit the cap, so somebody should look before it is paid. */
  capped: boolean;
  /** A shift opened before this period and never closed, so it earns nothing. */
  neverClosed: boolean;
  /**
   * When the running shift began, so the office can see a sign-off that never
   * happened. "On duty" alone cannot be told apart from one left open on
   * Tuesday, which is the whole difficulty when the figure looks wrong.
   */
  openedAt: string | null;
}

/**
 * Minutes on duty within a window. An open shift is counted to this moment and
 * flagged, rather than guessed at or run on to the end of the window.
 *
 * An open shift that began before the window is a different thing: nobody
 * works a fortnight without signing off. Counting it to the end of every
 * later day would put fourteen hours against that chauffeur every day for
 * ever, so it earns nothing and is called out instead.
 */
export const minutesOnDuty = (
  shifts: Shift[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): OnDuty => {
  // Time not yet worked is not time worked. A shift still running is counted
  // to this moment, never to the end of the window it falls in: counting it to
  // the end of the month reported the rest of the month as already earned, and
  // called every chauffeur on duty capped within a day of signing on.
  const running = Math.min(to.getTime(), now.getTime());
  let minutes = 0;
  let stillOpen = false;
  let capped = false;
  let neverClosed = false;
  let openedAt: string | null = null;
  for (const s of shifts) {
    if (!s.ended_at && new Date(s.started_at).getTime() < from.getTime()) {
      neverClosed = true;
      continue;
    }
    const start = Math.max(new Date(s.started_at).getTime(), from.getTime());
    const rawEnd = s.ended_at ? new Date(s.ended_at).getTime() : running;
    if (!s.ended_at) {
      stillOpen = true;
      openedAt = s.started_at;
    }
    const end = Math.min(rawEnd, to.getTime());
    if (end <= start) continue;
    const worked = (end - start) / 60000;
    // A shift left running does not become a longer day
    if (worked > MAX_SHIFT_HOURS * 60) {
      capped = true;
      minutes += MAX_SHIFT_HOURS * 60;
    } else {
      minutes += worked;
    }
  }
  return { minutes, stillOpen, capped, neverClosed, openedAt };
};
