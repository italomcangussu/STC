# public.historico_conversas
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| cliente_id | uuid | sim |  |  |
| message | text | não |  |  |
| status | text | sim |  |  |
| criado_em | timestamp without time zone | sim | `now()` |  |
| session_id | character varying | sim |  |  |

## Chaves e restrições
- PK (id)
- CHECK historico_conversas_status_check: `CHECK ((status = ANY (ARRAY['em_andamento'::text, 'concluido'::text, 'pendente_orcamento'::text])))`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
