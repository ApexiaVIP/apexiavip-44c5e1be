-- The RLS policies on corporate_passengers and corporate_addresses call
-- desk_group_allowed as the signed-in user, so the authenticated role must be
-- able to execute it. EXECUTE was revoked from PUBLIC and anon to keep it away
-- from signed-out callers; this makes sure that did not take authenticated with
-- it, which would fail every passenger query with "permission denied".
-- Safe to run whether or not the grant is already in place.
GRANT EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.desk_group_allowed(uuid, text) FROM anon';
  END IF;
END $$;
