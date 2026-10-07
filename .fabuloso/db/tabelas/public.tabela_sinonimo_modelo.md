# public.tabela_sinonimo_modelo
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | bigint | não | `nextval('tabela_sinonimo_modelo_id_seq'::regclass)` |  |
| sinonimo | text | não |  |  |
| modelo_canonico | text | não |  |  |
| normalizacao | text | não | `'lower_trim'::text` |  |
| ativo | boolean | não | `true` |  |

## Chaves e restrições
- PK (id)
- FK (modelo_canonico) → public.tabela_modelos(modelo_canonico) on delete restrict
- UNIQUE (sinonimo)

## Índices
- idx_sinonimo_modelo_mc: `btree (modelo_canonico)`
- tabela_sinonimo_modelo_sinonimo_key: `btree (sinonimo)` único

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
