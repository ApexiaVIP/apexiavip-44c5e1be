import { describe, it, expect } from "vitest";
import { whenDue, dueFromRoute } from "@/lib/eta";

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

/**
 * The number we work out when the chauffeur is not navigating in the app,
 * which is the only reason a passenger on board had no arrival time at all.
 */
describe("an arrival time we worked out ourselves", () => {
  const at = Date.parse("2026-11-02T11:00:00Z");
  const fresh = new Date(at).toISOString();

  it("counts down as the minutes pass, rather than sliding away", () => {
    const worked = { seconds: 20 * 60, at };
    const first = dueFromRoute(worked, fresh, "pob", new Date(at));
    // Four minutes on, not nine: past five the position itself is too old to
    // quote from and the estimate is dropped, which is tested below
    const later = dueFromRoute(worked, fresh, "pob", new Date(at + 4 * 60 * 1000));
    expect(first?.detail).toBe("about 20 minutes away");
    expect(later?.detail).toBe("about 16 minutes away");
    // The arrival itself does not move, only the wait shortens
    expect(later?.headline).toBe(first?.headline);
  });

  it("says the passenger is arriving once it is down to the last minute", () => {
    const due = dueFromRoute({ seconds: 30, at }, fresh, "pob", new Date(at));
    expect(due?.headline).toBe("Arriving now");
    expect(due?.detail).toBe("At your destination");
  });

  it("drops an estimate once the position it came from has gone stale", () => {
    const stale = new Date(at - 6 * 60 * 1000).toISOString();
    expect(dueFromRoute({ seconds: 600, at }, stale, "pob", new Date(at))).toBeNull();
  });

  it("has nothing to say when no route came back", () => {
    expect(dueFromRoute(null, fresh, "pob", new Date(at))).toBeNull();
    expect(dueFromRoute(undefined, fresh, "pob", new Date(at))).toBeNull();
  });

  it("speaks as a collection while the car is still coming to get them", () => {
    const due = dueFromRoute({ seconds: 15 * 60, at }, fresh, "en_route", new Date(at));
    expect(due?.headline).toMatch(/^Collecting you about/);
  });
});
