import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deviceTheme,
  openMapStyle,
  otherTheme,
  preferredMapTheme,
  rememberMapTheme,
  routeColours,
} from "@/lib/mapTheme";

const phoneSetTo = (scheme: "light" | "dark") =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("light") ? scheme === "light" : scheme === "dark",
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

beforeEach(() => {
  localStorage.clear();
  phoneSetTo("dark");
});

describe("which map a chauffeur gets", () => {
  it("follows the phone before they have chosen anything", () => {
    phoneSetTo("light");
    expect(preferredMapTheme()).toBe("light");
    phoneSetTo("dark");
    expect(preferredMapTheme()).toBe("dark");
  });

  /**
   * A chauffeur who flipped it at midday should not find it flipped back on
   * the next job just because their phone is still set to dark.
   */
  it("keeps their own choice over the phone's", () => {
    phoneSetTo("dark");
    rememberMapTheme("light");
    expect(preferredMapTheme()).toBe("light");
  });

  it("flips to the other one", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });

  it("falls back to dark when the phone will not say", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(deviceTheme()).toBe("dark");
  });

  it("ignores rubbish left in storage", () => {
    localStorage.setItem("apx.drive.map", "purple");
    phoneSetTo("light");
    expect(preferredMapTheme()).toBe("light");
  });
});

describe("drawing the route so it can still be seen", () => {
  it("uses a different map for each", () => {
    expect(openMapStyle("light")).toContain("positron");
    expect(openMapStyle("dark")).toContain("dark");
  });

  /**
   * Champagne on a pale map is close to invisible, which is the whole reason
   * a light map needs its own line colour rather than the brand one.
   */
  it("darkens the route line on a light map, and pales the casing", () => {
    const light = routeColours("light");
    const dark = routeColours("dark");
    expect(light.line).not.toBe(dark.line);
    expect(light.casing).toBe("#ffffff");
    expect(dark.casing).toBe("#0b0a08");
    expect(dark.line).toBe("#cdbb95");
  });
});
