# public.conv_contact_delegates
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| contact_id | uuid | não |  |  |
| principal_profile_id | uuid | não |  |  |
| kind | text | não | `'professor_assistant'::text` |  |
| active | boolean | não | `true` |  |
| note | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (contact_id)
- FK (contact_id) → public.conv_contacts(id)
- FK (principal_profile_id) → public.profiles(id) on delete cascade
- CHECK conv_contact_delegates_kind_check: `CHECK ((kind = 'professor_assistant'::text))`
- CHECK conv_contact_delegates_note_check: `CHECK (((note IS NULL) OR (length(note) <= 300)))`

## Índices
- conv_contact_delegates_principal_idx: `btree (principal_profile_id)`

## Políticas RLS
- "conv_contact_delegates_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
