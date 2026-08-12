-- Corporate travel desks (first partner: MCFC)

ALTER TABLE public.profiles ADD COLUMN corporate text;
ALTER TABLE public.bookings ADD COLUMN corporate text;

CREATE TABLE public.corporate_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate text NOT NULL,
  name text NOT NULL,
  grp text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corporate_passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corporate users read own passenger list"
ON public.corporate_passengers FOR SELECT
TO authenticated
USING (
  active AND corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "Admins read all corporate passengers"
ON public.corporate_passengers FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Writes are service-role only (managed via admin tooling)

CREATE INDEX idx_corporate_passengers ON public.corporate_passengers (corporate, grp, sort);

-- Seed: MCFC first team (2026-27, as of 6 Aug 2026), management, executives
INSERT INTO public.corporate_passengers (corporate, name, grp, sort) VALUES
('mcfc', 'Gianluigi Donnarumma', 'First Team', 1),
('mcfc', 'Marcus Bettinelli', 'First Team', 2),
('mcfc', 'Rúben Dias', 'First Team', 3),
('mcfc', 'Marc Guéhi', 'First Team', 4),
('mcfc', 'Joško Gvardiol', 'First Team', 5),
('mcfc', 'Rayan Aït-Nouri', 'First Team', 6),
('mcfc', 'Abdukodir Khusanov', 'First Team', 7),
('mcfc', 'Vitor Reis', 'First Team', 8),
('mcfc', 'Rico Lewis', 'First Team', 9),
('mcfc', 'Max Alleyne', 'First Team', 10),
('mcfc', 'Joshua Wilson-Esbrand', 'First Team', 11),
('mcfc', 'Rodri', 'First Team', 12),
('mcfc', 'Elliot Anderson', 'First Team', 13),
('mcfc', 'Tijjani Reijnders', 'First Team', 14),
('mcfc', 'Mateo Kovačić', 'First Team', 15),
('mcfc', 'Kalvin Phillips', 'First Team', 16),
('mcfc', 'Nico González', 'First Team', 17),
('mcfc', 'Matheus Nunes', 'First Team', 18),
('mcfc', 'Phil Foden', 'First Team', 19),
('mcfc', 'Rayan Cherki', 'First Team', 20),
('mcfc', 'Claudio Echeverri', 'First Team', 21),
('mcfc', 'Nico O''Reilly', 'First Team', 22),
('mcfc', 'Jack Grealish', 'First Team', 23),
('mcfc', 'Jérémy Doku', 'First Team', 24),
('mcfc', 'Savinho', 'First Team', 25),
('mcfc', 'Antoine Semenyo', 'First Team', 26),
('mcfc', 'Jeremy Monga', 'First Team', 27),
('mcfc', 'Erling Haaland', 'First Team', 28),
('mcfc', 'Omar Marmoush', 'First Team', 29),
('mcfc', 'Enzo Maresca', 'Management', 1),
('mcfc', 'Assistant Manager', 'Management', 2),
('mcfc', 'First Team Coach', 'Management', 3),
('mcfc', 'Head of Performance', 'Management', 4),
('mcfc', 'Chief Executive', 'Executives', 1),
('mcfc', 'Director of Football', 'Executives', 2),
('mcfc', 'Club Secretary', 'Executives', 3),
('mcfc', 'Executive Guest', 'Executives', 4);
