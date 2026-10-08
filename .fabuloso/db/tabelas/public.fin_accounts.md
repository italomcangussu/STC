# public.fin_accounts
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| name | text | não |  |  |
| kind | text | não |  |  |
| opening_balance_cents | bigint | não | `0` |  |
| opening_date | date | não |  |  |
| is_default_receipts | boolean | não | `false` |  |
| active | boolean | não | `true` |  |
| position | integer | não | `0` |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- CHECK fin_accounts_kind_check: `CHECK ((kind = ANY (ARRAY['cash'::text, 'bank'::text, 'card'::text, 'other'::text])))`
- CHECK fin_accounts_name_check: `CHECK (((length(TRIM(BOTH FROM name)) >= 2) AND (length(TRIM(BOTH FROM name)) <= 60)))`
- CHECK fin_accounts_opening_balance_cents_check: `CHECK ((abs(opening_balance_cents) <= '100000000000'::bigint))`

## Referenciada por (6)
public.conv_admin_prefs.default_account_id, public.fin_charge_payments.account_id, public.fin_entries.account_id, public.fin_entries.counter_account_id, public.fin_entry_payments.account_id, public.fin_recurrences.account_id

## Índices
- fin_accounts_name_key: `btree (lower(name))` único
- fin_accounts_one_default_receipts: `btree (is_default_receipts) WHERE is_default_receipts` único

## Políticas RLS
- "fin_accounts_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_accounts_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_accounts_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_accounts_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_accounts_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_accounts_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
