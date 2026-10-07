# Mapa do banco — postgres
> Gerado por `fabuloso.mjs db` em 2026-10-07 11:28 UTC · fonte: api supabase (smztsayzldjmkzmufqcz) · Postgres 17.6 · hash 85df5c14b0ff
> Última migração aplicada no remoto: 20261007120200 · última local no mapa: 20261007120000
> Detalhe: `tabelas/<schema>.<tabela>.md` (colunas, FKs, índices, políticas, gatilhos) · `funcoes.md` · `relacoes.mmd`. Não introspecte o banco para o que está aqui.

## Alertas (174)
- [alta] public.avaliacoes_semanais — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.championship_participants — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.championship_winners — política "Admin insert" (INSERT) libera escrita para public com expressão true
- [alta] public.championship_winners — política "Admin update" (UPDATE) libera escrita para public com expressão true
- [alta] public.courts — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.documentos_contexto — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.familia_compat_produto — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.historico_conversas — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.historico_treino — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.iatende_conversas — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.n8n_chat_histories — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.n8n_chat_histories_duplicate — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.n8n_vectors — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.n8n_vectors_treinador — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.n8n_vectors2 — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.patients_ebm — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.planos_treino — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.point_history — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.reservation_participants — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.servicos — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.stores — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.students — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.subcategorias — RLS desligado e com grant para anon/authenticated — exposto pela API
- [alta] public.support_messages — política "Anyone can submit support messages" (INSERT) libera escrita para public com expressão true
- [alta] public.tbl_embedding_valid — RLS desligado e com grant para anon/authenticated — exposto pela API
- [média] public.apply_championship_edition_points — SECURITY DEFINER sem search_path fixo
- [média] public.bootstrap_ranking_from_3_circuito — SECURITY DEFINER sem search_path fixo
- [média] public.des — sem chave primária
- [média] public.get_championship_phase_points — SECURITY DEFINER sem search_path fixo
- [média] public.get_user_h2h_points — SECURITY DEFINER sem search_path fixo
- [média] public.on_profile_class_change — SECURITY DEFINER sem search_path fixo
- [média] public.process_head_to_head_points — SECURITY DEFINER sem search_path fixo
- [média] public.reservas — sem chave primária
- [média] public.reservas2 — sem chave primária
- [média] public.revert_championship_edition_points — SECURITY DEFINER sem search_path fixo
- [média] public.rollback_bootstrap_3_circuito — SECURITY DEFINER sem search_path fixo
- [média] public.upsert_crm_lead — SECURITY DEFINER sem search_path fixo
- [média] public.vw_familia_modelos_expandidos — view sem security_invoker legível por anon — ignora o RLS das tabelas de origem
- [info] 94 funções — SECURITY DEFINER executáveis por anon (coluna anon em funcoes.md) — confirme quais RPCs devem ser públicas
- [info] public.access_requests — FK (decided_by) → public.profiles sem índice
- [info] public.alunos — RLS ligado sem políticas — ninguém acessa pela API (ok se for só service_role)
- [info] public.aniversario_consulta — RLS ligado sem políticas — ninguém acessa pela API (ok se for só service_role)
- [info] public.challenges — FK (challenger_id) → public.profiles sem índice
- [info] public.challenges — FK (court_id) → public.courts sem índice
- [info] public.challenges — FK (match_id) → public.matches sem índice
- [info] public.challenges — FK (reservation_id) → public.reservations sem índice
- [info] public.championship_admin_audit_logs — FK (actor_user_id) → public.profiles sem índice
- [info] public.championship_groups — FK (seed_registration_id) → public.championship_registrations sem índice
- [info] public.championship_participants — FK (user_id) → public.profiles sem índice
- [info] public.championship_registrations — FK (registered_by) → public.profiles sem índice
- … +124 infos em `alertas.md`

## Schema fin_private

Views: charge_payments_effective ⚠definer

## Schema public
| Tabela | Linhas | PK | FK → | RLS | Políticas | Gatilhos | anon/auth |
|---|---|---|---|---|---|---|---|
| Cliente_CRM | <10k | id | — | on | — | 1 | siud/siud |
| Memory Long | <10k | id_sender | — | on | — | — | siud/siud |
| Memory Long_jp | 0 | id_sender | — | on | — | — | siud/siud |
| Memory Test | 0 | id | — | on | — | — | siud/siud |
| access_requests | <100 | id | profiles | on | S1 I1 U1 A1 | 2 | siud/siud |
| admin_audit_logs | <10k | id | profiles | on | S1 | — | siud/siud |
| alunos | 0 | id_aluno | — | on | — | — | siud/siud |
| aniversario_consulta | <10k | id | — | on | — | — | siud/siud |
| announcements | 0 | id | — | on | S1 A1 | 1 | siud/siud |
| avaliacoes_semanais | 0 | id_avaliacao | alunos | **OFF** | — | — | siud/siud |
| challenges | <100 | id | profiles, courts, matches, reservations | on | S1 I2 U1 D1 | 2 | siud/siud |
| championship_admin_audit_logs | <1k | id | profiles, championships | on | S1 I1 | — | siud/siud |
| championship_group_members | <100 | id | championship_groups, championship_registrations | on | S1 I1 U1 D1 | 1 | siud/siud |
| championship_groups | 0 | id | championships, championship_registrations | on | S1 I1 U1 D1 | — | siud/siud |
| championship_participants | 0 | championship_id, user_id | championships, profiles | **OFF** | — | — | siud/siud |
| championship_phase_points | 0 | phase | — | on | S1 A1 | — | siud/siud |
| championship_registrations | <100 | id | championships, profiles, non_socio_students | on | S1 I1 U1 D1 | 1 | siud/siud |
| championship_rounds | <100 | id | championships | on | S1 A1 | 1 | siud/siud |
| championship_series | 0 | id | profiles | on | S1 A1 | — | siud/siud |
| championship_winners | 0 | id | championships, profiles | on | S1 I1 U1 | 1 | siud/siud |
| championships | <100 | id | championship_series | on | S2 I1 U1 A1 | 4 | siud/siud |
| class_change_events | 0 | id | profiles | on | S1 I1 | — | siud/siud |
| club_form_options | 0 | id | club_form_questions | on | S1 A1 | — | siud/siud |
| club_form_questions | 0 | id | club_forms | on | S1 A1 | — | siud/siud |
| club_form_responses | 0 | id | club_forms, club_form_options, club_form_questions, profiles | on | S1 I1 D1 | — | siud/siud |
| club_form_voter_receipts | 0 | id | club_forms, profiles | on | S1 I1 | — | siud/siud |
| club_forms | 0 | id | profiles | on | S1 A1 | — | siud/siud |
| consumptions | 0 | id | products, profiles | on | S2 A1 | 1 | siud/siud |
| conv_ai_decisions | <100 | id | conv_conversations, conv_ai_sessions, conv_ai_settings | on | S1 | — | ·/s |
| conv_ai_member_context | 0 | profile_id | profiles | on | S1 | — | ·/s |
| conv_ai_memory_candidates | 0 | id | auth.users, conv_messages | on | — | — | siud/siud |
| conv_ai_sessions | <100 | id | conv_conversations, conv_contacts, conv_messages | on | S1 | — | ·/s |
| conv_ai_settings | 0 | version | profiles | on | S1 | — | ·/s |
| conv_automation_recipients | 0 | id | conv_automations, conv_contacts, conv_messages, profiles, conv_automation_runs, non_socio_students | on | S1 | 1 | ·/s |
| conv_automation_runs | 0 | id | conv_automations, profiles | on | S1 | — | ·/s |
| conv_automation_settings | 0 | id | profiles | on | S1 | — | ·/s |
| conv_automation_versions | 0 | automation_id, version | conv_automations, profiles | on | S1 | 1 | ·/s |
| conv_automations | 0 | id | profiles | on | S1 | 1 | ·/s |
| conv_booking_proposals | 0 | id | conv_contacts, conv_messages, conv_conversations, profiles, reservations, conv_ai_sessions | on | S1 | — | ·/s |
| conv_channel | 0 | id | profiles | on | S1 | — | ·/· |
| conv_contacts | <100 | id | non_socio_students, profiles | on | S1 | 1 | ·/s |
| conv_conversations | <100 | id | profiles, conv_contacts, conv_groups | on | S1 | 1 | ·/s |
| conv_followups | 0 | id | conv_conversations, profiles, conv_messages | on | S1 | — | ·/s |
| conv_groups | <100 | id | profiles | on | S1 | — | ·/s |
| conv_messages | <1k | id | conv_ai_sessions, profiles, conv_conversations, conv_automation_recipients, conv_contacts | on | S1 | 2 | ·/s |
| conv_notes | 0 | id | profiles, conv_conversations | on | S1 | — | ·/s |
| conv_quick_replies | 0 | id | profiles | on | S1 | — | ·/s |
| conv_requests | 0 | request_id | profiles | on | — | — | ·/· |
| conv_webhook_log | 0 | id | — | on | S1 | — | ·/s |
| courts | 0 | id | — | **OFF** | — | 1 | siud/siud |
| des | <100 | — | — | on | — | — | siud/siud |
| documentos_contexto | 0 | id | — | **OFF** | — | — | siud/siud |
| familia_compat_produto | 0 | familia_id, produto_id | — | **OFF** | — | — | siud/siud |
| fin_accounts | 0 | id | profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_attachments | 0 | id | fin_entries, profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_categories | 0 | id | profiles, fin_categories | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_charge_adjustments | 0 | id | profiles, fin_member_charges | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_charge_payments | 0 | id | fin_accounts, profiles, fin_member_charges, fin_member_credits, fin_charge_payments, fin_receipt_submissions | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_entries | 0 | id | fin_accounts, profiles, fin_categories, fin_recurrences | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_entry_payments | 0 | id | fin_accounts, profiles, fin_entries, fin_entry_payments | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_holidays | <1k | id | profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_member_charges | 0 | id | profiles, fin_member_plans | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_member_credits | 0 | id | profiles, fin_entries, fin_charge_payments | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_member_plan_prices | 0 | id | profiles, fin_member_plans | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_member_plans | 0 | id | profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_receipt_charges | 0 | submission_id, charge_id | fin_member_charges, fin_receipt_submissions | on | S1 I1 U1 D1 | 1 | ·/s |
| fin_receipt_submissions | 0 | id | fin_receipt_submissions, profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_recurrences | 0 | id | fin_accounts, fin_categories, profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| fin_requests | 0 | request_id | profiles | on | I1 U1 D1 | 1 | ·/· |
| fin_settings | 0 | id | profiles | on | S1 I1 U1 D1 | 2 | ·/s |
| head_to_head_points | 0 | id | matches, profiles | on | S1 A1 | — | siud/siud |
| historico_conversas | 0 | id | — | **OFF** | — | — | siud/siud |
| historico_treino | 0 | id_historico | alunos | **OFF** | — | — | siud/siud |
| iatende_conversas | <1k | id | — | **OFF** | — | — | siud/siud |
| matches | <1k | id | championship_groups, championships, courts, profiles, matches, championship_registrations, championship_rounds | on | S1 I1 U1 A1 | 7 | siud/siud |
| n8n_chat_histories | <100k | id | — | **OFF** | — | — | siud/siud |
| n8n_chat_histories_duplicate | <100k | id | — | **OFF** | — | — | siud/siud |
| n8n_chat_histories_evento | <1k | id | — | on | — | — | siud/siud |
| n8n_vectors | <1k | id | — | **OFF** | — | — | siud/siud |
| n8n_vectors2 | <1k | id | — | **OFF** | — | — | siud/siud |
| n8n_vectors_treinador | 0 | id | — | **OFF** | — | — | siud/siud |
| non_socio_students | <100 | id | professors, profiles | on | S2 A4 | 1 | siud/siud |
| patients_ebm | 0 | patient_id | — | **OFF** | — | — | siud/siud |
| planos_treino | 0 | id_plano | alunos | **OFF** | — | — | siud/siud |
| point_history | <100 | id | championship_series, profiles | **OFF** | — | 2 | siud/siud |
| point_rules | 0 | id | — | on | S1 A1 | — | siud/siud |
| products | <100 | id | stores | on | S1 A1 | 1 | siud/siud |
| professors | 0 | id | profiles | on | S3 A2 | 1 | siud/siud |
| profiles | <100 | id | auth.users | on | S2 I1 U3 | 5 | siud/siud |
| push_subscriptions | 0 | id | profiles | on | S1 A1 | — | siud/siud |
| ranking_reset_events | 0 | id | profiles | on | S1 | 1 | siud/siud |
| reservas | <1k | — | — | on | — | — | siud/siud |
| reservas2 | <1k | — | — | on | — | — | siud/siud |
| reservation_participants | 0 | reservation_id, user_id | reservations, profiles | **OFF** | — | — | siud/siud |
| reservations | <1k | id | challenges, courts, profiles, matches, professors, students | on | S1 I1 U1 D1 | 2 | siud/siud |
| servicos | 0 | id | subcategorias | **OFF** | — | — | siud/siud |
| sig_documents | 0 | id | profiles, sig_documents | on | S2 | 2 | ·/s |
| sig_events | 0 | id | sig_documents | on | S1 | 2 | ·/s |
| sig_member_identities | 0 | profile_id | profiles | on | S2 | — | ·/s |
| sig_notifications | 0 | id | sig_documents, profiles | on | S1 | — | ·/s |
| sig_recipients | 0 | document_id, profile_id | sig_documents, profiles, sig_signatures | on | S2 | — | ·/s |
| sig_signatures | 0 | id | sig_documents | on | S2 | 3 | ·/s |
| stock_automator_config | <1k | id | stores | on | A1 | — | siud/siud |
| stores | 0 | id | — | **OFF** | — | — | siud/siud |
| student_level_history | 0 | id | profiles, student_profiles | on | S2 | — | siud/siud |
| student_payments | <100 | id | profiles, student_payments, non_socio_students | on | S1 A1 | 2 | siud/siud |
| student_profiles | 0 | id | non_socio_students, professors, profiles | on | S1 I1 U1 A1 | 2 | siud/siud |
| students | 0 | id | professors | **OFF** | — | 1 | siud/siud |
| subcategorias | 0 | id | — | **OFF** | — | — | siud/siud |
| support_messages | 0 | id | — | on | S1 I1 U1 | 1 | siud/siud |
| tabela_familia_iphone_map | <100 | familia_id, modelo_canonico | tabela_modelos | on | — | — | siud/siud |
| tabela_modelos | <100 | id | — | on | — | — | siud/siud |
| tabela_sinonimo_modelo | <1k | id | tabela_modelos | on | — | — | siud/siud |
| tbl_embedding | <100 | id | — | on | — | — | siud/siud |
| tbl_embedding_valid | <100 | id | — | **OFF** | — | — | siud/siud |

Views: fin_entries_v, members, sig_documents_overview, vw_familia_modelos_expandidos ⚠definer

## Schema sig_private
| Tabela | Linhas | PK | FK → | RLS | Políticas | Gatilhos | anon/auth |
|---|---|---|---|---|---|---|---|
| challenges | 0 | id | public.sig_documents, public.profiles | on | — | — | ·/· |

## Storage
storage.objects: 18 políticas (S8 I6 U2 D2) → `tabelas/storage.objects.md`

## Enums
- public.court_type: Saibro, Rápida
- public.match_status: pending, finished, waiting_opponents
- public.payment_status_type: paid, pending, exempt
- public.reservation_status: active, cancelled
- public.user_role: admin, socio, lanchonete

## Funções (366) → `funcoes.md`
conv_private.ai_active_settings*, conv_private.ai_agenda*, conv_private.ai_approved_memories*, conv_private.ai_cancel_proposal*, conv_private.ai_club_roster*, conv_private.ai_confirm*, conv_private.ai_context*, conv_private.ai_expire_sessions*, conv_private.ai_financial_context*, conv_private.ai_find_courts*, conv_private.ai_group_context*, conv_private.ai_handoff*, conv_private.ai_is_latest*, conv_private.ai_joao_pack*, conv_private.ai_my_reservations*, conv_private.ai_own_lines*, conv_private.ai_propose*, conv_private.ai_recent_results*, conv_private.ai_resolve_mentions*, conv_private.ai_resolve_people*, conv_private.ai_save_turn*, conv_private.ai_slot_games*, conv_private.ai_trigger*, conv_private.apply_delete*, conv_private.apply_edit*, conv_private.apply_edit_with_mention*, conv_private.apply_reaction*, conv_private.aud_advance*, conv_private.aud_audience*, conv_private.aud_card*, conv_private.aud_finance*, conv_private.aud_result*, conv_private.audience*, conv_private.audit*, conv_private.automation_cap_until, conv_private.automation_claim*, conv_private.automation_ctx, conv_private.automation_events*, conv_private.automation_finish*, conv_private.automation_materialize*, conv_private.automation_next_allowed, conv_private.automation_problems*, conv_private.automation_purpose, conv_private.automation_queue*, conv_private.automation_revalidate*, conv_private.automation_test_payload*, conv_private.automation_tick*, conv_private.automation_vars, conv_private.available_slots*, conv_private.begin_op*, conv_private.brl, conv_private.channel_delivery*, conv_private.claim_due_followups*, conv_private.conversation_contact*, conv_private.court_busy*, conv_private.date_br, conv_private.digits, conv_private.finish_followup*, conv_private.finish_message*, conv_private.finish_op*, conv_private.first_name, conv_private.fold, conv_private.game_people*, conv_private.game_summary*, conv_private.hhmm_to_min, conv_private.immutable_row, conv_private.ingest_message*, conv_private.is_confirmation, conv_private.is_opt_out, conv_private.is_semantic_acceptance, conv_private.join_check*, conv_private.join_party_check*, conv_private.link_contact*, conv_private.log_webhook*, conv_private.mark_read_collect*, conv_private.mark_unread*, conv_private.message_target*, conv_private.min_to_hhmm, conv_private.month_pt, conv_private.no_delete, conv_private.norm_lid, conv_private.on_inbound_opt_out*, conv_private.open_direct*, conv_private.open_group*, conv_private.participants_check*, conv_private.phone_e164, conv_private.phone_key, conv_private.phone_local, conv_private.queue_message*, conv_private.render_template, conv_private.require_admin*, conv_private.resolve_undecryptable*, conv_private.set_avatar*, conv_private.set_message_media*, conv_private.staff_delete_message*, conv_private.staff_edit_message*, conv_private.staff_react*, conv_private.template_vars, conv_private.today, conv_private.update_message_status*, conv_private.upsert_contact*, conv_private.validate_reservation*, conv_private.vfail, fin_private.account_balances*, fin_private.add_entry_payment*, fin_private.adjust_business_day, fin_private.apply_payment*, fin_private.audit_row*, fin_private.audit_row_dispatch*, fin_private.audit_row_soft*, fin_private.begin_op*, fin_private.cash_rows*, fin_private.category_id, fin_private.charge_rows*, fin_private.charge_statement*, fin_private.check_account*, fin_private.check_category*, fin_private.check_period, fin_private.day_card_rows*, fin_private.dre_lines*, fin_private.dre_rows*, fin_private.due_date, fin_private.easter, fin_private.end_plan*, fin_private.ensure_holidays*, fin_private.entry_paid_cents, fin_private.finish_op*, fin_private.generate_charges*, fin_private.generate_recurrences*, fin_private.is_active_member*, fin_private.is_business_day, fin_private.no_delete, fin_private.on_profile_membership_change*, fin_private.recurrence_due_date, fin_private.refresh_charge_status*, fin_private.require_admin*, fin_private.seed_holidays*, fin_private.statement_json*, fin_private.today, fin_private.waive_fees*, fin_private.zz_probe3, access_requests_set_updated_at, admin_audit_changed_fields, admin_audit_insert_log*, admin_audit_related_users, admin_audit_table_changes*, admin_audit_try_uuid, admin_record_user_access*, admin_record_user_login*, admin_reset_ranking_full*, apagar_mensagem_antiga, apply_championship_edition_points*, bootstrap_ranking_from_3_circuito*, check_and_auto_finish_championship*, class_rank, clean_model_text, conv_add_followup*, conv_add_note*, conv_admins*, conv_automation_approve_run*, conv_automation_cancel_run*, conv_automation_list*, conv_automation_prepare_manual*, conv_automation_preview*, conv_automation_retry_failed*, conv_automation_set_status*, conv_delete_quick_reply*, conv_get_ai_settings*, conv_get_automation_settings*, conv_inbox*, conv_link_contact*, conv_list_ai_memory_candidates*, conv_open_conversation*, conv_review_ai_memory_candidate*, conv_rotate_inbound_token*, conv_save_ai_settings*, conv_save_automation*, conv_save_automation_settings*, conv_save_channel*, conv_save_quick_reply*, conv_search_people*, conv_set_ai_channel*, conv_set_ai_status*, conv_set_group*, conv_set_mention_verified*, conv_set_meta*, conv_set_opt_out*, conv_set_status*, conv_svc_ai_cancel_proposal*, conv_svc_ai_club_roster*, conv_svc_ai_confirm*, conv_svc_ai_context*, conv_svc_ai_expire_sessions*, conv_svc_ai_financial_context*, conv_svc_ai_find_courts*, conv_svc_ai_group_context*, conv_svc_ai_handoff*, conv_svc_ai_is_latest*, conv_svc_ai_joao_pack*, conv_svc_ai_memory_candidate*, conv_svc_ai_propose*, conv_svc_ai_resolve_mentions*, conv_svc_ai_resolve_people*, conv_svc_ai_save_turn*, conv_svc_ai_slot_games*, conv_svc_ai_trigger*, conv_svc_apply_delete*, conv_svc_apply_edit*, conv_svc_apply_edit_with_mention*, conv_svc_apply_reaction*, conv_svc_automation_claim*, conv_svc_automation_finish*, conv_svc_automation_queue*, conv_svc_automation_test_payload*, conv_svc_automation_tick*, conv_svc_available_slots*, conv_svc_channel_delivery*, conv_svc_claim_due_followups*, conv_svc_conversation_contact*, conv_svc_finish_followup*, conv_svc_finish_message*, conv_svc_ingest_message*, conv_svc_log_webhook*, conv_svc_mark_read_collect*, conv_svc_mark_unread*, conv_svc_message_target*, conv_svc_queue_message*, conv_svc_resolve_undecryptable*, conv_svc_set_avatar*, conv_svc_set_message_media*, conv_svc_staff_delete_message*, conv_svc_staff_edit_message*, conv_svc_staff_react*, conv_svc_update_message_status*, conv_update_followup*, ensure_knockout_rounds*, escape_for_regexp, fin_account_balances*, fin_adjust_charge*, fin_approve_receipt*, fin_attach_file*, fin_cancel_charge*, fin_cancel_entry*, fin_cash_flow*, fin_charge_statements*, fin_charge_statements_by_ids*, fin_create_entry*, fin_create_member_plan*, fin_day_card_rows*, fin_dre_detail*, fin_dre_lines*, fin_dre_memo*, fin_end_member_plan*, fin_generate_member_charges*, fin_generate_recurrences*, fin_is_active_member*, fin_monthly_trend*, fin_movements*, fin_my_charges*, fin_pay_entry*, fin_payables_summary*, fin_public_settings*, fin_receipt_queue*, fin_receivables_summary*, fin_register_payment*, fin_reject_receipt*, fin_remove_attachment*, fin_resolve_credit*, fin_reverse_entry_payment*, fin_reverse_payment*, fin_save_account*, fin_save_category*, fin_save_holiday*, fin_save_recurrence*, fin_save_settings*, fin_seed_holidays*, fin_set_plan_price*, fin_start_receipt_review*, fin_student_revenue*, fin_submit_receipt*, fin_update_entry*, fin_update_member_plan*, finish_championship*, get_active_user_points, get_championship_phase_points*, get_form_live_results*, get_group_standings*, get_lead_marketing_intelligence*, get_ranking_cycle_start*, get_stock_automator_config*, get_user_h2h_points*, get_user_store_ids*, ia_instagram_handle_echo, ia_instagram_set_human_window, increment_unread_count*, insert_stock_automator_config*, is_admin*, is_lower_class, joao_daily_secret_ok*, log_championship_admin_action*, match_documents, normalize_and_expand_models, on_championship_finished_apply_points*, on_profile_class_change*, process_head_to_head_points*, propagate_bracket_winner*, record_student_level_change*, refresh_familias_trigger*, resolve_championship_final_phases*, resolve_match_winner_registration*, resolve_resenha_open_final_phases*, revert_championship_edition_points*, rollback_bootstrap_3_circuito*, set_credito_crm_timestamp, set_student_level, sig_add_recipients*, sig_admin_recipients*, sig_archive*, sig_can_delete_file*, sig_can_read_file*, sig_can_upload_file*, sig_create_draft*, sig_is_recipient*, sig_log_event*, sig_member_can_see*, sig_my_documents*, sig_my_pending_count*, sig_resend_failed*, sig_save_my_cpf*, sig_set_new_members*, sig_svc_claim_notifications*, sig_svc_enqueue_reminders*, sig_svc_finish_notification*, sig_svc_issue_challenge*, sig_svc_mark_code_sent*, sig_svc_verify_code*, sig_update_draft*, sig_update_due*, sig_verify_integrity*, submit_club_form*, sync_championship_registration_flags, sync_group_knockout_for_class*, sync_student_profile_status_to_legacy_student*, trg_sync_group_knockout_on_match_change*, update_updated_at_column, upsert_crm_lead*, validate_match_result_integrity, sig_private.audit*, sig_private.audit_row*, sig_private.consent_text, sig_private.cpf_valid, sig_private.enqueue_notification*, sig_private.forbid_change, sig_private.get_document*, sig_private.guard_document, sig_private.is_active_member*, sig_private.on_member_active*, sig_private.request_header, sig_private.request_ip, sig_private.require_admin*, sig_private.require_member*, sig_private.set_action, sig_private.sha256_hex, sig_private.signature_evidence, sig_private.ts
(* = SECURITY DEFINER)

Extensões: pg_cron 1.6.4, pg_net 0.19.5, pg_stat_statements 1.11, pgcrypto 1.3, supabase_vault 0.3.1, uuid-ossp 1.1, vector 0.8.0

> Legenda: Políticas S/I/U/D/A = SELECT/INSERT/UPDATE/DELETE/ALL · anon/auth = grants s/i/u/d · ⚡ = gatilho com efeito externo (http, fila, notify).
