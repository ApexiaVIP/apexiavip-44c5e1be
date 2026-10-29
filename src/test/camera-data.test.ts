import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { metresBetween } from "@/lib/trackMarker";
import { phrase, type LatLng, type NavRoute } from "@/lib/navRoute";
import { inBox, unpack } from "@/lib/cameraSource";
import { boxAround, cameraAhead, onRoute } from "@/lib/speedCameras";

/**
 * The file the app actually ships, read off disk.
 *
 * The rest of the camera tests prove the sums with cameras invented for the
 * purpose. This one proves the data: that the file is there, that it is in
 * the shape the app expects, and that a real road with real cameras on it
 * produces a real warning. If the pack script or the file format ever drifts,
 * this is what notices.
 */
const file = JSON.parse(readFileSync("public/speed-cameras.json", "utf8"));
const cameras = unpack(file);

/** A line of points between two coordinates, a few metres apart. */
const between = (a: LatLng, b: LatLng, steps = 60): LatLng[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    lat: a.lat + ((b.lat - a.lat) * i) / steps,
    lng: a.lng + ((b.lng - a.lng) * i) / steps,
  }));

const routeAlong = (line: LatLng[]): NavRoute => {
  let metres = 0;
  for (let i = 1; i < line.length; i++) {
    metres += metresBetween(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng);
  }
  return {
    line,
    steps: [
      { instruction: phrase("depart", "A34"), turn: "depart", road: "A34", metres, seconds: 120, fromIndex: 0 },
      { instruction: phrase("arrive", ""), turn: "arrive", road: "", metres: 0, seconds: 0, fromIndex: line.length - 1 },
    ],
    metres,
    seconds: 120,
    withTraffic: true,
    at: Date.now(),
  };
};

describe("the camera file the app ships", () => {
  it("is there and holds the cameras of Great Britain", () => {
    expect(cameras.length).toBeGreaterThan(3000);
  });

  it("credits the data it came from, as the licence asks", () => {
    expect(String(file.source)).toMatch(/OpenStreetMap/i);
  });

  it("puts every camera inside these islands", () => {
    const outside = cameras.filter(
      (c) => c.lat < 49.5 || c.lat > 61.2 || c.lng < -9 || c.lng > 2.1
    );
    expect(outside).toHaveLength(0);
  });

  it("knows the limit on a good half of them", () => {
    const known = cameras.filter((c) => c.limitMph !== null);
    expect(known.length / cameras.length).toBeGreaterThan(0.4);
  });

  it("holds the average speed stretches as well as the fixed ones", () => {
    expect(cameras.some((c) => c.kind === "average")).toBe(true);
  });

  it("covers the roads around the office", () => {
    // Hale Barns, Wilmslow and the airport approaches
    const near = cameras.filter((c) =>
      inBox(c, { south: 53.33, west: -2.3, north: 53.4, east: -2.2 })
    );
    expect(near.length).toBeGreaterThanOrEqual(4);
  });
});

describe("a real camera on a real road", () => {
  /**
   * The 50 camera on the A34 south of the airport, which is on the way to
   * half the jobs this firm runs. Driven from a kilometre short of it.
   */
  const camera = { lat: 53.37287, lng: -2.21104 };
  const route = () =>
    routeAlong(between({ lat: 53.3639, lng: -2.2096 }, { lat: 53.3819, lng: -2.2124 }));

  it("is found on the route", () => {
    const found = onRoute(route(), cameras);
    const ours = found.find(
      (c) => Math.abs(c.camera.lat - camera.lat) < 1e-4 && Math.abs(c.camera.lng - camera.lng) < 1e-4
    );
    expect(ours).toBeTruthy();
    expect(ours!.offBy).toBeLessThan(30);
  });

  it("is warned about three hundred metres out, with its limit", () => {
    const found = onRoute(route(), cameras);
    const ours = found.find((c) => Math.abs(c.camera.lat - camera.lat) < 1e-4)!;
    const warned = cameraAhead(found, ours.along - 250);
    expect(warned?.camera.limitMph).toBe(50);
    expect(warned?.toCamera).toBeCloseTo(250, 0);
  });

  it("is not warned about from a mile back", () => {
    const found = onRoute(route(), cameras);
    const ours = found.find((c) => Math.abs(c.camera.lat - camera.lat) < 1e-4)!;
    expect(cameraAhead(found, Math.max(0, ours.along - 1600))).toBeNull();
  });

  it("asks for a box that the camera falls inside", () => {
    const box = boxAround(route().line)!;
    expect(inBox({ ...camera, id: "x", kind: "fixed", limitMph: 50, direction: null }, box)).toBe(true);
  });
});
