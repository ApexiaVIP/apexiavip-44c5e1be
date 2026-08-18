-- Exec-only PAs, exec contact details, and confirmation routing.
-- Written to be safe to run again if an earlier attempt stopped part way.

-- A desk user can be limited to certain passenger groups. Null means the whole
-- desk, which is how every existing user stays as they are.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS corporate_groups text[];

-- Contact details and confirmation preferences per passenger
ALTER TABLE public.corporate_passengers ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE public.corporate_passengers ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE public.corporate_passengers ADD COLUMN IF NOT EXISTS notify_sms boolean NOT NULL DEFAULT false;
ALTER TABLE public.corporate_passengers ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT false;
-- Where a confirmation goes: the passenger, or the assistant who booked it
ALTER TABLE public.corporate_passengers
  ADD COLUMN IF NOT EXISTS notify_target text NOT NULL DEFAULT 'passenger';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corporate_passengers_notify_target_check'
  ) THEN
    ALTER TABLE public.corporate_passengers
      ADD CONSTRAINT corporate_passengers_notify_target_check
      CHECK (notify_target IN ('passenger', 'booker'));
  END IF;
END $$;

-- Whether a user may see a given passenger group. Null groups means all of
-- them. Kept as a function so the policies stay readable, and because = ANY
-- needs an array expression rather than a sub-select.
CREATE OR REPLACE FUNCTION public.desk_group_allowed(_user_id uuid, _grp text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.corporate_groups IS NULL OR _grp = ANY (p.corporate_groups)
  FROM public.profiles p
  WHERE p.id = _user_id
$$;

-- The policies below call this as the signed-in user, so authenticated needs
-- EXECUTE. Nobody signed out has any business calling it.
REVOKE EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) FROM anon';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) TO authenticated;

-- Readers only see the groups their profile allows
DROP POLICY IF EXISTS "Corporate users read own passenger list" ON public.corporate_passengers;
CREATE POLICY "Corporate users read own passenger list"
ON public.corporate_passengers FOR SELECT
TO authenticated
USING (
  active
  AND corporate = (SELECT p.corporate FROM public.profiles p WHERE p.id = auth.uid())
  AND public.desk_group_allowed(auth.uid(), grp)
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
        AND public.desk_group_allowed(auth.uid(), cp.grp)
    )
  )
);
