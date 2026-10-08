# public.conv_ai_sessions
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | não |  |  |
| requester_contact_id | uuid | não |  |  |
| trigger_message_id | uuid | sim |  |  |
| status | text | não | `'open'::text` |  |
| awaiting | boolean | não | `false` |  |
| memory | jsonb | não | `'{}'::jsonb` |  |
| turns | integer | não | `0` |  |
| started_at | timestamp with time zone | não | `now()` |  |
| last_turn_at | timestamp with time zone | sim |  |  |
| expires_at | timestamp with time zone | não |  |  |

## Chaves e restrições
- PK (id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (requester_contact_id) → public.conv_contacts(id)
- FK (trigger_message_id) → public.conv_messages(id)
- CHECK conv_ai_sessions_status_check: `CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'expired'::text, 'handoff'::text])))`

## Referenciada por (3)
public.conv_ai_decisions.session_id, public.conv_booking_proposals.session_id, public.conv_messages.ai_session_id

## Índices
- conv_ai_sessions_conversation_idx: `btree (conversation_id, status)`
- conv_ai_sessions_one_open: `btree (conversation_id, requester_contact_id) WHERE (status = 'open'::text)` único

## Políticas RLS
- "conv_ai_sessions_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
