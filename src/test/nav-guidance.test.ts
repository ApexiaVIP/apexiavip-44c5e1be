import { describe, it, expect } from "vitest";
import { metresBetween } from "@/lib/trackMarker";
import { phrase, type LatLng, type NavRoute, type Turn } from "@/lib/navRoute";
import {
  announcement,
  arrivalAt,
  cueFor,
  follow,
  locate,
  minutesLeft,
  offRoute,
  shownDistance,
  spokenDistance,
  stepAt,
} from "@/lib/navGuidance";

/** A tenth of a thousandth of a degree of latitude is about 111 metres. */
const STEP_LAT = 0.001;

/** Points running due north, roughly 111 metres apart. */
const north = (count: number, lng = -2.24, from = 53.48): LatLng[] =>
  Array.from({ length: count }, (_, i) => ({ lat: from + i * STEP_LAT, lng }));

interface Mark {
  fromIndex: number;
  turn: Turn;
  road?: string;
  seconds: number;
}

/**
 * A route built to order, with its step distances measured off its own line
 * so that nothing in the test disagrees with anything else in it.
 */
const build = (line: LatLng[], marks: Mark[]): NavRoute => {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + metresBetween(line[i - 1].lat, line[i - 1].lng, line[i].lat, line[i].lng));
  }
  const steps = marks.map((m, i) => {
    const next = marks[i + 1];
    const ends = next ? cum[next.fromIndex] : cum[cum.length - 1];
    return {
      instruction: phrase(m.turn, m.road ?? ""),
      turn: m.turn,
      road: m.road ?? "",
      metres: ends - cum[m.fromIndex],
      seconds: m.seconds,
      fromIndex: m.fromIndex,
    };
  });
  return {
    line,
    steps,
    metres: cum[cum.length - 1],
    seconds: marks.reduce((sum, m) => sum + m.seconds, 0),
    withTraffic: true,
    at: Date.now(),
  };
};

/** Ten points north, a left turn halfway, and a door at the end. */
const simple = () =>
  build(north(10), [
    { fromIndex: 0, turn: "depart", road: "Deansgate", seconds: 60 },
    { fromIndex: 5, turn: "left", road: "Quay Street", seconds: 60 },
    { fromIndex: 9, turn: "arrive", seconds: 0 },
  ]);

describe("finding the car on its route", () => {
  it("puts the car on the segment it is driving", () => {
    const route = simple();
    const found = locate(route, { lat: 53.4825, lng: -2.24 }, -1);
    expect(found.lineIndex).toBe(2);
    expect(found.offBy).toBeLessThan(2);
  });

  it("pulls a car that has drifted onto the line, and says how far off it was", () => {
    const route = simple();
    // Half a thousandth of a degree of longitude here is about thirty metres
    const found = locate(route, { lat: 53.4825, lng: -2.2405 }, -1);
    expect(found.offBy).toBeGreaterThan(25);
    expect(found.offBy).toBeLessThan(40);
    expect(found.point.lng).toBeCloseTo(-2.24, 4);
  });

  /**
   * The case that makes a window necessary. A job out to Wilmslow and back
   * runs within a lane's width of itself, and the nearest point on the whole
   * route can be the way home, which would have the screen announcing the
   * turns of a journey the chauffeur has not made yet.
   */
  it("stays on the leg being driven when the route doubles back alongside itself", () => {
    const out = north(30, -2.24);
    const back = north(30, -2.2403).reverse();
    const route = build([...out, ...back], [
      { fromIndex: 0, turn: "depart", road: "Deansgate", seconds: 300 },
      { fromIndex: 30, turn: "u-turn", seconds: 300 },
      { fromIndex: 59, turn: "arrive", seconds: 0 },
    ]);

    // Twelve metres west of the outward leg, so eight metres from the way home
    const car = { lat: 53.48 + 3 * STEP_LAT, lng: -2.24018 };
    const nearest = locate(route, car, -1);
    const following = locate(route, car, 3);

    expect(nearest.lineIndex).toBeGreaterThan(29);
    expect(following.lineIndex).toBeLessThan(30);
  });

  it("finds a car that has got well ahead of where it was last seen", () => {
    const route = build(north(80), [
      { fromIndex: 0, turn: "depart", road: "A34", seconds: 600 },
      { fromIndex: 79, turn: "arrive", seconds: 0 },
    ]);
    // Six kilometres on, far beyond anything the window would cover
    const found = locate(route, { lat: 53.48 + 54 * STEP_LAT, lng: -2.24 }, 2);
    expect(found.point.lat).toBeCloseTo(53.48 + 54 * STEP_LAT, 4);
    expect(found.offBy).toBeLessThan(2);
  });

  it("copes with a route that is a single point", () => {
    const route = build([{ lat: 53.48, lng: -2.24 }], [
      { fromIndex: 0, turn: "arrive", seconds: 0 },
    ]);
    expect(locate(route, { lat: 53.48, lng: -2.24 }, -1).lineIndex).toBe(0);
  });
});

describe("which step the car is on", () => {
  it("is the one it has reached", () => {
    const route = simple();
    expect(stepAt(route, 0)).toBe(0);
    expect(stepAt(route, 4)).toBe(0);
    expect(stepAt(route, 5)).toBe(1);
    expect(stepAt(route, 8)).toBe(1);
  });

  /**
   * Arriving is not a step anybody drives. If it were handed back as the
   * current step there would be nothing ahead to count down to, and the
   * distance to the next turn would sit at zero for the last half mile.
   */
  it("is never the arrival, so there is always something to count down to", () => {
    const route = simple();
    expect(stepAt(route, 9)).toBe(1);
  });
});

describe("following a route", () => {
  it("counts down to the turn as the car closes on it", () => {
    const route = simple();
    const early = follow(route, { lat: 53.4810, lng: -2.24 }, -1);
    const late = follow(route, { lat: 53.4845, lng: -2.24 }, early.lineIndex);
    expect(early.toTurn).toBeGreaterThan(late.toTurn);
    expect(late.toTurn).toBeLessThan(60);
  });

  it("measures the whole route as the distance left at the start", () => {
    const route = simple();
    const g = follow(route, { lat: 53.48, lng: -2.24 }, -1);
    expect(g.metresLeft).toBeCloseTo(route.metres, 0);
  });

  it("moves on to the next instruction once the turn is behind the car", () => {
    const route = simple();
    const before = follow(route, { lat: 53.4845, lng: -2.24 }, -1);
    const after = follow(route, { lat: 53.4860, lng: -2.24 }, before.lineIndex);
    expect(before.step.instruction).toContain("Set off");
    expect(after.step.instruction).toBe("Turn left onto Quay Street");
  });

  /**
   * What goes on the screen is the turn that is coming, not the one just
   * taken. A router hangs each manoeuvre on the step it starts, so the left
   * turn at the end of Deansgate belongs to the Quay Street step.
   */
  it("shows the turn being driven towards, not the one already made", () => {
    const route = simple();
    const onDeansgate = follow(route, { lat: 53.4825, lng: -2.24 }, -1);
    expect(onDeansgate.step.road).toBe("Deansgate");
    expect(onDeansgate.next.instruction).toBe("Turn left onto Quay Street");
    // Nothing between that turn and the door, so no second line
    expect(onDeansgate.then?.turn).toBe("arrive");
  });

  it("counts down to the door on the last street, rather than to nothing", () => {
    const route = simple();
    const lastStreet = follow(route, { lat: 53.4870, lng: -2.24 }, -1);
    expect(lastStreet.next.turn).toBe("arrive");
    expect(lastStreet.toTurn).toBeGreaterThan(0);
    expect(lastStreet.then).toBeNull();
  });

  it("spends the time it has left in proportion to the road it has left", () => {
    const route = simple();
    const start = follow(route, { lat: 53.48, lng: -2.24 }, -1);
    // Halfway along the first street: half of its minute, plus all of the next
    const halfway = follow(route, { lat: 53.4825, lng: -2.24 }, start.lineIndex);
    const atTheTurn = follow(route, { lat: 53.485, lng: -2.24 }, halfway.lineIndex);
    expect(start.secondsLeft).toBeCloseTo(120, 0);
    expect(halfway.secondsLeft).toBeCloseTo(90, 0);
    expect(atTheTurn.secondsLeft).toBeCloseTo(60, 0);
  });

  it("knows the car is there", () => {
    const route = simple();
    const g = follow(route, { lat: 53.4889, lng: -2.24 }, -1);
    expect(g.arrived).toBe(true);
  });

  it("does not call it arrived while there is still a street to drive", () => {
    const route = simple();
    expect(follow(route, { lat: 53.4870, lng: -2.24 }, -1).arrived).toBe(false);
  });

  it("turns the map the way the road goes", () => {
    const route = simple();
    const g = follow(route, { lat: 53.4825, lng: -2.24 }, -1);
    expect(g.course).toBeCloseTo(0, 0);
  });

  /**
   * Holding the car at the furthest point it reached must never be confused
   * with it having strayed. Off route has to be measured from where the phone
   * actually says the car is, or a chauffeur who takes a wrong turning while
   * the reading is held forward would never get a new route.
   */
  it("measures straying from the real position, not from the held reading", () => {
    const route = simple();
    const onTheRoute = { lat: 53.4820, lng: -2.24 };
    // Held a long way ahead of where the car actually is
    const held = follow(route, onTheRoute, -1, 700);
    expect(held.along).toBeCloseTo(700, 0);
    expect(held.offBy).toBeLessThan(2);
    expect(offRoute(held)).toBe(false);
  });

  it("still spots a car that has left the route while the reading is held", () => {
    const route = simple();
    const wellOff = { lat: 53.4820, lng: -2.2425 };
    expect(offRoute(follow(route, wellOff, -1, 700))).toBe(true);
  });

  it("calls it off route only once the car has properly left it", () => {
    const route = simple();
    const drifted = follow(route, { lat: 53.4825, lng: -2.2405 }, -1);
    const gone = follow(route, { lat: 53.4825, lng: -2.2425 }, -1);
    expect(offRoute(drifted)).toBe(false);
    expect(offRoute(gone)).toBe(true);
  });
});

describe("distances as they appear on screen", () => {
  it("counts in yards where a turning is being looked for", () => {
    expect(shownDistance(100)).toBe("110 yds");
    expect(shownDistance(300)).toBe("330 yds");
  });

  it("switches to miles once yards stop meaning anything", () => {
    expect(shownDistance(1609)).toBe("1.0 miles");
    expect(shownDistance(8047)).toBe("5.0 miles");
    expect(shownDistance(40234)).toBe("25 miles");
  });

  it("says now at the junction itself", () => {
    expect(shownDistance(5)).toBe("now");
  });
});

describe("distances as they are said out loud", () => {
  it("rounds to the fifty yards a sat nav uses", () => {
    expect(spokenDistance(300)).toBe("350 yards");
    expect(spokenDistance(180)).toBe("200 yards");
  });

  it("never says nought yards", () => {
    expect(spokenDistance(10)).toBe("50 yards");
  });

  it("talks in halves and miles further out", () => {
    expect(spokenDistance(800)).toBe("half a mile");
    expect(spokenDistance(1600)).toBe("a mile");
    expect(spokenDistance(4800)).toBe("3 miles");
  });
});

describe("when a turn is announced", () => {
  it("speaks at the junction whatever the step was like", () => {
    expect(cueFor(50, 120)).toBe("now");
  });

  it("gives warning on a step long enough to be worth warning about", () => {
    expect(cueFor(350, 1500)).toBe("near");
  });

  /**
   * Two announcements inside a bus length is worse than one. On a short step
   * the chauffeur only gets the one at the junction.
   */
  it("keeps quiet about a turn that is only yards past the last one", () => {
    expect(cueFor(200, 220)).toBeNull();
  });

  it("gives the mile warning only on a run long enough to have one", () => {
    expect(cueFor(1500, 4000)).toBe("mile");
    // Half a mile of street gets one warning as the turn comes up, not two
    expect(cueFor(500, 600)).toBeNull();
    expect(cueFor(400, 600)).toBe("near");
  });

  it("says nothing at all while the turn is miles off", () => {
    expect(cueFor(5000, 8000)).toBeNull();
  });
});

describe("the announcement itself", () => {
  const step = {
    instruction: "Turn left onto Deansgate",
    turn: "left" as Turn,
    road: "Deansgate",
    metres: 900,
    seconds: 90,
    fromIndex: 0,
  };

  it("puts the distance first, and drops the capital that followed it", () => {
    expect(announcement(step, "near", 320)).toBe("In 350 yards, turn left onto Deansgate");
  });

  it("just says it at the junction", () => {
    expect(announcement(step, "now", 40)).toBe("Turn left onto Deansgate");
  });

  it("leaves a road number alone, which is not a word to be lowercased", () => {
    const motorway = { ...step, instruction: "M60 towards Stockport" };
    expect(announcement(motorway, "mile", 1600)).toBe("In a mile, M60 towards Stockport");
  });
});

describe("when the car is due", () => {
  it("adds what is left to the clock", () => {
    const at = new Date("2026-10-24T18:30:00Z");
    expect(arrivalAt(900, at)).toBe("19:45");
  });

  it("never says nought minutes while the car is still moving", () => {
    expect(minutesLeft(20)).toBe(1);
    expect(minutesLeft(0)).toBe(0);
    expect(minutesLeft(610)).toBe(10);
  });
});
