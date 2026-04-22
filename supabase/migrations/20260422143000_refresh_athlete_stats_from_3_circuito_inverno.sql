-- Refresh athlete legacy championship stats from the latest edition
-- (3rd Circuito de Inverno, edition_year = 2026).
--
-- PRD alignment:
-- - Reuses championship points logic from apply_championship_edition_points (idempotent).
-- - Rebuilds legacy championship counters in profiles from finished championship matches.

DO $$
DECLARE
    v_championship_id UUID;
    v_updated_athletes INTEGER := 0;
    v_processed_matches INTEGER := 0;
BEGIN
    SELECT c.id
    INTO v_championship_id
    FROM public.championships c
    JOIN public.championship_series cs ON cs.id = c.series_id
    WHERE cs.slug = 'circuito-de-inverno'
      AND c.edition_year = 2026
      AND c.name ILIKE '3%Circuito%Inverno%'
    ORDER BY c.id
    LIMIT 1;

    IF v_championship_id IS NULL THEN
        RAISE EXCEPTION '3rd Circuito de Inverno (2026) not found.';
    END IF;

    -- Ensure final phases and championship points are consistent.
    -- Idempotent by design in existing functions.
    PERFORM public.resolve_championship_final_phases(v_championship_id);
    PERFORM public.apply_championship_edition_points(v_championship_id);

    -- Reset legacy championship counters (keep legacy_points untouched).
    UPDATE public.profiles p
    SET
        legacy_wins = 0,
        legacy_losses = 0,
        legacy_sets_won = 0,
        legacy_sets_lost = 0,
        legacy_games_won = 0,
        legacy_games_lost = 0,
        legacy_tiebreaks_won = 0,
        legacy_tiebreaks_lost = 0,
        legacy_matches_played = 0,
        legacy_matches_with_tiebreak = 0
    WHERE p.role IN ('socio', 'admin')
      AND COALESCE(p.is_active, TRUE) = TRUE;

    WITH champ_match_base AS (
        SELECT
            m.id,
            COALESCE(m.player_a_id, reg_a.user_id) AS player_a_id,
            COALESCE(m.player_b_id, reg_b.user_id) AS player_b_id,
            COALESCE(m.score_a, ARRAY[]::INTEGER[]) AS score_a,
            COALESCE(m.score_b, ARRAY[]::INTEGER[]) AS score_b,
            CASE
                WHEN m.walkover_winner_id IS NOT NULL THEN m.walkover_winner_id
                WHEN m.winner_id IS NOT NULL THEN m.winner_id
                WHEN m.walkover_winner_registration_id IS NOT NULL THEN walk_reg.user_id
                WHEN m.winner_registration_id IS NOT NULL THEN win_reg.user_id
                ELSE NULL
            END AS winner_user_id
        FROM public.matches m
        LEFT JOIN public.championship_registrations reg_a
               ON reg_a.id = m.registration_a_id
        LEFT JOIN public.championship_registrations reg_b
               ON reg_b.id = m.registration_b_id
        LEFT JOIN public.championship_registrations walk_reg
               ON walk_reg.id = m.walkover_winner_registration_id
        LEFT JOIN public.championship_registrations win_reg
               ON win_reg.id = m.winner_registration_id
        WHERE m.status = 'finished'
          AND (
                m.championship_id = v_championship_id
             OR m.round_id IN (
                    SELECT r.id
                    FROM public.championship_rounds r
                    WHERE r.championship_id = v_championship_id
             )
          )
          AND COALESCE(m.player_a_id, reg_a.user_id) IS NOT NULL
          AND COALESCE(m.player_b_id, reg_b.user_id) IS NOT NULL
    ),
    champ_matches AS (
        SELECT cmb.*
        FROM champ_match_base cmb
        JOIN public.profiles pa ON pa.id = cmb.player_a_id
        JOIN public.profiles pb ON pb.id = cmb.player_b_id
        WHERE pa.role IN ('socio', 'admin')
          AND pb.role IN ('socio', 'admin')
    ),
    set_rows AS (
        SELECT
            cm.id AS match_id,
            u.idx,
            COALESCE(u.sa, 0) AS sa,
            COALESCE(u.sb, 0) AS sb
        FROM champ_matches cm
        CROSS JOIN LATERAL unnest(cm.score_a, cm.score_b) WITH ORDINALITY AS u(sa, sb, idx)
    ),
    set_agg AS (
        SELECT
            cm.id AS match_id,
            COALESCE(SUM(sr.sa), 0) AS games_a,
            COALESCE(SUM(sr.sb), 0) AS games_b,
            COALESCE(SUM(CASE WHEN sr.sa > sr.sb THEN 1 ELSE 0 END), 0) AS sets_won_a,
            COALESCE(SUM(CASE WHEN sr.sb > sr.sa THEN 1 ELSE 0 END), 0) AS sets_won_b,
            COALESCE(SUM(CASE
                WHEN sr.idx = 3 AND sr.sa > sr.sb THEN 1
                WHEN sr.idx <> 3 AND sr.sa = 7 AND sr.sb = 6 THEN 1
                ELSE 0
            END), 0) AS tiebreaks_won_a,
            COALESCE(SUM(CASE
                WHEN sr.idx = 3 AND sr.sb > sr.sa THEN 1
                WHEN sr.idx <> 3 AND sr.sb = 7 AND sr.sa = 6 THEN 1
                ELSE 0
            END), 0) AS tiebreaks_won_b,
            (
                COALESCE(array_length(cm.score_a, 1), 0) = 3
                OR EXISTS (
                    SELECT 1
                    FROM set_rows srx
                    WHERE srx.match_id = cm.id
                      AND (
                            (srx.sa = 7 AND srx.sb = 6)
                         OR (srx.sb = 7 AND srx.sa = 6)
                      )
                )
            ) AS has_tiebreak
        FROM champ_matches cm
        LEFT JOIN set_rows sr ON sr.match_id = cm.id
        GROUP BY cm.id, cm.score_a
    ),
    per_player_match AS (
        SELECT
            cm.player_a_id AS user_id,
            1 AS matches_played,
            CASE WHEN sa.has_tiebreak THEN 1 ELSE 0 END AS matches_with_tiebreak,
            sa.games_a AS games_won,
            sa.games_b AS games_lost,
            sa.sets_won_a AS sets_won,
            sa.sets_won_b AS sets_lost,
            sa.tiebreaks_won_a AS tiebreaks_won,
            sa.tiebreaks_won_b AS tiebreaks_lost,
            CASE WHEN cm.winner_user_id = cm.player_a_id THEN 1 ELSE 0 END AS wins,
            CASE
                WHEN cm.winner_user_id IS NULL THEN 0
                WHEN cm.winner_user_id <> cm.player_a_id THEN 1
                ELSE 0
            END AS losses
        FROM champ_matches cm
        JOIN set_agg sa ON sa.match_id = cm.id

        UNION ALL

        SELECT
            cm.player_b_id AS user_id,
            1 AS matches_played,
            CASE WHEN sa.has_tiebreak THEN 1 ELSE 0 END AS matches_with_tiebreak,
            sa.games_b AS games_won,
            sa.games_a AS games_lost,
            sa.sets_won_b AS sets_won,
            sa.sets_won_a AS sets_lost,
            sa.tiebreaks_won_b AS tiebreaks_won,
            sa.tiebreaks_won_a AS tiebreaks_lost,
            CASE WHEN cm.winner_user_id = cm.player_b_id THEN 1 ELSE 0 END AS wins,
            CASE
                WHEN cm.winner_user_id IS NULL THEN 0
                WHEN cm.winner_user_id <> cm.player_b_id THEN 1
                ELSE 0
            END AS losses
        FROM champ_matches cm
        JOIN set_agg sa ON sa.match_id = cm.id
    ),
    aggregated AS (
        SELECT
            ppm.user_id,
            SUM(ppm.wins) AS wins,
            SUM(ppm.losses) AS losses,
            SUM(ppm.sets_won) AS sets_won,
            SUM(ppm.sets_lost) AS sets_lost,
            SUM(ppm.games_won) AS games_won,
            SUM(ppm.games_lost) AS games_lost,
            SUM(ppm.tiebreaks_won) AS tiebreaks_won,
            SUM(ppm.tiebreaks_lost) AS tiebreaks_lost,
            SUM(ppm.matches_played) AS matches_played,
            SUM(ppm.matches_with_tiebreak) AS matches_with_tiebreak
        FROM per_player_match ppm
        GROUP BY ppm.user_id
    )
    UPDATE public.profiles p
    SET
        legacy_wins = a.wins,
        legacy_losses = a.losses,
        legacy_sets_won = a.sets_won,
        legacy_sets_lost = a.sets_lost,
        legacy_games_won = a.games_won,
        legacy_games_lost = a.games_lost,
        legacy_tiebreaks_won = a.tiebreaks_won,
        legacy_tiebreaks_lost = a.tiebreaks_lost,
        legacy_matches_played = a.matches_played,
        legacy_matches_with_tiebreak = a.matches_with_tiebreak
    FROM aggregated a
    WHERE p.id = a.user_id;

    GET DIAGNOSTICS v_updated_athletes = ROW_COUNT;

    SELECT COUNT(*)
    INTO v_processed_matches
    FROM public.matches m
    WHERE m.status = 'finished'
      AND (
            m.championship_id = v_championship_id
         OR m.round_id IN (
                SELECT r.id
                FROM public.championship_rounds r
                WHERE r.championship_id = v_championship_id
         )
      );

    RAISE NOTICE '3rd Circuito refresh complete: championship_id=%, updated_athletes=%, processed_matches=%',
        v_championship_id,
        v_updated_athletes,
        v_processed_matches;
END;
$$;
