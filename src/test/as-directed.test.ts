import { describe, it, expect } from "vitest";
import { canSayWhere, destinationNow, placeFrom, type Logged } from "@/lib/asDirected";

let clock = 0;
const at = (kind: string, place = "", reference = "APX-1"): Logged => ({
  kind,
  place,
  booking_reference: reference,
  recorded_at: new Date(Date.UTC(2026, 9, 24, 12, 0, ++clock)).toISOString(),
});

describe("where an hourly hire is heading", () => {
  it("is nowhere until the passenger has said", () => {
    expect(destinationNow([at("en_route"), at("arrived"), at("pob")], "APX-1")).toBeNull();
  });

  it("is the address the chauffeur put in", () => {
    const log = [at("pob"), at("destination", "The Lowry Hotel, Salford")];
    expect(destinationNow(log, "APX-1")?.place).toBe("The Lowry Hotel, Salford");
  });

  /**
   * The one that makes the loop work. Once they have pulled up and are waiting
   * while the passenger is in a meeting, that address is done. Coming back
   * aboard must ask where next, not drive to the kerb they are parked on.
   */
  it("is spent once the chauffeur is waiting at it", () => {
    const log = [at("pob"), at("destination", "Spinningfields"), at("waiting", "Spinningfields")];
    expect(destinationNow(log, "APX-1")).toBeNull();
  });

  it("asks again after the passenger comes back aboard", () => {
    const log = [
      at("pob"),
      at("destination", "Spinningfields"),
      at("waiting"),
      at("pob"),
    ];
    expect(destinationNow(log, "APX-1")).toBeNull();
  });

  it("follows the passenger to the next place they name", () => {
    const log = [
      at("pob"),
      at("destination", "Spinningfields"),
      at("waiting"),
      at("pob"),
      at("destination", "Hale Barns"),
    ];
    expect(destinationNow(log, "APX-1")?.place).toBe("Hale Barns");
  });

  it("takes the latest when the chauffeur corrects themselves", () => {
    const log = [at("pob"), at("destination", "Wrong Street"), at("destination", "Right Street")];
    expect(destinationNow(log, "APX-1")?.place).toBe("Right Street");
  });

  it("is nothing once the job is cleared", () => {
    const log = [at("pob"), at("destination", "Hale Barns"), at("clear")];
    expect(destinationNow(log, "APX-1")).toBeNull();
  });

  it("never reads another job's destination", () => {
    const log = [at("destination", "Somewhere else", "APX-2"), at("pob")];
    expect(destinationNow(log, "APX-1")).toBeNull();
  });

  it("reads the log in time order, however it arrives", () => {
    const first = at("destination", "First");
    const waiting = at("waiting");
    const second = at("destination", "Second");
    expect(destinationNow([second, first, waiting], "APX-1")?.place).toBe("Second");
  });
});

/*
 * The end-of-day list used to be built here and was never read. The office
 * email builds it server side now, in driver-timesheets, which is where
 * accounts actually sees it.
 */

describe("turning a recorded destination back into something to drive to", () => {
  it("takes the postcode off the end, where it is written", () => {
    expect(placeFrom("Spinningfields, Manchester, M3 3EB")).toEqual({
      line1: "Spinningfields",
      town: "Manchester",
      postcode: "M3 3EB",
    });
  });

  it("keeps a town made of several parts together", () => {
    expect(placeFrom("The Ivy, Spinningfields, Manchester, M3 3AP").town)
      .toBe("Spinningfields, Manchester");
  });

  /**
   * Google knows places that have no postcode. Those are still worth having
   * on the job for the office, even though the sat nav cannot take the car
   * there, so this must not mistake the town for one.
   */
  it("leaves the postcode empty rather than guessing at a town", () => {
    expect(placeFrom("Old Trafford, Manchester")).toEqual({
      line1: "Old Trafford",
      town: "Manchester",
      postcode: "",
    });
  });

  it("copes with a postcode written without its space", () => {
    expect(placeFrom("Hale Barns, Altrincham, WA150AA").postcode).toBe("WA150AA");
  });

  it("copes with nothing at all", () => {
    expect(placeFrom("")).toEqual({ line1: "", town: "", postcode: "" });
  });
});

/**
 * The address arrives by word of mouth, through the window or over a
 * shoulder, and it arrives before anybody presses anything. If the box that
 * takes it is not already on the screen, the chauffeur has nowhere to put it
 * and the office never learns where the car went.
 */
describe("when the chauffeur can be asked where to", () => {
  it("asks from the moment the car is on the kerb", () => {
    expect(canSayWhere("arrived")).toBe(true);
  });

  it("keeps asking once the passenger is in", () => {
    expect(canSayWhere("pob")).toBe(true);
  });

  it("asks again while waiting, which is where the next leg comes from", () => {
    expect(canSayWhere("waiting")).toBe(true);
  });

  it("does not ask on the way to the collection, with nobody to ask", () => {
    expect(canSayWhere("en_route")).toBe(false);
  });

  it("does not ask before the job has started", () => {
    expect(canSayWhere(null)).toBe(false);
    expect(canSayWhere(undefined)).toBe(false);
  });

  it("stops asking once the job is cleared", () => {
    expect(canSayWhere("clear")).toBe(false);
  });
});
