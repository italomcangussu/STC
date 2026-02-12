-- Enable pgcrypto for hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Update passwords for all users that have a phone number
-- Pattern: sct + clean_phone + 2024
UPDATE auth.users
SET encrypted_password = crypt(
  'sct' || regexp_replace(p.phone, '\D', '', 'g') || '2024', 
  gen_salt('bf')
)
FROM public.profiles p
WHERE auth.users.id = p.id
AND p.phone IS NOT NULL
AND p.phone != '';
