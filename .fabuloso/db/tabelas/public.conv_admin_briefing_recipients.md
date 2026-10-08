# public.conv_admin_briefing_recipients
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| profile_id | uuid | não |  |  |
| enabled | boolean | não | `true` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (profile_id)
- FK (profile_id) → public.profiles(id) on delete cascade

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
