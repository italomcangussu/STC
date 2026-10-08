# public.student_payments
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| student_id | uuid | sim |  |  |
| amount | numeric(10,2) | sim | `200.00` |  |
| payment_date | timestamp with time zone | sim | `now()` |  |
| valid_until | timestamp with time zone | não |  |  |
| approved_by | uuid | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| status | character varying(20) | sim | `'active'::character varying` | Payment status: active (valid) or cancelled (refunded/converted) |
| cancelled_reason | text | sim |  | Reason for cancellation, e.g. Convertido para Card Mensal |
| related_payment_id | uuid | sim |  | Links to the replacement payment when a Day Card Experimental is converted to Card Mensal |

## Chaves e restrições
- PK (id)
- FK (approved_by) → public.profiles(id)
- FK (related_payment_id) → public.student_payments(id) on delete set null
- FK (student_id) → public.non_socio_students(id) on delete cascade
- CHECK student_payments_status_check: `CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying])::text[])))`

## Referenciada por (1)
public.student_payments.related_payment_id

## Índices
- idx_student_payments_status: `btree (status)`

## Políticas RLS
- "Admins can manage payments" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role)::text = 'admin'::text))))`
- "Professors can view own student payments" — SELECT para public · using `(EXISTS ( SELECT 1 FROM (non_socio_students s JOIN professors p ON ((s.professor_id = p.id))) WHERE ((s.id = student_payments.student_id) AND (p.user_id = auth.uid()))))`

## Gatilhos
- fin_student_payments_audit — AFTER INSERT OR DELETE OR UPDATE → fin_private.audit_row_soft()
- update_student_payments_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
