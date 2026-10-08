# public.fin_recurrences
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| description | text | não |  |  |
| supplier | text | sim |  |  |
| category_id | uuid | não |  |  |
| amount_cents | bigint | não |  |  |
| frequency | text | não |  |  |
| due_day | smallint | não |  |  |
| due_month_offset | smallint | não | `0` |  |
| start_month | date | não |  |  |
| end_month | date | sim |  |  |
| account_id | uuid | sim |  |  |
| notes | text | sim |  |  |
| active | boolean | não | `true` |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (account_id) → public.fin_accounts(id)
- FK (category_id) → public.fin_categories(id)
- FK (created_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK fin_recurrences_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= 1000000000)))`
- CHECK fin_recurrences_check: `CHECK (((end_month IS NULL) OR ((EXTRACT(day FROM end_month) = (1)::numeric) AND (end_month >= start_month))))`
- CHECK fin_recurrences_description_check: `CHECK (((length(TRIM(BOTH FROM description)) >= 2) AND (length(TRIM(BOTH FROM description)) <= 140)))`
- CHECK fin_recurrences_due_day_check: `CHECK (((due_day >= 1) AND (due_day <= 31)))`
- CHECK fin_recurrences_due_month_offset_check: `CHECK (((due_month_offset >= 0) AND (due_month_offset <= 2)))`
- CHECK fin_recurrences_frequency_check: `CHECK ((frequency = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'yearly'::text])))`
- CHECK fin_recurrences_notes_check: `CHECK (((notes IS NULL) OR (length(notes) <= 1000)))`
- CHECK fin_recurrences_start_month_check: `CHECK ((EXTRACT(day FROM start_month) = (1)::numeric))`
- CHECK fin_recurrences_supplier_check: `CHECK (((supplier IS NULL) OR (length(supplier) <= 120)))`

## Referenciada por (1)
public.fin_entries.recurrence_id

## Índices
- fin_recurrences_account_idx: `btree (account_id)`
- fin_recurrences_category_idx: `btree (category_id)`

## Políticas RLS
- "fin_recurrences_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_recurrences_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_recurrences_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_recurrences_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_recurrences_audit — AFTER INSERT OR DELETE OR UPDATE → fin_private.audit_row()
- fin_recurrences_no_delete — BEFORE DELETE → fin_private.no_delete_recurrence()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
