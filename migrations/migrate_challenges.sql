-- Migration Script: 'des' table to Matches and Challenges
-- Run this in Supabase SQL Editor

DO $$
DECLARE
    r RECORD;
    new_match_id UUID;
    match_date DATE;
    match_month_str TEXT;
BEGIN
    -- Iterate over each row in the 'des' table
    FOR r IN SELECT * FROM public.des LOOP
        
        -- 1. Determine Date
        -- Checks if 'data' column exists and is not null (CASE strictly refers to columns, here we use PL/PGSQL logic)
        -- Since users' data showed 'data' as null, we rely on 'Mes Atual'
        
        IF r.data IS NOT NULL THEN
            match_date := r.data::date;
        ELSE
            -- Map Portuguese Month to Date (Assumes 1st of month, 2025)
            match_month_str := TRIM(r."Mes Atual");
            match_date := CASE match_month_str
                WHEN 'Janeiro' THEN '2025-01-01'
                WHEN 'Fevereiro' THEN '2025-02-01'
                WHEN 'Março' THEN '2025-03-01'
                WHEN 'Abril' THEN '2025-04-01'
                WHEN 'Maio' THEN '2025-05-01'
                WHEN 'Junho' THEN '2025-06-01'
                WHEN 'Julho' THEN '2025-07-01'
                WHEN 'Agosto' THEN '2025-08-01'
                WHEN 'Setembro' THEN '2025-09-01'
                WHEN 'Outubro' THEN '2025-10-01'
                WHEN 'Novembro' THEN '2025-11-01'
                WHEN 'Dezembro' THEN '2025-12-01'
                ELSE CURRENT_DATE -- Fallback if unrecognized
            END::date;
        END IF;

        -- 2. Create MATCH
        INSERT INTO public.matches (
            type,
            player_a_id,
            player_b_id,
            date,
            scheduled_time,
            status
            -- winner_id, score_a, score_b skipped as data not provided in snippet
        )
        VALUES (
            'Desafio', -- Normalized to 'Desafio'
            r.atleta1_id,
            r.atleta2_id,
            match_date,
            r."Horário da Partida"::time,
            'finished' -- Assuming legacy imports are finished
        )
        RETURNING id INTO new_match_id;

        -- 3. Create CHALLENGE linked to Match
        INSERT INTO public.challenges (
            status,
            month_ref,
            created_at,
            challenger_id,
            challenged_id,
            match_id
        )
        VALUES (
            'finished',
            to_char(match_date, 'YYYY-MM'),
            (match_date + r."Horário da Partida"::time), -- Approximate timestamp
            r.atleta1_id, -- Assuming Atleta 1 is challenger
            r.atleta2_id,
            new_match_id
        );
        
    END LOOP;
END $$;
