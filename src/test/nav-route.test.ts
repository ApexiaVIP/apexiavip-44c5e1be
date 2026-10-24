import { describe, it, expect } from "vitest";
import {
  decodePolyline,
  fromGoogle,
  fromOsrm,
  ordinal,
  phrase,
  stitch,
  type LatLng,
} from "@/lib/navRoute";

/**
 * An encoder, written here only so a route can be built for the tests. The
 * decoder is checked against Google's own published example below, so a fault
 * shared by both would still be caught.
 */
const chunk = (value: number): string => {
  let n = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
};

const encode = (points: LatLng[]): string => {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const p of points) {
    const la = Math.round(p.lat * 1e5);
    const ln = Math.round(p.lng * 1e5);
    out += chunk(la - lat) + chunk(ln - lng);
    lat = la;
    lng = ln;
  }
  return out;
};

describe("reading an encoded route", () => {
  it("decodes the example Google publishes", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it("survives a Manchester route going back out again", () => {
    const route = [
      { lat: 53.4808, lng: -2.2426 },
      { lat: 53.4815, lng: -2.2401 },
      { lat: 53.4799, lng: -2.2388 },
    ];
    decodePolyline(encode(route)).forEach((p, i) => {
      expect(p.lat).toBeCloseTo(route[i].lat, 5);
      expect(p.lng).toBeCloseTo(route[i].lng, 5);
    });
  });
});

describe("joining the steps into one line", () => {
  const a = { lat: 53.48, lng: -2.24 };
  const b = { lat: 53.481, lng: -2.241 };
  const c = { lat: 53.482, lng: -2.242 };

  it("drops the point each step repeats from the one before", () => {
    const { line } = stitch([
      [a, b],
      [b, c],
    ]);
    expect(line).toEqual([a, b, c]);
  });

  it("points each step at where it starts in the line", () => {
    const { starts } = stitch([
      [a, b],
      [b, c],
    ]);
    // The second step begins at the shared point, not after it
    expect(starts).toEqual([0, 1]);
  });

  it("keeps a step that does not join cleanly, rather than losing it", () => {
    const { line, starts } = stitch([[a, b], [c]]);
    expect(line).toEqual([a, b, c]);
    expect(starts).toEqual([0, 2]);
  });

  it("gives a step with no shape somewhere to sit", () => {
    const { starts } = stitch([[a, b], []]);
    expect(starts[1]).toBe(1);
  });
});

describe("the words a British driver hears", () => {
  it("says bear, not slight", () => {
    expect(phrase("slight-left", "Deansgate")).toBe("Bear left onto Deansgate");
  });

  it("says slip road, not ramp", () => {
    expect(phrase("slip-left", "M60")).toBe("Take the slip road on the left onto M60");
  });

  it("counts roundabout exits out loud", () => {
    expect(phrase("roundabout", "A34", 3)).toBe("At the roundabout, take the third exit onto A34");
    expect(ordinal(1)).toBe("the first exit");
    expect(ordinal(11)).toBe("exit 11");
  });

  /** Seen on the screen: "Carry straight on on New York Street". */
  it("does not say on twice when carrying straight on", () => {
    expect(phrase("straight", "New York Street")).toBe("Continue on New York Street");
    expect(phrase("straight", "")).toBe("Carry straight on");
  });

  it("manages without a road name", () => {
    expect(phrase("left", "")).toBe("Turn left");
    expect(phrase("depart", "")).toBe("Set off");
  });
});

describe("a route from Google", () => {
  const leg = {
    steps: [
      {
        navigationInstruction: { maneuver: "DEPART", instructions: "Head north on Deansgate" },
        distanceMeters: 400,
        staticDuration: "100s",
        polyline: { encodedPolyline: encode([{ lat: 53.48, lng: -2.25 }, { lat: 53.4836, lng: -2.25 }]) },
      },
      {
        navigationInstruction: { maneuver: "TURN_LEFT", instructions: "Turn left onto Quay Street" },
        distanceMeters: 300,
        staticDuration: "100s",
        polyline: { encodedPolyline: encode([{ lat: 53.4836, lng: -2.25 }, { lat: 53.4836, lng: -2.2455 }]) },
      },
    ],
  };
  const body = { routes: [{ duration: "300s", distanceMeters: 700, legs: [leg] }] };

  it("keeps Google's own wording, which reads properly", () => {
    const route = fromGoogle(body)!;
    expect(route.steps[1].instruction).toBe("Turn left onto Quay Street");
    expect(route.steps[1].turn).toBe("left");
  });

  it("pulls the road name out for the line underneath", () => {
    expect(fromGoogle(body)!.steps[1].road).toBe("Quay Street");
  });

  it("stretches the step times to fit a journey held up by traffic", () => {
    // Two hundred seconds of clear road, three hundred in the traffic there is
    const route = fromGoogle(body)!;
    expect(route.seconds).toBe(300);
    expect(route.steps[0].seconds).toBeCloseTo(150, 0);
    expect(route.steps[1].seconds).toBeCloseTo(150, 0);
  });

  it("says the time allows for traffic, because it does", () => {
    expect(fromGoogle(body)!.withTraffic).toBe(true);
  });

  it("ends with an arrival to count down to", () => {
    const steps = fromGoogle(body)!.steps;
    expect(steps[steps.length - 1].turn).toBe("arrive");
  });

  it("gives back nothing when there is no route, rather than an empty one", () => {
    expect(fromGoogle({ routes: [] })).toBeNull();
    expect(fromGoogle({})).toBeNull();
    expect(fromGoogle({ routes: [{ legs: [{ steps: [] }] }] })).toBeNull();
  });
});

describe("a route from the open router", () => {
  const body = {
    routes: [
      {
        distance: 700,
        duration: 240,
        legs: [
          {
            steps: [
              {
                maneuver: { type: "depart", modifier: "straight" },
                name: "Deansgate",
                distance: 400,
                duration: 120,
                geometry: {
                  coordinates: [
                    [-2.25, 53.48],
                    [-2.25, 53.4836],
                  ] as [number, number][],
                },
              },
              {
                maneuver: { type: "roundabout", modifier: "right", exit: 2 },
                name: "Quay Street",
                distance: 300,
                duration: 120,
                geometry: {
                  coordinates: [
                    [-2.25, 53.4836],
                    [-2.2455, 53.4836],
                  ] as [number, number][],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it("writes the instruction itself, since the router gives none", () => {
    const route = fromOsrm(body)!;
    expect(route.steps[1].instruction).toBe(
      "At the roundabout, take the second exit onto Quay Street"
    );
  });

  it("reads coordinates the way the router orders them, longitude first", () => {
    const route = fromOsrm(body)!;
    expect(route.line[0].lat).toBeCloseTo(53.48, 4);
    expect(route.line[0].lng).toBeCloseTo(-2.25, 4);
  });

  it("admits it knows nothing about the traffic", () => {
    expect(fromOsrm(body)!.withTraffic).toBe(false);
  });

  it("is believed when it is a router that does know", () => {
    expect(fromOsrm(body, true)!.withTraffic).toBe(true);
  });
});
