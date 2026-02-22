
-- Create a public bucket for hosting vcard files
INSERT INTO storage.buckets (id, name, public)
VALUES ('vcard', 'vcard', true);

-- Allow public read access
CREATE POLICY "Public read access for vcard files"
ON storage.objects FOR SELECT
USING (bucket_id = 'vcard');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload vcard files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'vcard');

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update vcard files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'vcard');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete vcard files"
ON storage.objects FOR DELETE
USING (bucket_id = 'vcard');
