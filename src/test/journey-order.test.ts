import { describe, it, expect } from "vitest";
import { appendStop, lastSetDown } from "@/lib/journey";

const pick = (address = "") => ({ type: "pickup" as const, address });
const drop = (address = "") => ({ type: "dropoff" as const, address });

describe("adding a stop to a journey", () => {
  it("puts the new stop after everything else", () => {
    const run = appendStop([pick("Hale"), drop("Etihad")], pick());
    expect(run.map((s) => s.type)).toEqual(["pickup", "dropoff", "pickup"]);
  });

  /**
   * The one the desk asked for. A second leg is collect then set down, and
   * both halves have to land after the first leg, not inside it.
   */
  it("builds a second leg after the first, in order", () => {
    let run = [pick("Hale"), drop("Etihad")];
    run = appendStop(run, pick("Etihad"));
    run = appendStop(run, drop("Hale"));
    expect(run.map((s) => s.address)).toEqual(["Hale", "Etihad", "Etihad", "Hale"]);
  });

  it("leaves the stops already in the run alone", () => {
    const before = [pick("Hale"), drop("Etihad")];
    appendStop(before, drop());
    expect(before).toHaveLength(2);
  });

  it("starts a run off for an hourly car with nowhere to finish", () => {
    expect(appendStop([], pick("Hale"))).toEqual([pick("Hale")]);
  });
});

describe("where the car finishes", () => {
  it("is the set down on a plain there-and-back leg", () => {
    expect(lastSetDown([pick("Hale"), drop("Etihad")])).toBe(1);
  });

  it("is the final set down on a two-leg job", () => {
    expect(lastSetDown([pick("Hale"), drop("Etihad"), pick("Etihad"), drop("Hale")])).toBe(3);
  });

  /**
   * Mid-build the run ends on a collection. Treating that as the destination
   * would write the venue address into a collection field and send the car to
   * the wrong place, so it has to be the set down before it.
   */
  it("is not a collection the desk has just added on the end", () => {
    expect(lastSetDown([pick("Hale"), drop("Etihad"), pick("")])).toBe(1);
  });

  it("is nowhere on a car kept at disposal", () => {
    expect(lastSetDown([pick("Hale")])).toBe(-1);
  });

  it("is nowhere on an empty run", () => {
    expect(lastSetDown([])).toBe(-1);
  });
});
