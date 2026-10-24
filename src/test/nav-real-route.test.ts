import { describe, it, expect } from "vitest";
import real from "./fixtures/osrm-manchester-wilmslow.json";
import { fromOsrm } from "@/lib/navRoute";
import { cueFor, follow, offRoute, shownDistance } from "@/lib/navGuidance";
import { metresBetween } from "@/lib/trackMarker";

/**
 * A real route, recorded off the router: Brown Street in town out to
 * Wilmslow, fourteen miles and thirty two turns. Hand built routes agree with
 * whatever the test author believed; this one does not.
 */
describe("a real Manchester route", () => {
  const route = fromOsrm(real)!;

  it("reads every turn of it", () => {
    expect(route).not.toBeNull();
    // Thirty two from the router, plus the arrival it ends on
    expect(route.steps.length).toBeGreaterThan(30);
    expect(route.steps[route.steps.length - 1].turn).toBe("arrive");
  });

  it("measures the same fourteen miles the router did", () => {
    expect(route.metres).toBeCloseTo(22316, -2);
    expect(shownDistance(route.metres)).toBe("14 miles");
  });

  it("joins the turns into one unbroken line", () => {
    expect(route.line.length).toBeGreaterThan(300);
    // No step left pointing past the end of the line it was stitched into
    route.steps.forEach((step) => {
      expect(step.fromIndex).toBeLessThan(route.line.length);
    });
    // Consecutive points of a driven line are metres apart, never miles
    let biggest = 0;
    for (let i = 1; i < route.line.length; i++) {
      biggest = Math.max(
        biggest,
        metresBetween(
          route.line[i - 1].lat,
          route.line[i - 1].lng,
          route.line[i].lat,
          route.line[i].lng
        )
      );
    }
    expect(biggest).toBeLessThan(1500);
  });

  it("writes every instruction in words a driver could follow", () => {
    route.steps.forEach((step) => {
      expect(step.instruction.length).toBeGreaterThan(4);
      expect(step.instruction).not.toContain("undefined");
    });
    const instructions = route.steps.map((s) => s.instruction).join(" | ");
    expect(instructions).toContain("Set off");
    expect(instructions).toMatch(/Turn (left|right)/);
  });

  /**
   * Driving the whole thing, point by point, which is the test that catches a
   * countdown that jumps about or a step that never advances.
   */
  it("counts down the whole way without ever going backwards", () => {
    let lineIndex = -1;
    let previousLeft = Infinity;
    let previousStep = -1;
    let arrivedAt = -1;

    route.line.forEach((point, i) => {
      const g = follow(route, point, lineIndex);
      lineIndex = g.lineIndex;

      // Distance left only ever shrinks
      expect(g.metresLeft).toBeLessThanOrEqual(previousLeft + 1);
      previousLeft = g.metresLeft;

      // The step being driven only ever moves forward
      expect(g.stepIndex).toBeGreaterThanOrEqual(previousStep);
      previousStep = g.stepIndex;

      // The car is on the route, because every point of it is the route
      expect(g.offBy).toBeLessThan(1);
      // There is always a manoeuvre ahead to count down to
      expect(g.toTurn).toBeGreaterThanOrEqual(0);
      if (g.arrived && arrivedAt < 0) arrivedAt = i;
    });

    expect(previousLeft).toBeLessThan(1);
    // It only says arrived near the end, not somewhere in Cheadle
    expect(arrivedAt).toBeGreaterThan(route.line.length - 20);
  });

  it("announces each turn once on the way through, and not twice", () => {
    let lineIndex = -1;
    const said = new Set<string>();
    let total = 0;

    route.line.forEach((point) => {
      const g = follow(route, point, lineIndex);
      lineIndex = g.lineIndex;
      const cue = cueFor(g.toTurn, g.step.metres);
      if (!cue) return;
      total += 1;
      said.add(`${g.stepIndex}:${cue}`);
    });

    // Every turn gets said, and the repeats are all weeded out
    expect(said.size).toBeGreaterThan(20);
    expect(said.size).toBeLessThan(total);
  });
});

/**
 * The same real route, driven under the conditions a chauffeur actually
 * meets. A phone does not report a clean line down the middle of the road:
 * it wanders by twenty metres between tall buildings, and it goes quiet
 * altogether through a tunnel and comes back a mile later.
 */
describe("driving it with a real phone rather than a perfect one", () => {
  const route = fromOsrm(real)!;

  /** Repeatable wander, so a failure can be looked at twice. */
  const wobble = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };

  it("holds its nerve while the phone wanders about between buildings", () => {
    let lineIndex = -1;
    let along = 0;
    let previousStep = -1;
    let previousLeft = Infinity;
    let strayed = 0;

    route.line.forEach((point, i) => {
      // Up to about twenty five metres out, which is ordinary for a phone in
      // a city and well inside what we would call off route
      const drifted = {
        lat: point.lat + wobble(i) * 0.0002,
        lng: point.lng + wobble(i + 1000) * 0.0003,
      };
      const g = follow(route, drifted, lineIndex, along);
      lineIndex = g.lineIndex;
      along = g.along;

      expect(g.stepIndex).toBeGreaterThanOrEqual(previousStep);
      previousStep = g.stepIndex;

      // Held to the furthest point reached, so the distance left only shrinks
      expect(g.metresLeft).toBeLessThanOrEqual(previousLeft + 0.5);
      previousLeft = g.metresLeft;

      if (offRoute(g)) strayed += 1;
    });

    // A phone wandering inside the lane is not a chauffeur leaving the route,
    // and must not set off rerouting all the way to Wilmslow
    expect(strayed).toBe(0);
    expect(previousLeft).toBeLessThan(50);
  });

  it("picks the journey back up after the signal goes and comes back a mile later", () => {
    let lineIndex = -1;
    let along = 0;
    const tunnelFrom = Math.floor(route.line.length * 0.4);
    const tunnelTo = Math.floor(route.line.length * 0.55);
    let previousStep = -1;
    let afterTunnel: ReturnType<typeof follow> | null = null;

    route.line.forEach((point, i) => {
      if (i > tunnelFrom && i < tunnelTo) return; // no fixes at all
      const g = follow(route, point, lineIndex, along);
      lineIndex = g.lineIndex;
      along = g.along;
      expect(g.stepIndex).toBeGreaterThanOrEqual(previousStep);
      previousStep = g.stepIndex;
      if (i === tunnelTo) afterTunnel = g;
    });

    // The first fix out of the tunnel must land where the car actually is,
    // not back at the mouth of it
    expect(afterTunnel).not.toBeNull();
    expect(afterTunnel!.offBy).toBeLessThan(5);
    expect(afterTunnel!.lineIndex).toBeGreaterThanOrEqual(tunnelTo - 1);
  });

  /**
   * Sat at lights, the car does not move but the phone keeps reporting, and
   * what it reports drifts. Every one of those that looked like straying
   * would buy another traffic-aware route from Google, so a minute at a red
   * light must cost nothing and must not make the screen twitch.
   */
  it("sits still at a red light without straying or twitching", () => {
    const stopped = route.line[Math.floor(route.line.length * 0.3)];
    let lineIndex = -1;
    let along = 0;
    let strayed = 0;
    const readings: number[] = [];

    for (let tick = 0; tick < 40; tick++) {
      const drifted = {
        lat: stopped.lat + wobble(tick) * 0.00012,
        lng: stopped.lng + wobble(tick + 500) * 0.0002,
      };
      const g = follow(route, drifted, lineIndex, along);
      lineIndex = g.lineIndex;
      along = g.along;
      readings.push(g.metresLeft);
      if (offRoute(g)) strayed += 1;
    }

    expect(strayed).toBe(0);
    // The distance left must not wander about while the car is not moving
    expect(Math.max(...readings) - Math.min(...readings)).toBeLessThan(30);
  });

  it("manages a short hop, where the whole leg is shorter than one warning", () => {
    const start = route.line[0];
    const near = route.line[3];
    const short = fromOsrm({
      routes: [
        {
          distance: 120,
          duration: 40,
          legs: [
            {
              steps: [
                {
                  maneuver: { type: "depart", modifier: "straight" },
                  name: "Brown Street",
                  distance: 120,
                  duration: 40,
                  geometry: { coordinates: [[start.lng, start.lat], [near.lng, near.lat]] },
                },
              ],
            },
          ],
        },
      ],
    })!;
    const g = follow(short, start, -1);
    expect(g.next.turn).toBe("arrive");
    expect(g.arrived).toBe(false);
    // And it knows when it is there
    expect(follow(short, near, g.lineIndex, g.along).arrived).toBe(true);
  });

  it("knows the difference between a wander and actually leaving the route", () => {
    const point = route.line[Math.floor(route.line.length / 2)];
    const wandering = follow(route, { lat: point.lat + 0.0002, lng: point.lng }, -1);
    // Four hundred metres off is a chauffeur who has taken a different road
    const gone = follow(route, { lat: point.lat + 0.004, lng: point.lng }, -1);
    expect(offRoute(wandering)).toBe(false);
    expect(offRoute(gone)).toBe(true);
  });
});
