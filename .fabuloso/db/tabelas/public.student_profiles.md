# public.student_profiles
> tabela · RLS on · ~0 linhas — Student metadata linked to an existing member profile or non-member student; does not duplicate the person.

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| profile_id | uuid | sim |  |  |
| non_socio_student_id | uuid | sim |  |  |
| technical_level | text | sim |  |  |
| student_status | text | não | `'active'::text` | Operational student status, independent of membership and Card Mensal payment status. |
| professor_id | uuid | sim |  |  |
| card_expired_reviewed_for | date | sim |  | Expired Card Mensal date already reviewed by the responsible professor. |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (non_socio_student_id) → public.non_socio_students(id) on delete restrict
- FK (professor_id) → public.professors(id) on delete set null
- FK (profile_id) → public.profiles(id) on delete restrict
- CHECK student_profiles_single_person: `CHECK ((((profile_id IS NOT NULL) AND (non_socio_student_id IS NULL)) OR ((profile_id IS NULL) AND (non_socio_student_id IS NOT NULL))))`
- CHECK student_profiles_student_status_check: `CHECK ((student_status = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text])))`
- CHECK student_profiles_technical_level_check: `CHECK ((technical_level = ANY (ARRAY['Iniciante'::text, 'Iniciante Avançado'::text, 'Intermediário'::text, 'Intermediário Avançado'::text, 'Avançado'::text])))`

## Referenciada por (1)
public.student_level_history.student_profile_id

## Índices
- idx_student_profiles_non_socio_id: `btree (non_socio_student_id)` único
- idx_student_profiles_professor_status: `btree (professor_id, student_status)`
- idx_student_profiles_profile_id: `btree (profile_id)` único
- idx_student_profiles_status_level: `btree (student_status, technical_level)`

## Políticas RLS
- "Admins manage student profiles" — ALL para authenticated · using `is_admin()` · check `is_admin()`
- "Professors manage assigned student profiles" — INSERT para authenticated · check `((profile_id = ( SELECT auth.uid() AS uid)) OR (professor_id IN ( SELECT p.id FROM professors p WHERE (p.user_id = ( SELECT auth.uid() AS uid)))))`
- "Professors read assigned student profiles" — SELECT para authenticated · using `((profile_id = ( SELECT auth.uid() AS uid)) OR (professor_id IN ( SELECT p.id FROM professors p WHERE (p.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1 FROM non_socio_students student WHERE ((student.id …`
- "Professors update assigned student profiles" — UPDATE para authenticated · using `(professor_id IN ( SELECT p.id FROM professors p WHERE (p.user_id = ( SELECT auth.uid() AS uid))))` · check `(professor_id IN ( SELECT p.id FROM professors p WHERE (p.user_id = ( SELECT auth.uid() AS uid))))`

## Gatilhos
- student_profiles_record_level_change — AFTER INSERT OR UPDATE OF technical_level → public.record_student_level_change()
- student_profiles_sync_legacy_status — AFTER UPDATE OF student_status → public.sync_student_profile_status_to_legacy_student()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
