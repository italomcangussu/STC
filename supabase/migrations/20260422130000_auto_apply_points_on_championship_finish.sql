-- Auto-apply championship ranking points when an edition is finalized.
-- Flow:
--   1) Resolve final_phase for socio registrations from knockout results.
--   2) Apply points with current ranking rules (including lower-class halving).

CREATE OR REPLACE FUNCTION public.resolve_championship_final_phases(p_championship_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    WITH final_rounds AS (
        SELECT r.id
        FROM public.championship_rounds r
        WHERE r.championship_id = p_championship_id
          AND (
                r.phase ILIKE 'mata-mata-final%'
             OR r.phase IN ('final', 'Final')
             OR r.name = 'Final'
          )
          AND COALESCE(r.phase, '') NOT ILIKE '%semi%'
    ),
    semifinal_rounds AS (
        SELECT r.id
        FROM public.championship_rounds r
        WHERE r.championship_id = p_championship_id
          AND (
                r.phase ILIKE 'mata-mata-semifinal%'
             OR r.phase IN ('semifinal', 'Semi')
             OR r.name ILIKE 'Semifinal%'
          )
    ),
    final_matches AS (
        SELECT
            m.id,
            m.registration_a_id,
            m.registration_b_id,
            CASE
                WHEN m.walkover_winner_registration_id IS NOT NULL THEN m.walkover_winner_registration_id
                WHEN m.winner_registration_id IS NOT NULL THEN m.winner_registration_id
                WHEN reg_a.user_id = m.winner_id THEN m.registration_a_id
                WHEN reg_b.user_id = m.winner_id THEN m.registration_b_id
                ELSE NULL
            END AS winner_registration_id
        FROM public.matches m
        LEFT JOIN public.championship_registrations reg_a ON reg_a.id = m.registration_a_id
        LEFT JOIN public.championship_registrations reg_b ON reg_b.id = m.registration_b_id
        WHERE m.round_id IN (SELECT id FROM final_rounds)
          AND m.status = 'finished'
    ),
    semifinal_matches AS (
        SELECT
            m.id,
            m.registration_a_id,
            m.registration_b_id,
            CASE
                WHEN m.walkover_winner_registration_id IS NOT NULL THEN m.walkover_winner_registration_id
                WHEN m.winner_registration_id IS NOT NULL THEN m.winner_registration_id
                WHEN reg_a.user_id = m.winner_id THEN m.registration_a_id
                WHEN reg_b.user_id = m.winner_id THEN m.registration_b_id
                ELSE NULL
            END AS winner_registration_id
        FROM public.matches m
        LEFT JOIN public.championship_registrations reg_a ON reg_a.id = m.registration_a_id
        LEFT JOIN public.championship_registrations reg_b ON reg_b.id = m.registration_b_id
        WHERE m.round_id IN (SELECT id FROM semifinal_rounds)
          AND m.status = 'finished'
    ),
    champion_regs AS (
        SELECT DISTINCT fm.winner_registration_id AS registration_id
        FROM final_matches fm
        WHERE fm.winner_registration_id IS NOT NULL
    ),
    finalist_regs AS (
        SELECT DISTINCT x.registration_id
        FROM (
            SELECT fm.registration_a_id AS registration_id, fm.winner_registration_id FROM final_matches fm
            UNION ALL
            SELECT fm.registration_b_id AS registration_id, fm.winner_registration_id FROM final_matches fm
        ) x
        WHERE x.registration_id IS NOT NULL
          AND x.registration_id <> x.winner_registration_id
    ),
    semifinal_regs AS (
        SELECT DISTINCT x.registration_id
        FROM (
            SELECT sm.registration_a_id AS registration_id, sm.winner_registration_id FROM semifinal_matches sm
            UNION ALL
            SELECT sm.registration_b_id AS registration_id, sm.winner_registration_id FROM semifinal_matches sm
        ) x
        WHERE x.registration_id IS NOT NULL
          AND x.registration_id <> x.winner_registration_id
    ),
    resolved AS (
        SELECT
            cr.id AS registration_id,
            CASE
                WHEN cr.id IN (SELECT registration_id FROM champion_regs) THEN 'champion'
                WHEN cr.id IN (SELECT registration_id FROM finalist_regs) THEN 'finalist'
                WHEN cr.id IN (SELECT registration_id FROM semifinal_regs) THEN 'semifinal'
                WHEN cr.final_phase IS NOT NULL THEN cr.final_phase
                ELSE 'participation'
            END AS final_phase
        FROM public.championship_registrations cr
        WHERE cr.championship_id = p_championship_id
          AND cr.participant_type = 'socio'
          AND cr.user_id IS NOT NULL
    )
    UPDATE public.championship_registrations cr
    SET final_phase = resolved.final_phase
    FROM resolved
    WHERE cr.id = resolved.registration_id
      AND cr.championship_id = p_championship_id
      AND cr.participant_type = 'socio'
      AND cr.final_phase IS DISTINCT FROM resolved.final_phase;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_championship_final_phases(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_championship_final_phases(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.on_championship_finished_apply_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status <> 'finished' OR OLD.status = 'finished' THEN
        RETURN NEW;
    END IF;

    -- Only editions linked to a championship series feed ranking points.
    IF NEW.series_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.resolve_championship_final_phases(NEW.id);
    PERFORM public.apply_championship_edition_points(NEW.id);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_championship_points_on_finish ON public.championships;
CREATE TRIGGER trg_apply_championship_points_on_finish
AFTER UPDATE OF status
ON public.championships
FOR EACH ROW
WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.on_championship_finished_apply_points();
