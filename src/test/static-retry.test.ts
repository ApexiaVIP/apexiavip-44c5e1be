import { describe, it, expect, vi } from "vitest";
import { retryStaticPath, type Retry } from "@/lib/staticRetry";

const watcher = (tried: string | null = null) => {
  const remembered: string[] = [];
  const askAgain = vi.fn();
  const how: Retry = {
    tried: () => tried,
    remember: (p) => { remembered.push(p); },
    askAgain,
  };
  return { how, remembered, askAgain };
};

describe("asking again for a path the app does not own", () => {
  it.each(["/contacts/abc123/", "/vcards/abc123.vcf", "/setup/abc123/"])(
    "retries %s, which is a static file the worker should not have answered",
    (path) => {
      const { how, askAgain } = watcher();
      expect(retryStaticPath(path, how)).toBe(true);
      expect(askAgain).toHaveBeenCalledOnce();
    },
  );

  it.each(["/", "/book", "/driver", "/mcfc", "/contacts", "/nonsense"])(
    "leaves %s alone, because that really is a missing app route",
    (path) => {
      const { how, askAgain } = watcher();
      expect(retryStaticPath(path, how)).toBe(false);
      expect(askAgain).not.toHaveBeenCalled();
    },
  );

  it("gives up after one attempt rather than reloading forever", () => {
    const { how, askAgain } = watcher("/contacts/abc123/");
    expect(retryStaticPath("/contacts/abc123/", how)).toBe(false);
    expect(askAgain).not.toHaveBeenCalled();
  });

  it("still tries a different card after one has already failed", () => {
    const { how, askAgain } = watcher("/contacts/abc123/");
    expect(retryStaticPath("/contacts/def456/", how)).toBe(true);
    expect(askAgain).toHaveBeenCalledOnce();
  });

  it("remembers the path it tried, not just that it tried something", () => {
    const { how, remembered } = watcher();
    retryStaticPath("/contacts/abc123/", how);
    expect(remembered).toEqual(["/contacts/abc123/"]);
  });
});
