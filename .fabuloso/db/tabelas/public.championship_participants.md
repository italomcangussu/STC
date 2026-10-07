# public.championship_participants
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| championship_id | uuid | não |  |  |
| user_id | uuid | não |  |  |

## Chaves e restrições
- PK (championship_id, user_id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (user_id) → public.profiles(id) on delete cascade

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
