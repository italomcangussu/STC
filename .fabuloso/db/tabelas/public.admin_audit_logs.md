# public.admin_audit_logs
> tabela · RLS on · ~<10k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| occurred_at | timestamp with time zone | não | `now()` |  |
| actor_user_id | uuid | sim |  |  |
| actor_name_snapshot | text | sim |  |  |
| actor_role | text | sim |  |  |
| action | text | não |  |  |
| table_name | text | sim |  |  |
| record_id | text | sim |  |  |
| target_user_id | uuid | sim |  |  |
| target_name_snapshot | text | sim |  |  |
| related_user_ids | uuid[] | não | `'{}'::uuid[]` |  |
| changed_fields | text[] | sim |  |  |
| old_data | jsonb | sim |  |  |
| new_data | jsonb | sim |  |  |
| metadata | jsonb | não | `'{}'::jsonb` |  |
| source | text | não | `'trigger'::text` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (actor_user_id) → public.profiles(id)
- FK (target_user_id) → public.profiles(id)

## Índices
- admin_audit_logs_actor_user_id_idx: `btree (actor_user_id, occurred_at DESC)`
- admin_audit_logs_occurred_at_idx: `btree (occurred_at DESC)`
- admin_audit_logs_related_user_ids_idx: `gin (related_user_ids)`
- admin_audit_logs_target_user_id_idx: `btree (target_user_id, occurred_at DESC)`

## Políticas RLS
- "Admins can read admin audit logs" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
