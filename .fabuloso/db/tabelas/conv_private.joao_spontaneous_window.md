# conv_private.joao_spontaneous_window
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| group_id | uuid | não |  |  |
| active_until | timestamp with time zone | não |  |  |
| started_at | timestamp with time zone | não | `now()` |  |
| last_trigger_at | timestamp with time zone | sim |  |  |
| trigger_count | integer | não | `0` |  |
| max_triggers | integer | não | `24` |  |
| cooldown_minutes | integer | não | `15` |  |

## Chaves e restrições
- PK (group_id)
- FK (group_id) → public.conv_groups(id) on delete cascade
- CHECK joao_spontaneous_window_cooldown_minutes_check: `CHECK (((cooldown_minutes >= 5) AND (cooldown_minutes <= 120)))`
- CHECK joao_spontaneous_window_max_triggers_check: `CHECK (((max_triggers >= 1) AND (max_triggers <= 100)))`
- CHECK joao_spontaneous_window_trigger_count_check: `CHECK ((trigger_count >= 0))`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
