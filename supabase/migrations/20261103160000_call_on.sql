-- Calling a chauffeur on, and hearing back that they are up.
--
-- The booking team message every chauffeur on WhatsApp before every job to
-- find out whether they are awake and moving, and then chase the ones who do
-- not answer. Faz asked for the app to do it: a nudge two hours out and
-- another at one hour, and a way for the chauffeur to answer that the office
-- can see without asking anybody anything.
--
-- Two marks rather than a count, so a nudge is never sent twice and the
-- second one still goes out when the first was missed.
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
