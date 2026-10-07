# public.conv_automation_settings
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | boolean | não | `true` |  |
| enabled | boolean | não | `true` |  |
| window_start | time without time zone | não | `'08:00:00'::time without time zone` |  |
| window_end | time without time zone | não | `'20:00:00'::time without time zone` |  |
| days | integer[] | não | `ARRAY[1, 2, 3, 4, 5, 6]` |  |
| min_hours_between | integer | não | `12` |  |
| daily_cap | integer | não | `2` |  |
| weekly_cap | integer | não | `6` |  |
| opt_out_keywords | text[] | não | `ARRAY['parar'::text, 'pare'::text, 'sair'::text, 'stop'::te…` |  |
| updated_by | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (updated_by) → public.profiles(id)
- CHECK conv_automation_settings_daily_cap_check: `CHECK (((daily_cap >= 1) AND (daily_cap <= 10)))`
- CHECK conv_automation_settings_days: `CHECK ((((cardinality(days) >= 1) AND (cardinality(days) <= 7)) AND (days <@ ARRAY[0, 1, 2, 3, 4, 5, 6])))`
- CHECK conv_automation_settings_id_check: `CHECK (id)`
- CHECK conv_automation_settings_min_hours_between_check: `CHECK (((min_hours_between >= 0) AND (min_hours_between <= 720)))`
- CHECK conv_automation_settings_weekly_cap_check: `CHECK (((weekly_cap >= 1) AND (weekly_cap <= 30)))`
- CHECK conv_automation_settings_window: `CHECK ((window_start < window_end))`

## Políticas RLS
- "conv_automation_settings_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
