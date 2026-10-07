# public.conv_webhook_log
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | bigint | não |  | identity |
| at | timestamp with time zone | não | `now()` |  |
| event | text | não |  |  |
| outcome | text | não |  |  |
| detail | text | sim |  |  |

## Chaves e restrições
- PK (id)
- CHECK conv_webhook_log_detail_check: `CHECK (((detail IS NULL) OR (length(detail) <= 200)))`

## Índices
- conv_webhook_log_at_idx: `btree (at DESC)`

## Políticas RLS
- "conv_webhook_log_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
