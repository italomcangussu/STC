# public.ranking_reset_events
> tabela · RLS on · ~0 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| executed_by | uuid | não |  |  |
| reason | text | sim |  |  |
| reset_scope | text | não | `'full'::text` |  |
| executed_at | timestamp with time zone | não | `now()` |  |
| created_at | timestamp with time zone | não | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (executed_by) → public.profiles(id)

## Índices
- idx_ranking_reset_events_executed_at: `btree (executed_at DESC)`

## Políticas RLS
- "Admins can read ranking reset events" — SELECT para public · using `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.role)::text = 'admin'::text))))`

## Gatilhos
- trg_admin_audit_ranking_reset_events — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
