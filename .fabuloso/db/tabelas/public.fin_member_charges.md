# public.fin_member_charges
> tabela · RLS on · ~<100 linhas — Mensalidades e pendencias financeiras de socios

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| plan_id | uuid | sim |  |  |
| profile_id | uuid | não |  |  |
| competence_month | date | não |  |  |
| period_months | smallint | não |  |  |
| due_date | date | não |  |  |
| original_amount_cents | bigint | não |  |  |
| status | text | não | `'open'::text` |  |
| cancel_reason | text | sim |  |  |
| canceled_at | timestamp with time zone | sim |  |  |
| canceled_by | uuid | sim |  |  |
| source | text | não | `'generated'::text` |  |
| notes | text | sim |  |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |
| charge_type | text | não | `'membership'::text` |  |
| description | text | sim |  |  |
| pendency_kind | text | sim |  |  |
| category_id | uuid | sim |  |  |
| guest_name | text | sim |  |  |
| guest_date | date | sim |  |  |
| collection_enabled | boolean | não | `true` |  |

## Chaves e restrições
- PK (id)
- FK (canceled_by) → public.profiles(id)
- FK (category_id) → public.fin_categories(id)
- FK (created_by) → public.profiles(id)
- FK (plan_id) → public.fin_member_plans(id)
- FK (profile_id) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- UNIQUE (plan_id, competence_month)
- CHECK fin_member_charges_charge_type_check: `CHECK ((charge_type = ANY (ARRAY['membership'::text, 'member_pendency'::text])))`
- CHECK fin_member_charges_check: `CHECK (((status <> 'canceled'::text) OR ((canceled_at IS NOT NULL) AND (cancel_reason IS NOT NULL))))`
- CHECK fin_member_charges_competence_month_check: `CHECK ((EXTRACT(day FROM competence_month) = (1)::numeric))`
- CHECK fin_member_charges_guest_name_check: `CHECK (((guest_name IS NULL) OR ((length(TRIM(BOTH FROM guest_name)) >= 2) AND (length(TRIM(BOTH FROM guest_name)) <= 120))))`
- CHECK fin_member_charges_notes_check: `CHECK (((notes IS NULL) OR (length(notes) <= 1000)))`
- CHECK fin_member_charges_original_amount_cents_check: `CHECK (((original_amount_cents > 0) AND (original_amount_cents <= 1000000000)))`
- CHECK fin_member_charges_pendency_kind_check: `CHECK (((pendency_kind IS NULL) OR (pendency_kind = ANY (ARRAY['day_card'::text, 'consumo'::text, 'evento'::text, 'multa'::text, 'dano_reposicao'::text, 'outros'::text]))))`
- CHECK fin_member_charges_period_months_check: `CHECK ((period_months = ANY (ARRAY[1, 3, 6, 12])))`
- CHECK fin_member_charges_shape_check: `CHECK ((((charge_type = 'membership'::text) AND (plan_id IS NOT NULL)) OR ((charge_type = 'member_pendency'::text) AND (plan_id IS NULL) AND (description IS NOT NULL) AND ((length(TRIM(BOTH FROM desc…`
- CHECK fin_member_charges_source_check: `CHECK ((source = ANY (ARRAY['generated'::text, 'manual'::text])))`
- CHECK fin_member_charges_status_check: `CHECK ((status = ANY (ARRAY['open'::text, 'partial'::text, 'paid'::text, 'canceled'::text])))`

## Referenciada por
- public.fin_charge_adjustments.charge_id
- public.fin_charge_payments.charge_id
- public.fin_receipt_charges.charge_id

## Índices
- fin_member_charges_due_idx: `btree (due_date) WHERE (status = ANY (ARRAY['open'::text, 'partial'::text]))`
- fin_member_charges_plan_id_competence_month_key: `btree (plan_id, competence_month)` único
- fin_member_charges_profile_idx: `btree (profile_id, competence_month DESC)`
- fin_member_charges_status_idx: `btree (status)`
- fin_member_pendency_profile_status_idx: `btree (profile_id, due_date, id) WHERE ((charge_type = 'member_pendency'::text) AND (status = ANY (ARRAY['open'::text, 'partial'::text])))`

## Políticas RLS
- "fin_member_charges_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_member_charges_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_member_charges_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_member_charges_read" — SELECT para authenticated · using `(is_admin() OR (profile_id = ( SELECT auth.uid() AS uid)))`

## Gatilhos
- fin_member_charges_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_member_charges_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
