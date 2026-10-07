# public.fin_entries_v
> view · security_invoker

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | sim |  |  |
| kind | text | sim |  |  |
| status | text | sim |  |  |
| description | text | sim |  |  |
| supplier | text | sim |  |  |
| category_id | uuid | sim |  |  |
| amount_cents | bigint | sim |  |  |
| competence_date | date | sim |  |  |
| due_date | date | sim |  |  |
| account_id | uuid | sim |  |  |
| counter_account_id | uuid | sim |  |  |
| recurrence_id | uuid | sim |  |  |
| notes | text | sim |  |  |
| adjustment_cents | bigint | sim |  |  |
| settled_on | date | sim |  |  |
| request_id | uuid | sim |  |  |
| version | integer | sim |  |  |
| created_at | timestamp with time zone | sim |  |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | sim |  |  |
| updated_by | uuid | sim |  |  |
| canceled_at | timestamp with time zone | sim |  |  |
| canceled_by | uuid | sim |  |  |
| cancel_reason | text | sim |  |  |
| paid_cents | bigint | sim |  |  |
| remaining_cents | bigint | sim |  |  |
| display_status | text | sim |  |  |

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)

## Definição
```sql
SELECT e.id,
    e.kind,
    e.status,
    e.description,
    e.supplier,
    e.category_id,
    e.amount_cents,
    e.competence_date,
    e.due_date,
    e.account_id,
    e.counter_account_id,
    e.recurrence_id,
    e.notes,
    e.adjustment_cents,
    e.settled_on,
    e.request_id,
    e.version,
    e.created_at,
    e.created_by,
    e.updated_at,
    e.updated_by,
    e.canceled_at,
    e.canceled_by,
    e.cancel_reason,
    COALESCE(p.paid_cents, 0::numeric)::bigint AS paid_cents,
    GREATEST(e.amount_cents::numeric - COALESCE(p.paid_cents, 0::numeric), 0::numeric)::bigint AS remaining_cents,
        CASE
            WHEN e.status = 'canceled'::text THEN 'canceled'::text
            WHEN e.status = 'paid'::text THEN 'paid'::text
            WHEN e.due_date < (now() AT TIME ZONE 'America/Fortaleza'::text)::date THEN 'overdue'::text
            ELSE e.status
        END AS display_status
   FROM fin_entries e
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN x.kind = 'payment'::text THEN x.amount_cents
                    ELSE - x.amount_cents
                END) AS paid_cents
           FROM fin_entry_payments x
          WHERE x.entry_id = e.id) p ON true;
```
