/**
 * Leaving for another app.
 *
 * The app's own scheme carries the destination but fails silently when the
 * app is not installed, so a web link follows it. The whole value is in when
 * that follow-up does and does not happen, which is what these pin down.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handOffTo, type HandOff } from "@/lib/handOff";

const APP = "waze://?ll=53.32036,-2.23&navigate=yes";
const WEB = "https://waze.com/ul?ll=53.32036%2C-2.23&navigate=yes";

let went: string[];
let here: boolean;
const how = (): HandOff => ({
  go: (url) => went.push(url),
  stillHere: () => here,
});

beforeEach(() => {
  vi.useFakeTimers();
  went = [];
  here = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handing the drive to another app", () => {
  it("tries the app first, before anything else", () => {
    handOffTo(APP, WEB, how());
    expect(went).toEqual([APP]);
  });

  it("falls back to the web link when nothing opened", () => {
    handOffTo(APP, WEB, how());
    vi.advanceTimersByTime(5000);
    expect(went).toEqual([APP, WEB]);
  });

  it("leaves the phone alone once the app has it", () => {
    handOffTo(APP, WEB, how());
    // What backgrounding this app looks like from in here
    here = false;
    vi.advanceTimersByTime(5000);
    expect(went).toEqual([APP]);
  });

  it("does not follow up at all when there is no web link", () => {
    handOffTo(APP, null, how());
    vi.advanceTimersByTime(5000);
    expect(went).toEqual([APP]);
  });

  it("can be called off by a screen that goes away", () => {
    const callOff = handOffTo(APP, WEB, how());
    callOff();
    vi.advanceTimersByTime(5000);
    expect(went).toEqual([APP]);
  });
});
