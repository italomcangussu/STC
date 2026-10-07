# public.student_level_history
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| student_profile_id | uuid | não |  |  |
| previous_level | text | sim |  |  |
| new_level | text | não |  |  |
| changed_by | uuid | sim |  |  |
| observation | text | sim |  |  |
| changed_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (changed_by) → public.profiles(id) on delete set null
- FK (student_profile_id) → public.student_profiles(id) on delete restrict
- CHECK student_level_history_new_level_check: `CHECK ((new_level = ANY (ARRAY['Iniciante'::text, 'Iniciante Avançado'::text, 'Intermediário'::text, 'Intermediário Avançado'::text, 'Avançado'::text])))`
- CHECK student_level_history_previous_level_check: `CHECK (((previous_level IS NULL) OR (previous_level = ANY (ARRAY['Iniciante'::text, 'Iniciante Avançado'::text, 'Intermediário'::text, 'Intermediário Avançado'::text, 'Avançado'::text]))))`

## Índices
- idx_student_level_history_student_changed_at: `btree (student_profile_id, changed_at DESC)`

## Políticas RLS
- "Admins read student level history" — SELECT para authenticated · using `is_admin()`
- "Professors read assigned student level history" — SELECT para authenticated · using `(EXISTS ( SELECT 1 FROM student_profiles student WHERE ((student.id = student_level_history.student_profile_id) AND (student.professor_id IN ( SELECT p.id FROM professors p WHERE (p.user_id = ( SELECT auth.uid() AS uid)…`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
