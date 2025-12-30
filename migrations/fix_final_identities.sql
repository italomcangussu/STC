-- FIX IDENTITIES
-- Backfills missing identity records for manually created auth users
-- This resolves "Database error" during login/signup

DO $$
DECLARE
    u RECORD;
BEGIN
    FOR u IN SELECT * FROM auth.users LOOP
        -- Check if identity exists
        IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = u.id) THEN
            RAISE NOTICE 'Creating identity for %', u.email;
            
            INSERT INTO auth.identities (
                id, 
                user_id, 
                provider_id, 
                identity_data, 
                provider, 
                last_sign_in_at, 
                created_at, 
                updated_at, 
                email
            ) VALUES (
                gen_random_uuid(),
                u.id,
                u.id::text, -- Standard email provider_id is the user_id
                jsonb_build_object(
                    'sub', u.id, 
                    'email', u.email, 
                    'email_verified', true,
                    'provider', 'email'
                ),
                'email',
                NOW(),
                NOW(),
                NOW(),
                u.email
            );
        END IF;
    END LOOP;
END $$;
