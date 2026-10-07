# public.sig_notifications
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| document_id | uuid | não |  |  |
| profile_id | uuid | não |  |  |
| kind | text | não |  |  |
| slot | text | não | `''::text` |  |
| status | text | não | `'queued'::text` |  |
| skip_reason | text | sim |  |  |
| attempts | integer | não | `0` |  |
| not_before | timestamp with time zone | não | `now()` |  |
| claimed_at | timestamp with time zone | sim |  |  |
| sent_at | timestamp with time zone | sim |  |  |
| provider_message_id | text | sim |  |  |
| error | text | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (document_id) → public.sig_documents(id) on delete cascade
- FK (profile_id) → public.profiles(id) on delete cascade
- UNIQUE (document_id, profile_id, kind, slot)
- CHECK sig_notifications_kind_check: `CHECK ((kind = ANY (ARRAY['publish'::text, 'reminder'::text, 'new_member'::text])))`
- CHECK sig_notifications_status_check: `CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))`

## Índices
- sig_notifications_document_id_profile_id_kind_slot_key: `btree (document_id, profile_id, kind, slot)` único
- sig_notifications_document_idx: `btree (document_id, status)`
- sig_notifications_queue_idx: `btree (not_before) WHERE (status = ANY (ARRAY['queued'::text, 'sending'::text]))`

## Políticas RLS
- "sig_notifications_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
