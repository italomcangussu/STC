-- Migration: group_knockout_automation
-- Description:
--   Automate semifinal and final generation for "grupo-mata-mata" championships by class.
--   Includes:
--     - ensure_knockout_rounds(championship)
--     - get_group_standings(group)
--     - resolve_match_winner_registration(match)
--     - sync_group_knockout_for_class(championship, class)
--     - trigger on matches updates/inserts
--     - one-time backfill for ongoing championships

CREATE OR REPLACE FUNCTION public.ensure_knockout_rounds(p_championship_id UUID)
RETURNS TABLE(semifinal_round_id UUID, final_round_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_base_date DATE;
    v_semifinal_round_id UUID;
    v_final_round_id UUID;
BEGIN
    SELECT COALESCE(MAX(end_date), CURRENT_DATE)
    INTO v_base_date
    FROM championship_rounds
    WHERE championship_id = p_championship_id;

    INSERT INTO championship_rounds (
        championship_id,
        round_number,
        name,
        phase,
        start_date,
        end_date,
        status
    )
    VALUES (
        p_championship_id,
        4,
        'Semifinais',
        'mata-mata-semifinal',
        v_base_date + 1,
        v_base_date + 7,
        'pending'
    )
    ON CONFLICT (championship_id, round_number)
    DO UPDATE
      SET name = EXCLUDED.name,
          phase = EXCLUDED.phase
    RETURNING id INTO v_semifinal_round_id;

    INSERT INTO championship_rounds (
        championship_id,
        round_number,
        name,
        phase,
        start_date,
        end_date,
        status
    )
    VALUES (
        p_championship_id,
        5,
        'Final',
        'mata-mata-final',
        v_base_date + 8,
        v_base_date + 14,
        'pending'
    )
    ON CONFLICT (championship_id, round_number)
    DO UPDATE
      SET name = EXCLUDED.name,
          phase = EXCLUDED.phase
    RETURNING id INTO v_final_round_id;

    RETURN QUERY SELECT v_semifinal_round_id, v_final_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_match_winner_registration(p_match_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_match RECORD;
    v_sets_a INTEGER := 0;
    v_sets_b INTEGER := 0;
BEGIN
    SELECT
        m.id,
        m.status,
        m.registration_a_id,
        m.registration_b_id,
        m.winner_id,
        m.walkover_winner_id,
        m.walkover_winner_registration_id,
        ra.user_id AS reg_a_user_id,
        rb.user_id AS reg_b_user_id,
        m.score_a,
        m.score_b
    INTO v_match
    FROM matches m
    LEFT JOIN championship_registrations ra ON ra.id = m.registration_a_id
    LEFT JOIN championship_registrations rb ON rb.id = m.registration_b_id
    WHERE m.id = p_match_id;

    IF NOT FOUND OR v_match.status <> 'finished' THEN
        RETURN NULL;
    END IF;

    IF v_match.walkover_winner_registration_id IS NOT NULL THEN
        RETURN v_match.walkover_winner_registration_id;
    END IF;

    IF v_match.winner_id IS NOT NULL THEN
        IF v_match.reg_a_user_id = v_match.winner_id THEN
            RETURN v_match.registration_a_id;
        ELSIF v_match.reg_b_user_id = v_match.winner_id THEN
            RETURN v_match.registration_b_id;
        END IF;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN COALESCE(v_match.score_a[idx], 0) > COALESCE(v_match.score_b[idx], 0) THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(v_match.score_b[idx], 0) > COALESCE(v_match.score_a[idx], 0) THEN 1 ELSE 0 END), 0)
    INTO v_sets_a, v_sets_b
    FROM generate_series(
        1,
        GREATEST(
            COALESCE(array_length(v_match.score_a, 1), 0),
            COALESCE(array_length(v_match.score_b, 1), 0)
        )
    ) AS idx;

    IF v_sets_a > v_sets_b THEN
        RETURN v_match.registration_a_id;
    ELSIF v_sets_b > v_sets_a THEN
        RETURN v_match.registration_b_id;
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_standings(p_group_id UUID)
RETURNS TABLE(
    standing_position INTEGER,
    registration_id UUID,
    points INTEGER,
    h2h_wins INTEGER,
    sets_won INTEGER,
    sets_lost INTEGER,
    games_won INTEGER,
    games_lost INTEGER,
    wins INTEGER,
    losses INTEGER,
    matches_played INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH members AS (
    SELECT gm.registration_id
    FROM championship_group_members gm
    WHERE gm.group_id = p_group_id
),
finished_matches AS (
    SELECT
        m.id,
        m.registration_a_id,
        m.registration_b_id,
        m.winner_id,
        m.walkover_winner_id,
        m.walkover_winner_registration_id,
        ra.user_id AS reg_a_user_id,
        rb.user_id AS reg_b_user_id,
        m.score_a,
        m.score_b
    FROM matches m
    JOIN championship_rounds r ON r.id = m.round_id
    LEFT JOIN championship_registrations ra ON ra.id = m.registration_a_id
    LEFT JOIN championship_registrations rb ON rb.id = m.registration_b_id
    WHERE m.championship_group_id = p_group_id
      AND r.phase = 'classificatoria'
      AND m.status = 'finished'
      AND m.registration_a_id IS NOT NULL
      AND m.registration_b_id IS NOT NULL
),
set_sums AS (
    SELECT
        fm.id,
        fm.registration_a_id,
        fm.registration_b_id,
        fm.winner_id,
        fm.walkover_winner_id,
        fm.walkover_winner_registration_id,
        fm.reg_a_user_id,
        fm.reg_b_user_id,
        COALESCE(SUM(CASE WHEN COALESCE(fm.score_a[idx], 0) > COALESCE(fm.score_b[idx], 0) THEN 1 ELSE 0 END), 0)::INTEGER AS sets_a,
        COALESCE(SUM(CASE WHEN COALESCE(fm.score_b[idx], 0) > COALESCE(fm.score_a[idx], 0) THEN 1 ELSE 0 END), 0)::INTEGER AS sets_b,
        COALESCE(SUM(COALESCE(fm.score_a[idx], 0)), 0)::INTEGER AS games_a,
        COALESCE(SUM(COALESCE(fm.score_b[idx], 0)), 0)::INTEGER AS games_b
    FROM finished_matches fm
    LEFT JOIN LATERAL generate_series(
        1,
        GREATEST(
            COALESCE(array_length(fm.score_a, 1), 0),
            COALESCE(array_length(fm.score_b, 1), 0)
        )
    ) AS idx ON TRUE
    GROUP BY
        fm.id,
        fm.registration_a_id,
        fm.registration_b_id,
        fm.winner_id,
        fm.walkover_winner_id,
        fm.walkover_winner_registration_id,
        fm.reg_a_user_id,
        fm.reg_b_user_id
),
winner_per_match AS (
    SELECT
        ss.*,
        COALESCE(
            ss.walkover_winner_registration_id,
            CASE
                WHEN ss.winner_id IS NOT NULL AND ss.reg_a_user_id = ss.winner_id THEN ss.registration_a_id
                WHEN ss.winner_id IS NOT NULL AND ss.reg_b_user_id = ss.winner_id THEN ss.registration_b_id
                WHEN ss.sets_a > ss.sets_b THEN ss.registration_a_id
                WHEN ss.sets_b > ss.sets_a THEN ss.registration_b_id
                ELSE NULL
            END
        ) AS winner_reg_id
    FROM set_sums ss
),
stats_base AS (
    SELECT
        mem.registration_id,
        COALESCE(COUNT(wpm.id), 0)::INTEGER AS matches_played,
        COALESCE(SUM(CASE WHEN wpm.winner_reg_id = mem.registration_id THEN 1 ELSE 0 END), 0)::INTEGER AS wins,
        COALESCE(SUM(
            CASE
                WHEN (wpm.registration_a_id = mem.registration_id OR wpm.registration_b_id = mem.registration_id)
                 AND wpm.winner_reg_id IS NOT NULL
                 AND wpm.winner_reg_id <> mem.registration_id
                THEN 1
                ELSE 0
            END
        ), 0)::INTEGER AS losses,
        COALESCE(SUM(CASE WHEN wpm.registration_a_id = mem.registration_id THEN wpm.sets_a WHEN wpm.registration_b_id = mem.registration_id THEN wpm.sets_b ELSE 0 END), 0)::INTEGER AS sets_won,
        COALESCE(SUM(CASE WHEN wpm.registration_a_id = mem.registration_id THEN wpm.sets_b WHEN wpm.registration_b_id = mem.registration_id THEN wpm.sets_a ELSE 0 END), 0)::INTEGER AS sets_lost,
        COALESCE(SUM(CASE WHEN wpm.registration_a_id = mem.registration_id THEN wpm.games_a WHEN wpm.registration_b_id = mem.registration_id THEN wpm.games_b ELSE 0 END), 0)::INTEGER AS games_won,
        COALESCE(SUM(CASE WHEN wpm.registration_a_id = mem.registration_id THEN wpm.games_b WHEN wpm.registration_b_id = mem.registration_id THEN wpm.games_a ELSE 0 END), 0)::INTEGER AS games_lost,
        COALESCE(SUM(CASE WHEN wpm.winner_reg_id = mem.registration_id THEN 3 ELSE 0 END), 0)::INTEGER AS points
    FROM members mem
    LEFT JOIN winner_per_match wpm
      ON wpm.registration_a_id = mem.registration_id
      OR wpm.registration_b_id = mem.registration_id
    GROUP BY mem.registration_id
),
stats_h2h AS (
    SELECT
        sb.*,
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM winner_per_match wpm
            JOIN stats_base opp
              ON opp.registration_id = CASE
                  WHEN wpm.registration_a_id = sb.registration_id THEN wpm.registration_b_id
                  ELSE wpm.registration_a_id
              END
            WHERE (wpm.registration_a_id = sb.registration_id OR wpm.registration_b_id = sb.registration_id)
              AND wpm.winner_reg_id = sb.registration_id
              AND opp.points = sb.points
        ), 0)::INTEGER AS h2h_wins
    FROM stats_base sb
),
ranked AS (
    SELECT
        ROW_NUMBER() OVER (
            ORDER BY
                sh.points DESC,
                sh.h2h_wins DESC,
                (sh.sets_won - sh.sets_lost) DESC,
                (sh.games_won - sh.games_lost) DESC,
                sh.registration_id
        )::INTEGER AS standing_position,
        sh.registration_id,
        sh.points,
        sh.h2h_wins,
        sh.sets_won,
        sh.sets_lost,
        sh.games_won,
        sh.games_lost,
        sh.wins,
        sh.losses,
        sh.matches_played
    FROM stats_h2h sh
)
SELECT
    ranked.standing_position,
    ranked.registration_id,
    ranked.points,
    ranked.h2h_wins,
    ranked.sets_won,
    ranked.sets_lost,
    ranked.games_won,
    ranked.games_lost,
    ranked.wins,
    ranked.losses,
    ranked.matches_played
FROM ranked
ORDER BY ranked.standing_position;
$$;

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

    v_semi_ids UUID[] := ARRAY[]::UUID[];
    v_sf1_id UUID;
    v_sf2_id UUID;
    v_tmp_ra UUID;
    v_tmp_rb UUID;
    v_tmp_status TEXT;
    v_semis_changed BOOLEAN := FALSE;

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

    SELECT COALESCE(ARRAY_AGG(m.id ORDER BY m.created_at, m.id), ARRAY[]::UUID[])
    INTO v_semi_ids
    FROM matches m
    WHERE m.championship_id = p_championship_id
      AND m.round_id = v_semifinal_round_id
      AND m.phase = 'Semi'
      AND m.championship_group_id = v_anchor_group_id;

    IF cardinality(v_semi_ids) >= 1 THEN
        v_sf1_id := v_semi_ids[1];
    ELSE
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

        v_semis_changed := TRUE;
    END IF;

    IF cardinality(v_semi_ids) >= 2 THEN
        v_sf2_id := v_semi_ids[2];
    ELSE
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
            v_b1_user,
            v_a2_user,
            v_b1,
            v_a2,
            ARRAY[0, 0, 0],
            ARRAY[0, 0, 0],
            'pending'
        )
        RETURNING id INTO v_sf2_id;

        v_semis_changed := TRUE;
    END IF;

    SELECT registration_a_id, registration_b_id, status
    INTO v_tmp_ra, v_tmp_rb, v_tmp_status
    FROM matches
    WHERE id = v_sf1_id;

    IF v_tmp_status <> 'finished' THEN
        IF v_tmp_ra IS DISTINCT FROM v_a1 OR v_tmp_rb IS DISTINCT FROM v_b2 THEN
            v_semis_changed := TRUE;
        END IF;

        UPDATE matches
        SET
            registration_a_id = v_a1,
            registration_b_id = v_b2,
            player_a_id = v_a1_user,
            player_b_id = v_b2_user,
            winner_id = NULL,
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

    IF v_tmp_status <> 'finished' THEN
        IF v_tmp_ra IS DISTINCT FROM v_b1 OR v_tmp_rb IS DISTINCT FROM v_a2 THEN
            v_semis_changed := TRUE;
        END IF;

        UPDATE matches
        SET
            registration_a_id = v_b1,
            registration_b_id = v_a2,
            player_a_id = v_b1_user,
            player_b_id = v_a2_user,
            winner_id = NULL,
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

CREATE OR REPLACE FUNCTION public.trg_sync_group_knockout_on_match_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_championship_id UUID;
    v_format TEXT;
    v_class TEXT;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    v_championship_id := COALESCE(NEW.championship_id, OLD.championship_id);
    IF v_championship_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a
       AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b
       AND NEW.winner_id IS NOT DISTINCT FROM OLD.winner_id
       AND NEW.walkover_winner_id IS NOT DISTINCT FROM OLD.walkover_winner_id
       AND NEW.walkover_winner_registration_id IS NOT DISTINCT FROM OLD.walkover_winner_registration_id
       AND NEW.registration_a_id IS NOT DISTINCT FROM OLD.registration_a_id
       AND NEW.registration_b_id IS NOT DISTINCT FROM OLD.registration_b_id
       AND NEW.championship_group_id IS NOT DISTINCT FROM OLD.championship_group_id
       AND NEW.round_id IS NOT DISTINCT FROM OLD.round_id
    THEN
        RETURN NEW;
    END IF;

    SELECT c.format
    INTO v_format
    FROM championships c
    WHERE c.id = v_championship_id;

    IF v_format IS DISTINCT FROM 'grupo-mata-mata' THEN
        RETURN NEW;
    END IF;

    SELECT cr.class
    INTO v_class
    FROM championship_registrations cr
    WHERE cr.id = COALESCE(NEW.registration_a_id, NEW.registration_b_id, OLD.registration_a_id, OLD.registration_b_id)
    LIMIT 1;

    IF v_class IS NULL THEN
        SELECT cg.category
        INTO v_class
        FROM championship_groups cg
        WHERE cg.id = COALESCE(NEW.championship_group_id, OLD.championship_group_id)
        LIMIT 1;
    END IF;

    IF v_class IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.sync_group_knockout_for_class(v_championship_id, v_class);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_group_knockout_on_match_change ON matches;

CREATE TRIGGER trg_sync_group_knockout_on_match_change
AFTER INSERT OR UPDATE OF
    status,
    score_a,
    score_b,
    winner_id,
    walkover_winner_id,
    walkover_winner_registration_id,
    registration_a_id,
    registration_b_id,
    championship_group_id,
    round_id
ON matches
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_group_knockout_on_match_change();

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
