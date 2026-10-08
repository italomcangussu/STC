# public.club_forms
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| title | text | não |  |  |
| description | text | sim |  |  |
| slug | text | não |  |  |
| is_active | boolean | não | `true` |  |
| is_secret_vote | boolean | não | `false` |  |
| requires_auth | boolean | não | `true` |  |
| allow_multiple_submissions | boolean | não | `false` |  |
| show_live_results | boolean | não | `true` |  |
| starts_at | timestamp with time zone | sim |  |  |
| expires_at | timestamp with time zone | sim |  |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (created_by) → public.profiles(id) on delete set null
- UNIQUE (slug)

## Referenciada por (3)
public.club_form_questions.form_id, public.club_form_responses.form_id, public.club_form_voter_receipts.form_id

## Índices
- club_forms_slug_key: `btree (slug)` único
- idx_club_forms_active: `btree (is_active, created_at DESC)`
- idx_club_forms_slug: `btree (slug)`

## Políticas RLS
- "Admins can manage forms" — ALL para authenticated · using `is_admin()` · check `is_admin()`
- "Public can view active forms or admins view all" — SELECT para public · using `((is_active = true) OR is_admin())`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
