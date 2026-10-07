# public.conv_messages
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | não |  |  |
| direction | text | não |  |  |
| origin | text | não |  |  |
| sender_contact_id | uuid | sim |  |  |
| author_id | uuid | sim |  |  |
| kind | text | não | `'text'::text` |  |
| body | text | sim |  |  |
| status | text | não | `'queued'::text` |  |
| provider_message_id | text | sim |  |  |
| request_id | uuid | sim |  |  |
| sent_at | timestamp with time zone | sim |  |  |
| attempts | integer | não | `0` |  |
| last_error | text | sim |  |  |
| media_path | text | sim |  |  |
| media_mime | text | sim |  |  |
| media_name | text | sim |  |  |
| meta | jsonb | não | `'{}'::jsonb` |  |
| reply_to_provider_id | text | sim |  |  |
| reply_preview | text | sim |  |  |
| edited_at | timestamp with time zone | sim |  |  |
| deleted_at | timestamp with time zone | sim |  |  |
| reactions | jsonb | não | `'{}'::jsonb` |  |
| mention_direct | boolean | não | `false` |  |
| mention_evidence | text | sim |  |  |
| ai_session_id | uuid | sim |  |  |
| automation_recipient_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (ai_session_id) → public.conv_ai_sessions(id)
- FK (author_id) → public.profiles(id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (automation_recipient_id) → public.conv_automation_recipients(id)
- FK (sender_contact_id) → public.conv_contacts(id)
- CHECK conv_messages_body_check: `CHECK (((body IS NULL) OR (length(body) <= 8192)))`
- CHECK conv_messages_check: `CHECK ((((direction = 'inbound'::text) AND (origin = 'customer'::text)) OR ((direction = 'outbound'::text) AND (origin <> 'customer'::text))))`
- CHECK conv_messages_direction_check: `CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))`
- CHECK conv_messages_kind_check: `CHECK ((kind = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'audio'::text, 'ptt'::text, 'document'::text, 'sticker'::text, 'location'::text, 'contact'::text, 'other'::text])))`
- CHECK conv_messages_last_error_check: `CHECK (((last_error IS NULL) OR (length(last_error) <= 300)))`
- CHECK conv_messages_mention_evidence_check: `CHECK (((mention_evidence IS NULL) OR (length(mention_evidence) <= 80)))`
- CHECK conv_messages_origin_check: `CHECK ((origin = ANY (ARRAY['customer'::text, 'staff'::text, 'ai'::text, 'automation'::text, 'system'::text])))`
- CHECK conv_messages_reply_preview_check: `CHECK (((reply_preview IS NULL) OR (length(reply_preview) <= 200)))`
- CHECK conv_messages_status_check: `CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'received'::text])))`

## Referenciada por
- public.conv_ai_memory_candidates.source_message_id
- public.conv_ai_sessions.trigger_message_id
- public.conv_automation_recipients.message_id
- public.conv_booking_proposals.confirmed_message_id
- public.conv_followups.message_id

## Índices
- conv_messages_conversation_idx: `btree (conversation_id, created_at DESC)`
- conv_messages_provider_uidx: `btree (provider_message_id) WHERE (provider_message_id IS NOT NULL)` único
- conv_messages_request_uidx: `btree (request_id) WHERE (request_id IS NOT NULL)` único
- conv_messages_sender_idx: `btree (sender_contact_id, created_at DESC) WHERE (sender_contact_id IS NOT NULL)`
- conv_messages_session_idx: `btree (ai_session_id, created_at) WHERE (ai_session_id IS NOT NULL)`

## Políticas RLS
- "conv_messages_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_messages_no_delete — BEFORE DELETE → conv_private.no_delete()
- conv_messages_opt_out — AFTER INSERT → conv_private.on_inbound_opt_out()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
