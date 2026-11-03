import { describe, it, expect } from "vitest";
import { placeName } from "@/lib/whereAmI";

/**
 * What goes on the job when a chauffeur presses Wait or Clear. It is read by
 * the office and by accounts, so it has to be somewhere a person recognises.
 */
describe("the name put against where a car stopped", () => {
  it("uses the ward rather than a city's empty parish", () => {
    expect(
      placeName({
        parish: "Manchester, unparished area",
        admin_ward: "Clayton & Openshaw",
        admin_district: "Manchester",
        postcode: "M11 4DW",
      })
    ).toBe("Clayton & Openshaw, M11 4DW");
  });

  it("keeps a real parish where there is one", () => {
    expect(
      placeName({
        parish: "Alderley Edge",
        admin_ward: "Alderley Edge",
        admin_district: "Cheshire East",
        postcode: "SK9 7AA",
      })
    ).toBe("Alderley Edge, SK9 7AA");
  });

  it("falls back to the district when there is no ward either", () => {
    expect(
      placeName({ parish: null, admin_ward: "", admin_district: "Salford", postcode: "M3 5LH" })
    ).toBe("Salford, M3 5LH");
  });

  it("gives the postcode on its own rather than nothing", () => {
    expect(placeName({ postcode: "M1 2PB" })).toBe("M1 2PB");
  });

  it("is empty when the lookup gave nothing back", () => {
    expect(placeName({})).toBe("");
  });
});
