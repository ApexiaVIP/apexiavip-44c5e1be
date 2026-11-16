/**
 * Which chauffeur a job belongs to.
 *
 * This is the rule that decides whether a job ever reaches the person driving
 * it. It got its own file because it now runs from three places at once, and
 * because the ways it can go wrong are all quiet ones: a job that reaches
 * nobody looks exactly like a job nobody has been given yet.
 */
import { describe, it, expect } from "vitest";
import { matchChauffeurs, phoneKey } from "../../supabase/functions/_shared/chauffeurMatch.ts";

const JIMMY = { id: "jimmy", full_name: "Jimmy Acton", phone: "07700 900123" };
const SAM = { id: "sam", full_name: "Sam Reid", phone: "+447700900456" };

const held = (pairs: [string, string | null][]) => new Map(pairs);

describe("phoneKey", () => {
  it("reads the same number however the office typed it", () => {
    const keys = ["07700 900123", "+447700900123", "44 7700 900123", "7700900123"];
    expect(new Set(keys.map(phoneKey)).size).toBe(1);
  });

  it("refuses anything too short to be a phone number", () => {
    expect(phoneKey("1234")).toBe("");
    expect(phoneKey("")).toBe("");
    expect(phoneKey(null)).toBe("");
  });
});

describe("matchChauffeurs", () => {
  it("hands a job to the chauffeur whose number Dispatch gave", () => {
    const { claims } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Jimmy", Mobile: "+447700900123" } }],
      [JIMMY, SAM],
      held([["A1", null]])
    );
    expect(claims).toEqual([{ reference: "A1", driver_id: "jimmy", driver_name: "Jimmy" }]);
  });

  it("does not write again over a job the chauffeur already holds", () => {
    const { claims } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Jimmy", Mobile: "07700900123" } }],
      [JIMMY],
      held([["A1", "jimmy"]])
    );
    expect(claims).toEqual([]);
  });

  it("moves a job when the office moves it", () => {
    const { claims } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Sam", Mobile: "07700900456" } }],
      [JIMMY, SAM],
      held([["A1", "jimmy"]])
    );
    expect(claims[0].driver_id).toBe("sam");
  });

  it("leaves alone a booking that is not ours", () => {
    const { claims, unreachable } = matchChauffeurs(
      [{ Reference: "SOMEBODY-ELSE", Driver: { Name: "Jimmy", Mobile: "07700900123" } }],
      [JIMMY],
      held([])
    );
    expect(claims).toEqual([]);
    expect(unreachable).toEqual([]);
  });

  it("says so when Dispatch names a chauffeur with no mobile", () => {
    const { claims, unreachable } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Jimmy", Mobile: "" } }],
      [JIMMY],
      held([["A1", null]])
    );
    expect(claims).toEqual([]);
    expect(unreachable[0]).toMatchObject({ reference: "A1", name: "Jimmy" });
  });

  it("says so when the number is on nobody's profile", () => {
    const { claims, unreachable } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "A Stranger", Mobile: "07999 123456" } }],
      [JIMMY],
      held([["A1", null]])
    );
    expect(claims).toEqual([]);
    expect(unreachable[0].why).toContain("no profile");
  });

  it("refuses to guess when two chauffeurs share a number", () => {
    const twin = { id: "twin", full_name: "Twin", phone: "07700 900123" };
    const { claims, unreachable } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Jimmy", Mobile: "07700900123" } }],
      [JIMMY, twin],
      held([["A1", null]])
    );
    expect(claims).toEqual([]);
    expect(unreachable[0].why).toContain("more than one");
  });

  it("ignores a chauffeur profile with no number at all", () => {
    const { claims } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "Nobody", Mobile: "" } }],
      [{ id: "blank", full_name: "No Phone", phone: null }],
      held([["A1", null]])
    );
    expect(claims).toEqual([]);
  });

  it("falls back to our own name for them when Dispatch gives none", () => {
    const { claims } = matchChauffeurs(
      [{ Reference: "A1", Driver: { Name: "", Mobile: "07700900123" } }],
      [JIMMY],
      held([["A1", null]])
    );
    expect(claims[0].driver_name).toBe("Jimmy Acton");
  });

  it("hands out a whole day in one pass", () => {
    const { claims } = matchChauffeurs(
      [
        { Reference: "A1", Driver: { Name: "Jimmy", Mobile: "07700900123" } },
        { Reference: "A2", Driver: { Name: "Jimmy", Mobile: "07700900123" } },
        { Reference: "A3", Driver: { Name: "Sam", Mobile: "07700900456" } },
      ],
      [JIMMY, SAM],
      held([["A1", null], ["A2", null], ["A3", null]])
    );
    expect(claims.map((c) => c.driver_id)).toEqual(["jimmy", "jimmy", "sam"]);
  });
});
