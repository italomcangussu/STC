# public.documentos_contexto
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| titulo | text | sim |  |  |
| conteudo | text | sim |  |  |
| embedding | vector(1536) | sim |  |  |
| criado_em | timestamp without time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
