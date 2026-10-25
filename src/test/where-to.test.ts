import { describe, it, expect } from "vitest";
import { canAskChauffeur, placeLine } from "@/lib/whereTo";

/**
 * The passenger can only be offered this while there is a chauffeur on the
 * job. Earlier than that the office still owns the journey and nobody is
 * looking at a driver's screen, so an address typed into the app would go
 * nowhere and the passenger would believe it had been passed on.
 */
describe("whether the passenger can tell their chauffeur", () => {
  it("can once the car has set off", () => {
    expect(canAskChauffeur("en_route", "Dispatched")).toBe(true);
  });

  it("can while the car is on the kerb", () => {
    expect(canAskChauffeur("arrived", "Dispatched")).toBe(true);
  });

  it("can from the back seat, which is the point of it", () => {
    expect(canAskChauffeur("pob", "Dispatched")).toBe(true);
  });

  it("can while the chauffeur waits outside, ready for the next leg", () => {
    expect(canAskChauffeur("waiting", "Dispatched")).toBe(true);
  });

  it("cannot before a chauffeur has picked the job up", () => {
    expect(canAskChauffeur(null, "Confirmed")).toBe(false);
    expect(canAskChauffeur("", "Confirmed")).toBe(false);
  });

  it("cannot once the job is cleared", () => {
    expect(canAskChauffeur("clear", "Completed")).toBe(false);
  });

  it("cannot on a cancelled journey, whatever the chauffeur's app last said", () => {
    expect(canAskChauffeur("pob", "Cancelled")).toBe(false);
    expect(canAskChauffeur("pob", "cancelled")).toBe(false);
  });
});

/**
 * The sat nav reads the postcode off the end of the line, so the order is
 * not cosmetic: street, town, postcode, exactly as the chauffeur's own app
 * writes it.
 */
describe("the address as it goes on the record", () => {
  it("writes street, town then postcode", () => {
    expect(placeLine({ line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" })).toBe(
      "The Lowry Hotel, Salford, M3 5LH"
    );
  });

  it("leaves out what the search did not give", () => {
    expect(placeLine({ line1: "", town: "Wilmslow", postcode: "SK9 5PN" })).toBe(
      "Wilmslow, SK9 5PN"
    );
  });

  it("keeps the postcode last even with nothing in front of it", () => {
    expect(placeLine({ postcode: "SK9 5PN" })).toBe("SK9 5PN");
  });

  it("trims, so a stray space does not end up in the chauffeur's sat nav", () => {
    expect(placeLine({ line1: " Australasia ", town: " Manchester", postcode: "M3 3AP " })).toBe(
      "Australasia, Manchester, M3 3AP"
    );
  });

  it("gives nothing back when there is no address at all", () => {
    expect(placeLine({ line1: null, town: null, postcode: null })).toBe("");
  });
});
