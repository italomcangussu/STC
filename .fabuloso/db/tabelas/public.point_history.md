# public.point_history
> tabela · RLS OFF · ~<100 linhas — Ledger of all points earned to allow for 1-year expiration policies.

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |  |
| user_id | uuid | sim |  |  |
| amount | integer | não |  |  |
| event_type | text | sim |  |  |
| event_id | uuid | sim |  |  |
| description | text | sim |  |  |
| earned_date | date | não |  |  |
| expires_at | date | não |  |  |
| status | text | sim | `'active'::text` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| series_id | uuid | sim |  |  |
| edition_year | integer | sim |  |  |
| phase | text | sim |  |  |
| registration_class | text | sim |  |  |
| reason | text | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (series_id) → public.championship_series(id)
- FK (user_id) → public.profiles(id) on delete cascade
- CHECK point_history_event_type_check: `CHECK ((event_type = ANY (ARRAY['Desafio'::text, 'Campeonato'::text, 'Aula'::text, 'SuperSet'::text, 'Torneio'::text, 'Racha'::text, 'Ranking'::text, 'Outro'::text, 'superset'::text, 'championship'::…`
- CHECK point_history_reason_check: `CHECK ((reason = ANY (ARRAY['championship_earn'::text, 'championship_earn_lower_class'::text, 'defense_removal'::text, 'class_promotion_adjustment'::text, 'head_to_head_earn'::text, 'head_to_head_inv…`
- CHECK point_history_status_check: `CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))`

## Índices
- idx_point_history_calculation: `btree (user_id, status, expires_at)`
- idx_point_history_series: `btree (user_id, series_id, edition_year) WHERE (series_id IS NOT NULL)`

## Políticas RLS
- (RLS desligado)

## Gatilhos
- trg_admin_audit_point_history — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- update_point_history_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
