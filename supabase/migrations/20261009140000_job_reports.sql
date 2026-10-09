-- Reporting a job to the back office as it finishes, rather than only at the
-- end of the day, and letting a chauffeur take back a clear they did not mean.

-- When the office was told about this job, so it is reported once and no
-- sooner than the chauffeur has had a chance to undo a mistaken clear
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS job_report_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_cleared_unreported_idx
  ON public.bookings (driver_status_at)
  WHERE driver_status = 'clear' AND job_report_sent_at IS NULL;

-- Which summaries have already gone out. The day's wrap up waits for the last
-- chauffeur to finish, which can be after midnight, so it cannot simply fire
-- on a clock and has to remember whether it has run.
CREATE TABLE IF NOT EXISTS public.timesheet_runs (
  day date NOT NULL,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, kind)
);

ALTER TABLE public.timesheet_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.timesheet_runs IS
  'One row per summary sent, so a wrap up that waits for the last chauffeur still only goes once';
