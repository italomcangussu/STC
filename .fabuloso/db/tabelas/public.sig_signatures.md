# public.sig_signatures
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| document_id | uuid | não |  |  |
| profile_id | uuid | não |  |  |
| seq | integer | não |  |  |
| signed_at | timestamp with time zone | não |  |  |
| document_title | text | não |  |  |
| document_version | integer | não |  |  |
| document_sha256 | text | não |  |  |
| signer_name | text | não |  |  |
| signer_phone | text | não |  |  |
| signer_cpf | text | não |  |  |
| consent_text | text | não |  |  |
| accepted_at | timestamp with time zone | não |  |  |
| read_started_at | timestamp with time zone | sim |  |  |
| read_completed_at | timestamp with time zone | sim |  |  |
| read_seconds | integer | sim |  |  |
| pages_seen | integer | sim |  |  |
| pages_total | integer | sim |  |  |
| challenge_id | uuid | não |  |  |
| code_sent_at | timestamp with time zone | não |  |  |
| code_verified_at | timestamp with time zone | não |  |  |
| code_attempts | integer | não |  |  |
| provider_message_id | text | sim |  |  |
| ip | text | sim |  |  |
| user_agent | text | sim |  |  |
| geo | jsonb | não | `'{}'::jsonb` |  |
| device | jsonb | não | `'{}'::jsonb` |  |
| evidence_hash | text | não |  |  |
| prev_chain_hash | text | sim |  |  |
| chain_hash | text | não |  |  |

## Chaves e restrições
- PK (id)
- FK (document_id) → public.sig_documents(id)
- UNIQUE (document_id, profile_id)
- UNIQUE (document_id, seq)
- CHECK sig_signatures_chain_hash_check: `CHECK ((chain_hash ~ '^[0-9a-f]{64}$'::text))`
- CHECK sig_signatures_evidence_hash_check: `CHECK ((evidence_hash ~ '^[0-9a-f]{64}$'::text))`

## Referenciada por (1)
public.sig_recipients.signature_id

## Índices
- sig_signatures_document_id_profile_id_key: `btree (document_id, profile_id)` único
- sig_signatures_document_id_seq_key: `btree (document_id, seq)` único
- sig_signatures_profile_idx: `btree (profile_id)`

## Políticas RLS
- "sig_signatures_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`
- "sig_signatures_member_read" — SELECT para authenticated · using `(profile_id = ( SELECT auth.uid() AS uid))`

## Gatilhos
- sig_signatures_append_only — BEFORE DELETE OR UPDATE → sig_private.forbid_change()
- sig_signatures_audit — AFTER INSERT → sig_private.audit_row()
- sig_signatures_no_truncate — BEFORE TRUNCATE → sig_private.forbid_change()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
