# public.fin_member_credits
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| profile_id | uuid | não |  |  |
| source_payment_id | uuid | não |  |  |
| reason | text | não |  |  |
| amount_cents | bigint | não |  |  |
| remaining_cents | bigint | não |  |  |
| status | text | não | `'open'::text` |  |
| refund_entry_id | uuid | sim |  |  |
| resolution_note | text | sim |  |  |
| resolved_at | timestamp with time zone | sim |  |  |
| resolved_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (profile_id) → public.profiles(id)
- FK (refund_entry_id) → public.fin_entries(id)
- FK (resolved_by) → public.profiles(id)
- FK (source_payment_id) → public.fin_charge_payments(id)
- CHECK fin_member_credits_amount_cents_check: `CHECK ((amount_cents > 0))`
- CHECK fin_member_credits_check: `CHECK ((remaining_cents <= amount_cents))`
- CHECK fin_member_credits_reason_check: `CHECK ((reason = ANY (ARRAY['excess'::text, 'duplicate'::text])))`
- CHECK fin_member_credits_remaining_cents_check: `CHECK ((remaining_cents >= 0))`
- CHECK fin_member_credits_status_check: `CHECK ((status = ANY (ARRAY['open'::text, 'applied'::text, 'refunded'::text, 'void'::text])))`

## Referenciada por (1)
public.fin_charge_payments.credit_id

## Índices
- fin_member_credits_open_idx: `btree (profile_id) WHERE (status = 'open'::text)`
- fin_member_credits_profile_idx: `btree (profile_id)`

## Políticas RLS
- "fin_member_credits_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_member_credits_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_member_credits_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_member_credits_read" — SELECT para authenticated · using `(is_admin() OR (profile_id = ( SELECT auth.uid() AS uid)))`

## Gatilhos
- fin_member_credits_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_member_credits_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
