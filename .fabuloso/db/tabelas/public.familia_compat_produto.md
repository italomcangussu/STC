# public.familia_compat_produto
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| familia_id | bigint | não |  |  |
| produto_id | bigint | não |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (familia_id, produto_id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
