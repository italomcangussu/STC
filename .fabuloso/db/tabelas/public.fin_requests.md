# public.fin_requests
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| request_id | uuid | não |  |  |
| action | text | não |  |  |
| actor_id | uuid | sim |  |  |
| result | jsonb | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (request_id)
- FK (actor_id) → public.profiles(id)

## Índices
- fin_requests_actor_idx: `btree (actor_id)`

## Políticas RLS
- "fin_requests_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_requests_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_requests_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_requests_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
