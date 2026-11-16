/**
 * Where the platform sends its bookings.
 *
 * The address used to be written into seven places. It is one setting now,
 * and the whole point of that is being able to point the platform somewhere
 * else without a deployment. So the setting is worth proving, including the
 * case where it is not set at all, which is every day until it is.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  bookingTransferUrl,
  statusTransferUrl,
} from "../../supabase/functions/_shared/dispatch.ts";

declare global {
  // The edge functions run in Deno, which the app's own type checking knows
  // nothing about. This is the shape these tests stand in for.
  var Deno: { env: { get: (key: string) => string | undefined } };
}

const setting = (value?: string) => {
  globalThis.Deno = { env: { get: (key) => (key === "DISPATCH_BASE_URL" ? value : undefined) } };
};

afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
});

describe("with nothing set", () => {
  it("sends bookings to Dever, as it always has", () => {
    setting(undefined);
    expect(bookingTransferUrl("APEX1")).toBe(
      "https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=APEX1&BookedBy=Website"
    );
  });

  it("asks Dever for status, as it always has", () => {
    setting(undefined);
    expect(statusTransferUrl("APEX1")).toBe(
      "https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=APEX1&CheckBookingStatus=true"
    );
  });
});

describe("pointed somewhere else", () => {
  it("sends bookings there instead", () => {
    setting("https://concourse.apexiavip.com");
    expect(bookingTransferUrl("APEX1")).toBe(
      "https://concourse.apexiavip.com/Dispatch/Transfer/?TransferToReference=APEX1&BookedBy=Website"
    );
  });

  it("asks there for status instead", () => {
    setting("https://concourse.apexiavip.com");
    expect(statusTransferUrl("APEX1")).toBe(
      "https://concourse.apexiavip.com/Dispatch/Transfer/?TransferToReference=APEX1&CheckBookingStatus=true"
    );
  });

  // Somebody will paste an address with a slash on the end, and a double
  // slash in a path is the sort of thing that works on one server and
  // four-oh-fours on another.
  it("does not mind a trailing slash", () => {
    setting("https://concourse.apexiavip.com/");
    expect(bookingTransferUrl("APEX1")).toBe(
      "https://concourse.apexiavip.com/Dispatch/Transfer/?TransferToReference=APEX1&BookedBy=Website"
    );
  });

  it("does not mind several", () => {
    setting("https://concourse.apexiavip.com///");
    expect(statusTransferUrl("APEX1")).toContain("apexiavip.com/Dispatch/Transfer/");
  });

  it("falls back to Dever if the setting is empty rather than absent", () => {
    setting("");
    expect(bookingTransferUrl("APEX1")).toContain("dispatch.deversoftware.com");
  });
});

describe("the reference", () => {
  it("is escaped, so one with a space or an ampersand cannot rewrite the query", () => {
    setting(undefined);
    expect(bookingTransferUrl("A B&CheckBookingStatus=true")).toBe(
      "https://dispatch.deversoftware.com/Dispatch/Transfer/" +
        "?TransferToReference=A%20B%26CheckBookingStatus%3Dtrue&BookedBy=Website"
    );
  });
});
