# public.championship_winners
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | sim |  |  |
| category | text | não |  |  |
| winner_id | uuid | sim |  |  |
| position | integer | sim | `1` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (winner_id) → public.profiles(id) on delete set null
- UNIQUE (championship_id, category, position)

## Índices
- championship_winners_championship_id_category_position_key: `btree (championship_id, category, "position")` único

## Políticas RLS
- "Admin insert" — INSERT para public · check `true`
- "Admin update" — UPDATE para public · using `true`
- "Public read" — SELECT para public · using `true`

## Gatilhos
- update_championship_winners_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
