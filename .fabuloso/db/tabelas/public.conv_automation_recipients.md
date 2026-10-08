# public.conv_automation_recipients
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| run_id | uuid | não |  |  |
| automation_id | uuid | não |  |  |
| purpose_key | text | não |  |  |
| dedupe_key | text | não |  |  |
| profile_id | uuid | sim |  |  |
| student_id | uuid | sim |  |  |
| contact_id | uuid | sim |  |  |
| phone | text | sim |  |  |
| display_name | text | sim |  |  |
| subject | jsonb | não | `'{}'::jsonb` |  |
| body | text | sim |  |  |
| status | text | não | `'pending'::text` |  |
| skip_reason | text | sim |  |  |
| attempts | integer | não | `0` |  |
| due_at | timestamp with time zone | não | `now()` |  |
| claimed_at | timestamp with time zone | sim |  |  |
| sent_at | timestamp with time zone | sim |  |  |
| message_id | uuid | sim |  |  |
| last_error | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (automation_id) → public.conv_automations(id)
- FK (contact_id) → public.conv_contacts(id)
- FK (message_id) → public.conv_messages(id)
- FK (profile_id) → public.profiles(id)
- FK (run_id) → public.conv_automation_runs(id)
- FK (student_id) → public.non_socio_students(id)
- CHECK conv_automation_recipients_body_check: `CHECK (((body IS NULL) OR (length(body) <= 1000)))`
- CHECK conv_automation_recipients_display_name_check: `CHECK (((display_name IS NULL) OR (length(display_name) <= 200)))`
- CHECK conv_automation_recipients_last_error_check: `CHECK (((last_error IS NULL) OR (length(last_error) <= 300)))`
- CHECK conv_automation_recipients_phone_check: `CHECK (((phone IS NULL) OR (phone ~ '^[1-9][0-9]{9,14}$'::text)))`
- CHECK conv_automation_recipients_skip_reason_check: `CHECK (((skip_reason IS NULL) OR (length(skip_reason) <= 120)))`
- CHECK conv_automation_recipients_status_check: `CHECK ((status = ANY (ARRAY['review'::text, 'pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text, 'canceled'::text])))`

## Referenciada por (1)
public.conv_messages.automation_recipient_id

## Índices
- conv_automation_recipients_contact_idx: `btree (contact_id) WHERE (contact_id IS NOT NULL)`
- conv_automation_recipients_dedupe: `btree (purpose_key, dedupe_key) WHERE (status <> 'canceled'::text)` único
- conv_automation_recipients_due_idx: `btree (due_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]))`
- conv_automation_recipients_run_idx: `btree (run_id, status)`

## Políticas RLS
- "conv_automation_recipients_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_automation_recipients_no_delete — BEFORE DELETE → conv_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
