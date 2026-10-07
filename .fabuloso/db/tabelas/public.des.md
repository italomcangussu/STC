# public.des
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| Horário da Partida | text | sim |  |  |
| mes | text | sim |  |  |
| atleta1 | text | sim |  |  |
| atleta2 | text | sim |  |  |
| Quadra | text | sim |  |  |
| atleta1_id | uuid | sim |  |  |
| atleta2_id | uuid | sim |  |  |
| data | date | sim |  |  |
| vencedor | text | sim |  |  |
| set1 | text | sim |  |  |
| set2 | text | sim |  |  |
| set3 | text | sim |  |  |

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
