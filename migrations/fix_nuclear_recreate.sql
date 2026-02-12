-- FIX NUCLEAR REBIRTH
-- This script deletes and re-creates ALL auth users to ensure consistent state.
-- It replicates the 'Mario Fix' which was proven to work.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Drop FK Constraint to protect Profiles from Cascade Deletion
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $$
DECLARE
    r RECORD;
    clean_phone TEXT;
    new_pass TEXT;
BEGIN
    -- Loop through ALL profiles with phone numbers
    FOR r IN SELECT * FROM public.profiles WHERE phone IS NOT NULL AND phone != '' LOOP
        
        -- Delete existing auth user (Clean Slate)
        -- This ensures we don't have stale metadata or hidden corrupted state
        DELETE FROM auth.users WHERE id = r.id;
        DELETE FROM auth.users WHERE email = r.email; -- Double check
        
        -- Prepare password
        clean_phone := regexp_replace(r.phone, '\D', '', 'g');
        new_pass := 'sct' || clean_phone || '2024';
        
        -- Re-Insert Auth User
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            recovery_sent_at,
            last_sign_in_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            r.id, -- MATCH PROFILE ID
            'authenticated',
            'authenticated',
            r.email,
            crypt(new_pass, gen_salt('bf', 10)), -- Verified Cost
            NOW(), -- Fresh confirmation
            NULL,
            NULL,
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            '{}'::jsonb,
            NOW(),
            NOW(),
            '',
            '',
            '',
            ''
        );
        
        -- Insert Identity (Explicitly matching user)
        INSERT INTO auth.identities (
            id, 
            user_id, 
            provider_id, 
            identity_data, 
            provider, 
            last_sign_in_at, 
            created_at, 
            updated_at
        ) VALUES (
            gen_random_uuid(),
            r.id,
            r.id::text,
            jsonb_build_object(
                'sub', r.id, 
                'email', r.email, 
                'email_verified', true,
                'provider', 'email'
            ),
            'email',
            NOW(),
            NOW(),
            NOW()
        );
        
        RAISE NOTICE 'Rebirthed user: %', r.email;
        
    END LOOP;
END $$;

-- 2. Restore FK Constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey') THEN
        ALTER TABLE public.profiles 
        ADD CONSTRAINT profiles_id_fkey 
        FOREIGN KEY (id) REFERENCES auth.users(id);
    END IF;
END $$;
