# public.announcements
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| title | text | não |  |  |
| message | text | não |  |  |
| image_url | text | sim |  |  |
| is_active | boolean | sim | `true` |  |
| show_once | boolean | sim | `false` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| expires_at | timestamp with time zone | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)

## Políticas RLS
- "Admins can manage announcements" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can read active announcements" — SELECT para public · using `((is_active = true) AND ((expires_at IS NULL) OR (expires_at > now())))`

## Gatilhos
- update_announcements_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
