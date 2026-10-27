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
-- Squad and staff are taken from the club's own squad page, read on 27 October
-- 2026, with squad numbers kept as the sort order so the directory reads as
-- the team sheet does. Players the club marks as out on loan for this season
-- are left off, since they travel with another club; a loan the other way is
-- included, because she travels with City. Names are spelled as the club
-- spells them, so the desk and the chauffeur read the same thing. The travel
-- contact stays a role until the club names the person.
--
-- Anyone who turns out not to travel can be taken off in the portal, which
-- keeps their journeys, and anyone missing can be added there.
--
-- Safe to run again.

DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT * FROM (VALUES
      ('Eartha Cumings', 'First Team', 1),
      ('Risa Shimizu', 'First Team', 2),
      ('Jade Rose', 'First Team', 4),
      ('Alex Greenwood', 'First Team', 5),
      ('Grace Clinton', 'First Team', 6),
      ('Beth Mead', 'First Team', 7),
      ('Mary Fowler', 'First Team', 8),
      ('Bunny Shaw', 'First Team', 9),
      ('Vivianne Miedema', 'First Team', 10),
      ('Lauren Hemp', 'First Team', 11),
      ('Laura Wienroither', 'First Team', 13),
      ('Anna Moorhouse', 'First Team', 14),
      ('Sam Coffey', 'First Team', 17),
      ('Kerstin Casparij', 'First Team', 18),
      ('Laura Blindkilde Brown', 'First Team', 19),
      ('Aoba Fujino', 'First Team', 20),
      ('Niamh Charles', 'First Team', 21),
      ('Sydney Lohmann', 'First Team', 22),
      ('Iman Beney', 'First Team', 24),
      ('Yui Hasegawa', 'First Team', 25),
      ('Rebecca Knaak', 'First Team', 27),
      ('Gracie Prior', 'First Team', 28),
      ('Ayaka Yamashita', 'First Team', 31),
      ('Carlotta Wamser', 'First Team', 37),
      ('Amelia Oldroyd', 'First Team', 43),
      ('Sacha Lewis', 'First Team', 47),
      ('Mayzee Davies', 'First Team', 53),
      ('Andree Jeglertz', 'Management', 1),
      ('Anders Bengtsson', 'Management', 2),
      ('Diego Restrepo', 'Management', 3),
      ('Lauren Smith', 'Management', 4),
      ('Team Operations Manager', 'Management', 5)
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
--     SET corporate = 'mcfcw', corporate_groups = NULL
--   WHERE email = 'name@mancity.com';
--
-- corporate_groups NULL means the whole of their own desk, which for this
-- desk is the women's squad and staff and nothing else. Setting corporate to
-- 'mcfcw' is what keeps them out of the men's desk, and keeps the men's desk
-- users out of theirs. Nobody on the men's desk needs changing.