-- Apexia VIP: platform objects a public-schema dump cannot carry.
-- Run this FIRST on a brand new project, before schema.sql.
-- Nothing here touches the live project.

-- ------------------------------------------------------------
-- 1. Extensions
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- ------------------------------------------------------------
-- 2. Email queues (pgmq)
-- ------------------------------------------------------------
DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ------------------------------------------------------------
-- 3. Storage buckets
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('vcard', 'vcard', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Storage policies (final state, after the July 2026 tightening)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Service role manages vcard files" ON storage.objects;
CREATE POLICY "Service role manages vcard files"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'vcard')
WITH CHECK (bucket_id = 'vcard');

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Members can upload own avatar" ON storage.objects;
CREATE POLICY "Members can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Members can replace own avatar" ON storage.objects;
CREATE POLICY "Members can replace own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- 5. Vault secret used by every scheduled job
--    Replace the placeholder with the NEW project's service_role key.
-- ------------------------------------------------------------
-- SELECT vault.create_secret('<new-project-service-role-key>', 'email_queue_service_role_key', 'Service role key for queue and cron callbacks');

-- ------------------------------------------------------------
-- 6. Scheduled jobs
--    Replace every mzqpvnxtwshjcyzaipea URL with the NEW project ref
--    before running this section.
--    'process-email-queue' is NOT here: it was created outside the
--    migrations by a setup tool. Capture it from the live project with
--      SELECT jobname, schedule, command FROM cron.job;
--    and add it below before cutover.
-- ------------------------------------------------------------
-- booking-watch
SELECT cron.schedule(
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

-- driver-job-reports
SELECT cron.schedule(
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

-- driver-timesheet-daily
SELECT cron.schedule(
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

-- driver-timesheet-weekly
SELECT cron.schedule(
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

-- fixtures-sync-weekly
SELECT cron.schedule(
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
