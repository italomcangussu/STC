# public.championship_groups
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | não |  |  |
| category | character varying(50) | não |  |  |
| group_name | character varying(10) | não |  |  |
| seed_registration_id | uuid | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (seed_registration_id) → public.championship_registrations(id) on delete set null
- UNIQUE (championship_id, category, group_name)

## Referenciada por
- public.championship_group_members.group_id
- public.matches.championship_group_id

## Índices
- championship_groups_championship_id_category_group_name_key: `btree (championship_id, category, group_name)` único
- idx_championship_groups_category: `btree (category)`
- idx_championship_groups_championship: `btree (championship_id)`

## Políticas RLS
- "Admins can delete championship groups" — DELETE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can insert championship groups" — INSERT para public · check `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can update championship groups" — UPDATE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can view championship groups" — SELECT para public · using `true`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
