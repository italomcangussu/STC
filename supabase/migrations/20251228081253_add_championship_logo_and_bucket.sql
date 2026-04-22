
-- Add logo_url to championships
ALTER TABLE public.championships ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create Storage Bucket for Logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('championship-logos', 'championship-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow public access to logos
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'championship-logos' );

-- Policy to allow authenticated users to upload logos (for now, ideally admin only)
CREATE POLICY "Authenticated Upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'championship-logos' AND auth.role() = 'authenticated' );

-- Policy to allow updates
CREATE POLICY "Authenticated Update"
ON storage.objects FOR UPDATE
USING ( bucket_id = 'championship-logos' AND auth.role() = 'authenticated' );
;
