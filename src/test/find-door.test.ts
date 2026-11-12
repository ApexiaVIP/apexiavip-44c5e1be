/**
 * The coordinate the car is sent to.
 *
 * The case that started this: a cottage on Donkey Lane whose postcode
 * centroid sits fifty yards from the gate, so the chauffeur was told he had
 * arrived while he was still short of it. These check that a precise answer
 * is taken when there is one, and, more importantly, that a bad one is
 * refused rather than driven to.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const geocode = vi.fn();

vi.mock("@/lib/googleMaps", () => ({
  loadGoogleMaps: async () => ({ Geocoder: class { geocode = geocode; } }),
}));

const { findDoor } = await import("@/lib/findDoor");

/** The centroid of SK9 1PX, as postcodes.io gives it. */
const CENTROID = { lat: 53.32, lng: -2.23 };

/** Roughly forty metres north of it: the actual gate. */
const GATE = { lat: 53.32036, lng: -2.23 };

/** Two kilometres away: a different cottage of the same name. */
const ELSEWHERE = { lat: 53.338, lng: -2.23 };

const COTTAGE = { line1: "The Cottage, Donkey Lane", town: "Wilmslow", postcode: "SK9 1PX" };

const result = (
  at: { lat: number; lng: number },
  location_type: string,
  types: string[] = ["street_address"]
) => ({
  types,
  geometry: { location_type, location: { lat: () => at.lat, lng: () => at.lng } },
});

beforeEach(() => {
  geocode.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("postcodes.io")
        ? {
            ok: true,
            json: async () => ({
              result: { latitude: CENTROID.lat, longitude: CENTROID.lng },
            }),
          }
        : { ok: false }
    )
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("findDoor", () => {
  it("drives to the door when Google knows the building", async () => {
    geocode.mockResolvedValue({ results: [result(GATE, "ROOFTOP")] });

    const door = await findDoor(COTTAGE);

    expect(door).toEqual({ ...GATE, precision: "address" });
  });

  it("asks for the whole address, not just the postcode", async () => {
    geocode.mockResolvedValue({ results: [result(GATE, "ROOFTOP")] });

    await findDoor(COTTAGE);

    expect(geocode).toHaveBeenCalledWith(
      expect.objectContaining({ address: "The Cottage, Donkey Lane, Wilmslow, SK9 1PX" })
    );
  });

  it("keeps the centroid when Google only knows the area", async () => {
    geocode.mockResolvedValue({ results: [result(GATE, "APPROXIMATE", ["postal_code"])] });

    const door = await findDoor(COTTAGE);

    expect(door).toEqual({ ...CENTROID, precision: "postcode" });
  });

  it("refuses a precise answer that is nowhere near the postcode", async () => {
    // The failure this guards against: a name thousands of houses share,
    // matched confidently in the next village, with nothing on screen to say
    // the car is going somewhere else entirely.
    geocode.mockResolvedValue({ results: [result(ELSEWHERE, "ROOFTOP")] });

    const door = await findDoor(COTTAGE);

    expect(door).toEqual({ ...CENTROID, precision: "postcode" });
  });

  it("takes the first precise answer that is near enough", async () => {
    geocode.mockResolvedValue({
      results: [result(ELSEWHERE, "ROOFTOP"), result(GATE, "ROOFTOP")],
    });

    const door = await findDoor(COTTAGE);

    expect(door).toEqual({ ...GATE, precision: "address" });
  });

  it("falls back to the centroid when the geocoder fails", async () => {
    geocode.mockRejectedValue(new Error("ZERO_RESULTS"));

    const door = await findDoor(COTTAGE);

    expect(door).toEqual({ ...CENTROID, precision: "postcode" });
  });

  it("does not call the geocoder when the address is only a postcode", async () => {
    const door = await findDoor({ line1: "", town: "", postcode: "SK9 1PX" });

    expect(geocode).not.toHaveBeenCalled();
    expect(door).toEqual({ ...CENTROID, precision: "postcode" });
  });

  it("gives nothing when there is no postcode at all", async () => {
    expect(await findDoor({ line1: "The Cottage", town: "Wilmslow" })).toBeNull();
  });

  it("gives nothing when the postcode itself cannot be found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    expect(await findDoor(COTTAGE)).toBeNull();
  });
});
