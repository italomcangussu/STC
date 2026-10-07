# public.n8n_chat_histories_duplicate
> tabela · RLS OFF · ~<100k linhas — This is a duplicate of n8n_chat_histories

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
