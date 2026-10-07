# public.aniversario_consulta
> tabela · RLS on · ~<10k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| Nome | text | sim |  |  |
| CPF/CNPJ | text | não |  |  |
| Telefone | text | sim |  |  |
| data de nascimento | text | sim |  |  |
| consultado | boolean | sim | `false` |  |
| id | bigint | não | `nextval('aniversario_consulta_id_seq'::regclass)` |  |
| data_formatada | date | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
