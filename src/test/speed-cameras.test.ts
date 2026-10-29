import { describe, it, expect } from "vitest";
import { metresBetween } from "@/lib/trackMarker";
import { phrase, type LatLng, type NavRoute, type Turn } from "@/lib/navRoute";
import {
  boxAround,
  cameraAhead,
  cameraWords,
  facingSameWay,
  onRoute,
  type SpeedCamera,
} from "@/lib/speedCameras";

/** A tenth of a thousandth of a degree of latitude is about 111 metres. */
const STEP_LAT = 0.001;

const north = (count: number, lng = -2.24, from = 53.48): LatLng[] =>
  Array.from({ length: count }, (_, i) => ({ lat: from + i * STEP_LAT, lng }));

const build = (line: LatLng[], marks: { fromIndex: number; turn: Turn; seconds: number }[]): NavRoute => {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + metresBetween(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng));
  }
  const steps = marks.map((m, i) => {
    const next = marks[i + 1];
    const ends = next ? cum[next.fromIndex] : cum[cum.length - 1];
    return {
      instruction: phrase(m.turn, ""),
      turn: m.turn,
      road: "",
      metres: ends - cum[m.fromIndex],
      seconds: m.seconds,
      fromIndex: m.fromIndex,
    };
  });
  return {
    line,
    steps,
    metres: cum[cum.length - 1],
    seconds: 120,
    withTraffic: true,
    at: Date.now(),
  };
};

/** Ten points running due north, so the road's course is zero degrees. */
const route = () =>
  build(north(10), [
    { fromIndex: 0, turn: "depart", seconds: 60 },
    { fromIndex: 9, turn: "arrive", seconds: 0 },
  ]);

const camera = (over: Partial<SpeedCamera> = {}): SpeedCamera => ({
  id: "1",
  lat: 53.483,
  lng: -2.24,
  kind: "fixed",
  limitMph: 30,
  direction: null,
  ...over,
});

/** A degree of longitude at our latitude, in metres, near enough. */
const M_PER_DEG_LNG = 111_320 * Math.cos(53.48 * (Math.PI / 180));

describe("the box the cameras are asked for", () => {
  it("covers the whole route with road to spare", () => {
    const box = boxAround(north(10))!;
    expect(box.south).toBeLessThan(53.48);
    expect(box.north).toBeGreaterThan(53.489);
    expect(box.west).toBeLessThan(-2.24);
    expect(box.east).toBeGreaterThan(-2.24);
  });

  it("widens the longitude to match, because degrees narrow going north", () => {
    const box = boxAround([{ lat: 53.48, lng: -2.24 }], 400)!;
    const latPad = (box.north - 53.48) * 111_320;
    const lngPad = (box.east + 2.24) * M_PER_DEG_LNG;
    expect(latPad).toBeCloseTo(400, 0);
    // The same distance on the ground, which is what matters, not the same
    // number of degrees
    expect(lngPad).toBeCloseTo(400, 0);
  });

  it("has nothing to ask about an empty route", () => {
    expect(boxAround([])).toBeNull();
  });
});

describe("which way a camera looks", () => {
  it("counts a camera pointing up the road we are driving", () => {
    expect(facingSameWay(0, 10)).toBe(true);
  });

  it("does not count the one watching the other carriageway", () => {
    expect(facingSameWay(0, 180)).toBe(false);
  });

  it("copes with the wrap at north", () => {
    expect(facingSameWay(350, 10)).toBe(true);
  });
});

describe("the cameras on the route", () => {
  it("keeps one standing on the road", () => {
    const found = onRoute(route(), [camera()]);
    expect(found).toHaveLength(1);
    expect(found[0].along).toBeCloseTo(333, -1);
  });

  it("drops one on the next street over", () => {
    // Sixty metres east of the line, which is a parallel road, not this one
    const off = camera({ lng: -2.24 + 60 / M_PER_DEG_LNG });
    expect(onRoute(route(), [off])).toHaveLength(0);
  });

  it("keeps one a carriageway's width away", () => {
    const across = camera({ lng: -2.24 + 15 / M_PER_DEG_LNG });
    expect(onRoute(route(), [across])).toHaveLength(1);
  });

  it("drops the camera watching the traffic coming the other way", () => {
    expect(onRoute(route(), [camera({ direction: 180 })])).toHaveLength(0);
  });

  it("keeps the camera facing the way we are going", () => {
    expect(onRoute(route(), [camera({ direction: 2 })])).toHaveLength(1);
  });

  it("keeps a camera that never said which way it looks", () => {
    expect(onRoute(route(), [camera({ direction: null })])).toHaveLength(1);
  });

  it("hands them back in the order they are driven past", () => {
    const found = onRoute(route(), [
      camera({ id: "far", lat: 53.487 }),
      camera({ id: "near", lat: 53.481 }),
      camera({ id: "middle", lat: 53.484 }),
    ]);
    expect(found.map((c) => c.camera.id)).toEqual(["near", "middle", "far"]);
  });

  it("has nothing to say about a route with no line", () => {
    const empty = { ...route(), line: [] };
    expect(onRoute(empty, [camera()])).toHaveLength(0);
  });
});

describe("warning about the next one", () => {
  const cameras = () =>
    onRoute(route(), [
      camera({ id: "first", lat: 53.482 }),
      camera({ id: "second", lat: 53.486 }),
    ]);

  it("says nothing while the camera is still a long way off", () => {
    // The far camera alone, two thirds of a mile up the road
    const far = onRoute(route(), [camera({ id: "second", lat: 53.486 })]);
    expect(far[0].along).toBeGreaterThan(600);
    expect(cameraAhead(far, 0)).toBeNull();
  });

  it("speaks up three hundred metres out", () => {
    const list = cameras();
    const warned = cameraAhead(list, list[0].along - 250);
    expect(warned?.camera.id).toBe("first");
    expect(warned?.toCamera).toBeCloseTo(250, 0);
  });

  it("stops talking about a camera once it is behind the car", () => {
    const list = cameras();
    const warned = cameraAhead(list, list[0].along + 5);
    // The second one is still a long way off, so nothing is said at all
    expect(warned).toBeNull();
  });

  it("moves on to the next camera when that one comes up", () => {
    const list = cameras();
    expect(cameraAhead(list, list[1].along - 100)?.camera.id).toBe("second");
  });

  it("has nothing to warn about on a road with no cameras", () => {
    expect(cameraAhead([], 100)).toBeNull();
  });
});

describe("how a camera is put into words", () => {
  it("names the limit it is watching", () => {
    expect(cameraWords(camera({ limitMph: 40 }))).toBe("Speed camera at 40");
  });

  it("says what an average speed stretch is", () => {
    expect(cameraWords(camera({ kind: "average", limitMph: 50 }))).toBe(
      "Average speed check at 50"
    );
  });

  it("leaves the limit out when nobody has recorded one", () => {
    expect(cameraWords(camera({ limitMph: null }))).toBe("Speed camera");
  });
});
