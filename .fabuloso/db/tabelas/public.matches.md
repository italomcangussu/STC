# public.matches
> tabela · RLS on · ~<1k linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não | `extensions.uuid_generate_v4()` |  |
| championship_id | uuid | sim |  |  |
| phase | text | sim |  |  |
| player_a_id | uuid | sim |  |  |
| player_b_id | uuid | sim |  |  |
| score_a | integer[] | sim |  |  |
| score_b | integer[] | sim |  |  |
| winner_id | uuid | sim |  |  |
| date | date | sim |  |  |
| status | match_status | sim | `'pending'::match_status` |  |
| type | text | sim |  |  |
| scheduled_time | time without time zone | sim |  |  |
| championship_group_id | uuid | sim |  |  |
| round_id | uuid | sim |  |  |
| scheduled_date | date | sim |  |  |
| court_id | uuid | sim |  |  |
| registration_a_id | uuid | sim |  |  |
| registration_b_id | uuid | sim |  |  |
| is_walkover | boolean | sim | `false` |  |
| walkover_winner_id | uuid | sim |  |  |
| walkover_winner_registration_id | uuid | sim |  |  |
| updated_at | timestamp with time zone | sim | `now()` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| result_type | text | não | `'played'::text` |  |
| admin_notes | text | sim |  |  |
| result_set_by | uuid | sim |  |  |
| result_set_at | timestamp with time zone | sim |  |  |
| winner_registration_id | uuid | sim |  |  |
| match_number | integer | sim |  |  |
| player_a_source_match_id | uuid | sim |  |  |
| player_b_source_match_id | uuid | sim |  |  |

## Chaves e restrições
- PK (id)
- FK (championship_group_id) → public.championship_groups(id)
- FK (championship_id) → public.championships(id) on delete cascade
- FK (court_id) → public.courts(id)
- FK (player_a_id) → public.profiles(id)
- FK (player_a_source_match_id) → public.matches(id)
- FK (player_b_id) → public.profiles(id)
- FK (player_b_source_match_id) → public.matches(id)
- FK (registration_a_id) → public.championship_registrations(id)
- FK (registration_b_id) → public.championship_registrations(id)
- FK (result_set_by) → public.profiles(id)
- FK (round_id) → public.championship_rounds(id)
- FK (walkover_winner_id) → public.profiles(id)
- FK (walkover_winner_registration_id) → public.championship_registrations(id)
- FK (winner_id) → public.profiles(id)
- FK (winner_registration_id) → public.championship_registrations(id)
- CHECK matches_result_type_check: `CHECK ((result_type = ANY (ARRAY['played'::text, 'walkover'::text, 'technical_draw'::text])))`

## Referenciada por (6)
public.challenges.match_id, public.head_to_head_points.invalidated_by_match_id, public.head_to_head_points.match_id, public.matches.player_a_source_match_id, public.matches.player_b_source_match_id, public.reservations.match_id

## Índices
- idx_matches_champ_result_type: `btree (championship_id, result_type)`
- idx_matches_champ_round_status: `btree (championship_id, round_id, status)`
- idx_matches_championship_group: `btree (championship_group_id)`
- idx_matches_player_a_source: `btree (player_a_source_match_id) WHERE (player_a_source_match_id IS NOT NULL)`
- idx_matches_player_b_source: `btree (player_b_source_match_id) WHERE (player_b_source_match_id IS NOT NULL)`
- idx_matches_round: `btree (round_id)`

## Políticas RLS
- "Admins manage matches" — ALL para public · using `(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role))))`
- "Authenticated can insert matches" — INSERT para authenticated · check `(((auth.uid() = player_a_id) OR (auth.uid() = player_b_id)) OR is_admin())`
- "Players update own matches" — UPDATE para public · using `(((auth.uid() = player_a_id) OR (auth.uid() = player_b_id)) AND (status <> 'finished'::match_status))`
- "Public select matches" — SELECT para public · using `true`

## Gatilhos
- trg_admin_audit_matches — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- trg_auto_finish_championship — AFTER UPDATE OF status → public.check_and_auto_finish_championship()
- trg_process_head_to_head — AFTER UPDATE OF status → public.process_head_to_head_points()
- trg_propagate_bracket_winner — AFTER UPDATE OF status → public.propagate_bracket_winner()
- trg_sync_group_knockout_on_match_change — AFTER INSERT OR UPDATE OF status, score_a, score_b, winner_id, walkover_winner_id, walkover_winner_registration_id, registration_a_id, registration_b_id, championship_group_id, round_id → public.trg_sync_group_knockout_on_match_change()
- trg_validate_match_result_integrity — BEFORE INSERT OR UPDATE OF status, result_type, winner_id, walkover_winner_id, walkover_winner_registration_id, round_id, phase → public.validate_match_result_integrity()
- update_matches_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
