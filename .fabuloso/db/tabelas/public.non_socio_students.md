# public.non_socio_students
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| name | text | não |  |  |
| plan_type | text | não |  |  |
| plan_status | text | sim | `'active'::text` |  |
| master_expiration_date | date | sim |  |  |
| professor_id | uuid | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| student_type | character varying(20) | sim | `'regular'::character varying` | Type of student: regular (pays) or dependent (family, no payment) |
| responsible_socio_id | uuid | sim |  | ID of the socio responsible for this dependent |
| relationship_type | character varying(20) | sim |  | Relationship to responsible socio: filho, filha, esposo, esposa, outro |
| phone | character varying(20) | sim |  |  |
| is_active | boolean | sim | `true` | Soft delete flag. When false, student is archived but payment history is preserved. |

## Chaves e restrições
- PK (id)
- FK (professor_id) → public.professors(id)
- FK (responsible_socio_id) → public.profiles(id) on delete set null
- CHECK non_socio_students_plan_type_check: `CHECK ((plan_type = ANY (ARRAY['Day Card'::text, 'Card Mensal'::text, 'Dependente'::text, 'Day Card Experimental'::text])))`
- CHECK non_socio_students_relationship_type_check: `CHECK (((relationship_type)::text = ANY ((ARRAY['filho'::character varying, 'filha'::character varying, 'esposo'::character varying, 'esposa'::character varying, 'outro'::character varying])::text[])…`
- CHECK non_socio_students_student_type_check: `CHECK (((student_type)::text = ANY ((ARRAY['regular'::character varying, 'dependent'::character varying])::text[])))`

## Referenciada por (5)
public.championship_registrations.student_id, public.conv_automation_recipients.student_id, public.conv_contacts.non_socio_student_id, public.student_payments.student_id, public.student_profiles.non_socio_student_id

## Índices
- idx_non_socio_students_is_active: `btree (is_active)`
- idx_non_socio_students_responsible_socio: `btree (responsible_socio_id)`
- idx_non_socio_students_student_type: `btree (student_type)`

## Políticas RLS
- "Admins can do everything on non_socio_students" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can manage students" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role)::text = 'admin'::text))))`
- "Professors can manage own students" — ALL para public · using `(EXISTS ( SELECT 1 FROM professors p WHERE ((p.id = non_socio_students.professor_id) AND (p.user_id = auth.uid()))))`
- "Professors can manage their own students" — ALL para public · using `(professor_id IN ( SELECT professors.id FROM professors WHERE (professors.user_id = auth.uid())))` · check `(professor_id IN ( SELECT professors.id FROM professors WHERE (professors.user_id = auth.uid())))`
- "Professors can view their students" — SELECT para public · using `true`
- "Socios can view students" — SELECT para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role)::text = 'socio'::text))))`

## Gatilhos
- update_non_socio_students_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
