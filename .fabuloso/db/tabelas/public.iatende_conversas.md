# public.iatende_conversas
> tabela · RLS OFF · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | integer | não | `nextval('iatende_conversas_id_seq'::regclass)` |  |
| session_id | character varying(255) | não |  |  |
| message | jsonb | não |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
