-- Fix: avoid PL/pgSQL ambiguity with OUT param names (user_id/phase)
-- in apply_championship_edition_points.

CREATE OR REPLACE FUNCTION public.apply_championship_edition_points(p_championship_id UUID)
RETURNS TABLE (
    user_id         UUID,
    phase           TEXT,
    earned_points   INTEGER,
    defended_points INTEGER,
    net_change      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_series_id     UUID;
    v_edition_year  INTEGER;
    v_prev_champ_id UUID;
    v_reg           RECORD;
    v_profile_class TEXT;
    v_raw_pts       INTEGER;
    v_final_pts     INTEGER;
    v_defended_pts  INTEGER;
    v_is_lower      BOOLEAN;
    v_reason        TEXT;
BEGIN
    SELECT c.series_id, c.edition_year
    INTO   v_series_id, v_edition_year
    FROM   public.championships c
    WHERE  c.id = p_championship_id;

    IF v_series_id IS NULL THEN
        RAISE EXCEPTION 'Championship % has no series_id. Assign it to a series first.', p_championship_id;
    END IF;

    SELECT c.id INTO v_prev_champ_id
    FROM   public.championships c
    WHERE  c.series_id   = v_series_id
      AND  c.edition_year < v_edition_year
    ORDER  BY c.edition_year DESC
    LIMIT  1;

    FOR v_reg IN
        SELECT cr.id AS reg_id,
               cr.user_id,
               cr.class AS reg_class,
               cr.final_phase
        FROM   public.championship_registrations cr
        WHERE  cr.championship_id  = p_championship_id
          AND  cr.participant_type = 'socio'
          AND  cr.final_phase      IS NOT NULL
          AND  cr.user_id          IS NOT NULL
    LOOP
        IF EXISTS (
            SELECT 1
            FROM public.point_history ph
            WHERE ph.user_id = v_reg.user_id
              AND ph.event_id = p_championship_id
              AND ph.reason IN ('championship_earn', 'championship_earn_lower_class')
        ) THEN
            CONTINUE;
        END IF;

        SELECT p.category INTO v_profile_class
        FROM   public.profiles p
        WHERE  p.id = v_reg.user_id;

        v_raw_pts := public.get_championship_phase_points(v_reg.final_phase);
        IF v_raw_pts IS NULL THEN
            v_raw_pts := 5;
        END IF;

        v_is_lower := public.is_lower_class(v_reg.reg_class, v_profile_class);

        IF v_is_lower THEN
            v_final_pts := FLOOR(v_raw_pts::NUMERIC / 2)::INTEGER;
            v_reason    := 'championship_earn_lower_class';
        ELSE
            v_final_pts := v_raw_pts;
            v_reason    := 'championship_earn';
        END IF;

        v_defended_pts := 0;
        IF v_prev_champ_id IS NOT NULL THEN
            SELECT COALESCE(SUM(ph.amount), 0) INTO v_defended_pts
            FROM   public.point_history ph
            WHERE  ph.user_id  = v_reg.user_id
              AND  ph.event_id = v_prev_champ_id
              AND  ph.reason IN ('championship_earn', 'championship_earn_lower_class')
              AND  ph.status   = 'active';

            IF v_defended_pts > 0 THEN
                INSERT INTO public.point_history (
                    user_id, amount, event_type, event_id,
                    description, earned_date, expires_at,
                    series_id, edition_year, phase, registration_class, reason, status
                ) VALUES (
                    v_reg.user_id,
                    -v_defended_pts,
                    'Campeonato',
                    v_prev_champ_id,
                    'Defesa: remoção de pontos da edição anterior',
                    NOW()::DATE,
                    NOW()::DATE,
                    v_series_id,
                    v_edition_year,
                    v_reg.final_phase,
                    v_reg.reg_class,
                    'defense_removal',
                    'active'
                );

                UPDATE public.point_history ph
                SET    status = 'revoked'
                WHERE  ph.user_id  = v_reg.user_id
                  AND  ph.event_id = v_prev_champ_id
                  AND  ph.reason IN ('championship_earn', 'championship_earn_lower_class');
            END IF;
        END IF;

        INSERT INTO public.point_history (
            user_id, amount, event_type, event_id,
            description, earned_date, expires_at,
            series_id, edition_year, phase, registration_class, reason, status
        ) VALUES (
            v_reg.user_id,
            v_final_pts,
            'Campeonato',
            p_championship_id,
            'Campeonato ' || v_edition_year || ' – ' || v_reg.final_phase ||
                CASE WHEN v_is_lower THEN ' (classe inferior, ÷2)' ELSE '' END,
            NOW()::DATE,
            (NOW() + INTERVAL '2 years')::DATE,
            v_series_id,
            v_edition_year,
            v_reg.final_phase,
            v_reg.reg_class,
            v_reason,
            'active'
        );

        UPDATE public.profiles p
        SET    legacy_points = COALESCE(p.legacy_points, 0) + v_final_pts - v_defended_pts
        WHERE  p.id = v_reg.user_id;

        RETURN QUERY SELECT
            v_reg.user_id,
            v_reg.final_phase,
            v_final_pts,
            v_defended_pts,
            v_final_pts - v_defended_pts;
    END LOOP;
END;
$$;
