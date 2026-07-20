
REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Public read access for vcard files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload vcard files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update vcard files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete vcard files" ON storage.objects;

CREATE POLICY "Service role manages vcard files"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'vcard')
WITH CHECK (bucket_id = 'vcard');
