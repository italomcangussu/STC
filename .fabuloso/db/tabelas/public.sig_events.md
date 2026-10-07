# public.sig_events
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | bigint | não |  | identity |
| occurred_at | timestamp with time zone | não | `now()` |  |
| document_id | uuid | não |  |  |
| profile_id | uuid | sim |  |  |
| kind | text | não |  |  |
| ip | text | sim |  |  |
| user_agent | text | sim |  |  |
| meta | jsonb | não | `'{}'::jsonb` |  |

## Chaves e restrições
- PK (id)
- FK (document_id) → public.sig_documents(id)
- CHECK sig_events_kind_check: `CHECK ((kind = ANY (ARRAY['viewed'::text, 'read_started'::text, 'read_completed'::text, 'consent_checked'::text, 'code_requested'::text, 'code_sent'::text, 'code_send_failed'::text, 'code_wrong'::tex…`

## Índices
- sig_events_trail_idx: `btree (document_id, profile_id, kind, occurred_at)`

## Políticas RLS
- "sig_events_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`

## Gatilhos
- sig_events_append_only — BEFORE DELETE OR UPDATE → sig_private.forbid_change()
- sig_events_no_truncate — BEFORE TRUNCATE → sig_private.forbid_change()

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
