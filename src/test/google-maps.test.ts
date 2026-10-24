import { describe, it, expect } from "vitest";
import { pointAhead, turnTowards } from "@/lib/googleMaps";
import { bearing, metresBetween } from "@/lib/trackMarker";

describe("aiming the camera up the road", () => {
  it("puts the point the distance asked for, in the direction asked for", () => {
    const from = { lat: 53.4808, lng: -2.2426 };
    const ahead = pointAhead(from.lat, from.lng, 90, 130);
    expect(metresBetween(from.lat, from.lng, ahead.lat, ahead.lng)).toBeCloseTo(130, 0);
    expect(bearing(from.lat, from.lng, ahead.lat, ahead.lng)).toBeCloseTo(90, 1);
  });

  it("works heading north, where longitude does nothing", () => {
    const ahead = pointAhead(53.4808, -2.2426, 0, 200);
    expect(ahead.lat).toBeGreaterThan(53.4808);
    expect(ahead.lng).toBeCloseTo(-2.2426, 5);
    expect(metresBetween(53.4808, -2.2426, ahead.lat, ahead.lng)).toBeCloseTo(200, 0);
  });
});

describe("turning the map to face the way the car is going", () => {
  /**
   * The one that spins the whole world at a junction if it is got wrong:
   * going from almost north to just east of north is twenty degrees right,
   * not three hundred and forty degrees left.
   */
  it("takes the short way round past north", () => {
    expect(turnTowards(350, 10)).toBe(370);
    expect(turnTowards(10, 350)).toBe(-10);
  });

  it("turns the ordinary way when north is not in the way", () => {
    expect(turnTowards(90, 180)).toBe(180);
    expect(turnTowards(180, 90)).toBe(90);
  });

  it("leaves a bearing that has not changed alone", () => {
    expect(turnTowards(42, 42)).toBe(42);
  });

  it("picks a side for a half turn rather than sitting still", () => {
    expect(Math.abs(turnTowards(0, 180) - 0)).toBe(180);
  });
});
