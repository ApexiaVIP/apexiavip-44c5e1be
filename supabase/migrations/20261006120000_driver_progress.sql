-- The chauffeur's own progress through a job.
--
-- Two problems this fixes. Dispatch is asked who is driving, and a hiccup
-- there used to empty a chauffeur's screen in the middle of a shift, so the
-- assignment is now kept here the first time it is seen. The office also
-- retimes jobs in Dispatch without telling us, and a retimed job must not
-- drop out of the chauffeur's day either.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS driver_status text,
  ADD COLUMN IF NOT EXISTS driver_status_at timestamptz,
  -- The last moment we texted the passenger about from the chauffeur's own
  -- buttons, so the Dispatch watcher cannot text them about it a second time
  ADD COLUMN IF NOT EXISTS driver_moment text;

CREATE INDEX IF NOT EXISTS bookings_driver_idx
  ON public.bookings (driver_id, collection_at DESC);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_driver_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_driver_status_check
  CHECK (
    driver_status IS NULL
    OR driver_status IN ('en_route', 'arrived', 'pob', 'waiting', 'clear')
  );

-- The steps a chauffeur actually works through, and where each one happened
ALTER TABLE public.booking_waypoints
  DROP CONSTRAINT IF EXISTS booking_waypoints_kind_check;
ALTER TABLE public.booking_waypoints
  ADD CONSTRAINT booking_waypoints_kind_check
  CHECK (
    kind IN ('en_route', 'arrived', 'pob', 'waiting', 'clear', 'set_down', 'collected', 'note')
  );

ALTER TABLE public.booking_waypoints
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

COMMENT ON COLUMN public.bookings.driver_status IS
  'Where the chauffeur has got to, from their own app. Dispatch is not updated by it.';
