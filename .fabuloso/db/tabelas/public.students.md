# public.students
> tabela · RLS OFF · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| name | text | não |  |  |
| phone | text | sim |  |  |
| plan_type | text | sim |  |  |
| professor_id | uuid | sim |  |  |
| is_active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (professor_id) → public.professors(id)

## Referenciada por
- public.reservations.student_id

## Políticas RLS
- (RLS desligado)

## Gatilhos
- update_students_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
