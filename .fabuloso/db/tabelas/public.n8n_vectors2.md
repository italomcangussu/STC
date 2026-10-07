# public.n8n_vectors2
> tabela · RLS OFF · ~<1k linhas — This is a duplicate of n8n_vectors

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| text | text | sim |  |  |
| metadata | jsonb | sim |  |  |
| embedding | vector | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
