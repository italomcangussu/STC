# public.club_form_voter_receipts
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| form_id | uuid | não |  |  |
| user_id | uuid | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (form_id) → public.club_forms(id) on delete cascade
- FK (user_id) → public.profiles(id) on delete cascade
- UNIQUE (form_id, user_id)

## Índices
- club_form_voter_receipts_user_unique: `btree (form_id, user_id)` único
- idx_club_form_voter_receipts_lookup: `btree (form_id, user_id)`

## Políticas RLS
- "Users can insert own receipt" — INSERT para authenticated · check `((auth.uid() = user_id) OR is_admin())`
- "Users can view own receipts or admins view all" — SELECT para authenticated · using `((auth.uid() = user_id) OR is_admin())`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
