-- Corporate address book + real executive roster for the MCFC desk

CREATE TABLE public.corporate_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate text NOT NULL,
  label text NOT NULL,
  address text NOT NULL,
  -- Linked passenger makes this a personal address; null = global (whole desk)
  passenger_id uuid REFERENCES public.corporate_passengers(id) ON DELETE CASCADE,
  -- Match-day front-entrance drop-off available at this address
  grey_tarmac boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.corporate_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corporate users read own address book"
ON public.corporate_addresses FOR SELECT
TO authenticated
USING (
  corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "Admins read all corporate addresses"
ON public.corporate_addresses FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Writes go through the corporate-booking function (service role)

CREATE INDEX idx_corporate_addresses ON public.corporate_addresses (corporate, passenger_id);

-- Replace the placeholder executives with the real board and leadership
DELETE FROM public.corporate_passengers WHERE corporate = 'mcfc' AND grp = 'Executives';
INSERT INTO public.corporate_passengers (corporate, name, grp, sort) VALUES
('mcfc', 'Khaldoon Al Mubarak', 'Executives', 1),
('mcfc', 'Alberto Galassi', 'Executives', 2),
('mcfc', 'Martin Lee Edelman', 'Executives', 3),
('mcfc', 'Simon Pearce', 'Executives', 4),
('mcfc', 'Abdulla Khouri', 'Executives', 5),
('mcfc', 'John MacBeath', 'Executives', 6),
('mcfc', 'Ruigang Li', 'Executives', 7),
('mcfc', 'Ferran Soriano', 'Executives', 8),
('mcfc', 'Hugo Viana', 'Executives', 9),
('mcfc', 'Danny Wilson', 'Executives', 10),
('mcfc', 'Mike Summerbee', 'Executives', 11);

-- Starter global addresses for the desk
INSERT INTO public.corporate_addresses (corporate, label, address, grey_tarmac) VALUES
('mcfc', 'Etihad Stadium - Main Reception', 'Etihad Stadium, Etihad Campus, Manchester M11 3FF', false),
('mcfc', 'Etihad Stadium - Match Day', 'Etihad Stadium, Colin Bell Entrance, Manchester M11 3FF', true),
('mcfc', 'Etihad Campus - CFA Academy', 'City Football Academy, 400 Ashton New Road, Manchester M11 4TQ', false),
('mcfc', 'Manchester Airport - Terminal 3', 'Manchester Airport Terminal 3, Manchester M90 1QX', false);
