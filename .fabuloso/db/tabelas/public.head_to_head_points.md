# public.head_to_head_points
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| winner_id | uuid | não |  |  |
| loser_id | uuid | não |  |  |
| match_type | text | não |  |  |
| points | integer | não |  |  |
| match_id | uuid | sim |  |  |
| is_active | boolean | não | `true` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| invalidated_at | timestamp with time zone | sim |  |  |
| invalidated_by_match_id | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (invalidated_by_match_id) → public.matches(id)
- FK (loser_id) → public.profiles(id) on delete cascade
- FK (match_id) → public.matches(id)
- FK (winner_id) → public.profiles(id) on delete cascade
- CHECK h2h_different_players: `CHECK ((winner_id <> loser_id))`
- CHECK head_to_head_points_match_type_check: `CHECK ((match_type = ANY (ARRAY['challenge'::text, 'superset'::text])))`
- CHECK head_to_head_points_points_check: `CHECK ((points > 0))`

## Índices
- idx_h2h_pair_active: `btree (LEAST((winner_id)::text, (loser_id)::text), GREATEST((winner_id)::text, (loser_id)::text)) WHERE (is_active = true)`
- idx_h2h_winner: `btree (winner_id, is_active)`

## Políticas RLS
- "Authenticated users can read h2h points" — SELECT para authenticated · using `true`
- "Service role manages h2h points" — ALL para public · using `(auth.role() = 'service_role'::text)`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
