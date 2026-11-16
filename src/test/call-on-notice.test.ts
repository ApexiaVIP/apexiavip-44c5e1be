/**
 * What the office reads at six in the morning.
 *
 * This is the only thing telling the desk a chauffeur has answered, and it is
 * acted on: somebody either rings round or does not. "Up" and "signed on" are
 * different states and the wording has to keep them apart.
 */
import { describe, it, expect } from "vitest";
import { callOnNotice } from "../../supabase/functions/_shared/callOn.ts";

const answered = {
  chauffeur: "Mohammed Arshad",
  reference: "APEXIA-1234",
  passenger: "Mr A. Okafor",
  collectionAt: "2026-11-16T07:30:00Z",
  signedOnAt: "2026-11-16T06:12:00Z",
};

describe("a chauffeur who is up and signed on", () => {
  it("says so in the subject, which is all most people read", () => {
    expect(callOnNotice(answered).subject).toBe("Mohammed Arshad is up and signed on");
  });

  it("names the job they answered for", () => {
    expect(callOnNotice(answered).lines[0]).toContain("APEXIA-1234");
  });

  it("gives the collection in UK time, not the viewer's", () => {
    expect(callOnNotice(answered).lines.join(" ")).toContain("07:30");
  });

  it("says when the shift began", () => {
    expect(callOnNotice(answered).lines.join(" ")).toContain("Signed on at");
  });
});

describe("a chauffeur who is up but has not signed on", () => {
  const notOn = { ...answered, signedOnAt: null };

  // The difference the desk acts on. Up without a shift means no timesheet is
  // running, so the hours would be missing at the end of the week.
  it("is not described as signed on", () => {
    expect(callOnNotice(notOn).subject).toBe("Mohammed Arshad is up, not signed on");
  });

  it("spells out that no timesheet is running", () => {
    expect(callOnNotice(notOn).lines.join(" ")).toContain("no timesheet is running");
  });
});

describe("what is missing", () => {
  it("does not leave the subject starting with nothing when the name is blank", () => {
    expect(callOnNotice({ ...answered, chauffeur: "   " }).subject).toBe(
      "A chauffeur is up and signed on"
    );
  });

  it("leaves the passenger out rather than printing an empty line", () => {
    const lines = callOnNotice({ ...answered, passenger: "" }).lines;
    expect(lines.some((l) => l.startsWith("Passenger:"))).toBe(false);
  });

  it("leaves the collection out when there is no time on the job", () => {
    const lines = callOnNotice({ ...answered, collectionAt: null }).lines;
    expect(lines.some((l) => l.startsWith("Collection:"))).toBe(false);
  });

  it("does not print Invalid Date when the time is unreadable", () => {
    const lines = callOnNotice({ ...answered, collectionAt: "not a date" }).lines;
    expect(lines.join(" ")).not.toContain("Invalid");
  });
});
