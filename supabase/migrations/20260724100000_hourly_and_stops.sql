-- Hourly (as-directed) hire and multi-stop journeys

ALTER TABLE public.bookings
  ADD COLUMN journey_type text NOT NULL DEFAULT 'destination'
    CHECK (journey_type IN ('destination', 'hourly')),
  ADD COLUMN as_directed_hours integer,
  ADD COLUMN via jsonb;
