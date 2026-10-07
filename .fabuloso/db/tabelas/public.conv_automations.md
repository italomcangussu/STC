# public.conv_automations
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| name | text | não |  |  |
| description | text | não | `''::text` |  |
| objective | text | não | `''::text` |  |
| source | text | não |  |  |
| trigger_type | text | não |  |  |
| definition | jsonb | não | `'{}'::jsonb` |  |
| schedule | jsonb | não | `'{}'::jsonb` |  |
| message_body | text | não | `''::text` |  |
| status | text | não | `'draft'::text` |  |
| version | integer | não | `1` |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| activated_at | timestamp with time zone | sim |  |  |
| ended_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK conv_automation_combo: `CHECK ((((source = ANY (ARRAY['finance_charge'::text, 'card_mensal'::text])) AND (trigger_type = ANY (ARRAY['scheduled'::text, 'conditional'::text, 'manual'::text]))) OR ((source = ANY (ARRAY['champi…`
- CHECK conv_automations_description_check: `CHECK ((length(description) <= 500))`
- CHECK conv_automations_message_body_check: `CHECK ((length(message_body) <= 1000))`
- CHECK conv_automations_name_check: `CHECK (((length(TRIM(BOTH FROM name)) >= 3) AND (length(TRIM(BOTH FROM name)) <= 80)))`
- CHECK conv_automations_objective_check: `CHECK ((length(objective) <= 300))`
- CHECK conv_automations_source_check: `CHECK ((source = ANY (ARRAY['finance_charge'::text, 'championship_notice'::text, 'championship_result'::text, 'championship_advance'::text, 'card_mensal'::text, 'audience'::text])))`
- CHECK conv_automations_status_check: `CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'ended'::text])))`
- CHECK conv_automations_trigger_type_check: `CHECK ((trigger_type = ANY (ARRAY['scheduled'::text, 'conditional'::text, 'event'::text, 'manual'::text])))`

## Referenciada por
- public.conv_automation_recipients.automation_id
- public.conv_automation_runs.automation_id
- public.conv_automation_versions.automation_id

## Políticas RLS
- "conv_automations_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_automations_no_delete — BEFORE DELETE → conv_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
