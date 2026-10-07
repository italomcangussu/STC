# public.Memory Test
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | text | não |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| resumo | text | sim |  |  |
| nome | text | sim |  |  |
| intencao | text | sim |  |  |
| proposed_conduct | text | sim |  |  |
| detected_diagnosis | text | sim |  |  |
| resumo_updated | timestamp with time zone | sim |  |  |
| analise | text | sim |  |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
