# public.products
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| name | text | não |  |  |
| price | numeric | não |  |  |
| is_active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| image_url | text | sim |  |  |
| icon | text | sim | `'package'::text` |  |
| store_id | uuid | sim |  |  |
| display_code | text | sim |  |  |
| sku | text | sim |  |  |
| brand | text | sim |  |  |
| category | text | sim |  |  |
| subcategory | text | sim |  |  |
| type | text | sim |  |  |
| subtype | text | sim |  |  |
| cost_price | numeric(10,2) | sim |  |  |
| sell_price | numeric(10,2) | sim |  |  |
| stock_quantity | integer | sim | `0` |  |
| min_stock | integer | sim | `0` |  |
| warranty_time_days | integer | sim | `90` |  |
| active | boolean | sim | `true` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| submarca | text | sim |  |  |
| availability | text | sim | `'available'::text` |  |
| photos | text[] | sim | `'{}'::text[]` |  |
| color | text | sim |  |  |
| size_subtype | text | sim |  |  |
| compatibility | text | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (store_id) → public.stores(id)

## Referenciada por (1)
public.consumptions.product_id

## Índices
- idx_products_brand: `btree (brand)`
- idx_products_category: `btree (category)`
- idx_products_sku: `btree (sku)`
- idx_products_store: `btree (store_id)`
- idx_products_type: `btree (type)`

## Políticas RLS
- "Allow admins to manage products" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::user_role) OR (profiles.role = 'lanchonete'::user_role)))))`
- "Allow authenticated users to read products" — SELECT para public · using `(auth.role() = 'authenticated'::text)`

## Gatilhos
- trg_admin_audit_products — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
