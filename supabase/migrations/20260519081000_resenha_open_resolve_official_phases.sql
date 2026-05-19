-- Update Resenha Open phase resolution for the official 2026 bracket:
-- preliminar, oitavas, quartas, semifinal, final.

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
                WHEN 'oitavas'       THEN 7
                WHEN 'preliminar'    THEN 6
                WHEN 'segunda_fase'  THEN 5
                WHEN 'classifica_a'  THEN 5
                WHEN 'classifica_b'  THEN 5
                WHEN 'primeira_fase' THEN 4
                WHEN 'qualify'       THEN 3
                ELSE 1
            END DESC
        LIMIT 1;

        v_canonical := CASE v_phase
            WHEN 'final'         THEN 'champion'
            WHEN 'semifinal'     THEN 'semifinal'
            WHEN 'quartas'       THEN 'quarterfinal'
            WHEN 'oitavas'       THEN 'round_of_16'
            WHEN 'preliminar'    THEN 'round_of_16'
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
