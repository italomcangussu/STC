# public.sig_recipients
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| document_id | uuid | não |  |  |
| profile_id | uuid | não |  |  |
| source | text | não | `'selected'::text` |  |
| added_at | timestamp with time zone | não | `now()` |  |
| added_by | uuid | sim |  |  |
| signed_at | timestamp with time zone | sim |  |  |
| signature_id | uuid | sim |  |  |

## Chaves e restrições
- PK (document_id, profile_id)
- FK (document_id) → public.sig_documents(id) on delete cascade
- FK (profile_id) → public.profiles(id) on delete cascade
- FK (signature_id) → public.sig_signatures(id)
- CHECK sig_recipients_check: `CHECK (((signed_at IS NULL) = (signature_id IS NULL)))`
- CHECK sig_recipients_source_check: `CHECK ((source = ANY (ARRAY['all'::text, 'selected'::text, 'new_member'::text])))`

## Índices
- sig_recipients_pending_idx: `btree (profile_id) WHERE (signed_at IS NULL)`

## Políticas RLS
- "sig_recipients_admin_read" — SELECT para authenticated · using `( SELECT is_admin() AS is_admin)`
- "sig_recipients_member_read" — SELECT para authenticated · using `((profile_id = ( SELECT auth.uid() AS uid)) AND sig_member_can_see(document_id))`

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)
