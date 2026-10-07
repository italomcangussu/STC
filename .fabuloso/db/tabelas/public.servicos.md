# public.servicos
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| nome | text | não |  |  |
| descricao | text | sim |  |  |
| preco | numeric(10,2) | não |  |  |
| tempo_estimado | interval | sim |  |  |
| tempo_garantia | interval | sim |  |  |
| categoria_id | integer | sim |  |  |
| subcategoria_id | integer | sim |  |  |
| modelo_id | integer | sim |  |  |
| compatibilidade | jsonb | sim |  |  |
| tipo | text | sim |  |  |
| criado_em | timestamp without time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (subcategoria_id) → public.subcategorias(id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
