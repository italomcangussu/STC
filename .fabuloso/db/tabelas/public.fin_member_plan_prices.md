# public.fin_member_plan_prices
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| plan_id | uuid | não |  |  |
| effective_from | date | não |  |  |
| amount_cents | bigint | não |  |  |
| reason | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (plan_id) → public.fin_member_plans(id)
- UNIQUE (plan_id, effective_from)
- CHECK fin_member_plan_prices_amount_cents_check: `CHECK (((amount_cents > 0) AND (amount_cents <= 1000000000)))`
- CHECK fin_member_plan_prices_effective_from_check: `CHECK ((EXTRACT(day FROM effective_from) = (1)::numeric))`
- CHECK fin_member_plan_prices_reason_check: `CHECK (((reason IS NULL) OR (length(reason) <= 500)))`

## Índices
- fin_member_plan_prices_plan_id_effective_from_key: `btree (plan_id, effective_from)` único

## Políticas RLS
- "fin_member_plan_prices_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_member_plan_prices_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_member_plan_prices_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_member_plan_prices_read" — SELECT para authenticated · using `(is_admin() OR (EXISTS ( SELECT 1 FROM fin_member_plans p WHERE ((p.id = fin_member_plan_prices.plan_id) AND (p.profile_id = ( SELECT auth.uid() AS uid))))))`

## Gatilhos
- fin_member_plan_prices_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_member_plan_prices_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
