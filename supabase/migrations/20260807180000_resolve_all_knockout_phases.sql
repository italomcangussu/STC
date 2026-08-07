-- resolve_championship_final_phases só resolvia champion, finalist, semifinal
-- e participation. Quem caía nas quartas, oitavas ou 16avos recebia
-- 'participation' (5 pontos), embora championship_phase_points tenha
-- quarterfinal = 16 e round_of_16 = 8. Num quadro de 16, os 8 eliminados na
-- primeira rodada e os 4 das quartas eram todos igualados a participação.
--
-- Agora cada rodada eliminatória define a fase de quem perde nela, cobrindo o
-- vocabulário que o Criador emite (lib/championship/rounds.ts) e os nomes do
-- modelo antigo ('mata-mata-final%', 'mata-mata-semifinal%').
--
-- Os padrões são precisos o bastante para dispensar a exclusão de '%semi%' que
-- a versão anterior usava: 'mata-mata-semifinal' não casa com
-- 'mata-mata-final%', e a rodada de semifinal se chama 'Semifinais', não 'Final'.

CREATE OR REPLACE FUNCTION public.resolve_championship_final_phases(p_championship_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    WITH round_phase AS (
        -- Fase que um eliminado naquela rodada recebe. NULL = rodada não
        -- eliminatória (grupos, classificatória), que não define fase alcançada.
        SELECT
            r.id,
            CASE
                WHEN r.phase ILIKE 'mata-mata-final%'
                  OR r.phase IN ('final', 'Final')
                  OR r.name = 'Final'                  THEN 'finalist'
                WHEN r.phase ILIKE 'mata-mata-semifinal%'
                  OR r.phase IN ('semifinal', 'Semi')
                  OR r.name ILIKE 'Semifinal%'         THEN 'semifinal'
                WHEN r.phase IN ('quartas', 'quarterfinal')
                  OR r.name ILIKE 'Quartas%'           THEN 'quarterfinal'
                WHEN r.phase IN ('oitavas', 'round_of_16')
                  OR r.name ILIKE 'Oitavas%'           THEN 'round_of_16'
                WHEN r.phase IN ('16avos', 'round_of_32')
                  OR r.name ILIKE '16 avos%'           THEN 'round_of_32'
                WHEN r.phase IN ('qualify', 'preliminar')
                  OR r.name ILIKE 'Qualifica%'         THEN 'qualifying'
                ELSE NULL
            END AS loser_phase
        FROM public.championship_rounds r
        WHERE r.championship_id = p_championship_id
    ),
    resolved_matches AS (
        SELECT
            m.round_id,
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
        WHERE m.status = 'finished'
          AND m.round_id IN (SELECT id FROM round_phase WHERE loser_phase IS NOT NULL)
    ),
    champions AS (
        SELECT DISTINCT rm.winner_registration_id AS registration_id
        FROM resolved_matches rm
        JOIN round_phase rp ON rp.id = rm.round_id
        WHERE rp.loser_phase = 'finalist'
          AND rm.winner_registration_id IS NOT NULL
    ),
    losers AS (
        SELECT x.registration_id, rp.loser_phase
        FROM (
            SELECT rm.round_id, rm.registration_a_id AS registration_id, rm.winner_registration_id
            FROM resolved_matches rm
            UNION ALL
            SELECT rm.round_id, rm.registration_b_id AS registration_id, rm.winner_registration_id
            FROM resolved_matches rm
        ) x
        JOIN round_phase rp ON rp.id = x.round_id
        WHERE x.registration_id IS NOT NULL
          AND x.registration_id IS DISTINCT FROM x.winner_registration_id
    ),
    -- Perdeu em mais de uma fase (não deveria acontecer): fica com a melhor.
    best_loser AS (
        SELECT
            registration_id,
            (ARRAY_AGG(loser_phase ORDER BY
                CASE loser_phase
                    WHEN 'finalist'     THEN 1
                    WHEN 'semifinal'    THEN 2
                    WHEN 'quarterfinal' THEN 3
                    WHEN 'round_of_16'  THEN 4
                    WHEN 'round_of_32'  THEN 5
                    WHEN 'qualifying'   THEN 6
                    ELSE 7
                END))[1] AS loser_phase
        FROM losers
        GROUP BY registration_id
    ),
    resolved AS (
        SELECT
            cr.id AS registration_id,
            CASE
                WHEN cr.id IN (SELECT registration_id FROM champions) THEN 'champion'
                WHEN bl.loser_phase IS NOT NULL THEN bl.loser_phase
                WHEN cr.final_phase IS NOT NULL THEN cr.final_phase
                ELSE 'participation'
            END AS final_phase
        FROM public.championship_registrations cr
        LEFT JOIN best_loser bl ON bl.registration_id = cr.id
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
$function$;
