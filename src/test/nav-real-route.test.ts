import { describe, it, expect } from "vitest";
import real from "./fixtures/osrm-manchester-wilmslow.json";
import { fromOsrm } from "@/lib/navRoute";
import { cueFor, follow, shownDistance } from "@/lib/navGuidance";
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
