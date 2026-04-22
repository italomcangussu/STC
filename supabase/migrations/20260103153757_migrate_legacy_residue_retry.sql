DO $$
DECLARE
    r RECORD;
    backfilled_champ_pts INTEGER;
    diff INTEGER;
BEGIN
    FOR r IN SELECT id, legacy_points, name FROM profiles WHERE legacy_points > 0 LOOP
        
        -- Calculate how many points we ALREADY backfilled for Championships for this user
        SELECT COALESCE(SUM(amount), 0) INTO backfilled_champ_pts
        FROM point_history 
        WHERE user_id = r.id AND event_type = 'championship';

        -- The "Mystery Residue" is Legacy - Backfilled Championships
        diff := r.legacy_points - backfilled_champ_pts;

        IF diff > 0 THEN
            INSERT INTO point_history (
                user_id, 
                amount, 
                event_type, 
                description, 
                earned_date, 
                expires_at, 
                status
            ) VALUES (
                r.id,
                diff,
                'championship', 
                'Saldo Anterior (Consolidado 2024)',
                '2024-01-01', 
                (CURRENT_DATE + INTERVAL '1 year'),
                'active'
            );
            
            RAISE NOTICE 'Migrated % points for % (Legacy: %, Backfilled: %)', diff, r.name, r.legacy_points, backfilled_champ_pts;
        END IF;

    END LOOP;
END $$;
;
