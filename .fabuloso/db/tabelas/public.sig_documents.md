# public.sig_documents
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| title | text | não |  |  |
| description | text | sim |  |  |
| file_name | text | não |  |  |
| storage_path | text | não |  |  |
| size_bytes | bigint | não |  |  |
| page_count | integer | não |  |  |
| content_sha256 | text | não |  |  |
| version | integer | não | `1` |  |
| replaces_id | uuid | sim |  |  |
| status | text | não | `'draft'::text` |  |
| audience_mode | text | não | `'all'::text` |  |
| applies_to_new_members | boolean | não | `false` |  |
| due_at | timestamp with time zone | sim |  |  |
| created_by | uuid | sim |  |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| published_at | timestamp with time zone | sim |  |  |
| published_by | uuid | sim |  |  |
| archived_at | timestamp with time zone | sim |  |  |
| archived_by | uuid | sim |  |  |
| archived_reason | text | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (archived_by) → public.profiles(id) on delete set null
- FK (created_by) → public.profiles(id) on delete set null
- FK (published_by) → public.profiles(id) on delete set null
- FK (replaces_id) → public.sig_documents(id)
- UNIQUE (storage_path)
- CHECK sig_documents_audience_mode_check: `CHECK ((audience_mode = ANY (ARRAY['all'::text, 'selected'::text])))`
- CHECK sig_documents_check: `CHECK (((applies_to_new_members = false) OR (audience_mode = 'all'::text)))`
- CHECK sig_documents_check1: `CHECK ((storage_path = ((((id)::text \|\| '/'::text) \|\| content_sha256) \|\| '.pdf'::text)))`
- CHECK sig_documents_content_sha256_check: `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text))`
- CHECK sig_documents_description_check: `CHECK (((description IS NULL) OR (char_length(description) <= 2000)))`
- CHECK sig_documents_file_name_check: `CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 255)))`
- CHECK sig_documents_page_count_check: `CHECK (((page_count >= 1) AND (page_count <= 1000)))`
- CHECK sig_documents_size_bytes_check: `CHECK (((size_bytes >= 1) AND (size_bytes <= 10485760)))`
- CHECK sig_documents_status_check: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))`
- CHECK sig_documents_title_check: `CHECK (((char_length(btrim(title)) >= 3) AND (char_length(btrim(title)) <= 160)))`
- CHECK sig_documents_version_check: `CHECK ((version >= 1))`

## Referenciada por (6)
public.sig_documents.replaces_id, public.sig_events.document_id, public.sig_notifications.document_id, public.sig_recipients.document_id, public.sig_signatures.document_id, sig_private.challenges.document_id

## Índices
- sig_documents_replaces_idx: `btree (replaces_id) WHERE (replaces_id IS NOT NULL)`
- sig_documents_status_idx: `btree (status, published_at DESC)`
- sig_documents_storage_path_key: `btree (storage_path)` único

## Políticas RLS
- "sig_documents_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`
- "sig_documents_member_read" — SELECT para authenticated · using `sig_member_can_see(id)`

## Gatilhos
- sig_documents_audit — AFTER INSERT OR DELETE OR UPDATE → sig_private.audit_row()
- sig_documents_guard — BEFORE DELETE OR UPDATE → sig_private.guard_document()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
