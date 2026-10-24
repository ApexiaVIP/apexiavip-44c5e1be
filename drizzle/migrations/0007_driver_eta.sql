-- When the car is actually due, as the chauffeur's own navigation sees it.
--
-- The driving screen works out a traffic-aware arrival time to navigate by,
-- and we were throwing it away. A passenger who can see the car moving still
-- rings to ask how long, so the number the chauffeur is driving to is the
-- number the passenger should be reading.
--
-- Cleared with the position when the job is cleared, so we hold no estimate
-- for a journey that has finished.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_eta_at timestamptz;

COMMENT ON COLUMN public.bookings.driver_eta_at IS
  'Arrival time from the chauffeur app navigation. Cleared when the job is cleared.';