# sig_private.challenges
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| document_id | uuid | não |  |  |
| profile_id | uuid | não |  |  |
| code_hash | text | não |  |  |
| salt | text | não |  |  |
| phone | text | não |  |  |
| status | text | não | `'pending'::text` |  |
| attempts | integer | não | `0` |  |
| max_attempts | integer | não | `5` |  |
| created_at | timestamp with time zone | não | `now()` |  |
| expires_at | timestamp with time zone | não |  |  |
| sent_at | timestamp with time zone | sim |  |  |
| provider_message_id | text | sim |  |  |
| send_error | text | sim |  |  |
| ip | text | sim |  |  |
| user_agent | text | sim |  |  |
| evidence | jsonb | não | `'{}'::jsonb` |  |

## Chaves e restrições
- PK (id)
- FK (document_id) → public.sig_documents(id) on delete cascade
- FK (profile_id) → public.profiles(id) on delete cascade
- CHECK challenges_status_check: `CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'verified'::text, 'expired'::text, 'locked'::text, 'superseded'::text, 'failed'::text])))`

## Índices
- sig_challenges_lookup_idx: `btree (profile_id, document_id, created_at DESC)`

## Políticas RLS
- (nenhuma: sem acesso pela API)

## Grants
- anon: — · authenticated: — (s=select i=insert u=update d=delete)
