/**
 * What a chauffeur is paid for.
 *
 * This is the one definition of time on duty, shared by the chauffeur's own
 * screen, the office allocation list and the timesheets that go to accounts.
 * It had no tests, and it is the only figure here that somebody's wages come
 * off, so it gets them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { minutesOnDuty, type Shift } from "../../supabase/functions/_shared/hours.ts";

const NOV = new Date("2026-11-01T00:00:00Z");
const DEC = new Date("2026-12-01T00:00:00Z");
const open = (started: string): Shift => ({ started_at: started, ended_at: null });
const closed = (started: string, ended: string): Shift => ({ started_at: started, ended_at: ended });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const at = (when: string) => vi.setSystemTime(new Date(when));

describe("a shift still running", () => {
  it("counts only up to now, not to the end of the month", () => {
    at("2026-11-15T20:10:00Z");
    const { minutes } = minutesOnDuty([open("2026-11-15T20:00:00Z")], NOV, DEC);
    expect(minutes).toBe(10);
  });

  it("is not called capped ten minutes into a shift", () => {
    at("2026-11-15T20:10:00Z");
    const { capped } = minutesOnDuty([open("2026-11-15T20:00:00Z")], NOV, DEC);
    expect(capped).toBe(false);
  });

  it("says the figure is still running", () => {
    at("2026-11-15T20:10:00Z");
    const { stillOpen } = minutesOnDuty([open("2026-11-15T20:00:00Z")], NOV, DEC);
    expect(stillOpen).toBe(true);
  });

  it("is capped once it really has run past fourteen hours", () => {
    at("2026-11-16T12:00:00Z");
    const worked = minutesOnDuty([open("2026-11-15T20:00:00Z")], NOV, DEC);
    expect(worked.capped).toBe(true);
    expect(worked.minutes).toBe(14 * 60);
  });
});

describe("a shift that is over", () => {
  it("counts what was worked", () => {
    at("2026-11-15T20:00:00Z");
    const { minutes, stillOpen, capped } = minutesOnDuty(
      [closed("2026-11-14T08:00:00Z", "2026-11-14T16:30:00Z")], NOV, DEC,
    );
    expect(minutes).toBe(510);
    expect(stillOpen).toBe(false);
    expect(capped).toBe(false);
  });

  it("is capped when somebody signed off the next day", () => {
    at("2026-11-15T20:00:00Z");
    const { minutes, capped } = minutesOnDuty(
      [closed("2026-11-13T08:00:00Z", "2026-11-14T09:00:00Z")], NOV, DEC,
    );
    expect(capped).toBe(true);
    expect(minutes).toBe(14 * 60);
  });
});

describe("a shift left open from an earlier month", () => {
  it("earns nothing and is called out", () => {
    at("2026-11-15T20:00:00Z");
    const worked = minutesOnDuty([open("2026-10-28T08:00:00Z")], NOV, DEC);
    expect(worked.minutes).toBe(0);
    expect(worked.neverClosed).toBe(true);
    expect(worked.stillOpen).toBe(false);
  });
});

describe("a month already over", () => {
  it("counts to the end of that month, not to today", () => {
    at("2026-11-15T20:00:00Z");
    const oct = new Date("2026-10-01T00:00:00Z");
    const { minutes } = minutesOnDuty(
      [closed("2026-10-05T08:00:00Z", "2026-10-05T17:00:00Z")], oct, NOV,
    );
    expect(minutes).toBe(540);
  });
});

describe("a single day on the timesheet", () => {
  it("does not count the rest of today as already worked", () => {
    at("2026-11-15T14:00:00Z");
    const dayStart = new Date("2026-11-15T00:00:00Z");
    const dayEnd = new Date("2026-11-16T00:00:00Z");
    const { minutes } = minutesOnDuty([open("2026-11-15T09:00:00Z")], dayStart, dayEnd);
    expect(minutes).toBe(300);
  });
});
