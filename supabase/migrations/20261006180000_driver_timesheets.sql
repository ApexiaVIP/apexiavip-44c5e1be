-- Timesheets for the back office.
--
-- One email per chauffeur each evening covering when they signed on and off,
-- the jobs they worked and every step they pressed, then one summary for the
-- whole fleet on a Friday. Hours come from driver_shifts and the history from
-- booking_waypoints, both of which are ours: Dispatch has no notion of a shift.

-- Shifts are read a day and a week at a time
CREATE INDEX IF NOT EXISTS driver_shifts_started_idx
  ON public.driver_shifts (started_at);

CREATE INDEX IF NOT EXISTS booking_waypoints_driver_recorded_idx
  ON public.booking_waypoints (driver_id, recorded_at);

-- Both runs fire at 23:30 and 23:40 UTC. The function reports the UK day that
-- finished three hours earlier, which lands on the right day whether the
-- clocks are on BST or GMT, so these times never need changing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: schedule driver timesheets separately';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
  ) THEN
    RAISE NOTICE 'service role key not in vault: schedule driver timesheets separately';
    RETURN;
  END IF;

  PERFORM cron.unschedule('driver-timesheet-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'driver-timesheet-daily');

  PERFORM cron.schedule(
    'driver-timesheet-daily',
    '30 23 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://mzqpvnxtwshjcyzaipea.supabase.co/functions/v1/driver-timesheets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key' LIMIT 1
        )
      ),
      body := '{"mode":"daily","source":"cron"}'::jsonb
    );
    $job$
  );

  PERFORM cron.unschedule('driver-timesheet-weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'driver-timesheet-weekly');

  -- Day 5 is Friday
  PERFORM cron.schedule(
    'driver-timesheet-weekly',
    '40 23 * * 5',
    $job$
    SELECT net.http_post(
      url := 'https://mzqpvnxtwshjcyzaipea.supabase.co/functions/v1/driver-timesheets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key' LIMIT 1
        )
      ),
      body := '{"mode":"weekly","source":"cron"}'::jsonb
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule driver timesheets: %', SQLERRM;
END $$;
