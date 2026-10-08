# public.conv_ai_decisions
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | sim |  |  |
| session_id | uuid | sim |  |  |
| settings_version | integer | sim |  |  |
| decision | text | não |  |  |
| tool_name | text | sim |  |  |
| tool_result | jsonb | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (session_id) → public.conv_ai_sessions(id)
- FK (settings_version) → public.conv_ai_settings(version)
- CHECK conv_ai_decisions_decision_check: `CHECK ((length(decision) <= 60))`
- CHECK conv_ai_decisions_tool_name_check: `CHECK (((tool_name IS NULL) OR (length(tool_name) <= 60)))`

## Índices
- conv_ai_decisions_conversation_idx: `btree (conversation_id, created_at DESC)`
- conv_ai_decisions_day_idx: `btree (created_at DESC)`

## Políticas RLS
- "conv_ai_decisions_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
