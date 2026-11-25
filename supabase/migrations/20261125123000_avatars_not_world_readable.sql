-- Stop every avatar being readable by anybody who asks.
--
-- The bucket was created public, with a SELECT policy of
-- "bucket_id = 'avatars'" and no role named on it. That grants read to every
-- role, anon included, and the anon key ships inside the browser bundle. So
-- any stranger could list the bucket and sign a URL for any member's or
-- chauffeur's photograph. Confirmed against production on 25 November 2026:
-- an anonymous list of the bucket returned its contents.
--
-- The bucket itself was made private at some point in the dashboard, and the
-- app moved to signed URLs, but the policy never followed. Half a fix is why
-- this sat open.
--
-- The bucket's own public flag is NOT set here, and cannot be: the migration
-- tool refuses any SQL that writes to storage.buckets and rejects the whole
-- file for it. It reads public = false live today, so there is nothing to
-- change, but that half is held in the dashboard rather than in this repo.
-- It matters, because a public bucket serves its objects through a path that
-- skips these policies entirely. If anybody ever flips it back, the rules
-- below stop applying to reads.
--
-- Who is allowed to see a photograph, taken from the three places the app
-- actually renders one:
--   the member's own, on their profile
--   a primary member's family group, listed on their profile
--   any member's, by an administrator, on the admin screen
-- Nobody else, and never anonymously.

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

-- The folder is the member's own id, so the question is whether that member
-- belongs to the family group of whoever is asking. profiles carries its own
-- policy letting a primary member read their family, so a row they may not
-- see makes this false and the photograph stays hidden. It fails closed.
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
