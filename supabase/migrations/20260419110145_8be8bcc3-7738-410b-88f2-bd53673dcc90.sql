-- Ensure campaign-materials storage bucket exists with correct config
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-materials', 'campaign-materials', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies on storage.objects for campaign-materials bucket

-- Authenticated users can read campaign material files
DROP POLICY IF EXISTS "Authenticated users can read campaign materials" ON storage.objects;
CREATE POLICY "Authenticated users can read campaign materials"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'campaign-materials');

-- Authenticated users can upload campaign material files
DROP POLICY IF EXISTS "Authenticated users can upload campaign materials" ON storage.objects;
CREATE POLICY "Authenticated users can upload campaign materials"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'campaign-materials');

-- Authenticated users can update campaign material files
DROP POLICY IF EXISTS "Authenticated users can update campaign materials" ON storage.objects;
CREATE POLICY "Authenticated users can update campaign materials"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'campaign-materials');

-- Authenticated users can delete campaign material files
DROP POLICY IF EXISTS "Authenticated users can delete campaign materials" ON storage.objects;
CREATE POLICY "Authenticated users can delete campaign materials"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'campaign-materials');