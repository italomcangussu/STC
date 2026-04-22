-- Migration: initial_cut_3_circuito_inverno
-- Goal: zero out the ranking and reboot from the 3rd Circuito de Inverno,
--       applying class-division (÷2) for athletes promoted since then.
--
-- IMPORTANT: Run the dry-run first (p_dry_run = TRUE) before applying.
-- The function returns a diff table — verify it before committing.

-- ─── 1. Dry-run / apply function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bootstrap_ranking_from_3_circuito(p_dry_run BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
    user_id             UUID,
    name                TEXT,
    registration_class  TEXT,
    current_class       TEXT,
    phase               TEXT,
    raw_points          INTEGER,
    applied_points      INTEGER,
    class_adjusted      BOOLEAN,
    reason              TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_champ_id      UUID;
    v_series_id     UUID;
    v_edition_year  INTEGER;
    v_reg           RECORD;
    v_profile_class TEXT;
    v_raw_pts       INTEGER;
    v_final_pts     INTEGER;
    v_is_lower      BOOLEAN;
    v_reason        TEXT;
BEGIN
    -- Only admins
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    -- Locate the 3rd Circuito de Inverno championship
    SELECT c.id, c.series_id, c.edition_year
    INTO   v_champ_id, v_series_id, v_edition_year
    FROM   public.championships c
    JOIN   public.championship_series cs ON cs.id = c.series_id
    WHERE  cs.slug = 'circuito-de-inverno'
      AND  c.edition_year = 2026
    LIMIT  1;

    IF v_champ_id IS NULL THEN
        RAISE EXCEPTION '3rd Circuito de Inverno (edition_year=2026) not found. Run migration 20260422100000 backfill first.';
    END IF;

    -- Ensure final_phase is set on registrations for this championship
    -- (admins must have set them via the admin panel before running this)
    IF NOT EXISTS (
        SELECT 1 FROM public.championship_registrations
        WHERE  championship_id = v_champ_id AND final_phase IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'No final_phase set for 3rd Circuito de Inverno registrations. Set them via the admin panel first.';
    END IF;

    -- ── Dry-run: return diff without committing ──────────────────────────────
    FOR v_reg IN
        SELECT cr.user_id,
               p.name,
               cr.class        AS reg_class,
               p.category      AS profile_class,
               cr.final_phase
        FROM   public.championship_registrations cr
        JOIN   public.profiles p ON p.id = cr.user_id
        WHERE  cr.championship_id  = v_champ_id
          AND  cr.participant_type = 'socio'
          AND  cr.final_phase      IS NOT NULL
          AND  cr.user_id          IS NOT NULL
    LOOP
        v_raw_pts    := COALESCE(public.get_championship_phase_points(v_reg.final_phase), 5);
        v_is_lower   := public.is_lower_class(v_reg.reg_class, v_reg.profile_class);
        v_final_pts  := CASE WHEN v_is_lower
                             THEN FLOOR(v_raw_pts::NUMERIC / 2)::INTEGER
                             ELSE v_raw_pts END;
        v_reason     := CASE WHEN v_is_lower
                             THEN 'championship_earn_lower_class'
                             ELSE 'championship_earn' END;

        RETURN QUERY SELECT
            v_reg.user_id,
            v_reg.name,
            v_reg.reg_class,
            v_reg.profile_class,
            v_reg.final_phase,
            v_raw_pts,
            v_final_pts,
            v_is_lower,
            v_reason;
    END LOOP;

    -- ── If not dry-run, commit the reset + reapplication ────────────────────
    IF NOT p_dry_run THEN
        -- a) Snapshot current class state into class_change_events (state baseline)
        INSERT INTO public.class_change_events (
            user_id, from_class, to_class, points_before, points_after, changed_by
        )
        SELECT
            p.id,
            p.category,
            p.category,
            COALESCE(p.legacy_points, 0),
            COALESCE(p.legacy_points, 0),
            auth.uid()
        FROM   public.profiles p
        WHERE  p.role IN ('socio', 'admin')
          AND  p.is_active = TRUE
        ON CONFLICT DO NOTHING;

        -- b) Full ranking reset (zeros legacy_points on all profiles)
        PERFORM public.admin_reset_ranking_full(
            'Corte inicial — reinício do ranking a partir do 3º Circuito de Inverno',
            'bootstrap_ranking_from_3_circuito'
        );

        -- c) Apply 3rd Circuito points (via existing idempotent function)
        --    Note: apply_championship_edition_points handles class comparison internally.
        PERFORM public.apply_championship_edition_points(v_champ_id);

        -- d) Log in ranking_reset_events
        INSERT INTO public.ranking_reset_events (reason, notes)
        VALUES (
            'refactor_points_from_3_circuito_inverno',
            'Aplicação inicial: 3º Circuito de Inverno (edition_year=2026, dry_run=false)'
        )
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_ranking_from_3_circuito(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_ranking_from_3_circuito(BOOLEAN) TO authenticated;

-- ─── 2. Rollback helper ───────────────────────────────────────────────────────
-- Reverts the bootstrap: zeros points again and removes the bootstrap event.
-- Use only if bootstrap was applied erroneously.

CREATE OR REPLACE FUNCTION public.rollback_bootstrap_3_circuito()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    -- Zero all championship points applied by the bootstrap
    UPDATE public.point_history
    SET    status = 'revoked'
    WHERE  reason IN ('championship_earn', 'championship_earn_lower_class', 'defense_removal')
      AND  created_at > (
          SELECT executed_at FROM public.ranking_reset_events
          WHERE  reason = 'refactor_points_from_3_circuito_inverno'
          ORDER  BY executed_at DESC LIMIT 1
      );

    -- Zero legacy_points for all
    UPDATE public.profiles
    SET    legacy_points = 0
    WHERE  role IN ('socio', 'admin');

    -- Remove the event marker
    DELETE FROM public.ranking_reset_events
    WHERE  reason = 'refactor_points_from_3_circuito_inverno';
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_bootstrap_3_circuito() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_bootstrap_3_circuito() TO authenticated;

COMMENT ON FUNCTION public.bootstrap_ranking_from_3_circuito IS
'Pass p_dry_run=TRUE to preview the diff. Only call with FALSE after verifying output.';
