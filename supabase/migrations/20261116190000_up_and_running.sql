-- Being up, as a thing about the chauffeur rather than about a job.
--
-- Saying "I am up" started out attached to a booking, because it began life
-- as an answer to the office calling a chauffeur on before a particular job.
-- That is not what it means to the people using it. Signing on says the
-- shift has started; being up says they are awake, out, and able to work,
-- and it is true of the chauffeur for the whole shift rather than of any one
-- journey. So it belongs on the shift, and it is the first thing the screen
-- asks for once they have signed on.
ALTER TABLE public.driver_shifts
  ADD COLUMN IF NOT EXISTS up_at timestamptz;

COMMENT ON COLUMN public.driver_shifts.up_at IS
  'When the chauffeur said they were up and running. Null until they do.';
