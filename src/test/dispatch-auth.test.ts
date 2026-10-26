import { describe, it, expect } from "vitest";
import { transferAuth, usingTransferKey } from "../../supabase/functions/_shared/dispatch";

const decode = (auth: string) => atob(auth);

describe("signing in to the Dispatch transfer API", () => {
  it("uses the transfer API key as the password once there is one", () => {
    expect(decode(transferAuth("KEY123", "REF456"))).toBe("TRANSFERAPIUSER:KEY123");
  });

  /*
   * Dever still accept the reference for now. Falling back means the key can
   * be added as a secret whenever, rather than at the same moment as a
   * deployment.
   */
  it("falls back to the transfer reference until the key is set", () => {
    expect(decode(transferAuth("", "REF456"))).toBe("TRANSFERAPIUSER:REF456");
    expect(decode(transferAuth(undefined, "REF456"))).toBe("TRANSFERAPIUSER:REF456");
  });

  it("is not fooled by a secret pasted in with a space on the end", () => {
    expect(decode(transferAuth("  KEY123  ", "REF456"))).toBe("TRANSFERAPIUSER:KEY123");
    expect(decode(transferAuth("   ", "REF456"))).toBe("TRANSFERAPIUSER:REF456");
  });

  it("always calls itself the same user", () => {
    expect(decode(transferAuth("KEY123", null)).startsWith("TRANSFERAPIUSER:")).toBe(true);
  });

  it("says whether the key is in use yet", () => {
    expect(usingTransferKey("KEY123")).toBe(true);
    expect(usingTransferKey(" ")).toBe(false);
    expect(usingTransferKey(undefined)).toBe(false);
  });
});
