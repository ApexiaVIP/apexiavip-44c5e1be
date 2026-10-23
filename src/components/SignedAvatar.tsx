import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** How long a freshly signed URL is good for. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Re-sign this long before the signature actually dies.
 *
 * A URL handed out with five minutes left on it will break while somebody is
 * looking at it, so anything inside this window counts as already expired.
 */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

type Signed = { url: string; expiresAt: number };

const cache = new Map<string, Signed>();

/**
 * The storage path hiding inside a stored URL, if there is one.
 *
 * The avatars bucket was public when the first members joined, so their
 * profile rows hold a public URL rather than a path. The bucket is private
 * now, which means those URLs have been quietly returning nothing ever since,
 * and the oldest accounts are the worst affected. Rather than migrate the
 * column, recover the path and sign it like any other.
 *
 * It also catches a signed URL that was stored by mistake, which has the same
 * problem a week later.
 */
const storagePathFrom = (url: string): string | null => {
  const match = url.match(
    /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?avatars\/(.+?)(?:\?|$)/
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/** Only exported so the tests can start from a known state. */
export const __clearAvatarCache = () => cache.clear();

/**
 * Resolve an avatar reference to a displayable URL.
 *
 * The avatars bucket is private, so storage paths are exchanged for signed
 * URLs. A URL pointing at our own storage is turned back into a path and
 * signed too, because it will not load otherwise. Object URLs, and URLs on
 * anybody else's host, pass straight through.
 *
 * The signature expires, and this used to cache the signed URL forever. In a
 * browser that is survivable, because a reload empties the cache. This also
 * ships as a native app, whose webview can stay alive for weeks, so after
 * seven days every avatar in the app quietly turned into a broken image until
 * somebody force quit it. So each entry now remembers when it dies, and is
 * replaced before it does.
 */
export const resolveAvatarUrl = async (
  pathOrUrl: string,
  { force = false }: { force?: boolean } = {}
): Promise<string> => {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("blob:")) return pathOrUrl;

  let path = pathOrUrl;
  if (path.startsWith("http")) {
    const recovered = storagePathFrom(path);
    // Somebody else's URL, so nothing we can sign. Hand it back untouched.
    if (!recovered) return path;
    path = recovered;
  }

  const held = cache.get(path);
  const stillGood = held && held.expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (!force && stillGood) return held.url;

  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (data?.signedUrl) {
    cache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  }

  // Signing failed, most likely because the device is offline. The URL we
  // already hold may well still work, and showing a face beats showing a grey
  // circle on the strength of one failed request.
  return held?.url ?? "";
};

interface SignedAvatarProps {
  src: string;
  alt?: string;
  className: string;
}

/** Displays an avatar from a storage path or URL; a placeholder circle when absent. */
const SignedAvatar = ({ src, alt = "", className }: SignedAvatarProps) => {
  const [url, setUrl] = useState("");
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRetried(false);
    resolveAvatarUrl(src).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  /**
   * The picture would not load. Expiry is the likely reason and we cannot see
   * it from here, so sign a fresh one and try once more. Once only: a URL that
   * fails twice is a missing file, and retrying it forever would hammer
   * storage on every render.
   */
  const onError = useCallback(() => {
    if (retried) {
      setUrl("");
      return;
    }
    setRetried(true);
    resolveAvatarUrl(src, { force: true }).then(setUrl);
  }, [retried, src]);

  if (!url) {
    return <span className={`${className} bg-charcoal border border-border inline-block`} />;
  }
  return <img src={url} alt={alt} className={`${className} object-cover`} onError={onError} />;
};

export default SignedAvatar;
