-- The chauffeur's own position, reported by our app.
--
-- Until now the map could only show where the booking system last said the
-- car was, which is refreshed rarely enough that a passenger watching sees a
-- car that does not move. Our own app is already on the chauffeur's phone and
-- signed in, so it reports its position while a job is running.
--
-- Only while a job is running: the position is cleared the moment the job is
-- cleared, so we never hold a chauffeur's whereabouts once they are off the
-- job, and nothing is recorded when they are off duty.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_lat double precision,
  ADD COLUMN IF NOT EXISTS driver_lng double precision,
  ADD COLUMN IF NOT EXISTS driver_position_at timestamptz;

COMMENT ON COLUMN public.bookings.driver_position_at IS
  'When our own app last reported the chauffeur position. Cleared when the job is cleared.';
