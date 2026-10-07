# public.tabela_modelos
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | bigint | não | `nextval('tabela_modelos_id_seq'::regclass)` |  |
| familia | text | não |  |  |
| modelo_canonico | text | não |  |  |
| plataforma | text | sim |  |  |
| ativo | boolean | não | `true` |  |

## Chaves e restrições
- PK (id)
- UNIQUE (modelo_canonico)

## Referenciada por
- public.tabela_familia_iphone_map.modelo_canonico
- public.tabela_sinonimo_modelo.modelo_canonico

## Índices
- idx_modelos_familia: `btree (familia)`
- tabela_modelos_modelo_canonico_key: `btree (modelo_canonico)` único

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
