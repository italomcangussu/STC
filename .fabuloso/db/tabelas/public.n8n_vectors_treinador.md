# public.n8n_vectors_treinador
> tabela · RLS OFF · ~0 linhas

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
