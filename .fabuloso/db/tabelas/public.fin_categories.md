# public.fin_categories
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| parent_id | uuid | sim |  |  |
| name | text | não |  |  |
| kind | text | não |  |  |
| dre_line | text | não |  |  |
| system_key | text | sim |  |  |
| active | boolean | não | `true` |  |
| position | integer | não | `0` |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (parent_id) → public.fin_categories(id)
- FK (updated_by) → public.profiles(id)
- UNIQUE (system_key)
- CHECK fin_categories_check: `CHECK ((((kind = 'revenue'::text) AND (dre_line = ANY (ARRAY['revenue'::text, 'deduction'::text, 'none'::text]))) OR ((kind = 'expense'::text) AND (dre_line = ANY (ARRAY['variable_cost'::text, 'opera…`
- CHECK fin_categories_check1: `CHECK (((parent_id IS NULL) OR (parent_id <> id)))`
- CHECK fin_categories_dre_line_check: `CHECK ((dre_line = ANY (ARRAY['revenue'::text, 'deduction'::text, 'variable_cost'::text, 'operational'::text, 'administrative'::text, 'commercial'::text, 'financial'::text, 'none'::text])))`
- CHECK fin_categories_kind_check: `CHECK ((kind = ANY (ARRAY['expense'::text, 'revenue'::text])))`
- CHECK fin_categories_name_check: `CHECK (((length(TRIM(BOTH FROM name)) >= 2) AND (length(TRIM(BOTH FROM name)) <= 60)))`

## Referenciada por
- public.fin_categories.parent_id
- public.fin_entries.category_id
- public.fin_recurrences.category_id

## Índices
- fin_categories_name_key: `btree (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))` único
- fin_categories_parent_idx: `btree (parent_id)`
- fin_categories_system_key_key: `btree (system_key)` único

## Políticas RLS
- "fin_categories_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_categories_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_categories_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_categories_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_categories_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_categories_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
