# public.conv_admin_alert_log
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| profile_id | uuid | não |  |  |
| rule | text | não |  |  |
| day | date | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (profile_id, rule, day)
- FK (profile_id) → public.profiles(id) on delete cascade

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
