-- Some journeys we cannot promise at the moment of booking: inside two hours,
-- or a pickup between midnight and 6am. Those are taken but flagged, so the
-- member is told plainly and the office knows to confirm or decline.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS subject_to_availability boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declined_reason text;

COMMENT ON COLUMN public.bookings.subject_to_availability IS
  'Taken but not promised: booked within two hours of pickup, or a pickup between midnight and 6am';
COMMENT ON COLUMN public.bookings.declined_reason IS
  'Why the office could not cover the journey; shown to nobody but kept for the record';