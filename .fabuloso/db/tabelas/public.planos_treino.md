# public.planos_treino
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id_plano | uuid | não | `extensions.uuid_generate_v4()` |  |
| id_aluno | uuid | sim |  |  |
| data_inicio | timestamp with time zone | sim |  |  |
| fase | text | sim |  |  |
| observacoes | text | sim |  |  |
| detalhes_treino | text | sim |  |  |

## Chaves e restrições
- PK (id_plano)
- FK (id_aluno) → public.alunos(id_aluno) on delete cascade

## Índices
- idx_planos_id_aluno: `btree (id_aluno)`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
