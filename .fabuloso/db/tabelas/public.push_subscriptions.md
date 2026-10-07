# public.push_subscriptions
> tabela · RLS on · ~<100 linhas — Stores Web Push notification subscription data for iOS PWA and other browsers

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| user_id | uuid | não |  |  |
| endpoint | text | não |  |  |
| keys | jsonb | não |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (user_id) → public.profiles(id) on delete cascade
- UNIQUE (endpoint)

## Índices
- idx_push_subscriptions_endpoint: `btree (endpoint)`
- idx_push_subscriptions_user_id: `btree (user_id)`
- idx_push_subscriptions_user_updated: `btree (user_id, updated_at DESC)`
- push_subscriptions_endpoint_key: `btree (endpoint)` único

## Políticas RLS
- "Service role can all" — ALL para service_role · using `true` · check `true`
- "Service role can read all" — SELECT para public · using `(auth.role() = 'service_role'::text)`
- "Users can manage own subscriptions" — ALL para authenticated · using `(auth.uid() = user_id)` · check `(auth.uid() = user_id)`

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
