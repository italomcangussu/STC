-- Migration: auto_finish_championship_on_all_matches_completed
-- Goal: Automatically set championship status to 'finished' when all matches in the championship are completed
--       and the final match has been played, which triggers point calculation for the ranking.

CREATE OR REPLACE FUNCTION public.check_and_auto_finish_championship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_champ_status       TEXT;
    v_is_resenha_open    BOOLEAN;
    v_final_finished     BOOLEAN;
    v_unfinished_matches INTEGER;
BEGIN
    -- Only act when a match status is updated to 'finished'
    IF NEW.status <> 'finished' OR NEW.championship_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'finished' THEN
        RETURN NEW; -- already processed
    END IF;

    -- Fetch championship status
    SELECT status INTO v_champ_status
    FROM public.championships
    WHERE id = NEW.championship_id;

    -- Only auto-finish active/ongoing championships
    IF v_champ_status NOT IN ('active', 'ongoing') THEN
        RETURN NEW;
    END IF;

    -- Check remaining unfinished matches for this championship
    SELECT COUNT(*) INTO v_unfinished_matches
    FROM public.matches
    WHERE championship_id = NEW.championship_id
      AND status <> 'finished';

    -- If all existing matches for this championship are completed
    IF v_unfinished_matches = 0 THEN
        -- Verify that a final match has actually been completed
        SELECT EXISTS (
            SELECT 1
            FROM public.matches m
            JOIN public.championship_rounds r ON r.id = m.round_id
            WHERE m.championship_id = NEW.championship_id
              AND (r.phase ILIKE '%final%' OR r.phase IN ('final', 'Final') OR r.name ILIKE '%final%')
              AND COALESCE(r.phase, '') NOT ILIKE '%semi%'
              AND m.status = 'finished'
        ) INTO v_final_finished;

        IF v_final_finished THEN
            -- Check if it's a Resenha Open championship to resolve its official phases first
            SELECT (name ILIKE '%resenha open%' OR COALESCE(slug, '') ILIKE '%resenha-open%') INTO v_is_resenha_open
            FROM public.championships
            WHERE id = NEW.championship_id;

            IF v_is_resenha_open THEN
                PERFORM public.resolve_resenha_open_final_phases(NEW.championship_id);
            END IF;

            -- Update championship status to 'finished'.
            -- This automatically activates trg_apply_championship_points_on_finish
            -- which resolves final phases and credits ranking points to all socios!
            UPDATE public.championships
            SET status = 'finished'
            WHERE id = NEW.championship_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_finish_championship ON public.matches;
CREATE TRIGGER trg_auto_finish_championship
    AFTER UPDATE OF status ON public.matches
    FOR EACH ROW
    WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.check_and_auto_finish_championship();
