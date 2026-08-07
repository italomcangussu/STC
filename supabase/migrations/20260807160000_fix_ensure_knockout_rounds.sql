-- ensure_knockout_rounds usava ON CONFLICT (championship_id, round_number).
-- A migration 20260807140000 trocou essa restrição por
-- (championship_id, class, round_number) para permitir rodadas por classe,
-- então o ON CONFLICT deixou de ter alvo e a função passou a falhar com
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Como ela é chamada pelo trigger de sincronia da fase de
-- grupos, qualquer INSERT em matches de um campeonato de grupos quebrava.
--
-- A função é a automação do modelo antigo, em que as classes compartilham
-- rodadas (class IS NULL). Campeonatos criados pelo Criador têm rodadas por
-- classe e geram as próprias fases, então passam longe daqui.

CREATE OR REPLACE FUNCTION public.ensure_knockout_rounds(p_championship_id uuid)
 RETURNS TABLE(semifinal_round_id uuid, final_round_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_base_date DATE;
    v_semifinal_round_id UUID;
    v_final_round_id UUID;
    v_has_class_rounds BOOLEAN;
BEGIN
    -- Campeonato do modelo novo: as rodadas já existem por classe.
    SELECT EXISTS (
        SELECT 1 FROM championship_rounds
        WHERE championship_id = p_championship_id AND class IS NOT NULL
    ) INTO v_has_class_rounds;

    IF v_has_class_rounds THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    SELECT COALESCE(MAX(end_date), CURRENT_DATE)
    INTO v_base_date
    FROM championship_rounds
    WHERE championship_id = p_championship_id;

    -- Semifinais
    SELECT id INTO v_semifinal_round_id
    FROM championship_rounds
    WHERE championship_id = p_championship_id AND round_number = 4 AND class IS NULL;

    IF v_semifinal_round_id IS NULL THEN
        INSERT INTO championship_rounds (
            championship_id, round_number, name, phase, start_date, end_date, status
        ) VALUES (
            p_championship_id, 4, 'Semifinais', 'mata-mata-semifinal',
            v_base_date + 1, v_base_date + 7, 'pending'
        )
        RETURNING id INTO v_semifinal_round_id;
    ELSE
        UPDATE championship_rounds
           SET name = 'Semifinais', phase = 'mata-mata-semifinal'
        WHERE id = v_semifinal_round_id;
    END IF;

    -- Final
    SELECT id INTO v_final_round_id
    FROM championship_rounds
    WHERE championship_id = p_championship_id AND round_number = 5 AND class IS NULL;

    IF v_final_round_id IS NULL THEN
        INSERT INTO championship_rounds (
            championship_id, round_number, name, phase, start_date, end_date, status
        ) VALUES (
            p_championship_id, 5, 'Final', 'mata-mata-final',
            v_base_date + 8, v_base_date + 14, 'pending'
        )
        RETURNING id INTO v_final_round_id;
    ELSE
        UPDATE championship_rounds
           SET name = 'Final', phase = 'mata-mata-final'
        WHERE id = v_final_round_id;
    END IF;

    RETURN QUERY SELECT v_semifinal_round_id, v_final_round_id;
END;
$function$;
