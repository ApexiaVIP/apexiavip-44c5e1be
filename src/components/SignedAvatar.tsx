import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** One week; regenerated on every page view, so expiry is never user-visible */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

const cache = new Map<string, string>();

/**
 * Resolve an avatar reference to a displayable URL. The avatars bucket is
 * private (workspace policy), so storage paths are exchanged for signed URLs;
 * full http(s) URLs (legacy or object URLs) pass straight through.
 */
export const resolveAvatarUrl = async (pathOrUrl: string): Promise<string> => {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http") || pathOrUrl.startsWith("blob:")) return pathOrUrl;
  const cached = cache.get(pathOrUrl);
  if (cached) return cached;
  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(pathOrUrl, SIGNED_URL_TTL);
  if (data?.signedUrl) cache.set(pathOrUrl, data.signedUrl);
  return data?.signedUrl ?? "";
};

interface SignedAvatarProps {
  src: string;
  alt?: string;
  className: string;
}

/** Displays an avatar from a storage path or URL; renders a placeholder circle when absent. */
const SignedAvatar = ({ src, alt = "", className }: SignedAvatarProps) => {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    resolveAvatarUrl(src).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!url) {
    return <span className={`${className} bg-charcoal border border-border inline-block`} />;
  }
  return <img src={url} alt={alt} className={`${className} object-cover`} />;
};

export default SignedAvatar;
