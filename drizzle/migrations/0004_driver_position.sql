ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_lat double precision,
  ADD COLUMN IF NOT EXISTS driver_lng double precision,
  ADD COLUMN IF NOT EXISTS driver_position_at timestamptz;

COMMENT ON COLUMN public.bookings.driver_position_at IS
  'When our own app last reported the chauffeur position. Cleared when the job is cleared.';