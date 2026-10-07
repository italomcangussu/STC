# public.tabela_familia_iphone_map
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| familia_id | bigint | não |  |  |
| modelo_canonico | text | não |  |  |

## Chaves e restrições
- PK (familia_id, modelo_canonico)
- FK (modelo_canonico) → public.tabela_modelos(modelo_canonico) on delete restrict

## Índices
- idx_familia_map_modelo: `btree (modelo_canonico)`
- idx_tfim_familia_modelo: `btree (familia_id, modelo_canonico)`
- idx_tfim_modelo_canonico: `btree (modelo_canonico)`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
