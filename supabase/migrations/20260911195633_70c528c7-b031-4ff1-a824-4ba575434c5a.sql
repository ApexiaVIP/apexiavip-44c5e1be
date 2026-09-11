ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_platform text,
  ADD COLUMN IF NOT EXISTS app_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS app_nudged_at timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_app_platform_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_app_platform_check
  CHECK (app_platform IS NULL OR app_platform IN ('ios', 'android'));

-- Members cannot declare these about themselves (and closes a gap: corporate
-- desk access was not in the guarded list, so a member could self-tag)
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id := OLD.id;
    NEW.phone := OLD.phone;
    NEW.status := OLD.status;
    NEW.primary_member_id := OLD.primary_member_id;
    NEW.invited_by := OLD.invited_by;
    NEW.created_at := OLD.created_at;
    -- Desk membership is granted by ops, never self-declared
    NEW.corporate := OLD.corporate;
    NEW.corporate_groups := OLD.corporate_groups;
    NEW.app_platform := OLD.app_platform;
    NEW.app_last_seen_at := OLD.app_last_seen_at;
    NEW.app_nudged_at := OLD.app_nudged_at;
  END IF;
  RETURN NEW;
END;
$$;