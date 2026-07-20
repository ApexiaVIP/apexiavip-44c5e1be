-- Custom SMS 2FA (Twilio via edge function, no Supabase MFA add-on)

-- One-time codes awaiting verification (hashes only, never the code itself)
CREATE TABLE public.mfa_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mfa_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only mfa_codes"
ON public.mfa_codes FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_mfa_codes_user ON public.mfa_codes (user_id, created_at DESC);

-- Sessions that have passed SMS verification
CREATE TABLE public.mfa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mfa_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only mfa_sessions"
ON public.mfa_sessions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX idx_mfa_sessions_user ON public.mfa_sessions (user_id);
