# public.conv_requests
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
- conv_requests_actor_idx: `btree (actor_id)`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
