-- Migration: point_history_expand_and_core_functions
-- Goal:
--   1. Add audit columns to point_history (series_id, edition_year, phase,
--      registration_class, reason).
--   2. Add final_phase to championship_registrations.
--   3. Create class_change_events audit table.
--   4. Create apply_championship_edition_points() – idempotent point application.
--   5. Create revert_championship_edition_points() – used on cancellation.
--   6. Create trigger on profiles to halve points on class promotion.

-- ─── 1. Expand point_history ────────────────────────────────────────────────

ALTER TABLE public.point_history
    ADD COLUMN IF NOT EXISTS series_id          UUID    REFERENCES public.championship_series(id),
    ADD COLUMN IF NOT EXISTS edition_year       INTEGER,
    ADD COLUMN IF NOT EXISTS phase              TEXT,
    ADD COLUMN IF NOT EXISTS registration_class TEXT,
    ADD COLUMN IF NOT EXISTS reason             TEXT    CHECK (reason IN (
        'championship_earn',
        'championship_earn_lower_class',
        'defense_removal',
        'class_promotion_adjustment',
        'head_to_head_earn',
        'head_to_head_invalidation',
        'edition_cancelled',
        'manual_admin'
    ));

CREATE INDEX IF NOT EXISTS idx_point_history_series
    ON public.point_history (user_id, series_id, edition_year)
    WHERE series_id IS NOT NULL;

-- ─── 2. final_phase on championship_registrations ───────────────────────────

ALTER TABLE public.championship_registrations
    ADD COLUMN IF NOT EXISTS final_phase TEXT CHECK (final_phase IN (
        'champion', 'finalist', 'semifinal', 'quarterfinal', 'round_of_16', 'participation'
    ));

-- ─── 3. class_change_events ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.class_change_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    from_class      TEXT        NOT NULL,
    to_class        TEXT        NOT NULL,
    points_before   INTEGER     NOT NULL,
    points_after    INTEGER     NOT NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by      UUID        REFERENCES public.profiles(id)
);

ALTER TABLE public.class_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read class change events"
    ON public.class_change_events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));

CREATE POLICY "Admins can insert class change events"
    ON public.class_change_events FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));

CREATE INDEX IF NOT EXISTS idx_class_change_events_user
    ON public.class_change_events (user_id, changed_at DESC);

-- ─── 4. apply_championship_edition_points ───────────────────────────────────
-- Applies ranking points after a championship edition is finalized.
-- Called once per championship. Idempotent: re-running won't duplicate entries.
--
-- For each socio registration with final_phase set:
--   a) Remove old point_history rows from the previous edition of the same series.
--   b) Insert new point_history row (halved if registration_class < profile.category).
--   c) Update profiles.legacy_points accordingly.

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
    -- Validate championship belongs to a series
    SELECT series_id, edition_year
    INTO   v_series_id, v_edition_year
    FROM   public.championships
    WHERE  id = p_championship_id;

    IF v_series_id IS NULL THEN
        RAISE EXCEPTION 'Championship % has no series_id. Assign it to a series first.', p_championship_id;
    END IF;

    -- Find the immediately preceding edition of this series
    SELECT id INTO v_prev_champ_id
    FROM   public.championships
    WHERE  series_id   = v_series_id
      AND  edition_year < v_edition_year
    ORDER  BY edition_year DESC
    LIMIT  1;

    -- Process each socio registration with a final_phase
    FOR v_reg IN
        SELECT cr.id           AS reg_id,
               cr.user_id,
               cr.class        AS reg_class,
               cr.final_phase
        FROM   public.championship_registrations cr
        WHERE  cr.championship_id  = p_championship_id
          AND  cr.participant_type = 'socio'
          AND  cr.final_phase      IS NOT NULL
          AND  cr.user_id          IS NOT NULL
    LOOP
        -- Skip if points already applied for this championship + user (idempotency)
        IF EXISTS (
            SELECT 1 FROM public.point_history
            WHERE  user_id      = v_reg.user_id
              AND  event_id     = p_championship_id
              AND  reason IN ('championship_earn', 'championship_earn_lower_class')
        ) THEN
            CONTINUE;
        END IF;

        -- Get the athlete's current ranking class
        SELECT category INTO v_profile_class
        FROM   public.profiles
        WHERE  id = v_reg.user_id;

        -- Determine raw phase points
        v_raw_pts := public.get_championship_phase_points(v_reg.final_phase);
        IF v_raw_pts IS NULL THEN
            v_raw_pts := 5; -- fallback to participation
        END IF;

        -- Check if registration class is lower than ranking class
        v_is_lower := public.is_lower_class(v_reg.reg_class, v_profile_class);

        IF v_is_lower THEN
            v_final_pts := FLOOR(v_raw_pts::NUMERIC / 2)::INTEGER;
            v_reason    := 'championship_earn_lower_class';
        ELSE
            v_final_pts := v_raw_pts;
            v_reason    := 'championship_earn';
        END IF;

        -- Remove previous edition points for this user+series (defense)
        v_defended_pts := 0;
        IF v_prev_champ_id IS NOT NULL THEN
            SELECT COALESCE(SUM(amount), 0) INTO v_defended_pts
            FROM   public.point_history
            WHERE  user_id   = v_reg.user_id
              AND  event_id  = v_prev_champ_id
              AND  reason IN ('championship_earn', 'championship_earn_lower_class')
              AND  status    = 'active';

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

                -- Soft-revoke the original entries
                UPDATE public.point_history
                SET    status = 'revoked'
                WHERE  user_id  = v_reg.user_id
                  AND  event_id = v_prev_champ_id
                  AND  reason IN ('championship_earn', 'championship_earn_lower_class');
            END IF;
        END IF;

        -- Insert new edition points
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

        -- Update profiles.legacy_points (net change)
        UPDATE public.profiles
        SET    legacy_points = COALESCE(legacy_points, 0) + v_final_pts - v_defended_pts
        WHERE  id = v_reg.user_id;

        RETURN QUERY SELECT
            v_reg.user_id,
            v_reg.final_phase,
            v_final_pts,
            v_defended_pts,
            v_final_pts - v_defended_pts;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_championship_edition_points(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_championship_edition_points(UUID) TO authenticated;

-- ─── 5. revert_championship_edition_points ──────────────────────────────────
-- Called when admin cancels a finalized championship edition.
-- Reverses earn entries and re-applies the previous edition's points.

CREATE OR REPLACE FUNCTION public.revert_championship_edition_points(p_championship_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_series_id     UUID;
    v_edition_year  INTEGER;
    v_prev_champ_id UUID;
    v_reg           RECORD;
    v_cancel_pts    INTEGER;
BEGIN
    -- Only admins
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT series_id, edition_year
    INTO   v_series_id, v_edition_year
    FROM   public.championships
    WHERE  id = p_championship_id;

    -- For each user who earned points in this edition, cancel them
    FOR v_reg IN
        SELECT user_id, SUM(amount) AS total_pts
        FROM   public.point_history
        WHERE  event_id = p_championship_id
          AND  reason IN ('championship_earn', 'championship_earn_lower_class')
          AND  status   = 'active'
        GROUP  BY user_id
    LOOP
        v_cancel_pts := v_reg.total_pts;

        INSERT INTO public.point_history (
            user_id, amount, event_type, event_id,
            description, earned_date, expires_at,
            series_id, edition_year, reason, status
        ) VALUES (
            v_reg.user_id,
            -v_cancel_pts,
            'Campeonato',
            p_championship_id,
            'Cancelamento da edição ' || v_edition_year,
            NOW()::DATE,
            NOW()::DATE,
            v_series_id,
            v_edition_year,
            'edition_cancelled',
            'active'
        );

        UPDATE public.point_history
        SET    status = 'revoked'
        WHERE  user_id  = v_reg.user_id
          AND  event_id = p_championship_id
          AND  reason IN ('championship_earn', 'championship_earn_lower_class');

        -- Restore defense_removal entry (if any) — re-activate prior edition points
        UPDATE public.point_history
        SET    status = 'active'
        WHERE  user_id   = v_reg.user_id
          AND  series_id = v_series_id
          AND  reason    IN ('championship_earn', 'championship_earn_lower_class')
          AND  status    = 'revoked'
          AND  edition_year = (
              SELECT MAX(edition_year)
              FROM   public.championships
              WHERE  series_id = v_series_id
                AND  edition_year < v_edition_year
          );

        UPDATE public.profiles
        SET    legacy_points = COALESCE(legacy_points, 0) - v_cancel_pts
        WHERE  id = v_reg.user_id;
    END LOOP;

    INSERT INTO public.ranking_reset_events (reason, notes)
    VALUES (
        'edition_cancellation',
        'Revert: championship_id=' || p_championship_id::TEXT
    )
    ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_championship_edition_points(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_championship_edition_points(UUID) TO authenticated;

-- ─── 6. Trigger: class promotion halves legacy_points ───────────────────────

CREATE OR REPLACE FUNCTION public.on_profile_class_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_rank  INTEGER;
    v_new_rank  INTEGER;
    v_pts_now   INTEGER;
    v_halved    INTEGER;
BEGIN
    -- Only act on category changes
    IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
        RETURN NEW;
    END IF;

    v_old_rank := public.class_rank(OLD.category);
    v_new_rank := public.class_rank(NEW.category);

    -- Promotion = moving to a better (lower rank number) class
    IF v_new_rank >= v_old_rank THEN
        RETURN NEW; -- demotion or same — no adjustment
    END IF;

    -- Idempotency: avoid double-adjustment for the same class transition
    IF EXISTS (
        SELECT 1 FROM public.class_change_events
        WHERE  user_id    = NEW.id
          AND  from_class = OLD.category
          AND  to_class   = NEW.category
          AND  changed_at > NOW() - INTERVAL '5 seconds'
    ) THEN
        RETURN NEW;
    END IF;

    v_pts_now := COALESCE(NEW.legacy_points, 0);
    v_halved  := FLOOR(v_pts_now::NUMERIC / 2)::INTEGER;

    -- Insert audit entry
    INSERT INTO public.class_change_events (
        user_id, from_class, to_class, points_before, points_after, changed_by
    ) VALUES (
        NEW.id, OLD.category, NEW.category, v_pts_now, v_halved, auth.uid()
    );

    -- Insert adjustment in point_history
    INSERT INTO public.point_history (
        user_id, amount, event_type,
        description, earned_date, expires_at, reason, status
    ) VALUES (
        NEW.id,
        -(v_pts_now - v_halved),
        'Campeonato',
        'Promoção de classe: ' || OLD.category || ' → ' || NEW.category || ' (÷2)',
        NOW()::DATE,
        NOW()::DATE,
        'class_promotion_adjustment',
        'active'
    );

    -- Apply halving to the profile
    NEW.legacy_points := v_halved;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_class_change ON public.profiles;
CREATE TRIGGER trg_profile_class_change
    BEFORE UPDATE OF category ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.on_profile_class_change();
