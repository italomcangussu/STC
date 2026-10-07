# public.conv_notes
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | não |  |  |
| body | text | não |  |  |
| author_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (author_id) → public.profiles(id)
- FK (conversation_id) → public.conv_conversations(id)
- CHECK conv_notes_body_check: `CHECK (((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 4000)))`

## Índices
- conv_notes_conversation_idx: `btree (conversation_id, created_at DESC)`

## Políticas RLS
- "conv_notes_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
