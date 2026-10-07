# public.alunos
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id_aluno | uuid | não | `extensions.uuid_generate_v4()` |  |
| nome | text | sim |  |  |
| idade | integer | sim |  |  |
| sexo | text | sim |  |  |
| altura_cm | integer | sim |  |  |
| peso_kg | real | sim |  |  |
| nivel | text | sim |  |  |
| objetivo | text | sim |  |  |
| equipamento | text | sim |  |  |
| restricoes | text | sim |  |  |
| frequencia_semana | integer | sim |  |  |
| email | text | sim |  |  |
| data_criacao | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id_aluno)
- UNIQUE (email)
- CHECK alunos_altura_cm_check: `CHECK (((altura_cm >= 130) AND (altura_cm <= 220)))`
- CHECK alunos_equipamento_check: `CHECK ((equipamento = ANY (ARRAY['Academia'::text, 'Casa'::text, 'Peso Corporal'::text])))`
- CHECK alunos_frequencia_semana_check: `CHECK (((frequencia_semana >= 1) AND (frequencia_semana <= 7)))`
- CHECK alunos_idade_check: `CHECK (((idade >= 13) AND (idade <= 80)))`
- CHECK alunos_nivel_check: `CHECK ((nivel = ANY (ARRAY['Iniciante'::text, 'Intermediario'::text, 'Avancado'::text])))`
- CHECK alunos_objetivo_check: `CHECK ((objetivo = ANY (ARRAY['Hipertrofia'::text, 'Força'::text, 'Emagrecimento'::text, 'Resistência'::text])))`
- CHECK alunos_peso_kg_check: `CHECK (((peso_kg >= (35)::double precision) AND (peso_kg <= (250)::double precision)))`
- CHECK alunos_sexo_check: `CHECK ((sexo = ANY (ARRAY['Masculino'::text, 'Feminino'::text, 'Outro'::text])))`

## Referenciada por
- public.avaliacoes_semanais.id_aluno
- public.historico_treino.id_aluno
- public.planos_treino.id_aluno

## Índices
- alunos_email_key: `btree (email)` único

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
