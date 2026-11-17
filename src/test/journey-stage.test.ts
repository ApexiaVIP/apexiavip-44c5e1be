/**
 * Never tell a passenger something they have already moved past.
 *
 * On 17 November a passenger was texted "Faz Hussain is on the way" at 16:31
 * and "Your chauffeur is confirmed. We will text again when he sets off" at
 * 16:35. Nobody pressed anything the second time: the chauffeur's app had
 * texted straight away, and the Dispatch sweep, which runs every few minutes,
 * then found a status of Allocated and announced it as news.
 *
 * The guard it slipped past only blocked the same stage twice. It said nothing
 * about an earlier stage arriving late, which is the only way this fails.
 */
import { describe, it, expect } from "vitest";
import {
  classify,
  reached,
  shouldAnnounce,
} from "../../supabase/functions/_shared/journeyStage.ts";

describe("reading a Dispatch status", () => {
  it("places the stages in the order a journey happens", () => {
    expect(reached("assigned")).toBe(1);
    expect(reached("onroute")).toBe(2);
    expect(reached("arrived")).toBe(3);
  });

  it("leaves cancelled off the rail, because it can follow anything", () => {
    expect(reached("cancelled")).toBe(0);
  });

  it("treats nothing, and anything it does not know, as off the rail", () => {
    expect(reached(null)).toBe(0);
    expect(reached(undefined)).toBe(0);
    expect(reached("completed")).toBe(0);
  });
});

describe("the 16:31 then 16:35 texts", () => {
  it("does not confirm a car the chauffeur has already said is on its way", () => {
    expect(
      shouldAnnounce(classify("Allocated"), { driverMoment: "onroute" })
    ).toBe(false);
  });

  it("does not confirm a car the chauffeur has already arrived in", () => {
    expect(
      shouldAnnounce(classify("Allocated"), { driverMoment: "arrived" })
    ).toBe(false);
  });

  it("still says the car has arrived after the chauffeur said it set off", () => {
    expect(
      shouldAnnounce(classify("Arrived"), { driverMoment: "onroute" })
    ).toBe(true);
  });
});

describe("the ordinary run of a journey", () => {
  it("confirms the car when nothing has been said yet", () => {
    expect(shouldAnnounce(classify("Allocated"), {})).toBe(true);
  });

  it("says the car is on its way after confirming it", () => {
    expect(
      shouldAnnounce(classify("On Route"), { notifiedStatus: "Allocated" })
    ).toBe(true);
  });

  it("does not repeat itself when Dispatch words the same stage differently", () => {
    expect(
      shouldAnnounce(classify("En-route"), { notifiedStatus: "On Route" })
    ).toBe(false);
  });

  it("does not go backwards when Dispatch itself regresses", () => {
    expect(
      shouldAnnounce(classify("Allocated"), { notifiedStatus: "Arrived" })
    ).toBe(false);
  });

  it("takes the furthest of the two things that text a passenger", () => {
    // The sweep got as far as confirming it, the chauffeur got further
    expect(
      shouldAnnounce(classify("On Route"), {
        notifiedStatus: "Allocated",
        driverMoment: "arrived",
      })
    ).toBe(false);
  });
});

describe("cancellation", () => {
  it("always goes out, however far along the journey was", () => {
    expect(
      shouldAnnounce(classify("Cancelled"), {
        driverMoment: "arrived",
        notifiedStatus: "Arrived",
      })
    ).toBe(true);
  });
});

describe("statuses a passenger gains nothing from", () => {
  it("says nothing at all", () => {
    expect(shouldAnnounce(classify("Passenger On Board"), {})).toBe(false);
    expect(shouldAnnounce(classify("Completed"), {})).toBe(false);
    expect(shouldAnnounce(classify(""), {})).toBe(false);
  });
});
