-- Somewhere for a scheduled job to say it actually worked.
--
-- pg_cron records that it sent a request, not what came back, so three
-- functions answered 401 on every run for hours while the scheduler showed
-- green. Nothing recorded success, so nothing could notice its absence.
-- Each job now stamps this table when it completes, and the health endpoint
-- reads it. The health endpoint deliberately shares no secret with the jobs
-- it watches, so the failure that hid this cannot also hide the alarm.

CREATE TABLE IF NOT EXISTS public.job_heartbeats (
  job TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail JSONB
);

ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;

-- Only the service role writes these, and only the health function reads
-- them, which it does with the service role too. No member has any business
-- here, so no policy grants anyone else access.
DROP POLICY IF EXISTS "Service role manages job heartbeats" ON public.job_heartbeats;
CREATE POLICY "Service role manages job heartbeats"
ON public.job_heartbeats FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON public.job_heartbeats TO service_role;

-- A starting line, not a claim that anything has run.
--
-- Without these rows the health endpoint reports every job overdue from the
-- moment it is deployed, and stays red for over a week until the weekly sheet
-- and the fixture sync have each had a turn. An alarm that is red on arrival
-- teaches everyone to ignore it, so each job starts its clock here and
-- overwrites this the first time it genuinely finishes. From now on, overdue
-- means a job has missed its window rather than simply never having had one.
INSERT INTO public.job_heartbeats (job, last_success_at, detail)
VALUES
  ('booking-watch', now(), '{"note":"starting line, not a run"}'),
  ('driver-timesheets:cleared', now(), '{"note":"starting line, not a run"}'),
  ('driver-timesheets:daily', now(), '{"note":"starting line, not a run"}'),
  ('driver-timesheets:weekly', now(), '{"note":"starting line, not a run"}'),
  ('fixtures-sync', now(), '{"note":"starting line, not a run"}')
ON CONFLICT (job) DO NOTHING;
