# public.conv_ai_member_context
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| profile_id | uuid | não |  |  |
| aliases | text[] | não | `'{}'::text[]` |  |
| social_context | text | não | `''::text` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (profile_id)
- FK (profile_id) → public.profiles(id) on delete cascade
- CHECK conv_ai_member_context_social_context_check: `CHECK ((length(social_context) <= 1200))`

## Políticas RLS
- "conv_ai_member_context_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
