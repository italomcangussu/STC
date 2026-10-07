# public.avaliacoes_semanais
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id_avaliacao | uuid | não | `extensions.uuid_generate_v4()` |  |
| id_aluno | uuid | sim |  |  |
| semana | integer | sim |  |  |
| data | timestamp with time zone | sim |  |  |
| execucao_real | text | sim |  |  |
| feedback_dores | text | sim |  |  |
| energia_humor | integer | sim |  |  |
| peso_kg | real | sim |  |  |
| ganho_forca | text | sim |  |  |
| comentario_aluno | text | sim |  |  |

## Chaves e restrições
- PK (id_avaliacao)
- FK (id_aluno) → public.alunos(id_aluno) on delete cascade
- CHECK avaliacoes_semanais_energia_humor_check: `CHECK (((energia_humor >= 1) AND (energia_humor <= 10)))`
- CHECK avaliacoes_semanais_execucao_real_check: `CHECK ((execucao_real = ANY (ARRAY['Alta'::text, 'Média'::text, 'Baixa'::text])))`
- CHECK avaliacoes_semanais_ganho_forca_check: `CHECK ((ganho_forca = ANY (ARRAY['Sim'::text, 'Não'::text, 'Parcial'::text])))`

## Índices
- idx_avaliacoes_id_aluno: `btree (id_aluno)`

## Políticas RLS
- (RLS desligado)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
