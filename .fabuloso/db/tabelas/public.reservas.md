# public.reservas
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| date | date | sim |  |  |
| start_time | time without time zone | sim |  |  |
| end_time | time without time zone | sim |  |  |
| court_id | uuid | sim |  |  |
| participant_ids | uuid[] | sim | `'{}'::uuid[]` |  |
| creator_id | uuid | sim |  |  |
| status | reservation_status | sim |  |  |
| type | text | sim |  |  |

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
