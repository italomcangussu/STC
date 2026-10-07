# public.consumptions
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| user_id | uuid | sim |  |  |
| product_id | uuid | sim |  |  |
| quantity | integer | sim | `1` |  |
| total_price | numeric | não |  |  |
| status | text | sim | `'open'::text` |  |
| date | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (product_id) → public.products(id)
- FK (user_id) → public.profiles(id)

## Políticas RLS
- "admin_view_all" — SELECT para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "lanchonete_full_access" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'lanchonete'::user_role))))` · check `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'lanchonete'::user_role))))`
- "users_view_own" — SELECT para public · using `(user_id = auth.uid())`

## Gatilhos
- trg_admin_audit_consumptions — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
