-- Execute this SQL in Supabase SQL Editor to fix professor promotion
-- Go to: Supabase Dashboard > SQL Editor > New query

-- 1. Ensure professors table exists
CREATE TABLE IF NOT EXISTS professors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- 2. Enable RLS
ALTER TABLE professors ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read professors" ON professors;
DROP POLICY IF EXISTS "Allow admins to manage professors" ON professors;

-- 4. Create policy for admins to manage professors
CREATE POLICY "Allow admins to manage professors" ON professors
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

-- 5. Create policy for all users to read professors
CREATE POLICY "Allow authenticated users to read professors" ON professors
    FOR SELECT USING (auth.role() = 'authenticated');

-- 6. Ensure is_professor column exists in profiles
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'is_professor'
    ) THEN
        ALTER TABLE profiles ADD COLUMN is_professor BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Done! Professor promotion should now work.

-- 7. Fix Profiles RLS (Crucial for Login)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles" ON profiles;
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Allow everyone to read profiles (needed for login/fetching names)
CREATE POLICY "Public profiles" ON profiles
    FOR SELECT USING (true);

-- Allow users to insert their own profile (on signup)
CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

