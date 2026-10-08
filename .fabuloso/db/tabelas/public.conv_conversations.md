# public.conv_conversations
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| kind | text | não |  |  |
| contact_id | uuid | sim |  |  |
| group_id | uuid | sim |  |  |
| status | text | não | `'open'::text` |  |
| tags | text[] | não | `'{}'::text[]` |  |
| assigned_to | uuid | sim |  |  |
| staff_read_at | timestamp with time zone | sim |  |  |
| last_message_at | timestamp with time zone | sim |  |  |
| last_inbound_at | timestamp with time zone | sim |  |  |
| last_staff_at | timestamp with time zone | sim |  |  |
| handled_by_human | boolean | não | `false` |  |
| ai_status | text | não | `'ai'::text` |  |
| ai_turns | integer | não | `0` |  |
| ai_last_turn_at | timestamp with time zone | sim |  |  |
| handoff_kind | text | sim |  |  |
| handoff_note | text | sim |  |  |
| handoff_at | timestamp with time zone | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| merged_into | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (assigned_to) → public.profiles(id)
- FK (contact_id) → public.conv_contacts(id)
- FK (group_id) → public.conv_groups(id)
- FK (merged_into) → public.conv_conversations(id)
- CHECK conv_conversations_ai_status_check: `CHECK ((ai_status = ANY (ARRAY['ai'::text, 'human'::text, 'paused'::text])))`
- CHECK conv_conversations_check: `CHECK ((((kind = 'direct'::text) AND (contact_id IS NOT NULL) AND (group_id IS NULL)) OR ((kind = 'group'::text) AND (group_id IS NOT NULL) AND (contact_id IS NULL))))`
- CHECK conv_conversations_handoff_kind_check: `CHECK ((handoff_kind = ANY (ARRAY['soft'::text, 'hard'::text])))`
- CHECK conv_conversations_handoff_note_check: `CHECK (((handoff_note IS NULL) OR (length(handoff_note) <= 1000)))`
- CHECK conv_conversations_kind_check: `CHECK ((kind = ANY (ARRAY['direct'::text, 'group'::text])))`
- CHECK conv_conversations_status_check: `CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))`
- CHECK conv_conversations_tags_check: `CHECK ((cardinality(tags) <= 12))`

## Referenciada por (7)
public.conv_ai_decisions.conversation_id, public.conv_ai_sessions.conversation_id, public.conv_booking_proposals.conversation_id, public.conv_conversations.merged_into, public.conv_followups.conversation_id, public.conv_messages.conversation_id, public.conv_notes.conversation_id

## Índices
- conv_conversations_contact_idx: `btree (contact_id)`
- conv_conversations_group_idx: `btree (group_id)`
- conv_conversations_last_idx: `btree (last_message_at DESC NULLS LAST)`
- conv_conversations_one_open_direct: `btree (contact_id) WHERE ((status = 'open'::text) AND (kind = 'direct'::text))` único
- conv_conversations_one_open_group: `btree (group_id) WHERE ((status = 'open'::text) AND (kind = 'group'::text))` único

## Políticas RLS
- "conv_conversations_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_conversations_no_delete — BEFORE DELETE → conv_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
