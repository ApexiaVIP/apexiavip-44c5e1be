/**
 * Which way the car faces on the passenger's map.
 *
 * The car used to be turned by the line between its last two reported
 * positions, which arrive the better part of a minute apart. On anything but
 * a straight road that line is not the road, and a passenger watching the
 * map sees a car driving sideways through the buildings on a corner.
 */
import { describe, it, expect } from "vitest";
import { bearing, headingAlongRoute } from "../lib/trackMarker";

/** A straight run due east along a road, a few metres between points. */
const eastward = Array.from({ length: 40 }, (_, i) => ({
  lat: 53.4808,
  lng: -2.2426 + i * 0.0005,
}));

/** Due north, then a right turn and away due east. */
const rightTurn = [
  ...Array.from({ length: 20 }, (_, i) => ({ lat: 53.47 + i * 0.0004, lng: -2.24 })),
  ...Array.from({ length: 20 }, (_, i) => ({ lat: 53.4776, lng: -2.24 + i * 0.0006 })),
];

const near = (got: number | null, want: number, within = 12) => {
  expect(got).not.toBeNull();
  const off = Math.abs(((got as number) - want + 540) % 360) - 180;
  expect(Math.abs(off)).toBeLessThan(within);
};

describe("headingAlongRoute", () => {
  it("points along the road the car is on", () => {
    near(headingAlongRoute(eastward, 53.4808, -2.2376), 90);
  });

  it("still points along the road when the car is a little off the line", () => {
    // Half the width of a dual carriageway away from the drawn route
    near(headingAlongRoute(eastward, 53.48092, -2.2376), 90);
  });

  it("is still facing north on the approach to a right turn", () => {
    near(headingAlongRoute(rightTurn, 53.4735, -2.24), 0);
  });

  it("faces east once round the turn", () => {
    near(headingAlongRoute(rightTurn, 53.4776, -2.2352), 90);
  });

  it("gives nothing when the car is nowhere near the route", () => {
    expect(headingAlongRoute(eastward, 53.6, -2.5)).toBeNull();
  });

  it("gives nothing without a route to go on", () => {
    expect(headingAlongRoute(null, 53.4808, -2.2426)).toBeNull();
    expect(headingAlongRoute([], 53.4808, -2.2426)).toBeNull();
    expect(headingAlongRoute([{ lat: 53.4808, lng: -2.2426 }], 53.4808, -2.2426)).toBeNull();
  });

  it("gives nothing at the end of the route, where there is no road left", () => {
    const last = eastward[eastward.length - 1];
    expect(headingAlongRoute(eastward, last.lat, last.lng)).toBeNull();
  });

  it("survives a route that repeats the same point", () => {
    const stuttering = [
      { lat: 53.4808, lng: -2.2426 },
      { lat: 53.4808, lng: -2.2426 },
      { lat: 53.4808, lng: -2.2376 },
    ];
    near(headingAlongRoute(stuttering, 53.4808, -2.2421), 90);
  });

  it("reads the road, where two reports a minute apart read the corner", () => {
    // The car was at the bottom of the straight a minute ago and is now just
    // round the turn. The hop between those two points cuts the corner.
    const was = { lat: 53.4735, lng: -2.24 };
    const now = { lat: 53.4776, lng: -2.2364 };
    const asTheCrowFlies = bearing(was.lat, was.lng, now.lat, now.lng);
    expect(Math.abs(asTheCrowFlies - 90)).toBeGreaterThan(20);
    near(headingAlongRoute(rightTurn, now.lat, now.lng), 90);
  });
});
