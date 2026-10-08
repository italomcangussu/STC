# public.conv_automation_runs
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| automation_id | uuid | não |  |  |
| version | integer | não |  |  |
| kind | text | não |  |  |
| planned_for | timestamp with time zone | não |  |  |
| status | text | não | `'running'::text` |  |
| created_by | uuid | sim |  |  |
| request_key | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| finished_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (automation_id) → public.conv_automations(id)
- FK (created_by) → public.profiles(id)
- UNIQUE (automation_id, planned_for)
- UNIQUE (request_key)
- CHECK conv_automation_runs_kind_check: `CHECK ((kind = ANY (ARRAY['scheduled'::text, 'conditional'::text, 'event'::text, 'manual'::text])))`
- CHECK conv_automation_runs_status_check: `CHECK ((status = ANY (ARRAY['review'::text, 'running'::text, 'done'::text, 'canceled'::text])))`

## Referenciada por (1)
public.conv_automation_recipients.run_id

## Índices
- conv_automation_runs_automation_id_planned_for_key: `btree (automation_id, planned_for)` único
- conv_automation_runs_automation_idx: `btree (automation_id, created_at DESC)`
- conv_automation_runs_request_key_key: `btree (request_key)` único

## Políticas RLS
- "conv_automation_runs_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
