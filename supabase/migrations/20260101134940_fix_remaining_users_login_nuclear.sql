-- FIX REMAINING USERS LOGIN NUCLEAR
-- 1. Drop FK Constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DO $$
DECLARE
    r RECORD;
    clean_phone TEXT;
    new_pass TEXT;
BEGIN
    -- Loop through the specific users found with empty metadata
    FOR r IN SELECT * FROM public.profiles WHERE email IN ('olavop@gmail.com', 'leo.bonfim.95@gmail.com', 'rafaelfwrnamdes@gmail.com') LOOP
        
        -- Clean up existing (potentially corrupted) auth state
        DELETE FROM auth.identities WHERE user_id = r.id;
        DELETE FROM auth.users WHERE id = r.id;
        DELETE FROM auth.users WHERE email = r.email;

        -- Prepare data
        clean_phone := regexp_replace(r.phone, '\D', '', 'g');
        new_pass := 'sct' || clean_phone || '2024';

        -- Re-insert User with full working parameters
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, 
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
            created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            r.id, 'authenticated', 'authenticated', r.email,
            crypt(new_pass, gen_salt('bf', 10)),
            NOW(), '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb,
            NOW(), NOW(), '', '', '', ''
        );

        -- Re-insert Identity
        INSERT INTO auth.identities (
            id, user_id, provider_id, identity_data, provider, 
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), r.id, r.id::text,
            jsonb_build_object('sub', r.id, 'email', r.email, 'email_verified', true, 'provider', 'email'),
            'email', NOW(), NOW(), NOW()
        );
        
        RAISE NOTICE 'Rebirth complete for: %', r.email;
    END LOOP;
END $$;

-- 2. Restore FK Constraint
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);
;
