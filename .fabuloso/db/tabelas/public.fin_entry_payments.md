# public.fin_entry_payments
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| entry_id | uuid | não |  |  |
| kind | text | não | `'payment'::text` |  |
| amount_cents | bigint | não |  |  |
| paid_on | date | não |  |  |
| account_id | uuid | não |  |  |
| reverses_payment_id | uuid | sim |  |  |
| note | text | sim |  |  |
| actor_id | uuid | sim |  |  |
| request_id | uuid | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (account_id) → public.fin_accounts(id)
- FK (actor_id) → public.profiles(id)
- FK (entry_id) → public.fin_entries(id)
- FK (reverses_payment_id) → public.fin_entry_payments(id)
- UNIQUE (request_id)
- UNIQUE (reverses_payment_id)
- CHECK fin_entry_payments_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= '100000000000'::bigint)))`
- CHECK fin_entry_payments_check: `CHECK (((kind = 'reversal'::text) = (reverses_payment_id IS NOT NULL)))`
- CHECK fin_entry_payments_kind_check: `CHECK ((kind = ANY (ARRAY['payment'::text, 'reversal'::text])))`
- CHECK fin_entry_payments_note_check: `CHECK (((note IS NULL) OR (length(note) <= 500)))`

## Referenciada por (1)
public.fin_entry_payments.reverses_payment_id

## Índices
- fin_entry_payments_account_idx: `btree (account_id)`
- fin_entry_payments_entry_idx: `btree (entry_id)`
- fin_entry_payments_paid_idx: `btree (paid_on)`
- fin_entry_payments_request_id_key: `btree (request_id)` único
- fin_entry_payments_reverses_payment_id_key: `btree (reverses_payment_id)` único

## Políticas RLS
- "fin_entry_payments_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_entry_payments_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_entry_payments_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_entry_payments_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_entry_payments_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_entry_payments_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
