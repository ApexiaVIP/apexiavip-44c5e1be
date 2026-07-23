ALTER TABLE public.bookings
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN reference text UNIQUE,
  ADD COLUMN assigned_booking_id integer,
  ADD COLUMN assigned_reference text,
  ADD COLUMN collection_at timestamptz,
  ADD COLUMN pickup jsonb,
  ADD COLUMN dropoff jsonb,
  ADD COLUMN status text NOT NULL DEFAULT 'Requested',
  ADD COLUMN status_checked_at timestamptz;

CREATE INDEX idx_bookings_user_collection ON public.bookings (user_id, collection_at DESC);

CREATE POLICY "Members can read own bookings"
ON public.bookings FOR SELECT
TO authenticated
USING (user_id = auth.uid());