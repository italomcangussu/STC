# public.fin_attachments
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| entry_id | uuid | não |  |  |
| storage_path | text | não |  |  |
| file_name | text | não |  |  |
| content_type | text | não |  |  |
| size_bytes | integer | não |  |  |
| uploaded_by | uuid | sim |  |  |
| uploaded_at | timestamp with time zone | não | `now()` |  |
| removed_at | timestamp with time zone | sim |  |  |
| removed_by | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (entry_id) → public.fin_entries(id)
- FK (removed_by) → public.profiles(id)
- FK (uploaded_by) → public.profiles(id)
- UNIQUE (storage_path)
- CHECK fin_attachments_content_type_check: `CHECK ((content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/heic'::text])))`
- CHECK fin_attachments_file_name_check: `CHECK (((length(file_name) >= 1) AND (length(file_name) <= 200)))`
- CHECK fin_attachments_size_bytes_check: `CHECK (((size_bytes > 0) AND (size_bytes <= 10485760)))`

## Índices
- fin_attachments_entry_idx: `btree (entry_id)`
- fin_attachments_storage_path_key: `btree (storage_path)` único

## Políticas RLS
- "fin_attachments_admin_read" — SELECT para authenticated · using `is_admin()`
- "fin_attachments_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_attachments_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_attachments_no_update" — UPDATE para anon, authenticated · using `false` · check `false`

## Gatilhos
- fin_attachments_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_attachments_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
