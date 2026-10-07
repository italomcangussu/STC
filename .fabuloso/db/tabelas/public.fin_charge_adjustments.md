# public.fin_charge_adjustments
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| charge_id | uuid | não |  |  |
| kind | text | não |  |  |
| amount_cents | bigint | não |  |  |
| reason | text | não |  |  |
| before_data | jsonb | sim |  |  |
| after_data | jsonb | sim |  |  |
| actor_id | uuid | sim |  |  |
| request_id | uuid | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (actor_id) → public.profiles(id)
- FK (charge_id) → public.fin_member_charges(id)
- UNIQUE (request_id)
- CHECK fin_charge_adjustments_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= 1000000000)))`
- CHECK fin_charge_adjustments_kind_check: `CHECK ((kind = ANY (ARRAY['discount'::text, 'increase'::text, 'fee_waiver'::text])))`
- CHECK fin_charge_adjustments_reason_check: `CHECK ((length(TRIM(BOTH FROM reason)) >= 5))`

## Índices
- fin_charge_adjustments_charge_idx: `btree (charge_id)`
- fin_charge_adjustments_request_id_key: `btree (request_id)` único

## Políticas RLS
- "fin_charge_adjustments_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_charge_adjustments_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_charge_adjustments_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_charge_adjustments_read" — SELECT para authenticated · using `(is_admin() OR (EXISTS ( SELECT 1 FROM fin_member_charges c WHERE ((c.id = fin_charge_adjustments.charge_id) AND (c.profile_id = ( SELECT auth.uid() AS uid))))))`

## Gatilhos
- fin_charge_adjustments_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_charge_adjustments_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
