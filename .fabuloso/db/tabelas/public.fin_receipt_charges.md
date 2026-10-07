# public.fin_receipt_charges
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| submission_id | uuid | não |  |  |
| charge_id | uuid | não |  |  |

## Chaves e restrições
- PK (submission_id, charge_id)
- FK (charge_id) → public.fin_member_charges(id)
- FK (submission_id) → public.fin_receipt_submissions(id)

## Índices
- fin_receipt_charges_charge_idx: `btree (charge_id)`

## Políticas RLS
- "fin_receipt_charges_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_receipt_charges_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_receipt_charges_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_receipt_charges_read" — SELECT para authenticated · using `(is_admin() OR (EXISTS ( SELECT 1 FROM fin_receipt_submissions s WHERE ((s.id = fin_receipt_charges.submission_id) AND (s.profile_id = ( SELECT auth.uid() AS uid))))))`

## Gatilhos
- fin_receipt_charges_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
