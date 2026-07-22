-- Member profiles (self-completed) + family membership

ALTER TABLE public.profiles
  ADD COLUMN address_line1 text NOT NULL DEFAULT '',
  ADD COLUMN address_line2 text NOT NULL DEFAULT '',
  ADD COLUMN town text NOT NULL DEFAULT '',
  ADD COLUMN postcode text NOT NULL DEFAULT '',
  ADD COLUMN country text NOT NULL DEFAULT 'United Kingdom',
  ADD COLUMN avatar_url text NOT NULL DEFAULT '',
  ADD COLUMN profile_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN primary_member_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Family members awaiting admin approval carry the 'pending' status
ALTER TABLE public.profiles DROP CONSTRAINT profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'revoked', 'pending'));

-- Members may edit their own profile details from the app
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ...but the sensitive columns are preserved unless the service role writes
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_profile_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- Primary members can see their own family group
CREATE POLICY "Members can read own family"
ON public.profiles FOR SELECT
TO authenticated
USING (primary_member_id = auth.uid());

-- Profile pictures
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Members can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Members can replace own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
