# public.stock_automator_config
> tabela · RLS on · ~<1k linhas — Stock Automator Configuration table for brands, categories, etc.

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| store_id | uuid | não |  |  |
| config_type | text | não |  |  |
| value | text | não |  |  |
| aliases | text[] | sim | `'{}'::text[]` |  |
| sku_code | text | sim |  |  |
| active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (store_id) → public.stores(id)
- UNIQUE (store_id, config_type, value)
- CHECK stock_automator_config_config_type_check: `CHECK ((config_type = ANY (ARRAY['brand'::text, 'category'::text, 'subcategory'::text, 'submarca'::text, 'size_subtype'::text, 'color'::text])))`

## Índices
- idx_stock_automator_config_store: `btree (store_id)`
- idx_stock_automator_config_type: `btree (config_type)`
- stock_automator_config_store_id_config_type_value_key: `btree (store_id, config_type, value)` único

## Políticas RLS
- "Admins only management" — ALL para authenticated · using `(( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = 'admin'::user_role)` · check `(( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = 'admin'::user_role)`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
