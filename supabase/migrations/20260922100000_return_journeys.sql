-- A return journey is a second booking in its own right (its own car, its own
-- Dispatch job), linked back to the outbound leg so the member sees them as a
-- pair and we can tell the office they belong together.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS return_of text;

CREATE INDEX IF NOT EXISTS bookings_return_of_idx
  ON public.bookings (return_of)
  WHERE return_of IS NOT NULL;

COMMENT ON COLUMN public.bookings.return_of IS
  'Reference of the outbound booking this is the return leg of; null for a one-way or outbound booking';
