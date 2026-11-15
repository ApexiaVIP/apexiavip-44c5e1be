import { describe, it, expect } from "vitest";
import { asHours, against, monthName, onDutySince } from "@/lib/hours";

describe("how hours read", () => {
  it("gives whole hours plainly", () => {
    expect(asHours(120)).toBe("2h");
  });

  it("gives the minutes with them", () => {
    expect(asHours(155)).toBe("2h 35m");
  });

  it("gives minutes alone under the hour", () => {
    expect(asHours(42)).toBe("42m");
  });

  it("says nothing worked as nothing", () => {
    expect(asHours(0)).toBe("0m");
  });

  it("rounds the seconds a shift clock leaves behind, and carries them", () => {
    expect(asHours(119.6)).toBe("2h");
    expect(asHours(59.6)).toBe("1h");
  });
});

describe("where a chauffeur stands against the contract", () => {
  it("counts what is left", () => {
    expect(against(60 * 80, 120)).toEqual({ leftMinutes: 60 * 40, percent: 67 });
  });

  it("never reports less than nothing left", () => {
    expect(against(60 * 200, 120).leftMinutes).toBe(0);
  });

  it("never reports more than a full month", () => {
    expect(against(60 * 200, 120).percent).toBe(100);
  });

  it("has nothing to say when no contract is set", () => {
    expect(against(60 * 80, null)).toEqual({ leftMinutes: null, percent: null });
  });

  it("treats a contract of none as unset rather than as exceeded", () => {
    expect(against(60 * 80, 0)).toEqual({ leftMinutes: null, percent: null });
  });
});

describe("naming a month", () => {
  it("reads as a person would say it", () => {
    expect(monthName("2026-11")).toBe("November 2026");
  });

  it("does not slip into the month before at a boundary", () => {
    expect(monthName("2026-01")).toBe("January 2026");
    expect(monthName("2026-12")).toBe("December 2026");
  });
});

describe("telling the office when a shift started", () => {
  const now = new Date("2026-11-15T20:00:00Z");

  it("gives the time alone for a shift started today", () => {
    expect(onDutySince("2026-11-15T08:12:00Z", now)).toBe("since 08:12");
  });

  it("gives the day as well when it started before today", () => {
    // The one worth questioning: nobody is still on the shift they opened
    // last Tuesday, so the office can see at a glance that it was never
    // signed off rather than wondering why the hours look wrong.
    expect(onDutySince("2026-11-10T08:12:00Z", now)).toBe("since Tue 10 Nov, 08:12");
  });

  it("says nothing when no shift is running", () => {
    expect(onDutySince(null, now)).toBe("");
  });

  it("says nothing rather than Invalid Date when the time is unreadable", () => {
    expect(onDutySince("not a time", now)).toBe("");
  });

  it("reads the clock in UK time, not the viewer's", () => {
    // A shift opened at 23:30 UK on the 14th is not "today" on the 15th,
    // however the phone looking at it is set.
    expect(onDutySince("2026-11-14T23:30:00Z", now)).toBe("since Sat 14 Nov, 23:30");
  });
});
