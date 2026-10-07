# public.conv_quick_replies
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| shortcut | text | não |  |  |
| title | text | não |  |  |
| body | text | não |  |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- UNIQUE (shortcut)
- CHECK conv_quick_replies_body_check: `CHECK (((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 4096)))`
- CHECK conv_quick_replies_shortcut_check: `CHECK ((shortcut ~ '^[a-z0-9_-]{1,30}$'::text))`
- CHECK conv_quick_replies_title_check: `CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 80)))`

## Índices
- conv_quick_replies_shortcut_key: `btree (shortcut)` único

## Políticas RLS
- "conv_quick_replies_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
