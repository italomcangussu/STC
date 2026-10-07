# public.reservas2
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| Data | text | sim |  |  |
| Hora da Reserva | timestamp with time zone | sim |  |  |
| Participantes | text | sim |  |  |
| TipodeJogo | text | sim |  |  |
| horario | time without time zone | sim |  |  |
| data | date | sim |  |  |

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
