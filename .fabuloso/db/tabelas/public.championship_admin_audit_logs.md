# public.championship_admin_audit_logs
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| championship_id | uuid | não |  |  |
| entity_type | text | não |  |  |
| entity_id | uuid | sim |  |  |
| action | text | não |  |  |
| before_data | jsonb | sim |  |  |
| after_data | jsonb | sim |  |  |
| actor_user_id | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (actor_user_id) → public.profiles(id)
- FK (championship_id) → public.championships(id) on delete cascade

## Índices
- idx_champ_admin_audit_champ_created_at: `btree (championship_id, created_at DESC)`
- idx_champ_admin_audit_entity: `btree (entity_type, entity_id)`

## Políticas RLS
- "Admins can insert championship admin audit logs" — INSERT para public · check `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))`
- "Admins can read championship admin audit logs" — SELECT para public · using `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
