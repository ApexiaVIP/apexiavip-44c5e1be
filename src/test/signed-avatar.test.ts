import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Faz's profile picture kept vanishing in the app.
 *
 * The cause was a cache that held a signed URL forever while the signature
 * behind it expired after a week. A browser reload hid the problem; the
 * native app, whose webview is not reloaded for weeks, did not.
 *
 * These exercise the real resolver, with only the storage call mocked.
 */
const createSignedUrl = vi.fn();
const list = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl, list }) } },
}));

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let resolveAvatarUrl: typeof import("@/components/SignedAvatar")["resolveAvatarUrl"];
let findStoredAvatar: typeof import("@/components/SignedAvatar")["findStoredAvatar"];
let avatarLoads: typeof import("@/components/SignedAvatar")["avatarLoads"];
let clearCache: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
  const mod = await import("@/components/SignedAvatar");
  resolveAvatarUrl = mod.resolveAvatarUrl;
  findStoredAvatar = mod.findStoredAvatar;
  avatarLoads = mod.avatarLoads;
  clearCache = mod.__clearAvatarCache;
  clearCache();
  createSignedUrl.mockReset();
  list.mockReset();
  let n = 0;
  createSignedUrl.mockImplementation(async () => ({
    data: { signedUrl: `https://storage.test/faz.jpg?sig=${++n}` },
  }));
});

afterEach(() => vi.useRealTimers());

describe("resolving an avatar", () => {
  it("signs a storage path", async () => {
    expect(await resolveAvatarUrl("faz/avatar-1.jpg")).toBe("https://storage.test/faz.jpg?sig=1");
  });

  it("does not sign the same path twice in a row", async () => {
    await resolveAvatarUrl("faz/avatar-1.jpg");
    await resolveAvatarUrl("faz/avatar-1.jpg");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("signs again once the week is nearly up, rather than handing out a dead URL", async () => {
    const first = await resolveAvatarUrl("faz/avatar-1.jpg");
    // Six days and twenty three hours later, inside the refresh margin
    vi.setSystemTime(Date.now() + WEEK_MS - 30 * 60 * 1000);
    const second = await resolveAvatarUrl("faz/avatar-1.jpg");
    expect(second).not.toBe(first);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("is still serving a fresh URL a month later, which is what broke", async () => {
    await resolveAvatarUrl("faz/avatar-1.jpg");
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(await resolveAvatarUrl("faz/avatar-1.jpg")).toBe("https://storage.test/faz.jpg?sig=2");
  });

  it("re-signs on demand, for when the picture failed to load", async () => {
    const first = await resolveAvatarUrl("faz/avatar-1.jpg");
    const forced = await resolveAvatarUrl("faz/avatar-1.jpg", { force: true });
    expect(forced).not.toBe(first);
  });

  it("keeps the URL it has when signing fails, rather than blanking the face", async () => {
    const first = await resolveAvatarUrl("faz/avatar-1.jpg");
    createSignedUrl.mockResolvedValueOnce({ data: null });
    expect(await resolveAvatarUrl("faz/avatar-1.jpg", { force: true })).toBe(first);
  });

  it("returns nothing for an empty reference", async () => {
    expect(await resolveAvatarUrl("")).toBe("");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("passes somebody else's URL straight through without signing it", async () => {
    const url = "https://example.com/legacy.jpg";
    expect(await resolveAvatarUrl(url)).toBe(url);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  // The avatars bucket was public when the first members joined, so the
  // oldest profile rows hold a URL that stopped working when it went private
  it("rescues a public URL stored before the bucket was locked down", async () => {
    const stored =
      "https://abc.supabase.co/storage/v1/object/public/avatars/faz-id/avatar-171.jpg";
    expect(await resolveAvatarUrl(stored)).toBe("https://storage.test/faz.jpg?sig=1");
    expect(createSignedUrl).toHaveBeenCalledWith("faz-id/avatar-171.jpg", expect.any(Number));
  });

  it("rescues a signed URL that was stored instead of the path", async () => {
    const stored =
      "https://abc.supabase.co/storage/v1/object/sign/avatars/faz-id/avatar-171.jpg?token=old";
    expect(await resolveAvatarUrl(stored)).toBe("https://storage.test/faz.jpg?sig=1");
    expect(createSignedUrl).toHaveBeenCalledWith("faz-id/avatar-171.jpg", expect.any(Number));
  });

  it("unescapes a path that was escaped into the URL", async () => {
    const stored =
      "https://abc.supabase.co/storage/v1/object/public/avatars/faz%20id/avatar%201.jpg";
    await resolveAvatarUrl(stored);
    expect(createSignedUrl).toHaveBeenCalledWith("faz id/avatar 1.jpg", expect.any(Number));
  });

  it("treats the stored URL and the bare path as the same picture", async () => {
    await resolveAvatarUrl("faz-id/avatar-171.jpg");
    await resolveAvatarUrl(
      "https://abc.supabase.co/storage/v1/object/public/avatars/faz-id/avatar-171.jpg"
    );
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("passes an object URL through, so a just-chosen photo previews", async () => {
    expect(await resolveAvatarUrl("blob:abc123")).toBe("blob:abc123");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

/**
 * Faz uploaded a photograph more than once and it never stuck, because
 * choosing one uploaded the file but only recorded it if the form was saved
 * afterwards. The files are still in his folder. These cover going to find
 * them rather than asking him again.
 */
describe("recovering a photograph nothing points at", () => {
  it("finds the newest file in the member's own folder", async () => {
    list.mockResolvedValue({
      data: [
        { name: "avatar-1761300000000.jpg" },
        { name: "avatar-1760000000000.jpg" },
      ],
      error: null,
    });
    expect(await findStoredAvatar("faz-id")).toBe("faz-id/avatar-1761300000000.jpg");
  });

  it("asks storage for the newest first, so the first row is the right one", async () => {
    list.mockResolvedValue({ data: [{ name: "a.jpg" }], error: null });
    await findStoredAvatar("faz-id");
    expect(list).toHaveBeenCalledWith(
      "faz-id",
      expect.objectContaining({ sortBy: { column: "created_at", order: "desc" } })
    );
  });

  it("ignores the placeholder row in an empty folder", async () => {
    list.mockResolvedValue({ data: [{ name: ".emptyFolderPlaceholder" }], error: null });
    expect(await findStoredAvatar("faz-id")).toBeNull();
  });

  it("returns nothing when the folder is empty", async () => {
    list.mockResolvedValue({ data: [], error: null });
    expect(await findStoredAvatar("faz-id")).toBeNull();
  });

  it("returns nothing when storage refuses", async () => {
    list.mockResolvedValue({ data: null, error: { message: "denied" } });
    expect(await findStoredAvatar("faz-id")).toBeNull();
  });

  it("does not ask storage about nobody", async () => {
    expect(await findStoredAvatar("")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("telling a working picture from a dead one", () => {
  it("accepts a URL that hands something back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 206 }));
    expect(await avatarLoads("https://storage.test/faz.jpg")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("rejects a signed URL whose file has gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await avatarLoads("https://storage.test/gone.jpg")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("does not call a picture dead just because the device is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await avatarLoads("https://storage.test/faz.jpg")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("treats an empty URL as nothing to show", async () => {
    expect(await avatarLoads("")).toBe(false);
  });
});
