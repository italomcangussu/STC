# fin_private.charge_payments_effective
> view · security definer (padrão)

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | sim |  |  |
| charge_id | uuid | sim |  |  |
| kind | text | sim |  |  |
| amount_cents | bigint | sim |  |  |
| paid_on | date | sim |  |  |
| fine_cents | bigint | sim |  |  |
| interest_cents | bigint | sim |  |  |
| principal_cents | bigint | sim |  |  |
| excess_cents | bigint | sim |  |  |
| method | text | sim |  |  |
| account_id | uuid | sim |  |  |
| submission_id | uuid | sim |  |  |
| credit_id | uuid | sim |  |  |
| reverses_payment_id | uuid | sim |  |  |
| note | text | sim |  |  |
| actor_id | uuid | sim |  |  |
| request_id | uuid | sim |  |  |
| created_at | timestamp with time zone | sim |  |  |

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)

## Definição
```sql
SELECT id,
    charge_id,
    kind,
    amount_cents,
    paid_on,
    fine_cents,
    interest_cents,
    principal_cents,
    excess_cents,
    method,
    account_id,
    submission_id,
    credit_id,
    reverses_payment_id,
    note,
    actor_id,
    request_id,
    created_at
   FROM fin_charge_payments p
  WHERE kind = 'payment'::text AND NOT (EXISTS ( SELECT 1
           FROM fin_charge_payments r
          WHERE r.reverses_payment_id = p.id));
```
