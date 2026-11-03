ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS called_on_2h_at timestamptz,
  ADD COLUMN IF NOT EXISTS called_on_1h_at timestamptz,
  ADD COLUMN IF NOT EXISTS chauffeur_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS chauffeur_ack text;

COMMENT ON COLUMN public.bookings.called_on_2h_at IS
  'When the chauffeur was called on two hours before the collection.';

COMMENT ON COLUMN public.bookings.called_on_1h_at IS
  'When the chauffeur was called on an hour before the collection.';

COMMENT ON COLUMN public.bookings.chauffeur_ack_at IS
  'When the chauffeur answered the call on. Cleared by nothing: it is a record.';

COMMENT ON COLUMN public.bookings.chauffeur_ack IS
  'What they answered: awake, or on_the_way.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contracted_hours_monthly integer;

COMMENT ON COLUMN public.profiles.contracted_hours_monthly IS
  'Hours per month this chauffeur is contracted to. Null means not set.';