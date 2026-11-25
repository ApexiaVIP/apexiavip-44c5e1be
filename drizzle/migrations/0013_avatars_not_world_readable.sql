DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "A member reads their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "A primary member reads their family's avatars" ON storage.objects;
DROP POLICY IF EXISTS "An administrator reads any avatar" ON storage.objects;

CREATE POLICY "A member reads their own avatar"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "A primary member reads their family's avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id::text = (storage.foldername(name))[1]
      AND p.primary_member_id = auth.uid()
  )
);

CREATE POLICY "An administrator reads any avatar"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.has_role(auth.uid(), 'admin')
);

COMMENT ON POLICY "A member reads their own avatar" ON storage.objects IS
  'Avatars: own, family group, or administrator. Never anonymous. 25 Nov 2026.';