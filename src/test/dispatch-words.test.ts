/**
 * The booking system's own words, and what we are allowed to assume about them.
 *
 * Dever's documentation gives "At pickup" where our list reads "At Pickup",
 * and a case-sensitive match on that one letter takes a car at the kerb off
 * the map, out of its badge and to the wrong end of the sort, silently. It
 * also answers 0 for both coordinates on every booking more than fifteen
 * minutes from collection, which is most of a booking's life, so a reading of
 * zero is an absence of a position and not a place in the Atlantic.
 *
 * Both of those are theirs to change and ours to survive, so they are pinned
 * here rather than trusted.
 */
import { describe, it, expect } from "vitest";
import {
  chauffeurPosition,
  isActiveStatus,
  isFinalStatus,
  isPreDispatchStatus,
  statusIs,
  stillRunning,
  whyNotOnMap,
} from "@/lib/bookingLive";

const atPickup = (status: string) => ({ status, collection_at: "2026-11-24T05:00:00Z" });

describe("a status the booking system sends, in whatever casing", () => {
  it("reads a chauffeur at the kerb as working, however they spell it", () => {
    for (const word of ["At Pickup", "At pickup", "AT PICKUP", " at pickup "]) {
      expect(isActiveStatus(word), word).toBe(true);
    }
  });

  it("reads the rest of the working statuses the same way", () => {
    expect(isActiveStatus("dispatched")).toBe(true);
    expect(isActiveStatus("en route to pickup")).toBe(true);
    expect(isActiveStatus("passenger on board")).toBe(true);
  });

  it("does not read a status we have never been told about as working", () => {
    expect(isActiveStatus("Pending")).toBe(false);
    expect(isActiveStatus("Quotation")).toBe(false);
    expect(isActiveStatus("")).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
    expect(isActiveStatus(undefined)).toBe(false);
  });

  it("reads a finished journey as finished, however they spell it", () => {
    expect(isFinalStatus("cancelled")).toBe(true);
    expect(isFinalStatus("Clear/Completed")).toBe(true);
    expect(isFinalStatus("NO SHOW")).toBe(true);
  });

  it("tells a job not yet sent to a chauffeur from one with nobody on it", () => {
    expect(isPreDispatchStatus("Pending")).toBe(true);
    expect(isPreDispatchStatus("quotation")).toBe(true);
    expect(isPreDispatchStatus("Dispatched")).toBe(false);
  });

  it("compares one word against another without betting on the casing", () => {
    expect(statusIs("at pickup", "At Pickup")).toBe(true);
    expect(statusIs("Arrived", "At Pickup")).toBe(false);
    expect(statusIs(null, "At Pickup")).toBe(false);
  });

  it("keeps a car on the road when its status arrives lower case", () => {
    // Six hours past a five in the morning pickup, so only the status can
    // keep this journey alive
    const now = Date.parse("2026-11-24T11:00:00Z");
    expect(stillRunning(atPickup("at pickup"), now)).toBe(true);
    expect(stillRunning(atPickup("clear/completed"), now)).toBe(false);
  });
});

describe("where to draw the car", () => {
  const dispatchOnly = (latitude: unknown, longitude: unknown) =>
    chauffeurPosition({}, { latitude, longitude } as never);

  it("draws nothing for the zeroes the booking system sends before tracking opens", () => {
    expect(dispatchOnly(0, 0)).toBeNull();
    expect(dispatchOnly("0", "0")).toBeNull();
    expect(dispatchOnly("0.0", "0.0")).toBeNull();
  });

  it("draws nothing when the booking system sends no position at all", () => {
    expect(dispatchOnly(null, null)).toBeNull();
    expect(dispatchOnly("", "")).toBeNull();
    expect(dispatchOnly(undefined, undefined)).toBeNull();
  });

  it("reads a real position whether it arrives as a number or a string", () => {
    expect(dispatchOnly(53.4808, -2.2426)).toMatchObject({
      lat: 53.4808,
      lng: -2.2426,
      fromOurApp: false,
    });
    expect(dispatchOnly("53.4808", "-2.2426")).toMatchObject({
      lat: 53.4808,
      lng: -2.2426,
      fromOurApp: false,
    });
  });

  it("prefers our own app's fresh position over the booking system's", () => {
    const now = Date.parse("2026-11-24T06:10:00Z");
    const fix = chauffeurPosition(
      {
        driver_lat: 53.4631,
        driver_lng: -2.2913,
        driver_position_at: "2026-11-24T06:09:40Z",
      },
      { latitude: 53.4808, longitude: -2.2426 },
      now
    );
    expect(fix).toMatchObject({ lat: 53.4631, fromOurApp: true });
    expect(fix?.ageMs).toBe(20_000);
  });

  it("falls back to a stale position of ours rather than drawing nothing", () => {
    const now = Date.parse("2026-11-24T06:10:00Z");
    const fix = chauffeurPosition(
      {
        driver_lat: 53.4631,
        driver_lng: -2.2913,
        driver_position_at: "2026-11-24T05:00:00Z",
      },
      { latitude: 0, longitude: 0 },
      now
    );
    expect(fix).toMatchObject({ lat: 53.4631, fromOurApp: true });
  });

  it("does not draw a car on Null Island because our own app reported it", () => {
    const now = Date.parse("2026-11-24T06:10:00Z");
    expect(
      chauffeurPosition(
        { driver_lat: 0, driver_lng: 0, driver_position_at: "2026-11-24T06:09:50Z" },
        null,
        now
      )
    ).toBeNull();
  });
});

describe("why a car is not on the map", () => {
  const SOON = "2026-11-24T12:00:00Z";
  const now = Date.parse("2026-11-24T12:20:00Z");
  const named = { name: "Irfan Siddiqui" };

  it("says nothing has come back when nothing has", () => {
    expect(whyNotOnMap(null, SOON, now)).toBe("no answer from the booking system yet");
  });

  it("does not promise tracking for a booking the system cannot find", () => {
    expect(whyNotOnMap({ message: "Booking not found", driver: named }, SOON, now)).toBe(
      "the booking system cannot find this booking, so it will not track it"
    );
  });

  /**
   * The one this was written for. A booking asked about in the last thirty
   * seconds comes back from what we saved, with a chauffeur's name on it and
   * no status. Read as a live answer it looked like a car that had passed its
   * collection time without reporting, and the desk went looking for it. It
   * was our own rate limit.
   */
  it("reports our own rate limit as ours, not as news about the car", () => {
    expect(
      whyNotOnMap(
        { driver: named, bookingStatus: null, fromSaved: true },
        SOON,
        now
      )
    ).toBe("waiting for the booking system's next answer");
  });

  it("tells a job not yet sent to a chauffeur from one with nobody on it", () => {
    expect(whyNotOnMap({ bookingStatus: "Pending" }, SOON, now)).toBe(
      "not sent to a chauffeur yet, so no name with it"
    );
    expect(whyNotOnMap({ bookingStatus: "Dispatched" }, SOON, now)).toBe(
      "no chauffeur named yet"
    );
  });

  it("explains the fifteen minute rule only while it is still the reason", () => {
    const early = Date.parse("2026-11-24T11:00:00Z");
    expect(whyNotOnMap({ driver: named, bookingStatus: "Dispatched" }, SOON, early)).toBe(
      "tracking opens 15 minutes before collection"
    );
  });

  it("says a working car has reported no position, in any casing", () => {
    expect(whyNotOnMap({ driver: named, bookingStatus: "at pickup" }, SOON, now)).toBe(
      "on the job, no position reported"
    );
  });

  it("repeats any other status in the booking system's own words", () => {
    expect(whyNotOnMap({ driver: named, bookingStatus: "Invoice" }, SOON, now)).toBe(
      'booking system says "Invoice", no position with it'
    );
  });

  it("never guesses that a chauffeur has not set off", () => {
    // A live answer with no status says nothing about the car, and used to
    // read "collection time has passed and no position has come through"
    const why = whyNotOnMap({ driver: named, bookingStatus: null }, SOON, now);
    expect(why).toBe("the booking system gave no status for this job");
    expect(why).not.toMatch(/set off|collection time/);
  });

  it("copes with a booking that has no collection time at all", () => {
    expect(whyNotOnMap({ driver: named, bookingStatus: "Dispatched" }, null, now)).toBe(
      "on the job, no position reported"
    );
  });
});
