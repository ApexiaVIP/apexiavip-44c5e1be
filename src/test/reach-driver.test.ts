/**
 * Getting hold of the chauffeur.
 *
 * Dispatch hands back whatever the office typed, and a WhatsApp link made
 * from the wrong shape of number opens a chat with nobody. That failure is
 * silent, so it is worth pinning every shape a UK mobile gets written in.
 */
import { describe, it, expect } from "vitest";
import { callLink, textLink, whatsAppLink, whatsAppNumber } from "../lib/reachDriver";

describe("whatsAppNumber", () => {
  it("reads every way a UK mobile gets written", () => {
    for (const written of [
      "07700 900123",
      "07700900123",
      "+44 7700 900123",
      "+447700900123",
      "0044 7700 900123",
      "44 7700 900123",
    ]) {
      expect(whatsAppNumber(written)).toBe("447700900123");
    }
  });

  it("leaves a number from another country alone", () => {
    expect(whatsAppNumber("+1 415 555 0132")).toBe("14155550132");
    expect(whatsAppNumber("0033 6 12 34 56 78")).toBe("33612345678");
  });

  it("gives nothing for something that is not a number", () => {
    expect(whatsAppNumber("")).toBeNull();
    expect(whatsAppNumber("   ")).toBeNull();
    expect(whatsAppNumber("ask the office")).toBeNull();
    expect(whatsAppNumber("12345")).toBeNull();
  });
});

describe("links", () => {
  it("dials and texts the number as given, without the spaces", () => {
    expect(callLink("07700 900123")).toBe("tel:07700900123");
    expect(textLink("+44 7700 900123")).toBe("sms:+447700900123");
  });

  it("opens a WhatsApp chat on the international number", () => {
    expect(whatsAppLink("07700 900123")).toBe("https://wa.me/447700900123");
  });

  it("offers no WhatsApp at all when the number makes no sense", () => {
    expect(whatsAppLink("n/a")).toBeNull();
  });
});
