-- Sync Script: Full Refresh from 'public.des'
DO $$
DECLARE
    r RECORD;
    match_date DATE;
    match_month_str TEXT;
    
    -- Score Arrays
    s1_a INT; s1_b INT;
    s2_a INT; s2_b INT;
    s3_a INT; s3_b INT;
    
    final_score_a INT[];
    final_score_b INT[];
    
    det_winner_id UUID;
    current_match_id UUID;
    
BEGIN
    -- Temp table to track valid matches
    CREATE TEMP TABLE valid_match_ids (id UUID);

    FOR r IN SELECT * FROM public.des LOOP
        
        -- DATE LOGIC
        IF r.data IS NOT NULL THEN
            match_date := r.data::date;
        ELSE
            match_month_str := TRIM(r.mes);
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
                ELSE CURRENT_DATE
            END::date;
        END IF;

        -- SCORE PARSING (6x4)
        final_score_a := ARRAY[]::INT[];
        final_score_b := ARRAY[]::INT[];

        IF r.set1 IS NOT NULL AND r.set1 ~ '^\d+x\d+$' THEN
            s1_a := SPLIT_PART(r.set1, 'x', 1)::INT;
            s1_b := SPLIT_PART(r.set1, 'x', 2)::INT;
            final_score_a := array_append(final_score_a, s1_a);
            final_score_b := array_append(final_score_b, s1_b);
        END IF;
        
        IF r.set2 IS NOT NULL AND r.set2 ~ '^\d+x\d+$' THEN
            s2_a := SPLIT_PART(r.set2, 'x', 1)::INT;
            s2_b := SPLIT_PART(r.set2, 'x', 2)::INT;
            final_score_a := array_append(final_score_a, s2_a);
            final_score_b := array_append(final_score_b, s2_b);
        END IF;
        
        IF r.set3 IS NOT NULL AND r.set3 ~ '^\d+x\d+$' THEN
            s3_a := SPLIT_PART(r.set3, 'x', 1)::INT;
            s3_b := SPLIT_PART(r.set3, 'x', 2)::INT;
            final_score_a := array_append(final_score_a, s3_a);
            final_score_b := array_append(final_score_b, s3_b);
        END IF;

        -- WINNER LOGIC
        det_winner_id := NULL;
        IF TRIM(r.vencedor) = TRIM(r.atleta1) THEN
            det_winner_id := r.atleta1_id;
        ELSIF TRIM(r.vencedor) = TRIM(r.atleta2) THEN
            det_winner_id := r.atleta2_id;
        -- Fuzzy fallback: contains logic
        ELSIF STRPOS(TRIM(r.vencedor), TRIM(r.atleta1)) > 0 THEN 
            det_winner_id := r.atleta1_id;
        ELSIF STRPOS(TRIM(r.vencedor), TRIM(r.atleta2)) > 0 THEN 
            det_winner_id := r.atleta2_id;
        END IF;

        -- UPSERT MATCH
        SELECT id INTO current_match_id FROM public.matches 
        WHERE type = 'Desafio' 
          AND player_a_id = r.atleta1_id 
          AND player_b_id = r.atleta2_id
          AND date = match_date
          AND scheduled_time = r."Horário da Partida"::time
        LIMIT 1;

        IF current_match_id IS NOT NULL THEN
            UPDATE public.matches SET
                score_a = final_score_a,
                score_b = final_score_b,
                winner_id = det_winner_id,
                status = 'finished'
            WHERE id = current_match_id;
        ELSE
            INSERT INTO public.matches (
                type, player_a_id, player_b_id, date, scheduled_time, status,
                winner_id, score_a, score_b
            ) VALUES (
                'Desafio', r.atleta1_id, r.atleta2_id, match_date, r."Horário da Partida"::time, 'finished',
                det_winner_id, final_score_a, final_score_b
            ) RETURNING id INTO current_match_id;
            
            INSERT INTO public.challenges (
                status, month_ref, created_at, challenger_id, challenged_id, match_id
            ) VALUES (
                'finished', to_char(match_date, 'YYYY-MM'), (match_date + r."Horário da Partida"::time),
                r.atleta1_id, r.atleta2_id, current_match_id
            );
        END IF;
        
        INSERT INTO valid_match_ids (id) VALUES (current_match_id);

    END LOOP;

    -- DELETE ORPHANS
    DELETE FROM public.challenges
    WHERE match_id IN (
        SELECT id FROM public.matches 
        WHERE type = 'Desafio' 
        AND id NOT IN (SELECT id FROM valid_match_ids)
    );

    DELETE FROM public.matches
    WHERE type = 'Desafio' 
    AND id NOT IN (SELECT id FROM valid_match_ids);

    DROP TABLE valid_match_ids;
END $$;
