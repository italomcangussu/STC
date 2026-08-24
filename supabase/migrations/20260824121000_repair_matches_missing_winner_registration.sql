-- Migration: reparo das partidas gravadas sem a inscrição do vencedor
--
-- Consequência do bug corrigido em 20260824120000: partidas encerradas ficaram
-- com `winner_id` preenchido e `winner_registration_id` nulo. Onde a chave
-- depende daquele jogo, o vencedor está definido e a vaga seguinte, vazia.
--
-- Levantamento em 2026-08-24 — 17 partidas, todas recuperáveis:
--   3º Circuito de Inverno .. 14 partidas, 0 travando chave  (encerrado)
--   Resenha Open 2026 .......  1 partida,  1 travando chave  (encerrado)
--   Open da Galera 2026 .....  2 partidas, 2 travando chave  (em andamento)
--
-- Só mexe em campeonato em andamento. Torneio encerrado já foi pontuado e virou
-- registro histórico: reescrever o quadro dele agora é decisão da organização do
-- clube, não de migration. Fica de fora, por escolha, a semifinal J18 do Resenha
-- Open 2026 — e, pelo mesmo critério, as 14 partidas do 3º Circuito, que não
-- travam chave nenhuma.
--
-- Na prática esta migration corrige as 2 partidas do Open da Galera 2026:
--   J1 qualify  (Mailson Freitas) → vaga B das quartas J3
--   J5 quartas  (Thieslley Soares) → vaga B da semifinal J7

-- ── 1. Reconstruir a identidade de inscrição do vencedor ──────────────────────
-- A inscrição sai do cruzamento entre `winner_id` e as duas inscrições da
-- própria partida. Limitar às duas evita escolher errado quando o mesmo sócio
-- está inscrito em mais de uma classe.

UPDATE public.matches m
SET winner_registration_id = cr.id
FROM public.championship_registrations cr,
     public.championships c
WHERE c.id = m.championship_id
  AND c.status <> 'finished'
  AND m.status = 'finished'
  AND m.winner_registration_id IS NULL
  AND m.walkover_winner_registration_id IS NULL
  AND m.winner_id IS NOT NULL
  AND cr.user_id = m.winner_id
  AND cr.id IN (m.registration_a_id, m.registration_b_id);

-- ── 2. Destravar as chaves paradas ────────────────────────────────────────────
-- Faz à mão o que o trigger faria: ele só dispara na transição
-- pending → finished, e estas partidas já estão encerradas há dias.

UPDATE public.matches dep
SET registration_a_id = src.winner_registration_id,
    player_a_id       = (SELECT cr.user_id FROM public.championship_registrations cr
                         WHERE cr.id = src.winner_registration_id)
FROM public.matches src
JOIN public.championships c ON c.id = src.championship_id
WHERE dep.player_a_source_match_id = src.id
  AND dep.status = 'pending'
  AND dep.registration_a_id IS NULL
  AND src.status = 'finished'
  AND src.winner_registration_id IS NOT NULL
  AND c.status <> 'finished';

UPDATE public.matches dep
SET registration_b_id = src.winner_registration_id,
    player_b_id       = (SELECT cr.user_id FROM public.championship_registrations cr
                         WHERE cr.id = src.winner_registration_id)
FROM public.matches src
JOIN public.championships c ON c.id = src.championship_id
WHERE dep.player_b_source_match_id = src.id
  AND dep.status = 'pending'
  AND dep.registration_b_id IS NULL
  AND src.status = 'finished'
  AND src.winner_registration_id IS NOT NULL
  AND c.status <> 'finished';
