# public.n8n_chat_histories_evento
> tabela · RLS on · ~<1k linhas — This is a duplicate of n8n_chat_histories_duplicate

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | integer | não | `nextval('n8n_chat_histories_id_seq'::regclass)` |  |
| session_id | character varying(255) | não |  |  |
| message | jsonb | não |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
