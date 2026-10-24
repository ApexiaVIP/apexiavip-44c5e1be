import { describe, it, expect } from "vitest";
import {
  destinationQuery,
  nextDestination,
  wazeLink,
  googleMapsLink,
  appleMapsLink,
} from "@/lib/navigation";

const pickup = { line1: "Alderley Mill Cottage", town: "Macclesfield", postcode: "SK10 4TW" };
const dropoff = { line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" };

describe("the address handed to a navigation app", () => {
  it("reads street, town, postcode", () => {
    expect(destinationQuery(pickup)).toBe("Alderley Mill Cottage, Macclesfield, SK10 4TW");
  });

  it("leaves out the parts the office never filled in", () => {
    expect(destinationQuery({ line1: "", town: null, postcode: "M1 2PB" })).toBe("M1 2PB");
  });

  it("trims what somebody typed with a trailing space", () => {
    expect(destinationQuery({ line1: " Piccadilly ", town: "", postcode: " M1 2PB " }))
      .toBe("Piccadilly, M1 2PB");
  });

  it("is empty when there is no address at all", () => {
    expect(destinationQuery(null)).toBe("");
    expect(destinationQuery({ line1: "", town: "", postcode: "" })).toBe("");
  });
});

describe("where the chauffeur is driving to", () => {
  const job = { pickup, dropoff, as_directed: false };

  it("heads for the collection before anybody is aboard", () => {
    expect(nextDestination(job, null)).toEqual({ place: pickup, what: "pickup" });
    expect(nextDestination(job, "en_route")).toEqual({ place: pickup, what: "pickup" });
  });

  it("still heads for the collection while waiting on the kerb", () => {
    expect(nextDestination(job, "arrived")).toEqual({ place: pickup, what: "pickup" });
  });

  it("switches to the destination once the passenger is in", () => {
    expect(nextDestination(job, "pob")).toEqual({ place: dropoff, what: "dropoff" });
  });

  it("keeps the destination through a wait mid journey", () => {
    expect(nextDestination(job, "waiting")).toEqual({ place: dropoff, what: "dropoff" });
  });

  it("offers nothing on an as directed hire until the passenger has said", () => {
    expect(nextDestination({ ...job, as_directed: true }, "pob")).toBeNull();
  });

  /**
   * On an hourly hire the passenger names the place in the car, the chauffeur
   * puts it into the Apexia sat nav, and that is what the car drives to.
   */
  it("drives an hourly hire to wherever the passenger named", () => {
    const named = { line1: "Spinningfields", town: "Manchester", postcode: "M3 3EB" };
    expect(nextDestination({ ...job, as_directed: true }, "pob", named)).toEqual({
      place: named,
      what: "dropoff",
    });
  });

  it("ignores the booked destination on an hourly hire, which is not where they are going", () => {
    const named = { line1: "Hale Barns", town: "Altrincham", postcode: "WA15 0AA" };
    expect(nextDestination({ ...job, as_directed: true }, "pob", named)?.place).toBe(named);
  });

  it("still heads for the collection on an hourly hire before anybody is aboard", () => {
    const named = { line1: "Spinningfields", town: "Manchester", postcode: "M3 3EB" };
    expect(nextDestination({ ...job, as_directed: true }, "en_route", named)).toEqual({
      place: pickup,
      what: "pickup",
    });
  });

  it("offers nothing when the job has no destination recorded", () => {
    expect(nextDestination({ pickup, dropoff: null }, "pob")).toBeNull();
  });

  it("offers nothing when the job has no collection recorded", () => {
    expect(nextDestination({ pickup: null, dropoff }, null)).toBeNull();
  });
});

describe("the links themselves", () => {
  it("tells Waze to start driving, not just drop a pin", () => {
    const url = wazeLink(pickup);
    expect(url).toContain("navigate=yes");
    expect(url).toContain(encodeURIComponent("SK10 4TW"));
  });

  it("asks Google Maps for driving directions, which carry live traffic", () => {
    const url = googleMapsLink(dropoff);
    expect(url).toContain("travelmode=driving");
    expect(url).toContain("dir/?api=1");
    expect(url).toContain(encodeURIComponent("The Lowry Hotel"));
  });

  it("asks Apple Maps for driving too", () => {
    expect(appleMapsLink(dropoff)).toContain("dirflg=d");
  });

  it("escapes an address rather than breaking the link", () => {
    const url = wazeLink({ line1: "Flat 2, King's Court", town: "Hale", postcode: "WA15 9QA" });
    expect(url).not.toContain(" ");
    // An ampersand in an address would otherwise look like another parameter
    const amp = wazeLink({ line1: "Marks & Spencer", town: "Manchester", postcode: "M1 1AA" });
    expect(amp).toContain("%26");
    expect(amp.split("&").length).toBe(2); // only the real navigate= parameter
  });

  it("gives back nothing when there is no address, so no button is offered", () => {
    expect(wazeLink(null)).toBe("");
    expect(googleMapsLink(null)).toBe("");
    expect(appleMapsLink(null)).toBe("");
  });
});
