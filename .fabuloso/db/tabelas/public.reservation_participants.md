# public.reservation_participants
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| reservation_id | uuid | não |  |  |
| user_id | uuid | não |  |  |

## Chaves e restrições
- PK (reservation_id, user_id)
- FK (reservation_id) → public.reservations(id) on delete cascade
- FK (user_id) → public.profiles(id) on delete cascade

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
