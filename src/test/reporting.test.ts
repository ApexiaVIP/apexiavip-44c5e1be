/**
 * Reporting where the car is, while the chauffeur is in another app.
 *
 * This is the fault the whole hand off to Waze stands or falls on. The
 * operating system keeps delivering fixes to a backgrounded app, but it
 * suspends that app's timers, so anything waiting for a beat never runs. A
 * passenger watched a parked car on Manchester Road while the car itself was
 * two miles further on.
 *
 * Backgrounding is reproduced here by delivering fixes while the clock is
 * advanced but the timers never fire, which is exactly what the phone does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Fix } from "@/lib/positionSource";

let deliver: (fix: Fix) => void = () => {};
const stopped = vi.fn();

vi.mock("@/lib/positionSource", () => ({
  watchFixes: (onFix: (fix: Fix) => void) => {
    deliver = onFix;
    return stopped;
  },
}));

const { followPosition } = await import("@/lib/whereAmI");

const fix = (lat: number, lng: number): Fix => ({ lat, lng, heading: null, speed: null });

let sent: Array<[number, number]>;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  stopped.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const follow = (everyMs = 6000) =>
  followPosition((lat, lng) => sent.push([lat, lng]), everyMs);

describe("reporting the car's position", () => {
  it("reports the first fix at once, rather than a beat later", () => {
    follow();
    deliver(fix(53.32, -2.23));
    expect(sent).toEqual([[53.32, -2.23]]);
  });

  it("keeps reporting from the fixes alone when the timers are suspended", () => {
    // What iOS does to a backgrounded app: fixes still arrive, nothing ticks
    follow();
    deliver(fix(53.32, -2.23));
    vi.setSystemTime(Date.now() + 7000);
    deliver(fix(53.33, -2.24));
    vi.setSystemTime(Date.now() + 7000);
    deliver(fix(53.34, -2.25));
    expect(sent).toEqual([
      [53.32, -2.23],
      [53.33, -2.24],
      [53.34, -2.25],
    ]);
  });

  it("does not report faster than the beat, however many fixes arrive", () => {
    follow();
    for (let i = 0; i < 20; i += 1) deliver(fix(53.32, -2.23));
    expect(sent).toHaveLength(1);
  });

  it("still reports a car sat at lights, where no new fix arrives", () => {
    follow();
    deliver(fix(53.32, -2.23));
    vi.advanceTimersByTime(6000);
    expect(sent).toEqual([
      [53.32, -2.23],
      [53.32, -2.23],
    ]);
  });

  it("reports nothing before the first fix", () => {
    follow();
    vi.advanceTimersByTime(30000);
    expect(sent).toEqual([]);
  });

  it("stops the watcher when the job ends", () => {
    const stop = follow();
    stop();
    expect(stopped).toHaveBeenCalled();
  });

  it("stops the beat too, not only the watcher", () => {
    const stop = follow();
    deliver(fix(53.32, -2.23));
    stop();
    vi.setSystemTime(Date.now() + 7000);
    vi.advanceTimersByTime(30000);
    expect(sent).toHaveLength(1);
  });
});
