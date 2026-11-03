import { describe, it, expect } from "vitest";
import { asHours, against, monthName } from "@/lib/hours";

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
