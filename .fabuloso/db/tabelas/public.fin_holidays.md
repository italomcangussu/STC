# public.fin_holidays
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| holiday_date | date | não |  |  |
| name | text | não |  |  |
| scope | text | não |  |  |
| kind | text | não | `'holiday'::text` |  |
| active | boolean | não | `true` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| created_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| updated_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id)
- FK (updated_by) → public.profiles(id)
- UNIQUE (holiday_date, scope)
- CHECK fin_holidays_kind_check: `CHECK ((kind = ANY (ARRAY['holiday'::text, 'optional'::text])))`
- CHECK fin_holidays_name_check: `CHECK (((length(TRIM(BOTH FROM name)) >= 2) AND (length(TRIM(BOTH FROM name)) <= 80)))`
- CHECK fin_holidays_scope_check: `CHECK ((scope = ANY (ARRAY['national'::text, 'state'::text, 'municipal'::text, 'club'::text])))`

## Índices
- fin_holidays_active_idx: `btree (holiday_date) WHERE active`
- fin_holidays_holiday_date_scope_key: `btree (holiday_date, scope)` único

## Políticas RLS
- "fin_holidays_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_holidays_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_holidays_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_holidays_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_holidays_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_holidays_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
