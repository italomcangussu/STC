# public.class_change_events
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| user_id | uuid | não |  |  |
| from_class | text | não |  |  |
| to_class | text | não |  |  |
| points_before | integer | não |  |  |
| points_after | integer | não |  |  |
| changed_at | timestamp with time zone | não | `now()` |  |
| changed_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (changed_by) → public.profiles(id)
- FK (user_id) → public.profiles(id) on delete cascade

## Índices
- idx_class_change_events_user: `btree (user_id, changed_at DESC)`

## Políticas RLS
- "Admins can insert class change events" — INSERT para public · check `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can read class change events" — SELECT para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
