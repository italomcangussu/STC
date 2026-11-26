-- Migration: a chave acompanha a edição de um placar já publicado
--
-- O problema que esta migration fecha:
--   O admin pode editar uma partida finalizada (a política "Admins manage
--   matches" deixa), mas `propagate_bracket_winner` só agia na passagem para
--   `finished`. Se a edição trocava o vencedor, o jogo seguinte continuava com
--   o vencedor antigo; se o admin reabria a partida, a vaga seguinte continuava
--   ocupada por quem não tinha mais ganho.
--
-- O que muda:
--   - O gatilho também dispara quando muda o vencedor (inscrição, W.O. ou perfil).
--   - Vencedor trocado: a vaga do jogo seguinte que estava com o vencedor antigo
--     passa para o novo. Partida reaberta: essa vaga volta a ficar vazia.
--   - Se o jogo seguinte já começou ou terminou com o vencedor antigo, a edição
--     é recusada: o admin reabre o jogo seguinte primeiro (senão a chave teria
--     um resultado de alguém que não chegou lá).
--   - O resto continua igual: na primeira finalização só preenche vaga vazia, e
--     a rede de proteção do `winner_id` sem inscrição continua.

CREATE OR REPLACE FUNCTION public.propagate_bracket_winner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_reg_id     UUID;
    v_new_reg_id     UUID;
    v_new_user_id    UUID;
BEGIN
    IF OLD.status = 'finished' THEN
        v_old_reg_id := COALESCE(OLD.walkover_winner_registration_id, OLD.winner_registration_id);
    END IF;

    IF NEW.status = 'finished' THEN
        v_new_reg_id := COALESCE(NEW.walkover_winner_registration_id, NEW.winner_registration_id);

        -- Rede de proteção: quem gravou só o perfil do vencedor ainda tem chave a
        -- avançar. A busca é limitada às duas inscrições da própria partida.
        IF v_new_reg_id IS NULL AND NEW.winner_id IS NOT NULL THEN
            SELECT cr.id INTO v_new_reg_id
            FROM public.championship_registrations cr
            WHERE cr.user_id = NEW.winner_id
              AND cr.id IN (NEW.registration_a_id, NEW.registration_b_id);

            IF v_new_reg_id IS NOT NULL THEN
                UPDATE public.matches
                SET winner_registration_id = v_new_reg_id
                WHERE id = NEW.id
                  AND winner_registration_id IS NULL;
            END IF;
        END IF;
    END IF;

    IF v_old_reg_id IS NOT DISTINCT FROM v_new_reg_id THEN
        RETURN NEW;
    END IF;

    -- O vencedor antigo já jogou (ou está jogando) a partida seguinte.
    IF v_old_reg_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.matches m
        WHERE m.status <> 'pending'
          AND (
                (m.player_a_source_match_id = NEW.id AND m.registration_a_id = v_old_reg_id)
             OR (m.player_b_source_match_id = NEW.id AND m.registration_b_id = v_old_reg_id)
          )
    ) THEN
        RAISE EXCEPTION 'O jogo seguinte da chave já tem resultado com o vencedor anterior.'
            USING HINT = 'Reabra o jogo seguinte antes de trocar o vencedor desta partida.';
    END IF;

    IF v_new_reg_id IS NOT NULL THEN
        SELECT user_id INTO v_new_user_id
        FROM public.championship_registrations
        WHERE id = v_new_reg_id;
    END IF;

    -- Vaga vazia recebe o vencedor; vaga do vencedor antigo passa ao novo
    -- (ou fica vazia, se a partida foi reaberta).
    UPDATE public.matches
    SET registration_a_id = v_new_reg_id,
        player_a_id       = v_new_user_id
    WHERE player_a_source_match_id = NEW.id
      AND status = 'pending'
      AND (registration_a_id = v_old_reg_id OR (registration_a_id IS NULL AND v_new_reg_id IS NOT NULL));

    UPDATE public.matches
    SET registration_b_id = v_new_reg_id,
        player_b_id       = v_new_user_id
    WHERE player_b_source_match_id = NEW.id
      AND status = 'pending'
      AND (registration_b_id = v_old_reg_id OR (registration_b_id IS NULL AND v_new_reg_id IS NOT NULL));

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_bracket_winner ON public.matches;
CREATE TRIGGER trg_propagate_bracket_winner
    AFTER UPDATE OF status, winner_registration_id, walkover_winner_registration_id, winner_id
    ON public.matches
    FOR EACH ROW
    EXECUTE FUNCTION public.propagate_bracket_winner();

