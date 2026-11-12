/**
 * The arrival time, worked out without our own navigation on screen.
 *
 * A passenger watching the car move with no arrival time above it is the
 * fault this exists for, so the thing worth pinning down is that an answer
 * comes back at all, straight away, and that it is to the right place.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeArrival } from "@/lib/arrival";

const HERE = { lat: 53.32, lng: -2.23 };
const PICKUP = { line1: "The Cottage, Donkey Lane", town: "Wilmslow", postcode: "SK9 1PX" };
const DROPOFF = { line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the arrival time", () => {
  it("has no answer until the router has given one", () => {
    const left = makeArrival(async () => 600);
    expect(left(HERE, PICKUP)).toBeNull();
  });

  it("answers once the router has been", async () => {
    const left = makeArrival(async () => 600);
    left(HERE, PICKUP);
    await settle();
    expect(left(HERE, PICKUP)).toBe(600);
  });

  it("counts down between answers, rather than sitting still", async () => {
    const left = makeArrival(async () => 600);
    left(HERE, PICKUP);
    await settle();
    vi.setSystemTime(Date.now() + 60_000);
    expect(left(HERE, PICKUP)).toBe(540);
  });

  it("never counts past the arrival into negative time", async () => {
    const left = makeArrival(async () => 60);
    left(HERE, PICKUP);
    await settle();
    vi.setSystemTime(Date.now() + 600_000);
    expect(left(HERE, PICKUP)).toBe(0);
  });

  it("asks once, not on every position that goes out", async () => {
    const ask = vi.fn(async () => 600);
    const left = makeArrival(ask);
    for (let i = 0; i < 10; i += 1) left(HERE, PICKUP);
    await settle();
    for (let i = 0; i < 10; i += 1) left(HERE, PICKUP);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again once the answer has gone off", async () => {
    const ask = vi.fn(async () => 600);
    const left = makeArrival(ask);
    left(HERE, PICKUP);
    await settle();
    vi.setSystemTime(Date.now() + 120_000);
    left(HERE, PICKUP);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("throws the estimate away when the car turns round at the collection", async () => {
    const left = makeArrival(async () => 600);
    left(HERE, PICKUP);
    await settle();
    // Passenger aboard: the old number is to a place already behind them
    expect(left(HERE, DROPOFF)).toBeNull();
  });

  it("gives the new destination its own answer", async () => {
    const ask = vi.fn(async (_from: unknown, place: { line1?: string } | null) =>
      place?.line1 === "The Lowry Hotel" ? 1800 : 600
    );
    const left = makeArrival(ask);
    left(HERE, PICKUP);
    await settle();
    left(HERE, DROPOFF);
    await settle();
    expect(left(HERE, DROPOFF)).toBe(1800);
  });

  it("says nothing where there is nowhere to drive to", () => {
    const ask = vi.fn(async () => 600);
    expect(makeArrival(ask)(HERE, null)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps the last answer when the router cannot be reached", async () => {
    let answer: number | null = 600;
    const left = makeArrival(async () => answer);
    left(HERE, PICKUP);
    await settle();
    answer = null;
    vi.setSystemTime(Date.now() + 120_000);
    // Still counting down from what we had, rather than going blank
    expect(left(HERE, PICKUP)).toBe(480);
    await settle();
    expect(left(HERE, PICKUP)).toBe(480);
  });
});
