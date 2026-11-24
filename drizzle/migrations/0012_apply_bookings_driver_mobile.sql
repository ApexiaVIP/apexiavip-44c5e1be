ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_mobile text;

COMMENT ON COLUMN public.bookings.driver_mobile IS
  'The chauffeur''s number as Dispatch gave it, kept so a printed schedule has it before the job is dispatched and when Dispatch is held back. Falls back to the chauffeur profile phone where we have one.';
