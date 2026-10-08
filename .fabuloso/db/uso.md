# Uso do banco pelo código
> Gerado por `fabuloso.mjs react`; não edite. Front = app; edge = supabase/functions. Schema, RLS e gatilhos → `indice.md` e `tabelas/`.

## Tabelas (58)
| Tabela | Operações | Front (arquivos) | Edge (arquivos) | Telas |
|---|---|---|---|---|
| access_requests | select, insert, update | 2 | 1 | 0 |
| admin_audit_logs | select | 2 | 0 | 0 |
| announcements | select, insert, update, delete | 2 | 0 | 0 |
| challenges | select, insert, update | 9 | 0 | 0 |
| championship_admin_audit_logs | select, insert | 3 | 0 | 0 |
| championship_group_members | select, insert | 6 | 0 | 0 |
| championship_groups | select, insert, delete | 7 | 0 | 0 |
| championship_phase_points | select, upsert | 1 | 0 | 0 |
| championship_registrations | select, insert, update, delete | 11 | 0 | 0 |
| championship_rounds | select, insert, update | 9 | 0 | 0 |
| championship_series | select, insert | 4 | 0 | 0 |
| championships | select, insert, update | 14 | 0 | 0 |
| club_form_options | select, insert, update, delete | 1 | 0 | 0 |
| club_form_questions | select, insert, update, delete | 1 | 0 | 0 |
| club_form_responses | select | 1 | 0 | 0 |
| club_form_voter_receipts | select | 1 | 0 | 0 |
| club_forms | select, insert, update, delete | 1 | 0 | 0 |
| consumptions | select, insert, update | 2 | 0 | 0 |
| conv_ai_settings | select | 0 | 1 | 0 |
| conv_contacts | select | 0 | 2 | 0 |
| conv_conversations | select | 0 | 3 | 0 |
| conv_groups | select | 0 | 1 | 0 |
| conv_messages | select, update | 0 | 3 | 0 |
| courts | select | 12 | 0 | 0 |
| fin_accounts | select | 1 | 0 | 0 |
| fin_attachments | select | 1 | 0 | 0 |
| fin_categories | select | 1 | 0 | 0 |
| fin_charge_adjustments | select | 1 | 0 | 0 |
| fin_charge_payments | select | 1 | 0 | 0 |
| fin_entries_v | select | 1 | 0 | 0 |
| fin_entry_payments | select | 1 | 0 | 0 |
| fin_holidays | select | 1 | 0 | 0 |
| fin_member_charges | select | 1 | 0 | 0 |
| fin_member_credits | select | 1 | 0 | 0 |
| fin_member_plan_prices | select | 1 | 0 | 0 |
| fin_member_plans | select | 1 | 0 | 0 |
| fin_receipt_charges | select | 1 | 0 | 0 |
| fin_receipt_submissions | select | 1 | 0 | 0 |
| fin_recurrences | select | 1 | 0 | 0 |
| fin_settings | select | 1 | 0 | 0 |
| head_to_head_points | select | 1 | 0 | 0 |
| matches | select, insert, update, upsert, delete | 20 | 0 | 0 |
| non_socio_students | select, insert, update | 7 | 0 | 0 |
| point_history | select, insert | 3 | 0 | 0 |
| point_rules | select, update | 1 | 0 | 0 |
| products | select, insert, update | 1 | 0 | 0 |
| professors | select, insert, update, delete | 4 | 0 | 0 |
| profiles | select, insert, update, upsert | 33 | 4 | 0 |
| push_subscriptions | select, upsert, delete | 1 | 1 | 0 |
| ranking_reset_events | select | 1 | 0 | 0 |
| reservations | select, insert, update | 13 | 0 | 0 |
| sig_documents | select | 2 | 0 | 0 |
| sig_documents_overview | select | 1 | 0 | 0 |
| sig_member_identities | select | 1 | 0 | 0 |
| sig_signatures | select | 1 | 0 | 0 |
| student_level_history | select | 2 | 0 | 0 |
| student_payments | select, insert, update, delete | 3 | 0 | 0 |
| student_profiles | select, insert, update, upsert | 3 | 0 | 0 |

### access_requests
- select: components/AdminPanel.tsx:1137
- select [edge]: supabase/functions/admin-athlete-access/index.ts:94
- insert: contexts/AuthContext.tsx:163
- update: contexts/AuthContext.tsx:175
- update [edge]: supabase/functions/admin-athlete-access/index.ts:120, supabase/functions/admin-athlete-access/index.ts:150, supabase/functions/admin-athlete-access/index.ts:185

### admin_audit_logs
- select: components/AdminPanel.tsx:1191, lib/finance/financeApi.ts:405

### announcements
- select: App.tsx:114, components/AdminPanel.tsx:766
- insert: components/AdminPanel.tsx:820
- update: components/AdminPanel.tsx:819, components/AdminPanel.tsx:833
- delete: components/AdminPanel.tsx:848

### challenges
- select: components/AdminPanel.tsx:433, components/AdminReports.tsx:107, components/Agenda.tsx:1452, components/ChallengeNotificationPopup.tsx:28, components/Challenges.tsx:509, hooks/useChallenges.ts:188, lib/rankingService.ts:538, lib/rankingService.ts:546
- insert: components/AdminMatchCreator.tsx:169, components/AdminPanel.tsx:597, components/Athletes.tsx:164, components/Challenges.tsx:612, hooks/useChallenges.ts:280
- update: components/AdminPanel.tsx:484, components/AdminPanel.tsx:533, components/Agenda.tsx:1824, components/ChallengeNotificationPopup.tsx:94, components/Challenges.tsx:666, components/Challenges.tsx:803, hooks/useChallenges.ts:331, hooks/useChallenges.ts:354, hooks/useChallenges.ts:380

### championship_admin_audit_logs
- select: components/ChampionshipAdmin.tsx:301
- insert: components/ChampionshipAdmin.tsx:351, components/ChampionshipInProgress.tsx:333, components/Championships.tsx:609, components/Championships.tsx:775, components/Championships.tsx:862

### championship_group_members
- select: components/ChampionshipInProgress.tsx:137, components/Championships.tsx:421, components/GroupDrawPage.tsx:115, components/PublicChampionshipPage.tsx:84, lib/championship/groupPersistence.ts:100, lib/championship/knockoutFromGroups.ts:153
- insert: components/GroupDrawPage.tsx:440, components/GroupDrawPage.tsx:454, lib/championship/groupPersistence.ts:124

### championship_groups
- select: components/ChampionshipAdmin.tsx:297, components/ChampionshipInProgress.tsx:137, components/Championships.tsx:421, components/GroupDrawPage.tsx:115, components/PublicChampionshipPage.tsx:84, lib/championship/groupPersistence.ts:67, lib/championship/knockoutFromGroups.ts:153
- insert: components/GroupDrawPage.tsx:405, components/GroupDrawPage.tsx:419, lib/championship/groupPersistence.ts:78
- delete: components/GroupDrawPage.tsx:398

### championship_phase_points
- select: components/admin/PhasePointsEditor.tsx:37
- upsert: components/admin/PhasePointsEditor.tsx:60

### championship_registrations
- select: components/Agenda.tsx:1305, components/ChampionshipAdmin.tsx:286, components/ChampionshipInProgress.tsx:147, components/Championships.tsx:211, components/Championships.tsx:308, components/GroupDrawPage.tsx:105, components/PublicChampionshipPage.tsx:91, lib/championship/knockoutFromGroups.ts:164, lib/championship/registration.ts:36, lib/resenhaOpenService.ts:245, lib/resenhaOpenService.ts:308, lib/resenhaOpenService.ts:445
- insert: components/ChampionshipAdmin.tsx:394, components/creator/CreatorRegistration.tsx:143, components/creator/CreatorRegistration.tsx:169, lib/championship/registration.ts:72, lib/resenhaOpenService.ts:195, lib/resenhaOpenService.ts:212
- update: lib/championship/seeding.ts:54, lib/championship/seeding.ts:63
- delete: components/ChampionshipAdmin.tsx:423, components/creator/CreatorRegistration.tsx:216, lib/resenhaOpenService.ts:232

### championship_rounds
- select: components/Agenda.tsx:1282, components/ChampionshipAdmin.tsx:291, components/ChampionshipCreator.tsx:177, components/ChampionshipInProgress.tsx:128, components/Championships.tsx:248, components/Championships.tsx:326, components/PublicChampionshipPage.tsx:77, lib/championship/creation.ts:107, lib/championship/rounds.ts:123, lib/championship/rounds.ts:138, lib/championship/rounds.ts:203, lib/championship/rounds.ts:228 +2
- insert: components/ChampionshipInProgress.tsx:203, lib/championship/rounds.ts:161, lib/resenhaOpenService.ts:175
- update: components/ChampionshipAdmin.tsx:614, components/ChampionshipAdmin.tsx:654, components/ChampionshipInProgress.tsx:764, lib/championship/rounds.ts:181

### championship_series
- select: components/Athletes.tsx:106, components/creator/CreatorSetup.tsx:21, lib/championship/creation.ts:46, lib/resenhaOpenService.ts:84
- insert: lib/championship/creation.ts:55

### championships
- select: App.tsx:66, components/Agenda.tsx:1282, components/ChampionshipAdmin.tsx:204, components/ChampionshipCreator.tsx:142, components/ChampionshipCreator.tsx:551, components/ChampionshipCreator.tsx:94, components/Championships.tsx:140, components/GroupDrawPage.tsx:84, components/Layout.tsx:76, components/PublicChampionshipPage.tsx:57, components/ResenhaOpenBracketView.tsx:26, lib/championship/creation.ts:81 +3
- insert: lib/championship/creation.ts:145, lib/resenhaOpenService.ts:112
- update: components/ChampionshipAdmin.tsx:452, lib/championship/creation.ts:121, lib/championship/participantSources.ts:86, lib/championship/rounds.ts:189, lib/resenhaOpenService.ts:429, lib/resenhaOpenService.ts:457

### club_form_options
- select: lib/formsService.ts:203, lib/formsService.ts:57, lib/formsService.ts:9
- insert: lib/formsService.ts:226
- update: lib/formsService.ts:221
- delete: lib/formsService.ts:235

### club_form_questions
- select: lib/formsService.ts:164, lib/formsService.ts:57, lib/formsService.ts:9
- insert: lib/formsService.ts:191
- update: lib/formsService.ts:186
- delete: lib/formsService.ts:246

### club_form_responses
- select: lib/formsService.ts:318

### club_form_voter_receipts
- select: lib/formsService.ts:102, lib/formsService.ts:32, lib/formsService.ts:82

### club_forms
- select: lib/formsService.ts:57, lib/formsService.ts:9
- insert: lib/formsService.ts:149
- update: lib/formsService.ts:142, lib/formsService.ts:261
- delete: lib/formsService.ts:273

### consumptions
- select: components/AdminReports.tsx:95, components/Klanches.tsx:114, components/Klanches.tsx:304
- insert: components/Klanches.tsx:293
- update: components/Klanches.tsx:332

### conv_ai_settings
- select [edge]: supabase/functions/joao-daily-greeting/index.ts:109

### conv_contacts
- select [edge]: supabase/functions/finance-receipt-whatsapp/index.ts:52, supabase/functions/whatsapp-webhook/index.ts:139, supabase/functions/whatsapp-webhook/index.ts:80

### conv_conversations
- select [edge]: supabase/functions/finance-receipt-whatsapp/index.ts:49, supabase/functions/joao-daily-greeting/index.ts:99, supabase/functions/whatsapp-webhook/index.ts:141, supabase/functions/whatsapp-webhook/index.ts:80

### conv_groups
- select [edge]: supabase/functions/joao-daily-greeting/index.ts:97

### conv_messages
- select [edge]: supabase/functions/finance-receipt-whatsapp/index.ts:38, supabase/functions/joao-daily-greeting/index.ts:105, supabase/functions/whatsapp-webhook/index.ts:152, supabase/functions/whatsapp-webhook/index.ts:80
- update [edge]: supabase/functions/joao-daily-greeting/index.ts:177

### courts
- select: components/AdminPanel.tsx:1604, components/AdminPanel.tsx:271, components/AdminPanel.tsx:435, components/AdminReports.tsx:123, components/Agenda.tsx:1390, components/Athletes.tsx:99, components/ChallengeNotificationPopup.tsx:64, components/Challenges.tsx:72, components/ChampionshipInProgress.tsx:120, components/Championships.tsx:187, components/Dashboard.tsx:41, components/Klanches.tsx:169 +2

### fin_accounts
- select: lib/finance/financeApi.ts:59

### fin_attachments
- select: lib/finance/financeApi.ts:135

### fin_categories
- select: lib/finance/financeApi.ts:68

### fin_charge_adjustments
- select: lib/finance/financeApi.ts:252

### fin_charge_payments
- select: lib/finance/financeApi.ts:251

### fin_entries_v
- select: lib/finance/financeApi.ts:90

### fin_entry_payments
- select: lib/finance/financeApi.ts:106

### fin_holidays
- select: lib/finance/financeApi.ts:50

### fin_member_charges
- select: lib/finance/financeApi.ts:198

### fin_member_credits
- select: lib/finance/financeApi.ts:269

### fin_member_plan_prices
- select: lib/finance/financeApi.ts:166

### fin_member_plans
- select: lib/finance/financeApi.ts:161, lib/finance/financeApi.ts:282

### fin_receipt_charges
- select: lib/finance/financeApi.ts:330, lib/finance/financeApi.ts:344

### fin_receipt_submissions
- select: lib/finance/financeApi.ts:330, lib/finance/financeApi.ts:344

### fin_recurrences
- select: lib/finance/financeApi.ts:122

### fin_settings
- select: lib/finance/financeApi.ts:42

### head_to_head_points
- select: lib/rankingService.ts:173

### matches
- select: components/AdminReports.tsx:115, components/Agenda.tsx:1282, components/Athletes.tsx:67, components/Challenges.tsx:418, components/Challenges.tsx:536, components/ChampionshipAdmin.tsx:588, components/ChampionshipCreator.tsx:207, components/ChampionshipInProgress.tsx:156, components/Championships.tsx:263, components/Championships.tsx:331, components/PublicChampionshipPage.tsx:99, components/SuperSet.tsx:166 +5
- insert: components/AdminMatchCreator.tsx:149, components/AdminPanel.tsx:515, components/Agenda.tsx:1806, components/ChampionshipInProgress.tsx:259, components/MatchGenerationModal.tsx:119, components/SuperSet.tsx:110, lib/championship/bracket.ts:223, lib/championship/groupPersistence.ts:190
- update: components/ChampionshipInProgress.tsx:303, components/ChampionshipInProgress.tsx:364, components/Championships.tsx:561, components/Championships.tsx:621, components/Championships.tsx:701, components/Championships.tsx:747, components/Championships.tsx:835, lib/championship/bracket.ts:248, lib/resenhaOpenService.ts:390, lib/resenhaOpenService.ts:407
- upsert: components/LiveScoreboard.tsx:157
- delete: components/MatchGenerationModal.tsx:108, lib/resenhaOpenService.ts:466

### non_socio_students
- select: components/AdminProfessors.tsx:126, components/AdminStudents.tsx:79, components/Agenda.tsx:1430, components/FinanceiroAdmin.tsx:87, components/ProfessorProfile.tsx:197, lib/championship/registration.ts:36, lib/championship/registration.ts:9, lib/conversations/api.ts:557
- insert: components/AdminStudents.tsx:173, components/Agenda.tsx:2471, components/ProfessorProfile.tsx:412
- update: components/AdminStudents.tsx:161, components/AdminStudents.tsx:209, components/AdminStudents.tsx:225, components/AdminStudents.tsx:296, components/AdminStudents.tsx:365, components/Agenda.tsx:1657, components/ProfessorProfile.tsx:379, components/ProfessorProfile.tsx:615

### point_history
- select: components/AdminPanel.tsx:1550, components/Athletes.tsx:106
- insert: components/AdminUserEditor.tsx:142

### point_rules
- select: components/AdminRules.tsx:112
- update: components/AdminRules.tsx:150

### products
- select: components/Klanches.tsx:99
- insert: components/Klanches.tsx:365
- update: components/Klanches.tsx:364, components/Klanches.tsx:403

### professors
- select: components/AdminProfessors.tsx:118, components/AdminStudents.tsx:84, components/Agenda.tsx:1402, components/ProfessorProfile.tsx:182
- insert: components/AdminProfessors.tsx:176
- update: components/AdminProfessors.tsx:175
- delete: components/AdminProfessors.tsx:197

### profiles
- select: components/AdminLogin.tsx:32, components/AdminPanel.tsx:1004, components/AdminPanel.tsx:1166, components/AdminPanel.tsx:1550, components/AdminPanel.tsx:1574, components/AdminPanel.tsx:1603, components/AdminPanel.tsx:272, components/AdminPanel.tsx:434, components/AdminProtect.tsx:23, components/AdminReports.tsx:86, components/AdminStudents.tsx:85, components/Agenda.tsx:1220 +35
- select [edge]: supabase/functions/_shared/athleteProvision.ts:54, supabase/functions/_shared/serveAdmin.ts:29, supabase/functions/admin-athlete-access/index.ts:48, supabase/functions/send-push/index.ts:59
- insert: contexts/AuthContext.tsx:429
- update: components/AdminUserEditor.tsx:125, components/EditProfileModal.tsx:79, components/OnboardingModal.tsx:63, contexts/AuthContext.tsx:330
- update [edge]: supabase/functions/_shared/athleteProvision.ts:60
- upsert: seed_admin.ts:39, seed_admin.ts:56
- upsert [edge]: supabase/functions/_shared/athleteProvision.ts:64

### push_subscriptions
- select [edge]: supabase/functions/send-push/index.ts:62, supabase/functions/send-push/index.ts:67
- upsert: lib/pushNotifications.ts:73, lib/pushNotifications.ts:85
- delete: lib/pushNotifications.ts:181
- delete [edge]: supabase/functions/send-push/index.ts:109

### ranking_reset_events
- select: components/AdminPanel.tsx:1559

### reservations
- select: components/AdminPanel.tsx:270, components/AdminPanel.tsx:79, components/AdminReports.tsx:76, components/Agenda.tsx:1246, components/Agenda.tsx:1642, components/Athletes.tsx:79, components/Challenges.tsx:96, components/Dashboard.tsx:59, components/FinanceiroAdmin.tsx:59, components/Klanches.tsx:148, components/ProfessorProfile.tsx:237, components/SuperSet.tsx:58 +1
- insert: components/AdminMatchCreator.tsx:131, components/AdminPanel.tsx:574, components/Agenda.tsx:1723, components/Challenges.tsx:594, hooks/useReservations.ts:180
- update: components/AdminPanel.tsx:328, components/Agenda.tsx:1501, components/Agenda.tsx:1539, components/Agenda.tsx:1559, components/Agenda.tsx:1588, components/Agenda.tsx:1715, components/Agenda.tsx:1833, components/ChallengeNotificationPopup.tsx:104, components/FinanceiroAdmin.tsx:170, components/ProfessorProfile.tsx:661, hooks/useReservations.ts:253, hooks/useReservations.ts:279

### sig_documents
- select: components/signatures/admin/DocumentDetail.tsx:137, lib/signatures/admin.ts:87

### sig_documents_overview
- select: lib/signatures/admin.ts:76

### sig_member_identities
- select: lib/signatures/documents.ts:51

### sig_signatures
- select: lib/signatures/receipt.ts:215

### student_level_history
- select: components/AdminStudents.tsx:256, components/ProfessorProfile.tsx:543

### student_payments
- select: components/AdminStudents.tsx:336, components/FinanceiroAdmin.tsx:108, components/ProfessorProfile.tsx:586
- insert: components/AdminStudents.tsx:277, components/AdminStudents.tsx:354, components/ProfessorProfile.tsx:604
- update: components/AdminStudents.tsx:344, components/ProfessorProfile.tsx:594
- delete: components/FinanceiroAdmin.tsx:139

### student_profiles
- select: components/AdminStudents.tsx:83, components/Agenda.tsx:1414, components/ProfessorProfile.tsx:202
- insert: components/AdminStudents.tsx:176, components/AdminStudents.tsx:232, components/Agenda.tsx:2449, components/Agenda.tsx:2486, components/ProfessorProfile.tsx:426
- update: components/AdminStudents.tsx:164, components/AdminStudents.tsx:208, components/AdminStudents.tsx:224, components/AdminStudents.tsx:244, components/AdminStudents.tsx:250, components/ProfessorProfile.tsx:499, components/ProfessorProfile.tsx:517, components/ProfessorProfile.tsx:530, components/ProfessorProfile.tsx:554
- upsert: components/Agenda.tsx:1623

## RPC (29)
- `admin_record_user_access`: contexts/AuthContext.tsx:129
- `admin_reset_ranking_full`: components/AdminPanel.tsx:1634
- `apply_championship_edition_points`: components/ChampionshipAdmin.tsx:537
- `conv_svc_apply_delete`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:124
- `conv_svc_apply_edit_with_mention`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:113
- `conv_svc_apply_reaction`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:98
- `conv_svc_channel_delivery`: — · [edge] supabase/functions/whatsapp-webhook/index.ts:167
- `conv_svc_finish_message`: — · [edge] supabase/functions/joao-daily-greeting/index.ts:181
- `conv_svc_ingest_message`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:48
- `conv_svc_log_webhook`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:177, supabase/functions/whatsapp-webhook/record.ts:42
- `conv_svc_queue_message`: — · [edge] supabase/functions/joao-daily-greeting/index.ts:172
- `conv_svc_resolve_undecryptable`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:90
- `conv_svc_set_message_media`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:152
- `conv_svc_set_message_transcription`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:174
- `conv_svc_update_message_status`: — · [edge] supabase/functions/whatsapp-webhook/record.ts:128
- `fin_submit_whatsapp_pendency_receipt`: — · [edge] supabase/functions/finance-receipt-whatsapp/index.ts:86
- `finish_championship`: components/ChampionshipAdmin.tsx:493
- `get_admin_push_subscriptions`: — · [edge] supabase/functions/send-push/index.ts:55
- `get_form_live_results`: lib/formsService.ts:302
- `get_ranking_cycle_start`: lib/rankingService.ts:75
- `get_user_h2h_points`: components/Athletes.tsx:123
- `joao_daily_secret_ok`: — · [edge] supabase/functions/joao-daily-greeting/index.ts:26
- `resolve_resenha_open_final_phases`: lib/resenhaOpenService.ts:424
- `revert_championship_edition_points`: components/ChampionshipAdmin.tsx:569
- `set_student_level`: components/AdminStudents.tsx:169, components/AdminStudents.tsx:238, components/ProfessorProfile.tsx:392, components/ProfessorProfile.tsx:536
- `sig_svc_issue_challenge`: — · [edge] supabase/functions/_shared/signatureRequest.ts:116
- `sig_svc_mark_code_sent`: — · [edge] supabase/functions/_shared/signatureRequest.ts:131
- `sig_svc_verify_code`: — · [edge] supabase/functions/_shared/signatureRequest.ts:145
- `submit_club_form`: lib/formsService.ts:285

## Edge functions invocadas (4)
- `admin-athlete-access`: components/AdminPanel.tsx:1227
- `finance-receipt-whatsapp`: supabase/functions/whatsapp-webhook/index.ts:63
- `send-push`: lib/notificationService.ts:17, supabase/functions/whatsapp-webhook/index.ts:90
- `signature-operations`: lib/signatures/api.ts:25

## Storage (2)
- bucket `conv-media` (uso): supabase/functions/conversation-operations/index.ts:10
- bucket `klancheimages` (upload, getPublicUrl): components/Klanches.tsx:65, components/Klanches.tsx:71

## Realtime (8)
- tabela `championship_registrations`: components/Championships.tsx:220
- tabela `championship_rounds`: components/Championships.tsx:380
- tabela `club_form_responses`: lib/formsService.ts:344
- tabela `club_form_voter_receipts`: lib/formsService.ts:344
- tabela `conv_conversations`: lib/conversations/api.ts:345
- tabela `conv_messages`: lib/conversations/api.ts:345
- tabela `matches`: components/Championships.tsx:380, components/ResenhaOpenBracketView.tsx:39, components/SuperSet.tsx:182, components/TournamentBracketView.tsx:65
- tabela `reservations`: components/Dashboard.tsx:86

## Alertas (2)
- Tabelas do mapa sem uso no código (front + edge): `Cliente_CRM`, `Memory Long`, `Memory Long_jp`, `Memory Test`, `alunos`, `aniversario_consulta`, `avaliacoes_semanais`, `championship_participants`, `championship_winners`, `class_change_events`, `conv_admin_alert_log`, `conv_admin_briefing_recipients`, `conv_admin_prefs`, `conv_ai_decisions`, `conv_ai_member_context`, `conv_ai_memory_candidates`, `conv_ai_sessions`, `conv_automation_recipients`, `conv_automation_runs`, `conv_automation_settings`, `conv_automation_versions`, `conv_automations`, `conv_booking_proposals`, `conv_channel`, `conv_followups`, `conv_notes`, `conv_quick_replies`, `conv_requests`, `conv_webhook_log`, `des`, `documentos_contexto`, `familia_compat_produto`, `fin_entries`, `fin_private.charge_payments_effective`, `fin_requests`, `historico_conversas`, `historico_treino`, `iatende_conversas`, `members`, `n8n_chat_histories`, `n8n_chat_histories_duplicate`, `n8n_chat_histories_evento`, `n8n_vectors`, `n8n_vectors2`, `n8n_vectors_treinador`, `patients_ebm`, `planos_treino`, `reservas`, `reservas2`, `reservation_participants`, `servicos`, `sig_events`, `sig_notifications`, `sig_private.challenges`, `sig_recipients`, `stock_automator_config`, `stores`, `students`, `subcategorias`, `support_messages`, `tabela_familia_iphone_map`, `tabela_modelos`, `tabela_sinonimo_modelo`, `tbl_embedding`, `tbl_embedding_valid`, `vw_familia_modelos_expandidos`
- Edge functions sem chamada no front (webhook, cron ou outra função?): `conversation-operations`, `conversations-dispatch`, `finance-receipt-whatsapp`, `joao-admin-alerts`, `joao-admin-briefing`, `joao-daily-greeting`, `signature-dispatch`, `whatsapp-webhook`
