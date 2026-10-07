# public.fin_member_plans
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| profile_id | uuid | não |  |  |
| start_on | date | não |  |  |
| ended_on | date | sim |  |  |
| status | text | não | `'active'::text` |  |
| period_months | smallint | não | `1` |  |
| due_day | smallint | sim |  |  |
| due_month_offset | smallint | sim |  |  |
| notes | text | sim |  |  |
| end_reason | text | sim |  |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (profile_id) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK fin_member_plans_check: `CHECK (((ended_on IS NULL) OR (ended_on >= start_on)))`
- CHECK fin_member_plans_check1: `CHECK (((status = 'ended'::text) = (ended_on IS NOT NULL)))`
- CHECK fin_member_plans_due_day_check: `CHECK (((due_day >= 1) AND (due_day <= 31)))`
- CHECK fin_member_plans_due_month_offset_check: `CHECK (((due_month_offset >= 0) AND (due_month_offset <= 2)))`
- CHECK fin_member_plans_notes_check: `CHECK (((notes IS NULL) OR (length(notes) <= 1000)))`
- CHECK fin_member_plans_period_months_check: `CHECK ((period_months = ANY (ARRAY[1, 3, 6, 12])))`
- CHECK fin_member_plans_status_check: `CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text])))`

## Referenciada por
- public.fin_member_charges.plan_id
- public.fin_member_plan_prices.plan_id

## Índices
- fin_member_plans_one_live: `btree (profile_id) WHERE (status <> 'ended'::text)` único
- fin_member_plans_profile_idx: `btree (profile_id)`

## Políticas RLS
- "fin_member_plans_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_member_plans_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_member_plans_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_member_plans_read" — SELECT para authenticated · using `(is_admin() OR (profile_id = ( SELECT auth.uid() AS uid)))`

## Gatilhos
- fin_member_plans_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_member_plans_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
