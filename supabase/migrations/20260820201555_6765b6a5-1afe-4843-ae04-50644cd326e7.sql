-- Tracks which status a passenger has already been told about, so a booking
-- watched every few minutes only ever texts on a real change.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notified_status text;

-- The watcher only looks at bookings near their collection time
CREATE INDEX IF NOT EXISTS idx_bookings_collection_watch
  ON public.bookings (collection_at)
  WHERE status IS DISTINCT FROM 'Cancelled';

-- Watch active bookings every 5 minutes and text the passenger when the
-- chauffeur is assigned, sets off, or arrives. Reads the service key from
-- vault when it runs, as the other scheduled jobs do.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: schedule booking-watch separately';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
  ) THEN
    RAISE NOTICE 'service role key not in vault: schedule booking-watch separately';
    RETURN;
  END IF;

  PERFORM cron.unschedule('booking-watch')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'booking-watch');

  PERFORM cron.schedule(
    'booking-watch',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://mzqpvnxtwshjcyzaipea.supabase.co/functions/v1/booking-watch',
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
  RAISE NOTICE 'Could not schedule booking-watch: %', SQLERRM;
END $$;