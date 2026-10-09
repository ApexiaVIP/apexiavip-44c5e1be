-- Reporting a job within the hour, and a wrap up that waits for the last
-- chauffeur rather than firing on a clock.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: schedule job reports separately';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
  ) THEN
    RAISE NOTICE 'service role key not in vault: schedule job reports separately';
    RETURN;
  END IF;

  -- Every ten minutes, so a job reaches the office about half an hour after
  -- it is cleared, which is the window a chauffeur has to take back a clear
  PERFORM cron.unschedule('driver-job-reports')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'driver-job-reports');

  PERFORM cron.schedule(
    'driver-job-reports',
    '*/10 * * * *',
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
      body := '{"mode":"cleared","source":"cron"}'::jsonb
    );
    $job$
  );

  -- The day's wrap up is attempted every half hour from eleven at night until
  -- five in the morning. It sends once, and only when nobody is still working,
  -- so a late finish still gets its own day's sheet.
  PERFORM cron.unschedule('driver-timesheet-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'driver-timesheet-daily');

  PERFORM cron.schedule(
    'driver-timesheet-daily',
    '0,30 23,0,1,2,3,4 * * *',
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule job reports: %', SQLERRM;
END $$;
