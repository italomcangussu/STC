# public.historico_treino
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id_historico | uuid | não | `extensions.uuid_generate_v4()` |  |
| id_aluno | uuid | sim |  |  |
| data | timestamp with time zone | sim |  |  |
| grupo_muscular | text | sim |  |  |
| exercicios | jsonb | sim |  |  |
| duracao_min | integer | sim |  |  |
| comentarios | text | sim |  |  |

## Chaves e restrições
- PK (id_historico)
- FK (id_aluno) → public.alunos(id_aluno) on delete cascade

## Índices
- idx_historico_id_aluno: `btree (id_aluno)`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
