-- Exec-only PAs, exec contact details, and confirmation routing

-- A desk user can be limited to certain passenger groups. Null means the whole
-- desk, which is how every existing user stays as they are.
ALTER TABLE public.profiles ADD COLUMN corporate_groups text[];

-- Contact details and confirmation preferences per passenger
ALTER TABLE public.corporate_passengers ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE public.corporate_passengers ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE public.corporate_passengers ADD COLUMN notify_sms boolean NOT NULL DEFAULT false;
ALTER TABLE public.corporate_passengers ADD COLUMN notify_email boolean NOT NULL DEFAULT false;
-- Where a confirmation goes: the passenger, or the assistant who booked it
ALTER TABLE public.corporate_passengers
  ADD COLUMN notify_target text NOT NULL DEFAULT 'passenger'
  CHECK (notify_target IN ('passenger', 'booker'));

-- Readers only see the groups their profile allows
DROP POLICY IF EXISTS "Corporate users read own passenger list" ON public.corporate_passengers;
CREATE POLICY "Corporate users read own passenger list"
ON public.corporate_passengers FOR SELECT
TO authenticated
USING (
  active
  AND corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid())
  AND (
    (SELECT p.corporate_groups FROM public.profiles p WHERE p.id = auth.uid()) IS NULL
    OR grp = ANY ((SELECT p.corporate_groups FROM public.profiles p WHERE p.id = auth.uid()))
  )
);

-- Personal addresses follow the same scope; global addresses stay visible
DROP POLICY IF EXISTS "Corporate users read own address book" ON public.corporate_addresses;
CREATE POLICY "Corporate users read own address book"
ON public.corporate_addresses FOR SELECT
TO authenticated
USING (
  corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid())
  AND (
    passenger_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.corporate_passengers cp
      WHERE cp.id = corporate_addresses.passenger_id
        AND (
          (SELECT p.corporate_groups FROM public.profiles p WHERE p.id = auth.uid()) IS NULL
          OR cp.grp = ANY ((SELECT p.corporate_groups FROM public.profiles p WHERE p.id = auth.uid()))
        )
    )
  )
);
