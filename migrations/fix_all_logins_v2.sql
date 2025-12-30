-- FIX LOGIN V2: ID SYNCHRONIZATION
-- This script repairs logins where the Auth ID does NOT match the Profile ID.
-- It is critical for users who have historical data (reservations, rankings) linked to their Profile ID.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Temporarily drop FK to allow Auth ID updates/deletions
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $$
DECLARE
    r RECORD;
    clean_phone TEXT;
    new_pass TEXT;
    auth_user_id UUID;
    auth_email TEXT;
BEGIN
    -- Loop through all active profiles with phone numbers
    FOR r IN SELECT * FROM public.profiles WHERE phone IS NOT NULL AND phone != '' LOOP
        
        clean_phone := regexp_replace(r.phone, '\D', '', 'g');
        new_pass := 'sct' || clean_phone || '2024';
        
        -- Check if an Auth User exists with this Email
        SELECT id, email INTO auth_user_id, auth_email FROM auth.users WHERE email = r.email;
        
        -- SCENARIO A: Auth User exists but ID MISMATCH
        IF FOUND AND auth_user_id != r.id THEN
            RAISE NOTICE 'Fixing ID mismatch for % (Profile: %, Auth: %)', r.email, r.id, auth_user_id;
            
            -- Delete the misaligned auth user
            DELETE FROM auth.users WHERE id = auth_user_id;
            
            -- Re-insert with CORRECT ID (r.id)
            INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password, 
                email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000000',
                r.id, -- FORCE SAME ID AS PROFILE
                'authenticated',
                'authenticated',
                r.email,
                crypt(new_pass, gen_salt('bf', 10)), -- Cost 10
                NOW(),
                '{"provider": "email", "providers": ["email"]}'::jsonb,
                '{}'::jsonb,
                NOW(),
                NOW()
            );
            
        -- SCENARIO B: No Auth User exists (Orphaned Profile)
        ELSIF NOT FOUND THEN
             RAISE NOTICE 'Creating missing auth user for % (ID: %)', r.email, r.id;
             
             INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password, 
                email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
                created_at, updated_at
            ) VALUES (
                '00000000-0000-0000-0000-000000000000',
                r.id, -- FORCE SAME ID AS PROFILE
                'authenticated',
                'authenticated',
                r.email,
                crypt(new_pass, gen_salt('bf', 10)), -- Cost 10
                NOW(),
                '{"provider": "email", "providers": ["email"]}'::jsonb,
                '{}'::jsonb,
                NOW(),
                NOW()
            );
            
        -- SCENARIO C: Happy Path (ID Matches) -> Just update password to be sure
        ELSE
            UPDATE auth.users 
            SET encrypted_password = crypt(new_pass, gen_salt('bf', 10)),
                email_confirmed_at = COALESCE(email_confirmed_at, NOW())
            WHERE id = r.id;
        END IF;
        
    END LOOP;
END $$;

-- 2. Restore FK Constraint (safely)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey') THEN
        ALTER TABLE public.profiles 
        ADD CONSTRAINT profiles_id_fkey 
        FOREIGN KEY (id) REFERENCES auth.users(id);
    END IF;
END $$;
