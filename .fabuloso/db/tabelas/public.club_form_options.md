# public.club_form_options
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| question_id | uuid | não |  |  |
| label | text | não |  |  |
| display_order | integer | não | `0` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (question_id) → public.club_form_questions(id) on delete cascade

## Referenciada por (1)
public.club_form_responses.option_id

## Índices
- idx_club_form_options_question_order: `btree (question_id, display_order)`

## Políticas RLS
- "Admins can manage options" — ALL para authenticated · using `is_admin()` · check `is_admin()`
- "Options viewable if question is accessible" — SELECT para public · using `(EXISTS ( SELECT 1 FROM (club_form_questions q JOIN club_forms f ON ((f.id = q.form_id))) WHERE ((q.id = club_form_options.question_id) AND ((f.is_active = true) OR is_admin()))))`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
