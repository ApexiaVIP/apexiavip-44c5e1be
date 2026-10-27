-- The women's travel desk, as its own desk ('mcfcw') rather than a group
-- inside the men's one.
--
-- Passengers, the address book, bookings and fixtures are each keyed on the
-- desk, so separating at this level means neither side can see the other's
-- people, journeys, saved addresses or fixture list, with no new policy to
-- get right. Nothing belonging to 'mcfc' is read or changed here, so the
-- existing desk users keep exactly what they have today.
--
-- The group names match the men's desk on purpose: the portal orders its tabs
-- by name and needs no change to show them.
--
-- Safe to run again.

DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT * FROM (VALUES
      -- Staff stand in by role until the club gives us names, as the men's
      -- desk did. Renaming one in the portal keeps its journeys.
      ('Manager', 'Management', 1),
      ('Assistant Manager', 'Management', 2),
      ('First Team Coach', 'Management', 3),
      ('Head of Performance', 'Management', 4),
      ('Team Operations Manager', 'Management', 5)
      -- Squad goes here, as ('Player Name', 'First Team', n)
    ) AS v(name, grp, sort)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.corporate_passengers
      WHERE corporate = 'mcfcw' AND name = entry.name
    ) THEN
      INSERT INTO public.corporate_passengers (corporate, name, grp, sort)
        VALUES ('mcfcw', entry.name, entry.grp, entry.sort);
    END IF;
  END LOOP;
END $$;

-- Granting a person access is deliberately not done here, because it names a
-- real account and belongs with the invitation rather than with the schema.
-- Once the user has signed in once, for each of them:
--
--   UPDATE public.profiles
--      SET corporate = 'mcfcw', corporate_groups = NULL
--    WHERE email = 'name@mancity.com';
--
-- corporate_groups NULL means the whole of their own desk, which for this
-- desk is the women's squad and staff and nothing else. Setting corporate to
-- 'mcfcw' is what keeps them out of the men's desk, and keeps the men's desk
-- users out of theirs.
