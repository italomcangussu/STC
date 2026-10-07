# public.fin_entries
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| kind | text | não |  |  |
| status | text | não | `'pending'::text` |  |
| description | text | não |  |  |
| supplier | text | sim |  |  |
| category_id | uuid | sim |  |  |
| amount_cents | bigint | não |  |  |
| competence_date | date | não |  |  |
| due_date | date | sim |  |  |
| account_id | uuid | sim |  |  |
| counter_account_id | uuid | sim |  |  |
| recurrence_id | uuid | sim |  |  |
| notes | text | sim |  |  |
| adjustment_cents | bigint | não | `0` |  |
| settled_on | date | sim |  |  |
| request_id | uuid | não |  |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |
| canceled_at | timestamp with time zone | sim |  |  |
| canceled_by | uuid | sim |  |  |
| cancel_reason | text | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (account_id) → public.fin_accounts(id)
- FK (canceled_by) → public.profiles(id)
- FK (category_id) → public.fin_categories(id)
- FK (counter_account_id) → public.fin_accounts(id)
- FK (created_by) → public.profiles(id)
- FK (recurrence_id) → public.fin_recurrences(id)
- FK (updated_by) → public.profiles(id)
- UNIQUE (request_id)
- CHECK fin_entries_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= '100000000000'::bigint)))`
- CHECK fin_entries_check: `CHECK (((kind = ANY (ARRAY['expense'::text, 'revenue'::text])) = (category_id IS NOT NULL)))`
- CHECK fin_entries_check1: `CHECK (((kind = 'transfer'::text) = (counter_account_id IS NOT NULL)))`
- CHECK fin_entries_check2: `CHECK (((counter_account_id IS NULL) OR (counter_account_id <> account_id)))`
- CHECK fin_entries_check3: `CHECK (((status <> 'canceled'::text) OR ((canceled_at IS NOT NULL) AND (cancel_reason IS NOT NULL))))`
- CHECK fin_entries_check4: `CHECK (((kind = ANY (ARRAY['expense'::text, 'revenue'::text])) OR (status = ANY (ARRAY['paid'::text, 'canceled'::text]))))`
- CHECK fin_entries_check5: `CHECK (((status <> 'paid'::text) OR (settled_on IS NOT NULL)))`
- CHECK fin_entries_check6: `CHECK (((status <> ALL (ARRAY['pending'::text, 'partial'::text])) OR (due_date IS NOT NULL)))`
- CHECK fin_entries_check7: `CHECK (((recurrence_id IS NULL) OR (kind = 'expense'::text)))`
- CHECK fin_entries_description_check: `CHECK (((length(TRIM(BOTH FROM description)) >= 2) AND (length(TRIM(BOTH FROM description)) <= 140)))`
- CHECK fin_entries_kind_check: `CHECK ((kind = ANY (ARRAY['expense'::text, 'revenue'::text, 'contribution'::text, 'withdrawal'::text, 'transfer'::text, 'member_refund'::text])))`
- CHECK fin_entries_notes_check: `CHECK (((notes IS NULL) OR (length(notes) <= 1000)))`
- CHECK fin_entries_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'canceled'::text])))`
- CHECK fin_entries_supplier_check: `CHECK (((supplier IS NULL) OR (length(supplier) <= 120)))`

## Referenciada por
- public.fin_attachments.entry_id
- public.fin_entry_payments.entry_id
- public.fin_member_credits.refund_entry_id

## Índices
- fin_entries_account_idx: `btree (account_id)`
- fin_entries_category_idx: `btree (category_id)`
- fin_entries_competence_idx: `btree (competence_date)`
- fin_entries_counter_idx: `btree (counter_account_id)`
- fin_entries_due_idx: `btree (due_date) WHERE (status = ANY (ARRAY['pending'::text, 'partial'::text]))`
- fin_entries_recurrence_month: `btree (recurrence_id, competence_date) WHERE (recurrence_id IS NOT NULL)` único
- fin_entries_request_id_key: `btree (request_id)` único

## Políticas RLS
- "fin_entries_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_entries_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_entries_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_entries_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_entries_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_entries_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
