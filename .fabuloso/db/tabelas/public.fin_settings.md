# public.fin_settings
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | boolean | não | `true` |  |
| due_day | smallint | não | `5` |  |
| due_month_offset | smallint | não | `0` |  |
| non_business_rule | text | não | `'next_business_day'::text` |  |
| saturday_is_business | boolean | não | `false` |  |
| horizon_months | smallint | não | `1` |  |
| late_fee_confirmed_at | timestamp with time zone | sim |  |  |
| late_fee_confirmed_by | uuid | sim |  |  |
| grace_days | smallint | não | `0` |  |
| fine_fixed_cents | bigint | sim |  |  |
| fine_percent_bps | integer | sim |  |  |
| interest_daily_fixed_cents | bigint | sim |  |  |
| interest_daily_percent_bps | integer | sim |  |  |
| day_card_price_cents | bigint | não | `5000` |  |
| day_card_in_cash | boolean | não | `false` |  |
| payee_names | text[] | não | `'{}'::text[]` |  |
| version | integer | não | `1` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |
| pix_key | text | não | `'52.393.541/0001-20'::text` |  |
| pendency_automation_enabled | boolean | não | `true` |  |
| pendency_reminder_days | integer[] | não | `ARRAY[0, 3, 7, 14, 21]` |  |
| pendency_grace_days | smallint | não | `0` |  |
| pendency_fine_fixed_cents | bigint | não | `0` |  |
| pendency_fine_percent_bps | integer | não | `0` |  |
| pendency_interest_daily_fixed_cents | bigint | não | `0` |  |
| pendency_interest_daily_percent_bps | integer | não | `0` |  |

## Chaves e restrições
- PK (id)
- FK (late_fee_confirmed_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK fin_settings_day_card_price_cents_check: `CHECK (((day_card_price_cents >= 0) AND (day_card_price_cents <= 100000000)))`
- CHECK fin_settings_due_day_check: `CHECK (((due_day >= 1) AND (due_day <= 31)))`
- CHECK fin_settings_due_month_offset_check: `CHECK (((due_month_offset >= 0) AND (due_month_offset <= 2)))`
- CHECK fin_settings_fine_fixed_cents_check: `CHECK (((fine_fixed_cents IS NULL) OR ((fine_fixed_cents >= 0) AND (fine_fixed_cents <= 100000000))))`
- CHECK fin_settings_fine_percent_bps_check: `CHECK (((fine_percent_bps IS NULL) OR ((fine_percent_bps >= 0) AND (fine_percent_bps <= 10000))))`
- CHECK fin_settings_grace_days_check: `CHECK (((grace_days >= 0) AND (grace_days <= 60)))`
- CHECK fin_settings_horizon_months_check: `CHECK (((horizon_months >= 0) AND (horizon_months <= 24)))`
- CHECK fin_settings_id_check: `CHECK (id)`
- CHECK fin_settings_interest_daily_fixed_cents_check: `CHECK (((interest_daily_fixed_cents IS NULL) OR ((interest_daily_fixed_cents >= 0) AND (interest_daily_fixed_cents <= 100000000))))`
- CHECK fin_settings_interest_daily_percent_bps_check: `CHECK (((interest_daily_percent_bps IS NULL) OR ((interest_daily_percent_bps >= 0) AND (interest_daily_percent_bps <= 10000))))`
- CHECK fin_settings_non_business_rule_check: `CHECK ((non_business_rule = ANY (ARRAY['next_business_day'::text, 'previous_business_day'::text, 'keep'::text])))`
- CHECK fin_settings_pendency_fine_fixed_check: `CHECK (((pendency_fine_fixed_cents >= 0) AND (pendency_fine_fixed_cents <= 100000000)))`
- CHECK fin_settings_pendency_fine_pct_check: `CHECK (((pendency_fine_percent_bps >= 0) AND (pendency_fine_percent_bps <= 10000)))`
- CHECK fin_settings_pendency_grace_check: `CHECK (((pendency_grace_days >= 0) AND (pendency_grace_days <= 60)))`
- CHECK fin_settings_pendency_interest_fixed_check: `CHECK (((pendency_interest_daily_fixed_cents >= 0) AND (pendency_interest_daily_fixed_cents <= 100000000)))`
- CHECK fin_settings_pendency_interest_pct_check: `CHECK (((pendency_interest_daily_percent_bps >= 0) AND (pendency_interest_daily_percent_bps <= 10000)))`
- CHECK fin_settings_pendency_reminders_check: `CHECK (((cardinality(pendency_reminder_days) >= 1) AND (cardinality(pendency_reminder_days) <= 20)))`

## Políticas RLS
- "fin_settings_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_settings_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_settings_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_settings_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_settings_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_settings_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
