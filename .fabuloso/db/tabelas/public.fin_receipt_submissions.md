# public.fin_receipt_submissions
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| profile_id | uuid | não |  |  |
| status | text | não | `'submitted'::text` |  |
| storage_path | text | não |  |  |
| file_name | text | não |  |  |
| content_type | text | não |  |  |
| size_bytes | integer | não |  |  |
| content_sha256 | text | não |  |  |
| declared_amount_cents | bigint | sim |  |  |
| declared_paid_on | date | sim |  |  |
| declared_reference | text | sim |  |  |
| member_note | text | sim |  |  |
| ocr_status | text | não | `'not_run'::text` |  |
| ocr | jsonb | sim |  |  |
| possible_duplicate | boolean | não | `false` |  |
| duplicate_of | uuid | sim |  |  |
| reviewed_by | uuid | sim |  |  |
| reviewed_at | timestamp with time zone | sim |  |  |
| decision_reason | text | sim |  |  |
| approved_payment_ids | uuid[] | não | `'{}'::uuid[]` |  |
| superseded_by | uuid | sim |  |  |
| request_id | uuid | não |  |  |
| version | integer | não | `1` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| updated_at | timestamp with time zone | não | `now()` |  |
| source | text | não | `'app'::text` |  |
| source_message_id | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (duplicate_of) → public.fin_receipt_submissions(id)
- FK (profile_id) → public.profiles(id)
- FK (reviewed_by) → public.profiles(id)
- FK (source_message_id) → public.conv_messages(id)
- FK (superseded_by) → public.fin_receipt_submissions(id)
- UNIQUE (request_id)
- UNIQUE (storage_path)
- CHECK fin_receipt_submissions_check: `CHECK (((status <> ALL (ARRAY['approved'::text, 'rejected'::text])) OR ((reviewed_at IS NOT NULL) AND ((reviewed_by IS NOT NULL) OR ((status = 'approved'::text) AND (decision_reason ~~ 'Baixa automát…`
- CHECK fin_receipt_submissions_check1: `CHECK (((status <> 'rejected'::text) OR ((decision_reason IS NOT NULL) AND (length(TRIM(BOTH FROM decision_reason)) >= 5))))`
- CHECK fin_receipt_submissions_content_sha256_check: `CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text))`
- CHECK fin_receipt_submissions_content_type_check: `CHECK ((content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'image/heic'::text])))`
- CHECK fin_receipt_submissions_decision_reason_check: `CHECK (((decision_reason IS NULL) OR (length(decision_reason) <= 1000)))`
- CHECK fin_receipt_submissions_declared_amount_cents_check: `CHECK (((declared_amount_cents IS NULL) OR ((declared_amount_cents > 0) AND (declared_amount_cents <= 1000000000))))`
- CHECK fin_receipt_submissions_declared_reference_check: `CHECK (((declared_reference IS NULL) OR (length(declared_reference) <= 120)))`
- CHECK fin_receipt_submissions_file_name_check: `CHECK (((length(file_name) >= 1) AND (length(file_name) <= 200)))`
- CHECK fin_receipt_submissions_member_note_check: `CHECK (((member_note IS NULL) OR (length(member_note) <= 500)))`
- CHECK fin_receipt_submissions_ocr_status_check: `CHECK ((ocr_status = ANY (ARRAY['not_run'::text, 'ok'::text, 'unreadable'::text, 'failed'::text])))`
- CHECK fin_receipt_submissions_size_bytes_check: `CHECK (((size_bytes > 0) AND (size_bytes <= 10485760)))`
- CHECK fin_receipt_submissions_source_check: `CHECK ((source = ANY (ARRAY['app'::text, 'whatsapp'::text])))`
- CHECK fin_receipt_submissions_status_check: `CHECK ((status = ANY (ARRAY['submitted'::text, 'in_review'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])))`

## Referenciada por (4)
public.fin_charge_payments.submission_id, public.fin_receipt_charges.submission_id, public.fin_receipt_submissions.duplicate_of, public.fin_receipt_submissions.superseded_by

## Índices
- fin_receipt_submissions_hash_idx: `btree (content_sha256)`
- fin_receipt_submissions_pending_idx: `btree (created_at) WHERE (status = ANY (ARRAY['submitted'::text, 'in_review'::text]))`
- fin_receipt_submissions_profile_idx: `btree (profile_id, created_at DESC)`
- fin_receipt_submissions_request_id_key: `btree (request_id)` único
- fin_receipt_submissions_source_message_uidx: `btree (source_message_id) WHERE (source_message_id IS NOT NULL)` único
- fin_receipt_submissions_storage_path_key: `btree (storage_path)` único

## Políticas RLS
- "fin_receipt_submissions_no_delete_policy" — DELETE para anon, authenticated · using `false`
- "fin_receipt_submissions_no_insert" — INSERT para anon, authenticated · check `false`
- "fin_receipt_submissions_no_update" — UPDATE para anon, authenticated · using `false` · check `false`
- "fin_receipt_submissions_read" — SELECT para authenticated · using `(is_admin() OR (profile_id = ( SELECT auth.uid() AS uid)))`

## Gatilhos
- fin_receipt_auto_paid_notice — AFTER UPDATE OF status → fin_private.receipt_auto_paid_notice()
- fin_receipt_submissions_audit — AFTER INSERT OR UPDATE → fin_private.audit_row()
- fin_receipt_submissions_no_delete — BEFORE DELETE → fin_private.no_delete()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
