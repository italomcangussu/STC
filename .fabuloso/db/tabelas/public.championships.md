# public.championships
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| name | text | não |  |  |
| status | text | sim | `'draft'::text` |  |
| format | text | não |  |  |
| start_date | date | sim |  |  |
| end_date | date | sim |  |  |
| rules | text | sim |  |  |
| pts_victory | numeric | não | `3` |  |
| pts_set | numeric | não | `0` |  |
| pts_game | numeric | não | `0` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| logo_url | text | sim |  |  |
| groups | jsonb | sim |  |  |
| pts_defeat | integer | não | `0` |  |
| pts_wo_victory | integer | não | `3` |  |
| final_ranking_pts | integer | sim | `200` |  |
| tiebreak_rules | text[] | sim |  |  |
| registration_open | boolean | não | `true` |  |
| slug | character varying(100) | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| pts_technical_draw | integer | não | `0` |  |
| registration_closed | boolean | não | `false` |  |
| registration_closed_at | timestamp with time zone | sim |  |  |
| series_id | uuid | sim |  |  |
| edition_year | integer | sim |  |  |
| format_config | jsonb | sim |  | Configuração do formato escolhida no Criador. Formato do objeto em lib/championship/formatConfig.ts. |
| allow_guests | boolean | não | `false` | Se o Criador oferece a aba "Convidado" ao inscrever. Não restringe o que já foi inscrito. |
| allow_students | boolean | não | `false` | Se o Criador oferece a aba "Aluno" ao inscrever. Não restringe o que já foi inscrito. |

## Chaves e restrições
- PK (id)
- FK (series_id) → public.championship_series(id)
- UNIQUE (slug)
- CHECK championships_format_check: `CHECK ((format = ANY (ARRAY['mata-mata'::text, 'pontos-corridos'::text, 'grupo-mata-mata'::text])))`

## Referenciada por (7)
public.championship_admin_audit_logs.championship_id, public.championship_groups.championship_id, public.championship_participants.championship_id, public.championship_registrations.championship_id, public.championship_rounds.championship_id, public.championship_winners.championship_id, public.matches.championship_id

## Índices
- championships_slug_key: `btree (slug)` único
- idx_championships_series_id: `btree (series_id)`
- idx_championships_slug: `btree (slug)`
- uidx_championship_series_edition_year: `btree (series_id, edition_year) WHERE ((series_id IS NOT NULL) AND (edition_year IS NOT NULL))` único

## Políticas RLS
- "Admins manage championships" — ALL para public · using `is_admin()`
- "Championships viewable by everyone" — SELECT para public · using `true`
- "Enable insert for authenticated users on championships" — INSERT para authenticated · check `true`
- "Enable read access for all users on championships" — SELECT para public · using `true`
- "Enable update for authenticated users on championships" — UPDATE para authenticated · using `true`

## Gatilhos
- trg_admin_audit_championships — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- trg_apply_championship_points_on_finish — AFTER UPDATE OF status → public.on_championship_finished_apply_points()
- trg_sync_championship_registration_flags — BEFORE INSERT OR UPDATE OF registration_open, registration_closed → public.sync_championship_registration_flags()
- update_championships_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
