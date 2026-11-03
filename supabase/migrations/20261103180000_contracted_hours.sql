-- What a chauffeur is contracted to work in a month.
--
-- The hours themselves have been recorded since the shift clock went in, and
-- a timesheet already goes to accounts daily and weekly. What nobody held
-- anywhere was the figure those hours are meant to add up to, so neither the
-- chauffeur nor the office could say whether anyone was short.
--
-- Null means nobody has set one. That is different from zero, and the screens
-- say so rather than reporting a chauffeur as having worked 92 hours of none.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contracted_hours_monthly integer;

COMMENT ON COLUMN public.profiles.contracted_hours_monthly IS
  'Hours per month this chauffeur is contracted to. Null means not set.';
