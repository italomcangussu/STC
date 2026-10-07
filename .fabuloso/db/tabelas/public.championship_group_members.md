# public.championship_group_members
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| group_id | uuid | não |  |  |
| registration_id | uuid | não |  |  |
| is_seed | boolean | sim | `false` |  |
| draw_order | integer | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (group_id) → public.championship_groups(id) on delete cascade
- FK (registration_id) → public.championship_registrations(id) on delete cascade
- UNIQUE (group_id, registration_id)

## Índices
- championship_group_members_group_id_registration_id_key: `btree (group_id, registration_id)` único
- idx_championship_group_members_group: `btree (group_id)`
- idx_championship_group_members_registration: `btree (registration_id)`

## Políticas RLS
- "Admins can delete group members" — DELETE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can insert group members" — INSERT para public · check `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Admins can update group members" — UPDATE para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Anyone can view group members" — SELECT para public · using `true`

## Gatilhos
- update_championship_group_members_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
