# public.conv_followups
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| conversation_id | uuid | não |  |  |
| due_at | timestamp with time zone | não |  |  |
| note | text | sim |  |  |
| send_body | text | sim |  |  |
| status | text | não | `'pending'::text` |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| done_at | timestamp with time zone | sim |  |  |
| message_id | uuid | sim |  |  |
| last_error | text | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (conversation_id) → public.conv_conversations(id)
- FK (created_by) → public.profiles(id)
- FK (message_id) → public.conv_messages(id)
- CHECK conv_followups_note_check: `CHECK (((note IS NULL) OR (length(note) <= 500)))`
- CHECK conv_followups_send_body_check: `CHECK (((send_body IS NULL) OR ((length(TRIM(BOTH FROM send_body)) >= 1) AND (length(TRIM(BOTH FROM send_body)) <= 4096))))`
- CHECK conv_followups_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'done'::text, 'canceled'::text, 'failed'::text])))`

## Índices
- conv_followups_conversation_idx: `btree (conversation_id, due_at)`
- conv_followups_due_idx: `btree (due_at) WHERE (status = 'pending'::text)`

## Políticas RLS
- "conv_followups_admin_read" — SELECT para authenticated · using `is_admin()`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
