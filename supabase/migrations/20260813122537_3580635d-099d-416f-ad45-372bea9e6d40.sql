-- Club fixtures for corporate desks, kept in step with the published schedule

CREATE TABLE public.fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate text NOT NULL,
  -- The desk's club, as named in the fixture source
  club text NOT NULL,
  competition text NOT NULL DEFAULT 'Premier League',
  season text NOT NULL,
  -- Stable id from the source feed, unique within a season
  match_number integer NOT NULL,
  round_number integer,
  kickoff_utc timestamptz NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  opponent text NOT NULL,
  is_home boolean NOT NULL,
  venue text NOT NULL DEFAULT '',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate, season, competition, match_number)
);

-- Fixtures move: every kickoff or venue change is recorded so the desk can see
-- what shifted since they last looked
CREATE TABLE public.fixture_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id uuid NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  corporate text NOT NULL,
  field text NOT NULL,
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corporate users read own fixtures"
ON public.fixtures FOR SELECT
TO authenticated
USING (corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Admins read all fixtures"
ON public.fixtures FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Corporate users read own fixture changes"
ON public.fixture_changes FOR SELECT
TO authenticated
USING (corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Admins read all fixture changes"
ON public.fixture_changes FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Writes are service-role only (the fixtures-sync function)

CREATE INDEX idx_fixtures_desk_kickoff ON public.fixtures (corporate, kickoff_utc);
CREATE INDEX idx_fixture_changes_desk ON public.fixture_changes (corporate, detected_at DESC);

-- Weekly sync: Mondays 06:15 UTC. Reuses the service_role key already stored in
-- vault for the email queue job. Wrapped so the migration still applies cleanly
-- if pg_cron or the vault secret is not present; if it is skipped, schedule the
-- job through the Supabase tooling instead.
-- The job reads the key from vault when it runs, so nothing secret is stored
-- in the job definition itself.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: schedule fixtures-sync-weekly separately';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
  ) THEN
    RAISE NOTICE 'service role key not in vault: schedule fixtures-sync-weekly separately';
    RETURN;
  END IF;

  PERFORM cron.unschedule('fixtures-sync-weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fixtures-sync-weekly');

  PERFORM cron.schedule(
    'fixtures-sync-weekly',
    '15 6 * * 1',
    $job$
    SELECT net.http_post(
      url := 'https://mzqpvnxtwshjcyzaipea.supabase.co/functions/v1/fixtures-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key' LIMIT 1
        )
      ),
      body := '{"source":"cron"}'::jsonb
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule fixtures-sync-weekly: %', SQLERRM;
END $$;