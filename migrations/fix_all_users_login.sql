-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Temporarily drop the FK constraint to allow auth user manipulation
-- We use a DO block to avoid error if it doesn't exist, but standard ALTER allows IF EXISTS? 
-- Postgres < 9 doesn't, but Supabase is new. Safest is just ALTER command.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $$
DECLARE
    r RECORD;
    clean_phone TEXT;
    new_pass TEXT;
BEGIN
    -- Loop through all profiles that have a phone number (our target audience for phone login)
    FOR r IN SELECT * FROM public.profiles WHERE phone IS NOT NULL AND phone != '' LOOP
        
        clean_phone := regexp_replace(r.phone, '\D', '', 'g');
        new_pass := 'sct' || clean_phone || '2024';
        
        -- Check if auth user exists with the SAME ID (Happy Path)
        IF EXISTS (SELECT 1 FROM auth.users WHERE id = r.id) THEN
            -- Just update the password and confirm email
            UPDATE auth.users 
            SET encrypted_password = crypt(new_pass, gen_salt('bf', 10)),
                email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
                raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb
            WHERE id = r.id;
            
        ELSE
            -- No auth user with this ID.
            -- Check if an auth user uses this email (Mismatch Scenario)
            IF EXISTS (SELECT 1 FROM auth.users WHERE email = r.email) THEN
                -- Delete the mismatched auth user so we can reuse the email for the correct ID
                DELETE FROM auth.users WHERE email = r.email;
            END IF;
            
            -- Insert the correct auth user with the Profile ID
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
                r.id, -- FORCE SAME ID
                'authenticated',
                'authenticated',
                r.email,
                crypt(new_pass, gen_salt('bf', 10)),
                NOW(), -- Email confirmed
                NULL,
                NULL,
                '{"provider": "email", "providers": ["email"]}',
                '{}',
                NOW(),
                NOW(),
                '',
                '',
                '',
                ''
            );
        END IF;
    END LOOP;
END $$;

-- Restore the FK constraint
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id);

