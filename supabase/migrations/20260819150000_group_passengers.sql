-- Some entries stand for a party rather than one person (the chairman's guests,
-- family, VVIP guests). Booking one asks how many are travelling, and they take
-- that many seats.
ALTER TABLE public.corporate_passengers
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

-- Add the club's party entries, or mark them if an assistant added them already
DO $$
DECLARE
  entry record;
  next_sort integer;
BEGIN
  FOR entry IN
    SELECT * FROM (VALUES ('KAM Guests'), ('KAM Family'), ('VVIP Guests')) AS v(name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.corporate_passengers
      WHERE corporate = 'mcfc' AND name = entry.name
    ) THEN
      UPDATE public.corporate_passengers
        SET is_group = true, active = true, grp = 'Executives'
        WHERE corporate = 'mcfc' AND name = entry.name;
    ELSE
      SELECT coalesce(max(sort), 0) + 1 INTO next_sort
        FROM public.corporate_passengers
        WHERE corporate = 'mcfc' AND grp = 'Executives';
      INSERT INTO public.corporate_passengers (corporate, name, grp, sort, is_group)
        VALUES ('mcfc', entry.name, 'Executives', next_sort, true);
    END IF;
  END LOOP;
END $$;

-- The placeholder from the first seed is the same kind of entry
UPDATE public.corporate_passengers
  SET is_group = true
  WHERE corporate = 'mcfc' AND name = 'Executive Guest';

-- Requested by the club: no longer travelling with the desk
UPDATE public.corporate_passengers
  SET active = false
  WHERE corporate = 'mcfc' AND name = 'Ruigang Li';
