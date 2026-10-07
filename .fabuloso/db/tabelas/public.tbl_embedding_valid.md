# public.tbl_embedding_valid
> tabela · RLS OFF · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não |  |  |
| metadata | jsonb | sim |  |  |
| embedding | vector | sim |  |  |
| content | text | sim |  |  |
| text | text | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
