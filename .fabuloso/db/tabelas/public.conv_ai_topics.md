# public.conv_ai_topics
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não |  |  |
| conversation_id | uuid | não |  |  |
| requester_contact_id | uuid | não |  |  |
| session_id | uuid | sim |  |  |
| intent | text | não |  |  |
| domain | text | não | `'outro'::text` |  |
| status | text | não |  |  |
| slots | jsonb | não | `'{}'::jsonb` |  |
| summary | text | não | `''::text` |  |
| last_question | text | sim |  |  |
| next_step | text | sim |  |  |
| decisions | jsonb | não | `'[]'::jsonb` |  |
| outcome | text | sim |  |  |
| proposal_id | uuid | sim |  |  |
| close_reason | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| closed_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (proposal_id) → public.conv_booking_proposals(id) on delete set null
- FK (requester_contact_id) → public.conv_contacts(id)
- FK (session_id) → public.conv_ai_sessions(id)
- CHECK conv_ai_topics_domain_check: `CHECK ((domain = ANY (ARRAY['agenda'::text, 'admin'::text, 'outro'::text])))`
- CHECK conv_ai_topics_intent_check: `CHECK (((length(intent) >= 1) AND (length(intent) <= 40)))`
- CHECK conv_ai_topics_status_check: `CHECK ((status = ANY (ARRAY['awaiting_data'::text, 'awaiting_confirmation'::text, 'suspended'::text, 'completed'::text, 'canceled'::text, 'archived'::text])))`

## Índices
- conv_ai_topics_owner_idx: `btree (conversation_id, requester_contact_id, status, updated_at DESC)`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
