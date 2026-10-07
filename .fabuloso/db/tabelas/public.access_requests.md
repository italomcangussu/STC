# public.access_requests
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| phone | text | não |  |  |
| status | text | não | `'pending'::text` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| name | text | não |  |  |
| phone_normalized | text | não |  |  |
| email | text | sim |  |  |
| rejection_reason | text | sim |  |  |
| decided_by | uuid | sim |  |  |
| decided_at | timestamp with time zone | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (decided_by) → public.profiles(id)
- UNIQUE (phone)
- CHECK access_requests_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`

## Índices
- access_requests_phone_key: `btree (phone)` único
- access_requests_phone_normalized_key: `btree (phone_normalized)` único
- access_requests_status_created_at_idx: `btree (status, created_at DESC)`

## Políticas RLS
- "Admins can manage access requests" — ALL para authenticated · using `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))` · check `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))`
- "Admins can read access requests" — SELECT para authenticated · using `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))`
- "Anon can resubmit access requests" — UPDATE para anon, authenticated · using `(status = ANY (ARRAY['pending'::text, 'rejected'::text]))` · check `((status = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL))`
- "Anon can submit access requests" — INSERT para anon, authenticated · check `(status = 'pending'::text)`

## Gatilhos
- trg_access_requests_updated_at — BEFORE UPDATE → public.access_requests_set_updated_at()
- trg_admin_audit_access_requests — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
