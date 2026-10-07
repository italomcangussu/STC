# public.sig_documents_overview
> view · security_invoker

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | sim |  |  |
| title | text | sim |  |  |
| version | integer | sim |  |  |
| status | text | sim |  |  |
| audience_mode | text | sim |  |  |
| applies_to_new_members | boolean | sim |  |  |
| page_count | integer | sim |  |  |
| due_at | timestamp with time zone | sim |  |  |
| created_at | timestamp with time zone | sim |  |  |
| published_at | timestamp with time zone | sim |  |  |
| recipients | bigint | sim |  |  |
| signed | bigint | sim |  |  |
| notifications_pending | bigint | sim |  |  |
| notifications_failed | bigint | sim |  |  |
| no_phone | bigint | sim |  |  |

## Grants
- anon: — · authenticated: s (s=select i=insert u=update d=delete)

## Definição
```sql
SELECT id,
    title,
    version,
    status,
    audience_mode,
    applies_to_new_members,
    page_count,
    due_at,
    created_at,
    published_at,
    ( SELECT count(*) AS count
           FROM sig_recipients r
          WHERE r.document_id = d.id) AS recipients,
    ( SELECT count(*) AS count
           FROM sig_recipients r
          WHERE r.document_id = d.id AND r.signed_at IS NOT NULL) AS signed,
    ( SELECT count(*) AS count
           FROM sig_notifications n
          WHERE n.document_id = d.id AND (n.status = ANY (ARRAY['queued'::text, 'sending'::text]))) AS notifications_pending,
    ( SELECT count(*) AS count
           FROM sig_notifications n
          WHERE n.document_id = d.id AND n.status = 'failed'::text) AS notifications_failed,
    ( SELECT count(*) AS count
           FROM sig_notifications n
          WHERE n.document_id = d.id AND n.status = 'skipped'::text AND n.skip_reason = 'no_phone'::text) AS no_phone
   FROM sig_documents d;
```
