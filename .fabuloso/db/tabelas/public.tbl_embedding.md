# public.tbl_embedding
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| metadata | jsonb | sim |  |  |
| embedding | vector | sim |  |  |
| content | text | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
