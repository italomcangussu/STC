# public.club_form_questions
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| form_id | uuid | não |  |  |
| title | text | não |  |  |
| description | text | sim |  |  |
| question_type | text | não |  |  |
| is_required | boolean | não | `true` |  |
| display_order | integer | não | `0` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (form_id) → public.club_forms(id) on delete cascade
- CHECK club_form_questions_question_type_check: `CHECK ((question_type = ANY (ARRAY['single_choice'::text, 'multiple_choice'::text, 'open_text'::text])))`

## Referenciada por (2)
public.club_form_options.question_id, public.club_form_responses.question_id

## Índices
- idx_club_form_questions_form_order: `btree (form_id, display_order)`

## Políticas RLS
- "Admins can manage questions" — ALL para authenticated · using `is_admin()` · check `is_admin()`
- "Questions viewable if form is accessible" — SELECT para public · using `(EXISTS ( SELECT 1 FROM club_forms f WHERE ((f.id = club_form_questions.form_id) AND ((f.is_active = true) OR is_admin()))))`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
