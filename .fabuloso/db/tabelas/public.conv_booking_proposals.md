# public.conv_booking_proposals
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | não |  |  |
| session_id | uuid | não |  |  |
| requester_contact_id | uuid | não |  |  |
| requester_profile_id | uuid | não |  |  |
| action | text | não | `'create'::text` |  |
| payload | jsonb | não |  |  |
| status | text | não | `'open'::text` |  |
| request_key | uuid | não | `gen_random_uuid()` |  |
| expires_at | timestamp with time zone | não |  |  |
| confirmed_message_id | uuid | sim |  |  |
| confirmed_by_contact_id | uuid | sim |  |  |
| confirmed_at | timestamp with time zone | sim |  |  |
| reservation_id | uuid | sim |  |  |
| failure_code | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (confirmed_by_contact_id) → public.conv_contacts(id)
- FK (confirmed_message_id) → public.conv_messages(id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (requester_contact_id) → public.conv_contacts(id)
- FK (requester_profile_id) → public.profiles(id)
- FK (reservation_id) → public.reservations(id) on delete set null
- FK (session_id) → public.conv_ai_sessions(id)
- UNIQUE (request_key)
- CHECK conv_booking_proposals_action_check: `CHECK ((action = ANY (ARRAY['create'::text, 'cancel'::text, 'reschedule'::text, 'join'::text, 'participants'::text, 'fin_pendency_create'::text, 'fin_pendency_collection'::text, 'fin_pendency_send'::…`
- CHECK conv_booking_proposals_status_check: `CHECK ((status = ANY (ARRAY['open'::text, 'confirmed'::text, 'failed'::text, 'expired'::text, 'canceled'::text])))`
- CHECK conv_proposal_confirmed_consistent: `CHECK (((status <> 'confirmed'::text) OR (confirmed_at IS NOT NULL)))`

## Índices
- conv_booking_proposals_request_key_key: `btree (request_key)` único
- conv_proposals_conversation_idx: `btree (conversation_id, created_at DESC)`
- conv_proposals_one_open: `btree (session_id) WHERE (status = 'open'::text)` único
- conv_proposals_reservation_uidx: `btree (reservation_id) WHERE ((reservation_id IS NOT NULL) AND (action <> 'cancel'::text))` único

## Políticas RLS
- "conv_booking_proposals_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
