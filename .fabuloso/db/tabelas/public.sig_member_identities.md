# public.sig_member_identities
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| profile_id | uuid | não |  |  |
| cpf | text | não |  |  |
| confirmed_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (profile_id)
- FK (profile_id) → public.profiles(id) on delete cascade
- CHECK sig_member_identities_cpf_check: `CHECK (sig_private.cpf_valid(cpf))`

## Políticas RLS
- "sig_identities_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`
- "sig_identities_own_read" — SELECT para authenticated · using `(profile_id = ( SELECT auth.uid() AS uid))`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
