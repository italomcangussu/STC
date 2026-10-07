# public.professors
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| user_id | uuid | sim |  |  |
| name | text | não |  |  |
| bio | text | sim |  |  |
| is_active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (user_id) → public.profiles(id)

## Referenciada por
- public.non_socio_students.professor_id
- public.reservations.professor_id
- public.student_profiles.professor_id
- public.students.professor_id

## Políticas RLS
- "Admins can manage professors" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role)::text = 'admin'::text))))`
- "Allow admins to manage professors" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Allow authenticated users to read professors" — SELECT para public · using `(auth.role() = 'authenticated'::text)`
- "Anyone can view professors" — SELECT para public · using `true`
- "Professors can view own profile" — SELECT para public · using `(user_id = auth.uid())`

## Gatilhos
- update_professors_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
