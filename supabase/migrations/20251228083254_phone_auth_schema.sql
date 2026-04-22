
-- Add age column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;

-- Create access_requests table
CREATE TABLE IF NOT EXISTS public.access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Policies for access_requests
-- Allow public insert (for login attempts)
CREATE POLICY "Public Insert"
ON public.access_requests FOR INSERT
WITH CHECK (true);

-- Allow admins to view all (using the is_admin function we created earlier)
CREATE POLICY "Admin Select"
ON public.access_requests FOR SELECT
USING ( is_admin() );

-- Allow admins to update (approve/reject)
CREATE POLICY "Admin Update"
ON public.access_requests FOR UPDATE
USING ( is_admin() );

-- Allow admins to delete
CREATE POLICY "Admin Delete"
ON public.access_requests FOR DELETE
USING ( is_admin() );
;
