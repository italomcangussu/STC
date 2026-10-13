# fin_private.whatsapp_receipt_intents
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não |  |  |
| source_message_id | uuid | não |  |  |
| conversation_id | uuid | não |  |  |
| profile_id | uuid | sim |  |  |
| contact_id | uuid | não |  |  |
| original_data | jsonb | não |  |  |
| status | text | não | `'awaiting_purpose'::text` |  |
| purpose_kind | text | sim |  |  |
| purpose_detail | text | sim |  |  |
| purpose_message_id | uuid | sim |  |  |
| confirmation_message_id | uuid | sim |  |  |
| finance_entry_id | uuid | sim |  |  |
| finance_submission_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (confirmation_message_id) → public.conv_messages(id)
- FK (contact_id) → public.conv_contacts(id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (finance_entry_id) → public.fin_entries(id)
- FK (finance_submission_id) → public.fin_receipt_submissions(id)
- FK (profile_id) → public.profiles(id)
- FK (purpose_message_id) → public.conv_messages(id)
- FK (source_message_id) → public.conv_messages(id)
- UNIQUE (source_message_id)
- CHECK whatsapp_receipt_intents_purpose_kind_check: `CHECK ((purpose_kind = ANY (ARRAY['donation'::text, 'membership'::text, 'member_pendency'::text, 'student_card'::text, 'day_card'::text, 'other'::text])))`
- CHECK whatsapp_receipt_intents_status_check: `CHECK ((status = ANY (ARRAY['awaiting_purpose'::text, 'awaiting_confirmation'::text, 'confirmed'::text, 'needs_review'::text, 'canceled'::text])))`

## Índices
- whatsapp_receipt_intents_pending_idx: `btree (conversation_id, created_at) WHERE (status = ANY (ARRAY['awaiting_purpose'::text, 'awaiting_confirmation'::text]))`
- whatsapp_receipt_intents_source_message_id_key: `btree (source_message_id)` único

## Políticas RLS
- (RLS desligado)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
