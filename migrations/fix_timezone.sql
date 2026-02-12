-- 1. Set the database timezone to America/Fortaleza (UTC-3)
ALTER DATABASE postgres SET timezone TO 'America/Fortaleza';

-- 2. Check current server time to verify
SELECT NOW()::timestamptz as current_server_time;

-- 3. (Optional) If you have existing columns that were saved as 'timestamp without time zone' 
-- and you want them to be treated as Fortaleza time, you might need to cast them.
-- But usually, Supabase uses 'timestamptz' (timestamp with time zone).
-- If you have specific tables with wrong times (e.g., shifted by +3h because they were saved as UTC but meant to be local),
-- you can subtract/add intervals. 

-- Example: Fix reservations starting in the future that might be shifted
-- NOTE: Only run this if you confirm your data is shifted!
-- UPDATE reservations 
-- SET start_time = start_time - INTERVAL '3 hours' 
-- WHERE condition...;

-- 4. Ensure future inserts use the correct timezone if using now()
-- SET timezone = 'America/Fortaleza'; 
-- (This is per-session, the ALTER DATABASE above is persistent for new connections)
