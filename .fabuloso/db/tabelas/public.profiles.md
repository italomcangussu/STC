# public.profiles
> tabela · RLS on · ~<100 linhas

## Colunas
| Coluna | Tipo | Nulo | Padrão | Nota |
|---|---|---|---|---|
| id | uuid | não |  |  |
| name | text | não |  |  |
| email | text | sim |  |  |
| role | user_role | sim | `'socio'::user_role` |  |
| balance | numeric | sim | `0` |  |
| avatar_url | text | sim |  |  |
| category | text | sim |  |  |
| is_professor | boolean | sim | `false` |  |
| is_active | boolean | sim | `true` |  |
| created_at | timestamp with time zone | sim | `now()` |  |
| age | integer | sim |  |  |
| phone | text | sim |  |  |
| legacy_wins | integer | sim | `0` | Vitórias de campeonatos anteriores (antes da migração) |
| legacy_losses | integer | sim | `0` | Derrotas de campeonatos anteriores |
| legacy_sets_won | integer | sim | `0` | Sets ganhos em campeonatos anteriores |
| legacy_games_won | integer | sim | `0` | Games ganhos em campeonatos anteriores |
| legacy_points | integer | sim | `0` | Pontos totais de campeonatos anteriores |
| legacy_sets_lost | integer | sim | `0` | Sets perdidos em campeonatos anteriores |
| legacy_games_lost | integer | sim | `0` | Games perdidos em campeonatos anteriores |
| legacy_tiebreaks_won | integer | sim | `0` | Tiebreaks vencidos em campeonatos anteriores |
| legacy_tiebreaks_lost | integer | sim | `0` | Tiebreaks perdidos em campeonatos anteriores |
| legacy_matches_played | integer | sim | `0` | Total de partidas disputadas em campeonatos anteriores |
| legacy_matches_with_tiebreak | integer | sim | `0` | Partidas que foram para tiebreak em campeonatos anteriores |
| updated_at | timestamp with time zone | sim | `now()` |  |

## Chaves e restrições
- PK (id)
- FK (id) → auth.users(id)
- UNIQUE (phone)

## Referenciada por
- public.access_requests.decided_by
- public.admin_audit_logs.actor_user_id
- public.admin_audit_logs.target_user_id
- public.challenges.challenged_id
- public.challenges.challenger_id
- public.championship_admin_audit_logs.actor_user_id
- public.championship_participants.user_id
- public.championship_registrations.registered_by
- public.championship_registrations.user_id
- public.championship_series.created_by
- public.championship_winners.winner_id
- public.class_change_events.changed_by
- public.class_change_events.user_id
- public.club_form_responses.user_id
- public.club_form_voter_receipts.user_id
- public.club_forms.created_by
- public.consumptions.user_id
- public.conv_admin_alert_log.profile_id
- public.conv_admin_briefing_recipients.profile_id
- public.conv_admin_prefs.profile_id
- public.conv_ai_member_context.profile_id
- public.conv_ai_settings.created_by
- public.conv_automation_recipients.profile_id
- public.conv_automation_runs.created_by
- public.conv_automation_settings.updated_by
- public.conv_automation_versions.created_by
- public.conv_automations.created_by
- public.conv_automations.updated_by
- public.conv_booking_proposals.requester_profile_id
- public.conv_channel.mention_verified_by
- public.conv_channel.updated_by
- public.conv_contacts.profile_id
- public.conv_conversations.assigned_to
- public.conv_followups.created_by
- public.conv_groups.allowed_by
- public.conv_messages.author_id
- public.conv_notes.author_id
- public.conv_quick_replies.created_by
- public.conv_requests.actor_id
- public.fin_accounts.created_by
- public.fin_accounts.updated_by
- public.fin_attachments.removed_by
- public.fin_attachments.uploaded_by
- public.fin_categories.created_by
- public.fin_categories.updated_by
- public.fin_charge_adjustments.actor_id
- public.fin_charge_payments.actor_id
- public.fin_entries.canceled_by
- public.fin_entries.created_by
- public.fin_entries.updated_by
- public.fin_entry_payments.actor_id
- public.fin_holidays.created_by
- public.fin_holidays.updated_by
- public.fin_member_charges.canceled_by
- public.fin_member_charges.created_by
- public.fin_member_charges.profile_id
- public.fin_member_charges.updated_by
- public.fin_member_credits.profile_id
- public.fin_member_credits.resolved_by
- public.fin_member_plan_prices.created_by
- public.fin_member_plans.created_by
- public.fin_member_plans.profile_id
- public.fin_member_plans.updated_by
- public.fin_receipt_submissions.profile_id
- public.fin_receipt_submissions.reviewed_by
- public.fin_recurrences.created_by
- public.fin_recurrences.updated_by
- public.fin_requests.actor_id
- public.fin_settings.late_fee_confirmed_by
- public.fin_settings.updated_by
- public.head_to_head_points.loser_id
- public.head_to_head_points.winner_id
- public.matches.player_a_id
- public.matches.player_b_id
- public.matches.result_set_by
- public.matches.walkover_winner_id
- public.matches.winner_id
- public.non_socio_students.responsible_socio_id
- public.point_history.user_id
- public.professors.user_id
- public.push_subscriptions.user_id
- public.ranking_reset_events.executed_by
- public.reservation_participants.user_id
- public.reservations.creator_id
- public.reservations.guest_responsible_id
- public.sig_documents.archived_by
- public.sig_documents.created_by
- public.sig_documents.published_by
- public.sig_member_identities.profile_id
- public.sig_notifications.profile_id
- public.sig_recipients.profile_id
- public.student_level_history.changed_by
- public.student_payments.approved_by
- public.student_profiles.profile_id
- sig_private.challenges.profile_id

## Índices
- profiles_phone_key: `btree (phone)` único

## Políticas RLS
- "Admins can update any profile" — UPDATE para authenticated · using `is_admin()`
- "Enable insert for authenticated" — INSERT para authenticated · check `true`
- "Enable update for users based on id" — UPDATE para authenticated · using `(auth.uid() = id)` · check `(auth.uid() = id)`
- "Profiles are viewable by everyone" — SELECT para public · using `true`
- "Public profiles are viewable by everyone" — SELECT para public · using `true`
- "Users can update own profile" — UPDATE para public · using `(auth.uid() = id)`

## Gatilhos
- fin_profile_membership_end — AFTER UPDATE OF is_active, role → fin_private.on_profile_membership_change()
- sig_profiles_new_member — AFTER INSERT OR UPDATE OF is_active, role → sig_private.on_member_active()
- trg_admin_audit_profiles — AFTER INSERT OR DELETE OR UPDATE → public.admin_audit_table_changes()
- trg_profile_class_change — BEFORE UPDATE OF category → public.on_profile_class_change()
- update_profiles_updated_at — BEFORE UPDATE → public.update_updated_at_column()

## Grants
- anon: siud · authenticated: siud (s=select i=insert u=update d=delete)
