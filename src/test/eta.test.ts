import { describe, it, expect } from "vitest";
import { whenDue } from "@/lib/eta";

const now = new Date("2026-10-24T18:30:00Z");
const inMinutes = (n: number) => new Date(now.getTime() + n * 60000).toISOString();
const agoMinutes = (n: number) => new Date(now.getTime() - n * 60000).toISOString();

describe("what the passenger is told about their car", () => {
  it("gives the clock time and the minutes, so nobody has to do the sum", () => {
    const due = whenDue(inMinutes(7), agoMinutes(0), "en_route", now)!;
    expect(due.headline).toBe("Collecting you about 19:37");
    expect(due.detail).toBe("about 7 minutes away");
  });

  it("counts one minute as a minute, not minutes", () => {
    expect(whenDue(inMinutes(1.4), agoMinutes(0), "en_route", now)!.detail)
      .toBe("about 1 minute away");
  });

  /**
   * Before the passenger is aboard the car is coming to get them. After, it
   * is taking them somewhere. Telling a passenger already in the car that
   * they are being collected reads as a system that is not paying attention.
   */
  it("changes the sentence once the passenger is aboard", () => {
    expect(whenDue(inMinutes(20), agoMinutes(0), "en_route", now)!.headline)
      .toContain("Collecting you");
    expect(whenDue(inMinutes(20), agoMinutes(0), "pob", now)!.headline)
      .toContain("Arriving");
    expect(whenDue(inMinutes(20), agoMinutes(0), "waiting", now)!.headline)
      .toContain("Arriving");
  });

  it("says it is here rather than quoting a time a few seconds out", () => {
    const due = whenDue(inMinutes(0.5), agoMinutes(0), "en_route", now)!;
    expect(due.headline).toBe("Your chauffeur is arriving now");
    expect(due.detail).toBe("At the collection point");
  });

  it("says it is here for the destination too", () => {
    expect(whenDue(inMinutes(0.2), agoMinutes(0), "pob", now)!.headline).toBe("Arriving now");
  });

  it("treats a time already gone by as arriving, not as a time in the past", () => {
    const due = whenDue(agoMinutes(3), agoMinutes(0), "en_route", now)!;
    expect(due.headline).toBe("Your chauffeur is arriving now");
  });
});

describe("when the passenger is told nothing", () => {
  it("says nothing when there is no estimate", () => {
    expect(whenDue(null, agoMinutes(0), "en_route", now)).toBeNull();
    expect(whenDue(undefined, agoMinutes(0), "en_route", now)).toBeNull();
  });

  /**
   * The one that matters. An estimate is only as good as the position it came
   * from, and a chauffeur through a tunnel stops reporting. Quoting a ten
   * minute old "four minutes away" is how a passenger ends up on the phone to
   * the office.
   */
  it("says nothing once the position it was worked out from has gone stale", () => {
    expect(whenDue(inMinutes(7), agoMinutes(4), "en_route", now)).not.toBeNull();
    expect(whenDue(inMinutes(7), agoMinutes(6), "en_route", now)).toBeNull();
  });

  it("says nothing when there is no position at all", () => {
    expect(whenDue(inMinutes(7), null, "en_route", now)).toBeNull();
  });

  it("says nothing to a time so far out it cannot be real", () => {
    expect(whenDue(inMinutes(60 * 5), agoMinutes(0), "en_route", now)).toBeNull();
  });

  it("says nothing when the dates are rubbish", () => {
    expect(whenDue("not a date", agoMinutes(0), "en_route", now)).toBeNull();
    expect(whenDue(inMinutes(7), "not a date", "en_route", now)).toBeNull();
  });
});
