# public.conv_admin_prefs
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| profile_id | uuid | não |  |  |
| briefing_enabled | boolean | não | `true` |  |
| briefing_style | text | não | `'completo'::text` |  |
| alerts_enabled | boolean | não | `true` |  |
| min_balance_cents | bigint | sim |  |  |
| overdue_days | integer | não | `7` |  |
| default_account_id | uuid | sim |  |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (profile_id)
- FK (default_account_id) → public.fin_accounts(id) on delete set null
- FK (profile_id) → public.profiles(id) on delete cascade
- CHECK conv_admin_prefs_briefing_style_check: `CHECK ((briefing_style = ANY (ARRAY['completo'::text, 'curto'::text])))`
- CHECK conv_admin_prefs_min_balance_cents_check: `CHECK (((min_balance_cents IS NULL) OR (min_balance_cents >= 0)))`
- CHECK conv_admin_prefs_overdue_days_check: `CHECK (((overdue_days >= 1) AND (overdue_days <= 90)))`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
