-- Migration: resenha_open
-- Goal: add schema extensions for the Resenha Open championship format.
--   1. Create "Resenha Open" championship series.
--   2. Extend championship_registrations (cabeca_de_chave, guest_cidade, guest_idade, nullable shirt_size).
--   3. Extend matches (match_number, bracket source FKs).
--   4. Trigger: propagate winner to dependent bracket slots.
--   5. Function: resolve Resenha Open special phases to canonical phase values.

-- ── 1. Resenha Open championship series ────────────────────────────────────────

INSERT INTO public.championship_series (name, slug)
VALUES ('Resenha Open', 'resenha-open')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Extend championship_registrations ───────────────────────────────────────

ALTER TABLE public.championship_registrations
    ADD COLUMN IF NOT EXISTS cabeca_de_chave  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS guest_cidade     TEXT,
    ADD COLUMN IF NOT EXISTS guest_idade      INTEGER;

-- Make shirt_size nullable for championships that do not collect sizing
ALTER TABLE public.championship_registrations
    ALTER COLUMN shirt_size DROP NOT NULL;

-- ── 3. Extend matches for bracket propagation ──────────────────────────────────

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS match_number              INTEGER,
    ADD COLUMN IF NOT EXISTS player_a_source_match_id  UUID REFERENCES public.matches(id),
    ADD COLUMN IF NOT EXISTS player_b_source_match_id  UUID REFERENCES public.matches(id);

CREATE INDEX IF NOT EXISTS idx_matches_player_a_source
    ON public.matches (player_a_source_match_id)
    WHERE player_a_source_match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_player_b_source
    ON public.matches (player_b_source_match_id)
    WHERE player_b_source_match_id IS NOT NULL;

-- ── 4. Trigger: propagate winner to dependent bracket slots ───────────────────

CREATE OR REPLACE FUNCTION public.propagate_bracket_winner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_winner_reg_id  UUID;
    v_winner_user_id UUID;
BEGIN
    -- Only act when a match transitions to finished
    IF NEW.status <> 'finished' OR OLD.status = 'finished' THEN
        RETURN NEW;
    END IF;

    -- Determine effective winner registration id
    v_winner_reg_id := COALESCE(
        NEW.walkover_winner_registration_id,
        NEW.winner_registration_id
    );
    IF v_winner_reg_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Get winner's user_id (null for guests)
    SELECT user_id INTO v_winner_user_id
    FROM public.championship_registrations
    WHERE id = v_winner_reg_id;

    -- Fill slot A of any dependent match
    UPDATE public.matches
    SET
        registration_a_id = v_winner_reg_id,
        player_a_id       = v_winner_user_id
    WHERE player_a_source_match_id = NEW.id
      AND status = 'pending'
      AND registration_a_id IS NULL;

    -- Fill slot B of any dependent match
    UPDATE public.matches
    SET
        registration_b_id = v_winner_reg_id,
        player_b_id       = v_winner_user_id
    WHERE player_b_source_match_id = NEW.id
      AND status = 'pending'
      AND registration_b_id IS NULL;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_bracket_winner ON public.matches;
CREATE TRIGGER trg_propagate_bracket_winner
    AFTER UPDATE OF status
    ON public.matches
    FOR EACH ROW
    EXECUTE FUNCTION public.propagate_bracket_winner();

-- ── 5. Resolve Resenha Open special phases → canonical final_phase ─────────────
-- Maps the custom phases (qualify, primeira_fase, segunda_fase, quartas, …)
-- to the canonical phase values recognised by apply_championship_edition_points:
--   round_of_16 | quarterfinal | semifinal | finalist | champion
--
-- Must be called by admin BEFORE setting championship.status = 'finished'.
-- The existing on_championship_finished_apply_points trigger will then:
--   a) Run resolve_championship_final_phases (which preserves existing final_phase
--      values because of its WHEN cr.final_phase IS NOT NULL THEN cr.final_phase branch).
--   b) Run apply_championship_edition_points using those pre-set values.

CREATE OR REPLACE FUNCTION public.resolve_resenha_open_final_phases(p_championship_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reg   RECORD;
    v_phase TEXT;
    v_canonical TEXT;
BEGIN
    -- Phase → canonical priority (deepest reached)
    FOR v_reg IN
        SELECT cr.id AS reg_id, cr.user_id
        FROM public.championship_registrations cr
        WHERE cr.championship_id  = p_championship_id
          AND cr.participant_type = 'socio'
          AND cr.user_id          IS NOT NULL
    LOOP
        SELECT r.phase INTO v_phase
        FROM public.matches m
        JOIN public.championship_rounds r ON r.id = m.round_id
        WHERE r.championship_id = p_championship_id
          AND (m.registration_a_id = v_reg.reg_id OR m.registration_b_id = v_reg.reg_id)
          AND m.status = 'finished'
        ORDER BY
            CASE r.phase
                WHEN 'final'         THEN 10
                WHEN 'semifinal'     THEN 9
                WHEN 'quartas'       THEN 8
                WHEN 'segunda_fase'  THEN 7
                WHEN 'classifica_a'  THEN 7
                WHEN 'classifica_b'  THEN 7
                WHEN 'primeira_fase' THEN 5
                WHEN 'qualify'       THEN 4
                ELSE 1
            END DESC
        LIMIT 1;

        v_canonical := CASE v_phase
            WHEN 'final'         THEN 'champion'   -- corrected below for finalist
            WHEN 'semifinal'     THEN 'semifinal'
            WHEN 'quartas'       THEN 'quarterfinal'
            WHEN 'segunda_fase'  THEN 'round_of_16'
            WHEN 'classifica_a'  THEN 'round_of_16'
            WHEN 'classifica_b'  THEN 'round_of_16'
            WHEN 'primeira_fase' THEN 'round_of_16'
            WHEN 'qualify'       THEN 'round_of_16'
            ELSE 'participation'
        END;

        UPDATE public.championship_registrations
        SET    final_phase = v_canonical
        WHERE  id = v_reg.reg_id;
    END LOOP;

    -- Correct final: loser → finalist (winner already → champion above)
    UPDATE public.championship_registrations cr
    SET    final_phase = 'finalist'
    FROM   public.matches m
    JOIN   public.championship_rounds r ON r.id = m.round_id
    WHERE  r.championship_id = p_championship_id
      AND  r.phase            = 'final'
      AND  m.status           = 'finished'
      AND  cr.championship_id = p_championship_id
      AND  cr.id IN (m.registration_a_id, m.registration_b_id)
      AND  cr.id IS DISTINCT FROM COALESCE(
               m.walkover_winner_registration_id,
               m.winner_registration_id
           );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_resenha_open_final_phases(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_resenha_open_final_phases(UUID) TO authenticated;
