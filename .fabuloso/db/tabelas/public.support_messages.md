# public.support_messages
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| full_name | text | não |  |  |
| email | text | não |  |  |
| country_code | text | não |  |  |
| phone_number | text | não |  |  |
| message_type | text | não |  |  |
| message | text | não |  |  |
| status | text | não | `'new'::text` |  |
| admin_response | text | sim |  |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- CHECK support_messages_message_type_check: `CHECK ((message_type = ANY (ARRAY['suggestion'::text, 'support'::text, 'error'::text, 'compliment'::text, 'complaint'::text])))`
- CHECK support_messages_status_check: `CHECK ((status = ANY (ARRAY['new'::text, 'read'::text, 'answered'::text])))`

## Índices
- idx_support_messages_created_at: `btree (created_at DESC)`
- idx_support_messages_email: `btree (email)`
- idx_support_messages_status: `btree (status)`

## Políticas RLS
- "Admins can update support messages" — UPDATE para public · using `(EXISTS ( SELECT 1 FROM auth.users WHERE ((users.id = auth.uid()) AND ((users.email)::text = 'italomcangussu@icloud.com'::text))))`
- "Admins can view all support messages" — SELECT para public · using `(EXISTS ( SELECT 1 FROM auth.users WHERE ((users.id = auth.uid()) AND ((users.email)::text = 'italomcangussu@icloud.com'::text))))`
- "Anyone can submit support messages" — INSERT para public · check `true`

## Gatilhos
- update_support_messages_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
