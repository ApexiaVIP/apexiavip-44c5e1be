import { describe, it, expect } from "vitest";
import {
  addressLine,
  addressUsable,
  blankAddress,
  fromPlace,
  labelTaken,
  sortAddresses,
} from "@/lib/addressBook";

const at = (label: string, is_home = false, id = label) => ({ id, label, is_home });

describe("the order addresses are offered in", () => {
  it("puts home first however it is named", () => {
    const rows = sortAddresses([at("Zoo"), at("The flat", true), at("Airport")]);
    expect(rows.map((r) => r.label)).toEqual(["The flat", "Airport", "Zoo"]);
  });

  it("leaves the list it was given alone", () => {
    const given = [at("Zoo"), at("Airport")];
    sortAddresses(given);
    expect(given.map((r) => r.label)).toEqual(["Zoo", "Airport"]);
  });
});

describe("naming an address", () => {
  const rows = [at("Home"), at("The office")];

  it("spots the same name in a different case", () => {
    expect(labelTaken(rows, " home ")).toBe(true);
  });

  it("lets a member keep the name of the one they are editing", () => {
    expect(labelTaken(rows, "Home", "Home")).toBe(false);
  });

  it("does not treat an empty name as taken", () => {
    expect(labelTaken(rows, "   ")).toBe(false);
  });
});

describe("what a car can actually be sent to", () => {
  it("wants a street and something to find it by", () => {
    expect(addressUsable({ ...blankAddress(), line1: "1 Water Street" })).toBe(false);
    expect(addressUsable({ ...blankAddress(), line1: "1 Water Street", postcode: "M3 4JQ" })).toBe(
      true,
    );
    expect(addressUsable({ ...blankAddress(), line1: "1 Water Street", town: "Manchester" })).toBe(
      true,
    );
  });

  it("will not save a postcode on its own", () => {
    expect(addressUsable({ ...blankAddress(), postcode: "M3 4JQ" })).toBe(false);
  });
});

describe("reading an address back", () => {
  it("leaves out the parts that are not filled in", () => {
    expect(
      addressLine({ line1: "1 Water Street", line2: "", town: "Manchester", postcode: "M3 4JQ" }),
    ).toBe("1 Water Street, Manchester, M3 4JQ");
  });
});

describe("taking an address from a search result", () => {
  it("falls back to the United Kingdom when the search gives no country", () => {
    const place = { label: "x", line1: "1 Water Street", line2: "", town: "Manchester", postcode: "M3 4JQ", country: "" };
    expect(fromPlace(place).country).toBe("United Kingdom");
  });
});
