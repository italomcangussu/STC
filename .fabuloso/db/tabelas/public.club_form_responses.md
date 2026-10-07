# public.club_form_responses
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| form_id | uuid | não |  |  |
| question_id | uuid | não |  |  |
| option_id | uuid | sim |  |  |
| text_response | text | sim |  |  |
| user_id | uuid | sim |  |  |
| submission_batch_id | uuid | não | `gen_random_uuid()` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (form_id) → public.club_forms(id) on delete cascade
- FK (option_id) → public.club_form_options(id) on delete cascade
- FK (question_id) → public.club_form_questions(id) on delete cascade
- FK (user_id) → public.profiles(id) on delete set null

## Índices
- idx_club_form_responses_batch: `btree (submission_batch_id)`
- idx_club_form_responses_lookup: `btree (form_id, question_id, option_id)`

## Políticas RLS
- "Admins can delete responses" — DELETE para authenticated · using `is_admin()`
- "Responses insert policy" — INSERT para authenticated · check `((user_id IS NULL) OR (user_id = auth.uid()) OR is_admin())`
- "Responses select policy" — SELECT para public · using `(is_admin() OR (EXISTS ( SELECT 1 FROM club_forms f WHERE ((f.id = club_form_responses.form_id) AND (f.show_live_results = true)))))`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
