# public.fin_charge_payments
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| charge_id | uuid | não |  |  |
| kind | text | não | `'payment'::text` |  |
| amount_cents | bigint | não |  |  |
| paid_on | date | não |  |  |
| fine_cents | bigint | não | `0` |  |
| interest_cents | bigint | não | `0` |  |
| principal_cents | bigint | não | `0` |  |
| excess_cents | bigint | não | `0` |  |
| method | text | não |  |  |
| account_id | uuid | sim |  |  |
| submission_id | uuid | sim |  |  |
| credit_id | uuid | sim |  |  |
| reverses_payment_id | uuid | sim |  |  |
| note | text | sim |  |  |
| actor_id | uuid | sim |  |  |
| request_id | uuid | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (account_id) → public.fin_accounts(id)
- FK (actor_id) → public.profiles(id)
- FK (charge_id) → public.fin_member_charges(id)
- FK (credit_id) → public.fin_member_credits(id)
- FK (reverses_payment_id) → public.fin_charge_payments(id)
- FK (submission_id) → public.fin_receipt_submissions(id)
- UNIQUE (request_id)
- UNIQUE (reverses_payment_id)
- CHECK fin_charge_payments_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= '100000000000'::bigint)))`
- CHECK fin_charge_payments_check: `CHECK (((kind = 'reversal'::text) = (reverses_payment_id IS NOT NULL)))`
- CHECK fin_charge_payments_check1: `CHECK (((kind = 'reversal'::text) OR (amount_cents = (((fine_cents + interest_cents) + principal_cents) + excess_cents))))`
- CHECK fin_charge_payments_check2: `CHECK (((method = 'credit'::text) OR (account_id IS NOT NULL)))`
- CHECK fin_charge_payments_excess_cents_check: `CHECK ((excess_cents >= 0))`
- CHECK fin_charge_payments_fine_cents_check: `CHECK ((fine_cents >= 0))`
- CHECK fin_charge_payments_interest_cents_check: `CHECK ((interest_cents >= 0))`
- CHECK fin_charge_payments_kind_check: `CHECK ((kind = ANY (ARRAY['payment'::text, 'reversal'::text])))`
- CHECK fin_charge_payments_method_check: `CHECK ((method = ANY (ARRAY['pix'::text, 'transfer'::text, 'cash'::text, 'card'::text, 'other'::text, 'credit'::text])))`
- CHECK fin_charge_payments_note_check: `CHECK (((note IS NULL) OR (length(note) <= 500)))`
- CHECK fin_charge_payments_principal_cents_check: `CHECK ((principal_cents >= 0))`

## Referenciada por
- public.fin_charge_payments.reverses_payment_id
- public.fin_member_credits.source_payment_id

## Índices
- fin_charge_payments_charge_idx: `btree (charge_id)`
- fin_charge_payments_paid_idx: `btree (paid_on)`
- fin_charge_payments_request_id_key: `btree (request_id)` único
- fin_charge_payments_reverses_payment_id_key: `btree (reverses_payment_id)` único
- fin_charge_payments_submission_idx: `btree (submission_id) WHERE (submission_id IS NOT NULL)`

## Políticas RLS
- "fin_charge_payments_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_charge_payments_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_charge_payments_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_charge_payments_read" — SELECT para authenticated · using `(is_admin() OR (EXISTS ( SELECT 1 FROM fin_member_charges c WHERE ((c.id = fin_charge_payments.charge_id) AND (c.profile_id = ( SELECT auth.uid() AS uid))))))`

## Gatilhos
- fin_charge_payments_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_charge_payments_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
