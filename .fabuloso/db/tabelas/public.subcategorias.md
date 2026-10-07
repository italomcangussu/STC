# public.subcategorias
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | integer | não | `nextval('subcategorias_id_seq'::regclass)` |  |
| categoria_id | integer | sim |  |  |
| nome | text | não |  |  |

## Chaves e restrições
- PK (id)
- UNIQUE (categoria_id, nome)

## Referenciada por
- public.servicos.subcategoria_id

## Índices
- subcategorias_categoria_id_nome_key: `btree (categoria_id, nome)` único

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
