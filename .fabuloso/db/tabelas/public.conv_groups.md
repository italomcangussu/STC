# public.conv_groups
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| group_jid | text | não |  |  |
| name | text | sim |  |  |
| status | text | não | `'detected'::text` |  |
| ai_enabled | boolean | não | `false` |  |
| first_seen_at | timestamp with time zone | não | `now()` |  |
| last_seen_at | timestamp with time zone | não | `now()` |  |
| events_seen | integer | não | `1` |  |
| last_payload_shape | jsonb | sim |  |  |
| allowed_by | uuid | sim |  |  |
| allowed_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (allowed_by) → public.profiles(id)
- UNIQUE (group_jid)
- CHECK conv_groups_ai_needs_allowed: `CHECK (((NOT ai_enabled) OR (status = 'allowed'::text)))`
- CHECK conv_groups_group_jid_check: `CHECK ((group_jid ~ '^[0-9A-Za-z._-]{5,64}@g\.us$'::text))`
- CHECK conv_groups_name_check: `CHECK (((name IS NULL) OR (length(name) <= 200)))`
- CHECK conv_groups_status_check: `CHECK ((status = ANY (ARRAY['detected'::text, 'allowed'::text, 'blocked'::text])))`

## Referenciada por
- public.conv_conversations.group_id

## Índices
- conv_groups_group_jid_key: `btree (group_jid)` único

## Políticas RLS
- "conv_groups_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
