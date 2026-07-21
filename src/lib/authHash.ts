// Captures the auth link type from the URL hash BEFORE the Supabase client
// consumes it. Lovable Cloud can't allowlist custom redirect URLs, so invite
// and recovery links land on the site root; this lets the app route them to
// the right screen. This module must be imported first in main.tsx.

const params = new URLSearchParams(window.location.hash.slice(1));

/** 'invite' | 'recovery' | other Supabase link types, or null */
export const initialAuthType: string | null = params.get("type");

/** True when the link arrived with an auth error (e.g. expired link) */
export const initialAuthError: boolean = params.has("error") || params.has("error_code");
