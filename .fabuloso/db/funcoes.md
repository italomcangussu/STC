# Funções
> 475 funções nos schemas conv_private, fin_private, public, sig_private. Corpo completo sob demanda: `select pg_get_functiondef('<schema.nome>(<args>)'::regprocedure)`.

| Função | Argumentos | Retorno | Ling. | Segurança | anon | Nota |
|---|---|---|---|---|---|---|
| conv_private.admin_alert_data | `p_profile uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.admin_alert_targets | — | `TABLE(profile_id uuid, name text, conversation_id uuid)` | sql | DEFINER | não |  |
| conv_private.admin_briefing_data | `p_profile uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.admin_briefing_data_base | `p_profile uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.admin_briefing_targets | — | `TABLE(profile_id uuid, name text, conversation_id uuid)` | sql | DEFINER | não |  |
| conv_private.admin_prefs_json | `p_profile uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_active_settings | — | `conv_ai_settings` | sql | DEFINER | não |  |
| conv_private.ai_admin_access_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_adm_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_briefing_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_broadcast_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_dependent_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_file_lookup | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_finance_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_admin_finance_propose_ext | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_finance_propose_pendency | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_finance_propose_w2 | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_admin_finance_propose_w6 | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_members | `p_session uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_memories | `p_session uuid, p_subject text` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_memory_forget_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_message_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_prefs | `p_session uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_read | `p_session uuid, p_domain text, p_args jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_read_more | `p_session uuid, p_domain text, p_args jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_receipt | `p_session uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_admin_requester | `p_session uuid` | `uuid` | sql | DEFINER | não |  |
| conv_private.ai_admin_wave8_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_agenda | `p_profile uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_approved_memories | — | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_audio_transcripts | `p_ids text[]` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_cancel_proposal | `p_session uuid` | `void` | sql | DEFINER | não |  |
| conv_private.ai_club_roster | — | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_confirm | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_before_student_card | `p_proposal uuid, p_message uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_confirm_booking | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pendency_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pre_briefing_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pre_broadcast_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pre_dependent_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pre_memory_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_pre_message_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_single_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_wave2_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_wave3_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_wave6_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_confirm_wave7_step | `p_proposal uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_context | `p_session uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_expire_sessions | — | `integer` | plpgsql | DEFINER | não |  |
| conv_private.ai_financial_context | — | `jsonb` | sql | DEFINER | sim |  |
| conv_private.ai_find_courts | `p_label text` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_group_context | `p_session uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_handoff | `p_session uuid, p_kind text, p_note text` | `void` | plpgsql | DEFINER | não |  |
| conv_private.ai_is_latest | `p_message uuid` | `boolean` | sql | DEFINER | não |  |
| conv_private.ai_joao_pack | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_member_onboard | `p_proposal uuid, p_profile uuid, p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_my_reservations | `p_profile uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_own_lines | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_recent_results | `p_days integer` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_requester_title | `p_session uuid` | `text` | sql | DEFINER | não |  |
| conv_private.ai_resolve_mentions | `p_items jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_resolve_people | `p_names text[], p_scope text` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_save_turn | `p_session uuid, p_memory jsonb, p_decision text, p_payload jsonb, p_awaiting boolean, p_c…` | `void` | plpgsql | DEFINER | não |  |
| conv_private.ai_slot_games | `p_court uuid, p_date date, p_start_min integer, p_end_min integer, p_requester uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.ai_student_card_propose | `p_session uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.ai_trigger | `p_message uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.apply_delete | `p_provider_id text` | `void` | sql | DEFINER | não |  |
| conv_private.apply_edit | `p_provider_id text, p_body text` | `void` | sql | DEFINER | não |  |
| conv_private.apply_edit_with_mention | `p_provider_id text, p_body text, p_mention_direct boolean, p_mention_evidence text` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.apply_reaction | `p_target text, p_emoji text, p_from_me boolean` | `void` | sql | DEFINER | não |  |
| conv_private.aud_advance | `a conv_automations, p_as_of date` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.aud_audience | `a conv_automations, p_as_of date, p_bucket text` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.aud_card | `a conv_automations, p_as_of date` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.aud_finance | `a conv_automations, p_as_of date` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.aud_result | `a conv_automations, p_as_of date` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.audience | `a conv_automations, p_as_of date, p_bucket text` | `SETOF conv_private.audience_row` | plpgsql | DEFINER | sim |  |
| conv_private.audit | `p_action text, p_table text, p_record text, p_old jsonb, p_new jsonb, p_meta jsonb, p_tar…` | `void` | plpgsql | DEFINER | sim |  |
| conv_private.automation_cap_until | `p_contact uuid` | `timestamp with time zone` | plpgsql | invoker | sim |  |
| conv_private.automation_claim | `p_limit integer` | `TABLE(recipient_id uuid, conversation_id uuid, body text)` | plpgsql | DEFINER | sim |  |
| conv_private.automation_ctx | `p_source text, p_subject jsonb, p_name text` | `jsonb` | plpgsql | invoker | sim |  |
| conv_private.automation_events | `p_contact uuid` | `SETOF timestamp with time zone` | sql | DEFINER | sim |  |
| conv_private.automation_finish | `p_recipient uuid, p_message uuid, p_ok boolean, p_error text` | `void` | plpgsql | DEFINER | sim |  |
| conv_private.automation_materialize | `a conv_automations, p_run uuid, p_as_of date, p_bucket text, p_status text` | `integer` | plpgsql | DEFINER | sim |  |
| conv_private.automation_next_allowed | `p_at timestamp with time zone` | `timestamp with time zone` | plpgsql | invoker | sim |  |
| conv_private.automation_problems | `a conv_automations` | `text[]` | plpgsql | DEFINER | sim |  |
| conv_private.automation_purpose | `a conv_automations` | `text` | sql | invoker | sim |  |
| conv_private.automation_queue | `p_recipient uuid, p_conversation uuid, p_body text` | `TABLE(message_id uuid, destination text, already_sent boole…` | plpgsql | DEFINER | sim |  |
| conv_private.automation_revalidate | `a conv_automations, r conv_automation_recipients` | `jsonb` | plpgsql | DEFINER | sim |  |
| conv_private.automation_test_payload | `p_actor uuid, p_id uuid` | `jsonb` | plpgsql | DEFINER | sim |  |
| conv_private.automation_tick | `p_now timestamp with time zone` | `jsonb` | plpgsql | DEFINER | sim |  |
| conv_private.automation_vars | `p_source text` | `text[]` | sql | invoker | sim |  |
| conv_private.available_slots | `p_date date, p_court uuid, p_duration integer` | `text[]` | plpgsql | DEFINER | não |  |
| conv_private.begin_op | `p_key uuid, p_action text` | `jsonb` | plpgsql | DEFINER | sim |  |
| conv_private.br_local_phone | `p text` | `text` | plpgsql | invoker | não |  |
| conv_private.briefing_list_names | `p_extra uuid, p_enabled boolean` | `text` | sql | DEFINER | não |  |
| conv_private.brl | `p_cents bigint` | `text` | sql | invoker | sim |  |
| conv_private.can_merge | `a uuid, b uuid` | `boolean` | plpgsql | DEFINER | não |  |
| conv_private.channel_delivery | — | `TABLE(inbound_token_hash text, bot_phone text, bot_lids tex…` | sql | DEFINER | não |  |
| conv_private.claim_due_followups | `p_limit integer` | `TABLE(followup_id uuid, conversation_id uuid, send_body tex…` | sql | DEFINER | não |  |
| conv_private.conversation_contact | `p_conversation uuid` | `TABLE(contact_id uuid, destination text, name text, avatar_…` | sql | DEFINER | não |  |
| conv_private.court_busy | `p_court uuid, p_date date, p_start_min integer, p_end_min integer, p_exclude uuid` | `boolean` | sql | DEFINER | não |  |
| conv_private.date_br | `p_date date` | `text` | sql | invoker | sim |  |
| conv_private.dedupe_contact | `p_id uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.digits | `p text` | `text` | sql | invoker | sim |  |
| conv_private.finish_followup | `p_followup uuid, p_message uuid, p_error text` | `void` | sql | DEFINER | não |  |
| conv_private.finish_message | `p_message uuid, p_sent boolean, p_provider_id text, p_error text` | `void` | plpgsql | DEFINER | não |  |
| conv_private.finish_op | `p_key uuid, p_result jsonb` | `jsonb` | plpgsql | DEFINER | sim |  |
| conv_private.first_name | `p text` | `text` | sql | invoker | sim |  |
| conv_private.fold | `p text` | `text` | sql | invoker | sim |  |
| conv_private.fold_conversation | `p_keep uuid, p_drop uuid` | `void` | plpgsql | DEFINER | não |  |
| conv_private.game_people | `p_reservation uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.game_summary | `p_reservation uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.hhmm_to_min | `p text` | `integer` | plpgsql | invoker | sim |  |
| conv_private.immutable_row | — | `trigger` | plpgsql | invoker | sim |  |
| conv_private.ingest_message | `p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.is_confirmation | `p text` | `boolean` | plpgsql | invoker | não |  |
| conv_private.is_opt_out | `p_body text` | `boolean` | sql | invoker | sim |  |
| conv_private.is_semantic_acceptance | `p text, p_allow_cancel boolean` | `boolean` | plpgsql | invoker | não |  |
| conv_private.join_check | `p_reservation uuid, p_profile uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.join_party_check | `p_reservation uuid, p_profile uuid, p_extra uuid[], p_guest text` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.link_contact | `p_contact uuid` | `void` | plpgsql | DEFINER | não |  |
| conv_private.log_webhook | `p_event text, p_outcome text, p_detail text` | `void` | plpgsql | DEFINER | não |  |
| conv_private.mark_read_collect | `p_conversation uuid` | `TABLE(destination text, provider_ids text[], is_group boole…` | plpgsql | DEFINER | não |  |
| conv_private.mark_unread | `p_conversation uuid` | `void` | plpgsql | DEFINER | não |  |
| conv_private.member_pendency_subject | `p_profile uuid, p_as_of date, p_include_future boolean` | `jsonb` | sql | DEFINER | sim |  |
| conv_private.merge_contacts | `p_keep uuid, p_drop uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.message_target | `p_message uuid` | `TABLE(provider_message_id text, destination text, direction…` | sql | DEFINER | não |  |
| conv_private.min_to_hhmm | `p integer` | `text` | sql | invoker | sim |  |
| conv_private.month_pt | `p_date date` | `text` | sql | invoker | sim |  |
| conv_private.no_delete | — | `trigger` | plpgsql | invoker | sim |  |
| conv_private.norm_lid | `p text` | `text` | sql | invoker | sim |  |
| conv_private.older_of | `a uuid, b uuid` | `uuid` | sql | DEFINER | não |  |
| conv_private.on_inbound_opt_out | — | `trigger` | plpgsql | DEFINER | sim |  |
| conv_private.open_direct | `p_contact uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.open_group | `p_group uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.participants_check | `p_reservation uuid, p_profile uuid, p_add uuid[], p_remove uuid[], p_add_guest text, p_re…` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.pendency_paid_subject | `p_submission uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.pendency_send_existing | `p_profile uuid` | `jsonb` | sql | DEFINER | não |  |
| conv_private.phone_e164 | `p text` | `text` | plpgsql | invoker | sim |  |
| conv_private.phone_key | `p text` | `text` | plpgsql | invoker | sim |  |
| conv_private.phone_local | `p text` | `text` | plpgsql | invoker | sim |  |
| conv_private.queue_member_pendency_now | `p_profile uuid, p_charge uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.queue_message | `p_conversation uuid, p jsonb, p_author uuid, p_key uuid, p_origin text, p_session uuid, p…` | `TABLE(message_id uuid, destination text, already_sent boole…` | plpgsql | DEFINER | não |  |
| conv_private.queue_pendency_paid_notice | `p_profile uuid, p_submission uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.queue_pendency_receipt_review_notice | `p_profile uuid, p_submission uuid` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.render_template | `p_body text, p_ctx jsonb` | `text` | plpgsql | invoker | sim |  |
| conv_private.require_admin | — | `uuid` | plpgsql | DEFINER | sim |  |
| conv_private.resolve_contact | `p_phone text, p_lid text` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.resolve_undecryptable | `p_provider_id text, p_body text, p_kind text` | `void` | sql | DEFINER | não |  |
| conv_private.set_avatar | `p_contact uuid, p_url text` | `void` | sql | DEFINER | não |  |
| conv_private.set_message_media | `p_provider_id text, p_path text, p_mime text` | `uuid` | sql | DEFINER | não |  |
| conv_private.set_message_transcription | `p_message uuid, p jsonb` | `boolean` | plpgsql | DEFINER | não |  |
| conv_private.staff_delete_message | `p_message uuid` | `void` | plpgsql | DEFINER | não |  |
| conv_private.staff_edit_message | `p_message uuid, p_body text` | `void` | plpgsql | DEFINER | não |  |
| conv_private.staff_react | `p_message uuid, p_emoji text` | `void` | sql | DEFINER | não |  |
| conv_private.template_vars | `p_body text` | `text[]` | sql | invoker | sim |  |
| conv_private.today | — | `date` | sql | invoker | sim |  |
| conv_private.update_message_status | `p_provider_id text, p_status text` | `void` | sql | DEFINER | não |  |
| conv_private.upsert_contact | `p_phone text, p_lid text, p_name text, p_staff_sent boolean` | `uuid` | plpgsql | DEFINER | não |  |
| conv_private.validate_reservation | `p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| conv_private.vfail | `p_code text, p_message text` | `jsonb` | sql | invoker | sim |  |
| fin_private.account_balances | `p_at date` | `TABLE(id uuid, name text, kind text, active boolean, is_def…` | sql | DEFINER | sim |  |
| fin_private.add_entry_payment | `p_entry uuid, p_amount bigint, p_paid_on date, p_account uuid, p_note text, p_settle bool…` | `void` | plpgsql | DEFINER | sim |  |
| fin_private.adjust_business_day | `p_date date, p_rule text` | `date` | plpgsql | invoker | sim |  |
| fin_private.apply_payment | `p_charge uuid, p_amount bigint, p_paid_on date, p_method text, p_account uuid, p_submissi…` | `jsonb` | plpgsql | DEFINER | sim |  |
| fin_private.audit_row | — | `trigger` | plpgsql | DEFINER | sim |  |
| fin_private.audit_row_dispatch | `p_op text, p_old jsonb, p_new jsonb, p_table text` | `void` | plpgsql | DEFINER | sim |  |
| fin_private.audit_row_soft | — | `trigger` | plpgsql | DEFINER | sim |  |
| fin_private.auto_approve_pendency_receipt | `p_submission uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| fin_private.begin_op | `p_key uuid, p_action text, p_reason text` | `jsonb` | plpgsql | DEFINER | sim |  |
| fin_private.cash_rows | `p_from date, p_to date` | `TABLE(source_type text, source_id text, leg text, occurred_…` | plpgsql | DEFINER | sim |  |
| fin_private.category_id | `p_key text` | `uuid` | sql | invoker | sim |  |
| fin_private.charge_rows | `p_profile uuid, p_ids uuid[], p_filters jsonb, p_as_of date, p_limit integer, p_offset in…` | `TABLE(charge_id uuid, plan_id uuid, profile_id uuid, profil…` | plpgsql | DEFINER | sim |  |
| fin_private.charge_statement | `p_charge uuid, p_as_of date` | `TABLE(principal_base bigint, principal_paid bigint, princip…` | plpgsql | DEFINER | sim |  |
| fin_private.check_account | `p_account uuid` | `void` | plpgsql | DEFINER | sim |  |
| fin_private.check_category | `p_category uuid, p_kind text` | `void` | plpgsql | DEFINER | sim |  |
| fin_private.check_period | `p_from date, p_to date` | `void` | plpgsql | invoker | sim |  |
| fin_private.cnpj_matches | `p_read text, p_key text` | `boolean` | sql | invoker | não |  |
| fin_private.day_card_rows | `p_from date, p_to date` | `TABLE(reservation_id uuid, occurred_on date, guest_name tex…` | plpgsql | DEFINER | sim |  |
| fin_private.dre_lines | `p_from date, p_to date` | `TABLE(line text, category_id uuid, name text, parent_name t…` | sql | DEFINER | sim |  |
| fin_private.dre_rows | `p_from date, p_to date` | `TABLE(category_id uuid, amount_cents bigint, source_type te…` | plpgsql | DEFINER | sim |  |
| fin_private.due_date | `p_competence date, p_period_months integer, p_due_day integer, p_offset integer, p_rule t…` | `date` | plpgsql | invoker | sim |  |
| fin_private.easter | `p_year integer` | `date` | plpgsql | invoker | sim |  |
| fin_private.end_plan | `p_plan uuid, p_ended_on date, p_reason text, p_auto boolean` | `jsonb` | plpgsql | DEFINER | sim |  |
| fin_private.ensure_holidays | `p_from_year integer, p_to_year integer` | `void` | plpgsql | DEFINER | sim |  |
| fin_private.ensure_member_charges | `p_profile uuid, p_extend boolean` | `integer` | plpgsql | DEFINER | não |  |
| fin_private.entry_paid_cents | `p_entry uuid` | `bigint` | sql | invoker | sim |  |
| fin_private.finish_op | `p_key uuid, p_result jsonb` | `jsonb` | plpgsql | DEFINER | sim |  |
| fin_private.fold_text | `p_text text` | `text` | sql | invoker | não |  |
| fin_private.generate_charges | `p_plan uuid, p_today date` | `jsonb` | plpgsql | DEFINER | sim |  |
| fin_private.generate_recurrences | `p_recurrence uuid, p_until date` | `integer` | plpgsql | DEFINER | sim |  |
| fin_private.is_active_member | `p_profile uuid` | `boolean` | sql | DEFINER | sim |  |
| fin_private.is_business_day | `p_date date` | `boolean` | sql | invoker | sim |  |
| fin_private.no_delete | — | `trigger` | plpgsql | invoker | sim |  |
| fin_private.no_delete_recurrence | — | `trigger` | plpgsql | invoker | sim |  |
| fin_private.on_profile_membership_change | — | `trigger` | plpgsql | DEFINER | sim |  |
| fin_private.payee_matches | `p_read text, p_expected text[]` | `boolean` | sql | invoker | não |  |
| fin_private.receipt_auto_paid_notice | — | `trigger` | plpgsql | DEFINER | sim |  |
| fin_private.recurrence_due_date | `p_competence date, p_day integer, p_offset integer` | `date` | sql | invoker | sim |  |
| fin_private.refresh_charge_status | `p_charge uuid` | `text` | plpgsql | DEFINER | sim |  |
| fin_private.require_admin | — | `uuid` | plpgsql | DEFINER | sim |  |
| fin_private.seed_holidays | `p_year integer` | `integer` | plpgsql | DEFINER | sim |  |
| fin_private.statement_json | `p_charge uuid, p_as_of date` | `jsonb` | sql | DEFINER | sim |  |
| fin_private.today | — | `date` | sql | invoker | sim |  |
| fin_private.waive_fees | `p_charge uuid, p_amount bigint, p_reason text, p_as_of date, p_request uuid` | `void` | plpgsql | DEFINER | sim |  |
| public.access_requests_set_updated_at | — | `trigger` | plpgsql | invoker | sim |  |
| public.admin_audit_changed_fields | `p_old jsonb, p_new jsonb` | `text[]` | sql | invoker | sim |  |
| public.admin_audit_insert_log | `p_action text, p_table_name text, p_record_id text, p_target_user_id uuid, p_related_user…` | `uuid` | plpgsql | DEFINER | sim |  |
| public.admin_audit_related_users | `p_table_name text, p_row jsonb` | `uuid[]` | plpgsql | invoker | sim |  |
| public.admin_audit_table_changes | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.admin_audit_try_uuid | `p_value text` | `uuid` | plpgsql | invoker | sim |  |
| public.admin_record_user_access | `p_event text, p_metadata jsonb` | `uuid` | plpgsql | DEFINER | sim |  |
| public.admin_record_user_login | `p_metadata jsonb` | `uuid` | plpgsql | DEFINER | sim |  |
| public.admin_reset_ranking_full | `p_confirmation text, p_reason text` | `jsonb` | plpgsql | DEFINER | sim |  |
| public.apagar_mensagem_antiga | — | `void` | plpgsql | invoker | sim |  |
| public.apply_championship_edition_points | `p_championship_id uuid` | `TABLE(user_id uuid, phase text, earned_points integer, defe…` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.bootstrap_ranking_from_3_circuito | `p_dry_run boolean` | `TABLE(user_id uuid, name text, registration_class text, cur…` | plpgsql | DEFINER ⚠ sem search_path | sim | Pass p_dry_run=TRUE to preview the diff. Only call with FALSE after verifying output. |
| public.check_and_auto_finish_championship | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.class_rank | `p_class text` | `integer` | sql | invoker | sim |  |
| public.clean_model_text | `input_text text` | `text` | plpgsql | invoker | sim |  |
| public.conv_add_followup | `p_conversation uuid, p_due_at timestamp with time zone, p_note text, p_send_body text` | `uuid` | plpgsql | DEFINER | não |  |
| public.conv_add_note | `p_conversation uuid, p_body text` | `uuid` | plpgsql | DEFINER | não |  |
| public.conv_admins | — | `TABLE(id uuid, name text)` | plpgsql | DEFINER | não |  |
| public.conv_automation_approve_run | `p_request uuid, p_run uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_automation_cancel_run | `p_run uuid` | `void` | plpgsql | DEFINER | não |  |
| public.conv_automation_list | — | `TABLE(id uuid, name text, description text, objective text,…` | plpgsql | DEFINER | não |  |
| public.conv_automation_prepare_manual | `p_request uuid, p_id uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_automation_preview | `p_id uuid, p_override jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_automation_retry_failed | `p_run uuid` | `integer` | plpgsql | DEFINER | não |  |
| public.conv_automation_set_status | `p_request uuid, p_id uuid, p_status text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_delete_quick_reply | `p_id uuid` | `void` | plpgsql | DEFINER | não |  |
| public.conv_get_ai_settings | — | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_get_automation_settings | — | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_inbox | `p_filter text, p_search text, p_limit integer` | `TABLE(id uuid, kind text, status text, title text, destinat…` | plpgsql | DEFINER | não |  |
| public.conv_link_contact | `p_contact uuid, p_profile uuid, p_student uuid` | `void` | plpgsql | DEFINER | não |  |
| public.conv_list_ai_memory_candidates | `p_status text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_open_conversation | `p_phone text, p_name text` | `uuid` | plpgsql | DEFINER | não |  |
| public.conv_review_ai_memory_candidate | `p_id uuid, p_decision text, p_content text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_rotate_inbound_token | `p_request uuid, p_token text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_save_ai_settings | `p_request uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_save_automation | `p_request uuid, p_id uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_save_automation_settings | `p_request uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_save_channel | `p_request uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.conv_save_quick_reply | `p_id uuid, p_shortcut text, p_title text, p_body text` | `uuid` | plpgsql | DEFINER | não |  |
| public.conv_search_people | `p_query text` | `TABLE(kind text, id uuid, name text, hint text)` | plpgsql | DEFINER | não |  |
| public.conv_set_ai_channel | `p_direct boolean, p_group boolean` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_ai_status | `p_conversation uuid, p_status text` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_group | `p_group uuid, p_status text, p_ai boolean` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_mention_verified | `p_verified boolean` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_meta | `p_conversation uuid, p jsonb` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_opt_out | `p_contact uuid, p_opt_out boolean` | `void` | plpgsql | DEFINER | não |  |
| public.conv_set_status | `p_conversation uuid, p_status text` | `void` | plpgsql | DEFINER | não |  |
| public.conv_svc_admin_alert_claim | `p_profile uuid, p_rule text, p_day date` | `boolean` | plpgsql | DEFINER | não |  |
| public.conv_svc_admin_alert_data | `p_profile uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_admin_alert_release | `p_profile uuid, p_rule text, p_day date` | `void` | sql | DEFINER | não |  |
| public.conv_svc_admin_alert_targets | — | `TABLE(profile_id uuid, name text, conversation_id uuid)` | sql | DEFINER | não |  |
| public.conv_svc_admin_briefing_data | `p_profile uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_admin_briefing_targets | — | `TABLE(profile_id uuid, name text, conversation_id uuid)` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_access_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_adm_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_briefing_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_broadcast_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_dependent_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_file | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_finance_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_member_onboard | `p_proposal uuid, p_profile uuid, p_message uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_members | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_memories | `p_session uuid, p_subject text` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_memory_forget_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_message_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_prefs | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_read | `p_session uuid, p_domain text, p_args jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_read_more | `p_session uuid, p_domain text, p_args jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_receipt | `p_session uuid, p_message uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_admin_wave8_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_audio_transcripts | `p_ids text[]` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_cancel_proposal | `p_session uuid` | `void` | sql | DEFINER | não |  |
| public.conv_svc_ai_club_balances | — | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_club_roster | — | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_confirm | `p_proposal uuid, p_message uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_context | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_expire_sessions | — | `integer` | sql | DEFINER | não |  |
| public.conv_svc_ai_financial_context | — | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_find_courts | `p_label text` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_group_context | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_handoff | `p_session uuid, p_kind text, p_note text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_ai_is_latest | `p_message uuid` | `boolean` | sql | DEFINER | não |  |
| public.conv_svc_ai_joao_pack | `p_session uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_memory_candidate | `p jsonb` | `uuid` | plpgsql | DEFINER | não |  |
| public.conv_svc_ai_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_requester_title | `p_session uuid` | `text` | sql | DEFINER | não |  |
| public.conv_svc_ai_resolve_mentions | `p_items jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_resolve_people | `p_names text[], p_scope text` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_save_turn | `p_session uuid, p_memory jsonb, p_decision text, p_payload jsonb, p_awaiting boolean, p_c…` | `void` | sql | DEFINER | não |  |
| public.conv_svc_ai_slot_games | `p_court uuid, p_date date, p_start_min integer, p_end_min integer, p_requester uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_student_card_propose | `p_session uuid, p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_ai_trigger | `p_message uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_apply_delete | `p_provider_id text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_apply_edit | `p_provider_id text, p_body text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_apply_edit_with_mention | `p_provider_id text, p_body text, p_mention_direct boolean, p_mention_evidence text` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_apply_reaction | `p_target text, p_emoji text, p_from_me boolean` | `void` | sql | DEFINER | não |  |
| public.conv_svc_automation_claim | `p_limit integer` | `TABLE(recipient_id uuid, conversation_id uuid, body text)` | sql | DEFINER | não |  |
| public.conv_svc_automation_finish | `p_recipient uuid, p_message uuid, p_ok boolean, p_error text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_automation_queue | `p_recipient uuid, p_conversation uuid, p_body text` | `TABLE(message_id uuid, destination text, already_sent boole…` | sql | DEFINER | não |  |
| public.conv_svc_automation_test_payload | `p_actor uuid, p_id uuid` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_automation_tick | — | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_available_slots | `p_date date, p_court uuid, p_duration integer` | `text[]` | sql | DEFINER | não |  |
| public.conv_svc_channel_delivery | — | `TABLE(inbound_token_hash text, bot_phone text, bot_lids tex…` | sql | DEFINER | não |  |
| public.conv_svc_claim_due_followups | `p_limit integer` | `TABLE(followup_id uuid, conversation_id uuid, send_body tex…` | sql | DEFINER | não |  |
| public.conv_svc_conversation_contact | `p_conversation uuid` | `TABLE(contact_id uuid, destination text, name text, avatar_…` | sql | DEFINER | não |  |
| public.conv_svc_finish_followup | `p_followup uuid, p_message uuid, p_error text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_finish_message | `p_message uuid, p_sent boolean, p_provider_id text, p_error text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_ingest_message | `p jsonb` | `jsonb` | sql | DEFINER | não |  |
| public.conv_svc_log_webhook | `p_event text, p_outcome text, p_detail text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_mark_read_collect | `p_conversation uuid` | `TABLE(destination text, provider_ids text[], is_group boole…` | sql | DEFINER | não |  |
| public.conv_svc_mark_unread | `p_conversation uuid` | `void` | sql | DEFINER | não |  |
| public.conv_svc_message_target | `p_message uuid` | `TABLE(provider_message_id text, destination text, direction…` | sql | DEFINER | não |  |
| public.conv_svc_queue_message | `p_conversation uuid, p jsonb, p_author uuid, p_key uuid, p_origin text, p_session uuid, p…` | `TABLE(message_id uuid, destination text, already_sent boole…` | sql | DEFINER | não |  |
| public.conv_svc_resolve_undecryptable | `p_provider_id text, p_body text, p_kind text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_set_avatar | `p_contact uuid, p_url text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_set_message_media | `p_provider_id text, p_path text, p_mime text` | `uuid` | sql | DEFINER | não |  |
| public.conv_svc_set_message_transcription | `p_message uuid, p jsonb` | `boolean` | sql | DEFINER | não |  |
| public.conv_svc_staff_delete_message | `p_message uuid` | `void` | sql | DEFINER | não |  |
| public.conv_svc_staff_edit_message | `p_message uuid, p_body text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_staff_react | `p_message uuid, p_emoji text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_update_message_status | `p_provider_id text, p_status text` | `void` | sql | DEFINER | não |  |
| public.conv_svc_welcome_groups | — | `TABLE(conversation_id uuid, group_name text)` | sql | DEFINER | não |  |
| public.conv_update_followup | `p_id uuid, p_status text, p_due_at timestamp with time zone` | `void` | plpgsql | DEFINER | não |  |
| public.default_professor_id | — | `uuid` | sql | DEFINER | não |  |
| public.ensure_knockout_rounds | `p_championship_id uuid` | `TABLE(semifinal_round_id uuid, final_round_id uuid)` | plpgsql | DEFINER | sim |  |
| public.escape_for_regexp | `str text` | `text` | sql | invoker | sim |  |
| public.fin_account_balances | `p_at date` | `TABLE(id uuid, name text, kind text, active boolean, is_def…` | plpgsql | DEFINER | não |  |
| public.fin_active_members | — | `TABLE(id uuid, name text, phone text)` | plpgsql | DEFINER | não |  |
| public.fin_adjust_charge | `p_request_id uuid, p_charge uuid, p_kind text, p_amount_cents bigint, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_approve_receipt | `p_request_id uuid, p_submission_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_attach_file | `p_request_id uuid, p_entry uuid, p_path text, p_name text, p_content_type text, p_size in…` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_cancel_charge | `p_request_id uuid, p_charge uuid, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_cancel_entry | `p_request_id uuid, p_id uuid, p_expected_version integer, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_cash_flow | `p_from date, p_to date, p_granularity text, p_account uuid` | `TABLE(bucket_start date, bucket_end date, opening_cents big…` | plpgsql | DEFINER | não |  |
| public.fin_charge_statements | `p_filters jsonb, p_as_of date, p_limit integer, p_offset integer` | `TABLE(charge_id uuid, plan_id uuid, profile_id uuid, profil…` | plpgsql | DEFINER | não |  |
| public.fin_charge_statements_by_ids | `p_ids uuid[], p_as_of date` | `TABLE(charge_id uuid, plan_id uuid, profile_id uuid, profil…` | plpgsql | DEFINER | não |  |
| public.fin_create_entry | `p_request_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_create_member_pendency | `p_request_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_create_member_plan | `p_request_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_day_card_rows | `p_from date, p_to date` | `TABLE(reservation_id uuid, occurred_on date, guest_name tex…` | plpgsql | DEFINER | não |  |
| public.fin_delete_recurrence | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_dre_detail | `p_from date, p_to date, p_category uuid` | `TABLE(category_id uuid, category_name text, source_type tex…` | plpgsql | DEFINER | não |  |
| public.fin_dre_lines | `p_from date, p_to date` | `TABLE(period text, line text, category_id uuid, name text, …` | plpgsql | DEFINER | não |  |
| public.fin_dre_memo | `p_from date, p_to date` | `TABLE(contributions_cents bigint, withdrawals_cents bigint)` | plpgsql | DEFINER | não |  |
| public.fin_end_member_plan | `p_request_id uuid, p_plan_id uuid, p_ended_on date, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_generate_member_charges | `p_request_id uuid, p_plan_id uuid, p_today date` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_generate_recurrences | `p_request_id uuid, p_until date` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_is_active_member | `p_profile uuid` | `boolean` | sql | DEFINER | não |  |
| public.fin_link_receipt_charges | `p_request_id uuid, p_submission_id uuid, p_charge_ids uuid[]` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_member_payment_settings | — | `TABLE(pix_key text, pendency_automation_enabled boolean, pe…` | sql | DEFINER | não |  |
| public.fin_monthly_trend | `p_to date, p_months integer` | `TABLE(month_start date, revenue_cents bigint, expense_cents…` | plpgsql | DEFINER | não |  |
| public.fin_movements | `p_from date, p_to date, p_filters jsonb, p_limit integer, p_offset integer` | `TABLE(source_type text, source_id text, leg text, occurred_…` | plpgsql | DEFINER | não |  |
| public.fin_my_charges | `p_as_of date` | `TABLE(charge_id uuid, plan_id uuid, profile_id uuid, profil…` | plpgsql | DEFINER | não |  |
| public.fin_pay_entry | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_payables_summary | `p_as_of date` | `TABLE(payable_open_cents bigint, payable_overdue_count bigi…` | plpgsql | DEFINER | não |  |
| public.fin_public_settings | — | `TABLE(due_day smallint, due_month_offset smallint, non_busi…` | sql | DEFINER | não |  |
| public.fin_receipt_queue | `p_status text, p_limit integer, p_offset integer` | `TABLE(id uuid, profile_id uuid, profile_name text, status t…` | plpgsql | DEFINER | não |  |
| public.fin_receivables_summary | `p_as_of date` | `TABLE(open_count bigint, open_cents bigint, overdue_count b…` | plpgsql | DEFINER | não |  |
| public.fin_register_payment | `p_request_id uuid, p_charge uuid, p_amount_cents bigint, p_paid_on date, p_method text, p…` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_reject_receipt | `p_request_id uuid, p_submission_id uuid, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_remove_attachment | `p_request_id uuid, p_id uuid, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_resolve_credit | `p_request_id uuid, p_credit uuid, p_action text, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_reverse_entry_payment | `p_request_id uuid, p_payment_id uuid, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_reverse_payment | `p_request_id uuid, p_payment_id uuid, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_save_account | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_save_category | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_save_holiday | `p_request_id uuid, p_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_save_recurrence | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb, p_apply_from date` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_save_settings | `p_request_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_seed_holidays | `p_request_id uuid, p_year integer` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_send_pendency_now | `p_request_id uuid, p_charge uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_set_pendency_collection | `p_request_id uuid, p_charge uuid, p_enabled boolean` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_set_plan_price | `p_request_id uuid, p_plan_id uuid, p_effective_from date, p_amount_cents bigint, p_reason…` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_start_receipt_review | `p_request_id uuid, p_submission_id uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_student_revenue | `p_from date, p_to date` | `TABLE(source_type text, source_id text, occurred_on date, d…` | plpgsql | DEFINER | não |  |
| public.fin_submit_receipt | `p_request_id uuid, p_submission_id uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_submit_whatsapp_pendency_receipt | `p_message uuid, p_submission uuid, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_update_entry | `p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb, p_reason text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.fin_update_member_plan | `p_request_id uuid, p_plan_id uuid, p_expected_version integer, p_data jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.finish_championship | `p_championship_id uuid` | `jsonb` | plpgsql | DEFINER | sim |  |
| public.get_active_user_points | — | `TABLE(user_id uuid, total_points bigint)` | plpgsql | invoker | sim |  |
| public.get_admin_push_subscriptions | — | `TABLE(id uuid, user_id uuid, endpoint text, keys jsonb)` | sql | DEFINER | não | Retorna todas as assinaturas push ativas dos administradores do clube |
| public.get_championship_phase_points | `p_phase text` | `integer` | sql | DEFINER ⚠ sem search_path | sim |  |
| public.get_form_live_results | `p_form_id uuid` | `jsonb` | plpgsql | DEFINER | sim |  |
| public.get_group_standings | `p_group_id uuid` | `TABLE(standing_position integer, registration_id uuid, poin…` | sql | DEFINER | sim |  |
| public.get_lead_marketing_intelligence | `p_lead_id uuid` | `jsonb` | plpgsql | DEFINER | sim |  |
| public.get_ranking_cycle_start | — | `timestamp with time zone` | plpgsql | DEFINER | sim |  |
| public.get_stock_automator_config | `p_store_id uuid` | `TABLE(id uuid, store_id uuid, config_type text, value text,…` | plpgsql | DEFINER | sim |  |
| public.get_user_h2h_points | `p_user_id uuid` | `TABLE(opponent_id uuid, opponent_name text, match_type text…` | sql | DEFINER ⚠ sem search_path | sim |  |
| public.get_user_store_ids | — | `uuid[]` | plpgsql | DEFINER | sim |  |
| public.ia_instagram_handle_echo | — | `trigger` | plpgsql | invoker | sim |  |
| public.ia_instagram_set_human_window | — | `trigger` | plpgsql | invoker | sim |  |
| public.increment_unread_count | `p_conversation_id uuid, p_last_customer_message_at timestamp with time zone` | `void` | plpgsql | DEFINER | sim |  |
| public.insert_stock_automator_config | `p_store_id uuid, p_config_type text, p_value text, p_sku_code text, p_aliases text[]` | `uuid` | plpgsql | DEFINER | sim |  |
| public.is_admin | — | `boolean` | plpgsql | DEFINER | sim |  |
| public.is_lower_class | `p_registration_class text, p_profile_class text` | `boolean` | sql | invoker | sim |  |
| public.joao_daily_secret_ok | `p_secret text` | `boolean` | sql | DEFINER | não |  |
| public.log_championship_admin_action | `p_championship_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_before_dat…` | `uuid` | plpgsql | DEFINER | sim |  |
| public.match_documents | `query_embedding vector, match_count integer, filter jsonb` | `TABLE(id uuid, content text, similarity double precision)` | plpgsql | invoker | sim |  |
| public.normalize_and_expand_models | `input_text text` | `text[]` | plpgsql | invoker | sim |  |
| public.on_championship_finished_apply_points | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.on_profile_class_change | — | `trigger` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.process_head_to_head_points | — | `trigger` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.propagate_bracket_winner | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.record_student_level_change | — | `trigger` | plpgsql | DEFINER | não |  |
| public.refresh_familias_trigger | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.resolve_championship_final_phases | `p_championship_id uuid` | `void` | plpgsql | DEFINER | sim |  |
| public.resolve_match_winner_registration | `p_match_id uuid` | `uuid` | plpgsql | DEFINER | sim |  |
| public.resolve_resenha_open_final_phases | `p_championship_id uuid` | `void` | plpgsql | DEFINER | sim |  |
| public.revert_championship_edition_points | `p_championship_id uuid` | `void` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.rollback_bootstrap_3_circuito | — | `void` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.set_credito_crm_timestamp | — | `trigger` | plpgsql | invoker | sim |  |
| public.set_default_professor | — | `trigger` | plpgsql | DEFINER | não |  |
| public.set_student_level | `p_student_profile_id uuid, p_new_level text, p_observation text` | `void` | plpgsql | invoker | não |  |
| public.sig_add_recipients | `p_id uuid, p_profiles uuid[]` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_admin_recipients | `p_id uuid` | `TABLE(profile_id uuid, name text, phone text, source text, …` | plpgsql | DEFINER | não |  |
| public.sig_archive | `p_id uuid, p_reason text` | `void` | plpgsql | DEFINER | não |  |
| public.sig_can_delete_file | `p_name text` | `boolean` | sql | DEFINER | não |  |
| public.sig_can_read_file | `p_name text` | `boolean` | sql | DEFINER | não |  |
| public.sig_can_upload_file | `p_name text` | `boolean` | sql | DEFINER | não |  |
| public.sig_create_draft | `p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_delete_draft | `p_id uuid` | `text` | plpgsql | DEFINER | não |  |
| public.sig_is_recipient | `p_document uuid` | `boolean` | sql | DEFINER | não |  |
| public.sig_log_event | `p_document uuid, p_kind text, p_meta jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_member_can_see | `p_document uuid` | `boolean` | sql | DEFINER | não |  |
| public.sig_my_documents | — | `TABLE(document_id uuid, title text, description text, versi…` | plpgsql | DEFINER | não |  |
| public.sig_my_pending_count | — | `integer` | plpgsql | DEFINER | não |  |
| public.sig_publish | `p_id uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_remove_recipient | `p_id uuid, p_profile uuid` | `void` | plpgsql | DEFINER | não |  |
| public.sig_resend_failed | `p_id uuid` | `integer` | plpgsql | DEFINER | não |  |
| public.sig_save_my_cpf | `p_cpf text` | `void` | plpgsql | DEFINER | não |  |
| public.sig_set_new_members | `p_id uuid, p_value boolean` | `void` | plpgsql | DEFINER | não |  |
| public.sig_set_recipients | `p_id uuid, p_profiles uuid[]` | `integer` | plpgsql | DEFINER | não |  |
| public.sig_svc_claim_notifications | `p_limit integer` | `TABLE(id uuid, document_id uuid, profile_id uuid, kind text…` | plpgsql | DEFINER | não |  |
| public.sig_svc_enqueue_reminders | — | `integer` | plpgsql | DEFINER | não |  |
| public.sig_svc_finish_notification | `p_id uuid, p_sent boolean, p_provider_id text, p_error text` | `void` | plpgsql | DEFINER | não |  |
| public.sig_svc_issue_challenge | `p_profile uuid, p_document uuid, p_code text, p_evidence jsonb, p_ip text, p_ua text` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_svc_mark_code_sent | `p_challenge uuid, p_provider_id text, p_error text` | `void` | plpgsql | DEFINER | não |  |
| public.sig_svc_verify_code | `p_challenge uuid, p_profile uuid, p_code text, p_ip text, p_ua text, p_geo jsonb, p_devic…` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_update_draft | `p_id uuid, p jsonb` | `jsonb` | plpgsql | DEFINER | não |  |
| public.sig_update_due | `p_id uuid, p_due timestamp with time zone` | `void` | plpgsql | DEFINER | não |  |
| public.sig_verify_integrity | `p_id uuid` | `jsonb` | plpgsql | DEFINER | não |  |
| public.submit_club_form | `p_form_id uuid, p_answers jsonb` | `jsonb` | plpgsql | DEFINER | sim |  |
| public.sync_championship_registration_flags | — | `trigger` | plpgsql | invoker | sim |  |
| public.sync_group_knockout_for_class | `p_championship_id uuid, p_class text` | `void` | plpgsql | DEFINER | sim |  |
| public.sync_student_profile_status_to_legacy_student | — | `trigger` | plpgsql | DEFINER | não |  |
| public.trg_sync_group_knockout_on_match_change | — | `trigger` | plpgsql | DEFINER | sim |  |
| public.update_updated_at_column | — | `trigger` | plpgsql | invoker | sim |  |
| public.upsert_crm_lead | `p_store_id uuid, p_phone text, p_name text, p_contact_id text, p_entity_id text` | `uuid` | plpgsql | DEFINER ⚠ sem search_path | sim |  |
| public.upsert_crm_lead | `p_store_id uuid, p_phone text, p_name text, p_contact_id text, p_entity_id text, p_channe…` | `uuid` | plpgsql | DEFINER | sim |  |
| public.validate_match_result_integrity | — | `trigger` | plpgsql | invoker | sim |  |
| sig_private.audit | `p_action text, p_document uuid, p_data jsonb` | `void` | plpgsql | DEFINER | sim |  |
| sig_private.audit_row | — | `trigger` | plpgsql | DEFINER | sim |  |
| sig_private.consent_text | `p_title text, p_version integer` | `text` | sql | invoker | sim |  |
| sig_private.cpf_valid | `p text` | `boolean` | plpgsql | invoker | sim |  |
| sig_private.enqueue_notification | `p_doc uuid, p_profile uuid, p_kind text, p_slot text, p_not_before timestamp with time zo…` | `text` | plpgsql | DEFINER | sim |  |
| sig_private.forbid_change | — | `trigger` | plpgsql | invoker | sim |  |
| sig_private.get_document | `p_id uuid, p_lock boolean` | `sig_documents` | plpgsql | DEFINER | sim |  |
| sig_private.guard_document | — | `trigger` | plpgsql | invoker | sim |  |
| sig_private.is_active_member | `p_profile uuid` | `boolean` | sql | DEFINER | sim |  |
| sig_private.on_member_active | — | `trigger` | plpgsql | DEFINER | sim |  |
| sig_private.request_header | `p_name text` | `text` | plpgsql | invoker | sim |  |
| sig_private.request_ip | — | `text` | sql | invoker | sim |  |
| sig_private.require_admin | — | `uuid` | plpgsql | DEFINER | sim |  |
| sig_private.require_member | — | `uuid` | plpgsql | DEFINER | sim |  |
| sig_private.set_action | `p text` | `void` | sql | invoker | sim |  |
| sig_private.sha256_hex | `p text` | `text` | sql | invoker | sim |  |
| sig_private.signature_evidence | `r sig_signatures` | `jsonb` | sql | invoker | sim |  |
| sig_private.ts | `p timestamp with time zone` | `text` | sql | invoker | sim |  |
