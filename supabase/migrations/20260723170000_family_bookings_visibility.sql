-- Primary members can see (not touch) their family members' bookings

CREATE OR REPLACE FUNCTION public.is_family_member_of(_member uuid, _primary uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _member AND primary_member_id = _primary
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_family_member_of(uuid, uuid) TO authenticated;

CREATE POLICY "Primary members can read family bookings"
ON public.bookings FOR SELECT
TO authenticated
USING (public.is_family_member_of(user_id, auth.uid()));
