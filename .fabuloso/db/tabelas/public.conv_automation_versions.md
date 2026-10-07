# public.conv_automation_versions
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| automation_id | uuid | não |  |  |
| version | integer | não |  |  |
| definition | jsonb | não |  |  |
| schedule | jsonb | não |  |  |
| message_body | text | não |  |  |
| trigger_type | text | não |  |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (automation_id, version)
- FK (automation_id) → public.conv_automations(id)
- FK (created_by) → public.profiles(id)

## Políticas RLS
- "conv_automation_versions_admin_read" — SELECT para authenticated · using `is_admin()`

## Gatilhos
- conv_automation_versions_immutable — BEFORE DELETE OR UPDATE → conv_private.immutable_row()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
