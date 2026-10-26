import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TrackMap from "@/components/TrackMap";

const maps = { configured: false };
vi.mock("@/lib/googleMaps", () => ({
  googleMapsConfigured: () => maps.configured,
  loadGoogleMaps: () => Promise.reject(new Error("no key")),
  mapId: () => "",
}));

/**
 * The two maps underneath, stubbed. Which one a member is given is the whole
 * of what this file is about, so the engines themselves are not loaded.
 */
vi.mock("@/components/TrackMapGoogle", () => ({
  default: ({ onUnavailable }: { onUnavailable: () => void }) => {
    googleAsked.calls += 1;
    if (googleAsked.failing) onUnavailable();
    return <div data-testid="google-map" />;
  },
}));
vi.mock("@/components/TrackMapVector", () => ({
  default: () => <div data-testid="open-map" />,
}));
vi.mock("@/components/TrackMapRaster", () => ({
  default: () => <div data-testid="raster-map" />,
}));

const googleAsked = { calls: 0, failing: false };

beforeEach(() => {
  maps.configured = false;
  googleAsked.calls = 0;
  googleAsked.failing = false;
  // Every test phone can draw vectors unless it says otherwise
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
});

/**
 * Which map a member is shown.
 *
 * A member watching their car and a chauffeur driving it were being drawn on
 * two different maps, which reads as two different companies. They share one
 * now wherever the settings for it exist, and the open map is still there for
 * the build that has no key and for the phone that cannot draw either.
 */
describe("the map a member watches their car on", () => {
  it("uses Google's, which is the map the chauffeur is driving by", async () => {
    maps.configured = true;
    render(<TrackMap lat={53.48} lng={-2.24} />);
    expect(await screen.findByTestId("google-map")).toBeInTheDocument();
  });

  it("uses the open map when this build has no Google settings", async () => {
    render(<TrackMap lat={53.48} lng={-2.24} />);
    expect(await screen.findByTestId("open-map")).toBeInTheDocument();
    expect(googleAsked.calls).toBe(0);
  });

  it("falls back to the open map when Google will not load", async () => {
    maps.configured = true;
    googleAsked.failing = true;
    render(<TrackMap lat={53.48} lng={-2.24} />);
    expect(await screen.findByTestId("open-map")).toBeInTheDocument();
  });

  /**
   * Once Google has given up it must stay given up. Swapping back and forth
   * would tear the map down and build it again every few seconds, in front
   * of a member who is trying to watch a car.
   */
  it("does not keep trying Google after it has failed", async () => {
    maps.configured = true;
    googleAsked.failing = true;
    render(<TrackMap lat={53.48} lng={-2.24} />);
    await screen.findByTestId("open-map");
    const tried = googleAsked.calls;
    await new Promise((settle) => setTimeout(settle, 50));
    expect(googleAsked.calls).toBe(tried);
  });

  it("gives a phone that cannot draw vectors the raster tiles", async () => {
    maps.configured = true;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
    render(<TrackMap lat={53.48} lng={-2.24} />);
    await waitFor(() => expect(screen.getByTestId("raster-map")).toBeInTheDocument());
    expect(googleAsked.calls).toBe(0);
  });
});
