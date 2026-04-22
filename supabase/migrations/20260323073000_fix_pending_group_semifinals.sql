-- Migration: fix_pending_group_semifinals
-- Description:
--   Preserve finished semifinals in group knockouts and reuse only non-finished
--   semifinal matches to fill the missing official pairing.

CREATE OR REPLACE FUNCTION public.sync_group_knockout_for_class(p_championship_id UUID, p_class TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_format TEXT;
    v_group_a_id UUID;
    v_group_b_id UUID;
    v_anchor_group_id UUID;
    v_semifinal_round_id UUID;
    v_final_round_id UUID;

    v_expected_a INTEGER := 0;
    v_expected_b INTEGER := 0;
    v_created_a INTEGER := 0;
    v_created_b INTEGER := 0;
    v_finished_a INTEGER := 0;
    v_finished_b INTEGER := 0;

    v_a1 UUID;
    v_a2 UUID;
    v_b1 UUID;
    v_b2 UUID;
    v_a1_user UUID;
    v_a2_user UUID;
    v_b1_user UUID;
    v_b2_user UUID;

    v_sf1_id UUID;
    v_sf2_id UUID;
    v_tmp_ra UUID;
    v_tmp_rb UUID;
    v_tmp_status TEXT;

    v_sf1_winner UUID;
    v_sf2_winner UUID;

    v_final_id UUID;
    v_final_status TEXT;
    v_final_ra UUID;
    v_final_rb UUID;
    v_final_user_a UUID;
    v_final_user_b UUID;
BEGIN
    IF p_championship_id IS NULL OR p_class IS NULL OR btrim(p_class) = '' THEN
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_championship_id::TEXT || '|' || p_class, 0));

    SELECT c.format
    INTO v_format
    FROM championships c
    WHERE c.id = p_championship_id;

    IF v_format IS DISTINCT FROM 'grupo-mata-mata' THEN
        RETURN;
    END IF;

    SELECT g_a.id, g_b.id
    INTO v_group_a_id, v_group_b_id
    FROM championship_groups g_a
    JOIN championship_groups g_b
      ON g_b.championship_id = g_a.championship_id
     AND g_b.category = g_a.category
    WHERE g_a.championship_id = p_championship_id
      AND g_a.category = p_class
      AND g_a.group_name = 'A'
      AND g_b.group_name = 'B'
    LIMIT 1;

    IF v_group_a_id IS NULL OR v_group_b_id IS NULL THEN
        RETURN;
    END IF;

    v_anchor_group_id := v_group_a_id;

    SELECT semifinal_round_id, final_round_id
    INTO v_semifinal_round_id, v_final_round_id
    FROM public.ensure_knockout_rounds(p_championship_id);

    SELECT ((COUNT(*) * (COUNT(*) - 1)) / 2)::INTEGER
    INTO v_expected_a
    FROM championship_group_members
    WHERE group_id = v_group_a_id;

    SELECT ((COUNT(*) * (COUNT(*) - 1)) / 2)::INTEGER
    INTO v_expected_b
    FROM championship_group_members
    WHERE group_id = v_group_b_id;

    IF v_expected_a <= 0 OR v_expected_b <= 0 THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE m.status = 'finished')::INTEGER
    INTO v_created_a, v_finished_a
    FROM matches m
    JOIN championship_rounds r ON r.id = m.round_id
    WHERE m.championship_group_id = v_group_a_id
      AND r.phase = 'classificatoria';

    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE m.status = 'finished')::INTEGER
    INTO v_created_b, v_finished_b
    FROM matches m
    JOIN championship_rounds r ON r.id = m.round_id
    WHERE m.championship_group_id = v_group_b_id
      AND r.phase = 'classificatoria';

    IF v_created_a < v_expected_a OR v_created_b < v_expected_b THEN
        RETURN;
    END IF;

    IF v_finished_a < v_expected_a OR v_finished_b < v_expected_b THEN
        RETURN;
    END IF;

    SELECT registration_id INTO v_a1
    FROM public.get_group_standings(v_group_a_id)
    WHERE standing_position = 1;

    SELECT registration_id INTO v_a2
    FROM public.get_group_standings(v_group_a_id)
    WHERE standing_position = 2;

    SELECT registration_id INTO v_b1
    FROM public.get_group_standings(v_group_b_id)
    WHERE standing_position = 1;

    SELECT registration_id INTO v_b2
    FROM public.get_group_standings(v_group_b_id)
    WHERE standing_position = 2;

    IF v_a1 IS NULL OR v_a2 IS NULL OR v_b1 IS NULL OR v_b2 IS NULL THEN
        RETURN;
    END IF;

    SELECT user_id INTO v_a1_user FROM championship_registrations WHERE id = v_a1;
    SELECT user_id INTO v_a2_user FROM championship_registrations WHERE id = v_a2;
    SELECT user_id INTO v_b1_user FROM championship_registrations WHERE id = v_b1;
    SELECT user_id INTO v_b2_user FROM championship_registrations WHERE id = v_b2;

    SELECT m.id
    INTO v_sf1_id
    FROM matches m
    WHERE m.championship_id = p_championship_id
      AND m.round_id = v_semifinal_round_id
      AND m.phase = 'Semi'
      AND m.championship_group_id = v_anchor_group_id
      AND m.status = 'finished'
      AND (
        (m.registration_a_id = v_a1 AND m.registration_b_id = v_b2) OR
        (m.registration_a_id = v_b2 AND m.registration_b_id = v_a1)
      )
    ORDER BY m.created_at, m.id
    LIMIT 1;

    IF v_sf1_id IS NULL THEN
        SELECT m.id
        INTO v_sf1_id
        FROM matches m
        WHERE m.championship_id = p_championship_id
          AND m.round_id = v_semifinal_round_id
          AND m.phase = 'Semi'
          AND m.championship_group_id = v_anchor_group_id
          AND m.status <> 'finished'
          AND (
            (m.registration_a_id = v_a1 AND m.registration_b_id = v_b2) OR
            (m.registration_a_id = v_b2 AND m.registration_b_id = v_a1)
          )
        ORDER BY m.created_at, m.id
        LIMIT 1;
    END IF;

    SELECT m.id
    INTO v_sf2_id
    FROM matches m
    WHERE m.championship_id = p_championship_id
      AND m.round_id = v_semifinal_round_id
      AND m.phase = 'Semi'
      AND m.championship_group_id = v_anchor_group_id
      AND m.status = 'finished'
      AND (
        (m.registration_a_id = v_a2 AND m.registration_b_id = v_b1) OR
        (m.registration_a_id = v_b1 AND m.registration_b_id = v_a2)
      )
    ORDER BY m.created_at, m.id
    LIMIT 1;

    IF v_sf2_id IS NULL THEN
        SELECT m.id
        INTO v_sf2_id
        FROM matches m
        WHERE m.championship_id = p_championship_id
          AND m.round_id = v_semifinal_round_id
          AND m.phase = 'Semi'
          AND m.championship_group_id = v_anchor_group_id
          AND m.status <> 'finished'
          AND (
            (m.registration_a_id = v_a2 AND m.registration_b_id = v_b1) OR
            (m.registration_a_id = v_b1 AND m.registration_b_id = v_a2)
          )
        ORDER BY m.created_at, m.id
        LIMIT 1;
    END IF;

    IF v_sf1_id IS NULL THEN
        SELECT m.id
        INTO v_sf1_id
        FROM matches m
        WHERE m.championship_id = p_championship_id
          AND m.round_id = v_semifinal_round_id
          AND m.phase = 'Semi'
          AND m.championship_group_id = v_anchor_group_id
          AND m.status <> 'finished'
          AND (v_sf2_id IS NULL OR m.id <> v_sf2_id)
        ORDER BY m.created_at, m.id
        LIMIT 1;

        IF v_sf1_id IS NULL THEN
            INSERT INTO matches (
                type,
                championship_id,
                championship_group_id,
                round_id,
                phase,
                player_a_id,
                player_b_id,
                registration_a_id,
                registration_b_id,
                score_a,
                score_b,
                status
            )
            VALUES (
                'Campeonato',
                p_championship_id,
                v_anchor_group_id,
                v_semifinal_round_id,
                'Semi',
                v_a1_user,
                v_b2_user,
                v_a1,
                v_b2,
                ARRAY[0, 0, 0],
                ARRAY[0, 0, 0],
                'pending'
            )
            RETURNING id INTO v_sf1_id;
        END IF;
    END IF;

    IF v_sf2_id IS NULL THEN
        SELECT m.id
        INTO v_sf2_id
        FROM matches m
        WHERE m.championship_id = p_championship_id
          AND m.round_id = v_semifinal_round_id
          AND m.phase = 'Semi'
          AND m.championship_group_id = v_anchor_group_id
          AND m.status <> 'finished'
          AND m.id <> v_sf1_id
        ORDER BY m.created_at, m.id
        LIMIT 1;

        IF v_sf2_id IS NULL THEN
            INSERT INTO matches (
                type,
                championship_id,
                championship_group_id,
                round_id,
                phase,
                player_a_id,
                player_b_id,
                registration_a_id,
                registration_b_id,
                score_a,
                score_b,
                status
            )
            VALUES (
                'Campeonato',
                p_championship_id,
                v_anchor_group_id,
                v_semifinal_round_id,
                'Semi',
                v_a2_user,
                v_b1_user,
                v_a2,
                v_b1,
                ARRAY[0, 0, 0],
                ARRAY[0, 0, 0],
                'pending'
            )
            RETURNING id INTO v_sf2_id;
        END IF;
    END IF;

    SELECT registration_a_id, registration_b_id, status
    INTO v_tmp_ra, v_tmp_rb, v_tmp_status
    FROM matches
    WHERE id = v_sf1_id;

    IF v_tmp_status <> 'finished'
       AND (v_tmp_ra IS DISTINCT FROM v_a1 OR v_tmp_rb IS DISTINCT FROM v_b2) THEN
        UPDATE matches
        SET
            registration_a_id = v_a1,
            registration_b_id = v_b2,
            player_a_id = v_a1_user,
            player_b_id = v_b2_user,
            winner_id = NULL,
            winner_registration_id = NULL,
            walkover_winner_id = NULL,
            walkover_winner_registration_id = NULL,
            score_a = ARRAY[0, 0, 0],
            score_b = ARRAY[0, 0, 0],
            status = 'pending',
            scheduled_date = NULL,
            scheduled_time = NULL,
            court_id = NULL,
            date = NULL
        WHERE id = v_sf1_id;
    END IF;

    SELECT registration_a_id, registration_b_id, status
    INTO v_tmp_ra, v_tmp_rb, v_tmp_status
    FROM matches
    WHERE id = v_sf2_id;

    IF v_tmp_status <> 'finished'
       AND (v_tmp_ra IS DISTINCT FROM v_a2 OR v_tmp_rb IS DISTINCT FROM v_b1) THEN
        UPDATE matches
        SET
            registration_a_id = v_a2,
            registration_b_id = v_b1,
            player_a_id = v_a2_user,
            player_b_id = v_b1_user,
            winner_id = NULL,
            winner_registration_id = NULL,
            walkover_winner_id = NULL,
            walkover_winner_registration_id = NULL,
            score_a = ARRAY[0, 0, 0],
            score_b = ARRAY[0, 0, 0],
            status = 'pending',
            scheduled_date = NULL,
            scheduled_time = NULL,
            court_id = NULL,
            date = NULL
        WHERE id = v_sf2_id;
    END IF;

    DELETE FROM matches
    WHERE championship_id = p_championship_id
      AND round_id = v_semifinal_round_id
      AND phase = 'Semi'
      AND championship_group_id = v_anchor_group_id
      AND id NOT IN (v_sf1_id, v_sf2_id)
      AND status <> 'finished';

    v_sf1_winner := public.resolve_match_winner_registration(v_sf1_id);
    v_sf2_winner := public.resolve_match_winner_registration(v_sf2_id);

    SELECT id, status, registration_a_id, registration_b_id
    INTO v_final_id, v_final_status, v_final_ra, v_final_rb
    FROM matches
    WHERE championship_id = p_championship_id
      AND round_id = v_final_round_id
      AND phase = 'Final'
      AND championship_group_id = v_anchor_group_id
    ORDER BY created_at, id
    LIMIT 1;

    IF v_sf1_winner IS NOT NULL AND v_sf2_winner IS NOT NULL THEN
        SELECT user_id INTO v_final_user_a FROM championship_registrations WHERE id = v_sf1_winner;
        SELECT user_id INTO v_final_user_b FROM championship_registrations WHERE id = v_sf2_winner;

        IF v_final_id IS NULL THEN
            INSERT INTO matches (
                type,
                championship_id,
                championship_group_id,
                round_id,
                phase,
                player_a_id,
                player_b_id,
                registration_a_id,
                registration_b_id,
                score_a,
                score_b,
                status
            )
            VALUES (
                'Campeonato',
                p_championship_id,
                v_anchor_group_id,
                v_final_round_id,
                'Final',
                v_final_user_a,
                v_final_user_b,
                v_sf1_winner,
                v_sf2_winner,
                ARRAY[0, 0, 0],
                ARRAY[0, 0, 0],
                'pending'
            )
            RETURNING id INTO v_final_id;
        ELSIF v_final_status <> 'finished' THEN
            UPDATE matches
            SET
                registration_a_id = v_sf1_winner,
                registration_b_id = v_sf2_winner,
                player_a_id = v_final_user_a,
                player_b_id = v_final_user_b,
                winner_id = NULL,
                winner_registration_id = NULL,
                walkover_winner_id = NULL,
                walkover_winner_registration_id = NULL,
                score_a = ARRAY[0, 0, 0],
                score_b = ARRAY[0, 0, 0],
                status = 'pending',
                scheduled_date = NULL,
                scheduled_time = NULL,
                court_id = NULL,
                date = NULL
            WHERE id = v_final_id;
        END IF;
    ELSE
        IF v_final_id IS NOT NULL AND v_final_status <> 'finished' THEN
            UPDATE matches
            SET
                registration_a_id = NULL,
                registration_b_id = NULL,
                player_a_id = NULL,
                player_b_id = NULL,
                winner_id = NULL,
                winner_registration_id = NULL,
                walkover_winner_id = NULL,
                walkover_winner_registration_id = NULL,
                score_a = ARRAY[0, 0, 0],
                score_b = ARRAY[0, 0, 0],
                status = 'pending',
                scheduled_date = NULL,
                scheduled_time = NULL,
                court_id = NULL,
                date = NULL
            WHERE id = v_final_id;
        END IF;
    END IF;

    IF v_final_id IS NOT NULL THEN
        DELETE FROM matches
        WHERE championship_id = p_championship_id
          AND round_id = v_final_round_id
          AND phase = 'Final'
          AND championship_group_id = v_anchor_group_id
          AND id <> v_final_id
          AND status <> 'finished';
    END IF;
END;
$$;

DO $$
DECLARE
    v_champ RECORD;
    v_class RECORD;
BEGIN
    FOR v_champ IN
        SELECT c.id
        FROM championships c
        WHERE c.format = 'grupo-mata-mata'
          AND c.status = 'ongoing'
    LOOP
        FOR v_class IN
            SELECT DISTINCT cg.category
            FROM championship_groups cg
            WHERE cg.championship_id = v_champ.id
        LOOP
            PERFORM public.sync_group_knockout_for_class(v_champ.id, v_class.category);
        END LOOP;
    END LOOP;
END;
$$;
;
