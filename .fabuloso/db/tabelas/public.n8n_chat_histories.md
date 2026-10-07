# public.n8n_chat_histories
> tabela · RLS OFF · ~<100k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | integer | não | `nextval('n8n_chat_histories_id_seq'::regclass)` |  |
| session_id | character varying(255) | não |  |  |
| message | jsonb | não |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
