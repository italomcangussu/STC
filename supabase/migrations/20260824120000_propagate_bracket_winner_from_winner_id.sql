-- Migration: propagate_bracket_winner ganha rede de proteção
--
-- O problema que esta migration fecha:
--   O marcador ao vivo gravava a partida com `winner_id` preenchido e
--   `winner_registration_id` nulo. A validação `validate_match_result_integrity`
--   aceita "um OU outro", então o resultado entrava. Já o
--   `propagate_bracket_winner` só sabia ler a inscrição — e desistia em silêncio:
--
--       IF v_winner_reg_id IS NULL THEN RETURN NEW; END IF;
--
--   Resultado: placar correto na tela, vencedor definido, e a chave seguinte
--   parada para sempre. Nenhum erro, nenhum log, nada para ninguém ver.
--   (Caso real: Open da Galera 2026, jogo 5 das quartas — a semifinal J7 ficou
--   com a vaga B vazia mesmo com a partida encerrada.)
--
-- A correção de origem está no app (lib/liveScore.ts recusa salvar partida de
-- campeonato sem inscrição). Esta aqui é a segunda linha de defesa, para as
-- telas antigas e para qualquer caminho futuro que só conheça `winner_id`.

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

    -- Rede de proteção: quem gravou só o perfil do vencedor ainda tem chave a
    -- avançar. A busca é limitada às duas inscrições da própria partida — sem
    -- isso um sócio inscrito em duas classes daria dois resultados e a escolha
    -- seria arbitrária.
    IF v_winner_reg_id IS NULL AND NEW.winner_id IS NOT NULL THEN
        SELECT cr.id INTO v_winner_reg_id
        FROM public.championship_registrations cr
        WHERE cr.user_id = NEW.winner_id
          AND cr.id IN (NEW.registration_a_id, NEW.registration_b_id);

        -- Deixa a linha coerente: vencedor definido nas duas identidades que o
        -- resto do sistema lê (pontuação e resolução de fases usam a inscrição).
        IF v_winner_reg_id IS NOT NULL THEN
            UPDATE public.matches
            SET winner_registration_id = v_winner_reg_id
            WHERE id = NEW.id
              AND winner_registration_id IS NULL;
        END IF;
    END IF;

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
