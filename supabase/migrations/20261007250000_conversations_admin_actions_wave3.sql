-- Onda 3 do assessor administrativo (administrativo, N1: reversível). Mesmo protocolo: proposta com resumo → "sim" do
-- próprio administrador → grava como o administrador, com auditoria. Ações: publicar/desativar aviso, pausar/reativar
-- aluno, inativar/reativar sócio, reenviar assinaturas com falha e cancelar reserva. Aprovar/recusar acesso (função de
-- borda que cria o usuário) e follow-up ficam no painel.

-- A CHECK de `conv_booking_proposals.action` é reescrita por cada onda: aqui ela é LIDA do banco e só ACRESCENTA,
-- para nunca apagar ações de outras migrations.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_announcement_create', 'adm_announcement_deactivate', 'adm_student_status',
    'adm_member_status', 'adm_signature_resend', 'adm_reservation_cancel'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- ---------------------------------------------------------------------------------------------- proposta
create function conv_private.ai_admin_adm_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_payload jsonb; v_id uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_title text; v_msg text; v_n int; v_list text; v_active boolean; v_profile uuid; v_pname text; v_role text; v_cur boolean;
  v_id2 uuid; v_status text; v_date date; v_start time; v_court text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  if v_action = 'adm_announcement_create' then
    v_title := trim(coalesce(p->>'title', '')); v_msg := trim(coalesce(p->>'message', ''));
    if length(v_title) not between 3 and 80 then return conv_private.vfail('INVALID_TITLE', 'Qual o título do aviso? (até 80 caracteres)'); end if;
    if length(v_msg) not between 5 and 600 then return conv_private.vfail('INVALID_MESSAGE', 'Qual o texto do aviso? (até 600 caracteres)'); end if;
    if nullif(p->>'expires_on', '')::date < v_today then return conv_private.vfail('INVALID_DATE', 'A validade do aviso não pode ser no passado.'); end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object('title', v_title, 'message', v_msg, 'expires_on', nullif(p->>'expires_on', '')::date,
      'show_once', coalesce((p->>'show_once')::boolean, false)));

  elsif v_action = 'adm_announcement_deactivate' then
    select count(*), min(a.id::text)::uuid, min(a.title), string_agg(a.title, '; ' order by a.created_at desc)
      into v_n, v_id2, v_title, v_list from public.announcements a
    where coalesce(a.is_active, true) and (a.expires_at is null or a.expires_at > now())
      and fin_private.fold_text(a.title) like '%' || fin_private.fold_text(coalesce(p->>'title', '')) || '%';
    if v_n = 0 then return conv_private.vfail('ANNOUNCEMENT_NOT_FOUND', 'Não achei aviso ativo com esse título.'); end if;
    if v_n > 1 then return conv_private.vfail('ANNOUNCEMENT_AMBIGUOUS', 'Achei mais de um aviso ativo: ' || v_list || '. Qual deles?'); end if;
    v_payload := jsonb_build_object('announcement_id', v_id2, 'title', v_title);

  elsif v_action = 'adm_student_status' then
    v_status := p->>'status';
    if v_status not in ('active', 'paused') then return conv_private.vfail('INVALID_DATA', 'É para pausar ou reativar o aluno?'); end if;
    select count(*), min(x.id::text)::uuid, min(x.name), string_agg(x.name, ', ' order by x.name) into v_n, v_id2, v_pname, v_list from (
      select sp.id, coalesce(pr.name, ns.name) name from public.student_profiles sp
      left join public.profiles pr on pr.id = sp.profile_id left join public.non_socio_students ns on ns.id = sp.non_socio_student_id
      where fin_private.fold_text(coalesce(pr.name, ns.name)) like '%' || fin_private.fold_text(coalesce(p->>'student_name', '')) || '%') x;
    if nullif(trim(coalesce(p->>'student_name', '')), '') is null or v_n = 0 then
      return conv_private.vfail('STUDENT_NOT_FOUND', 'Não achei esse aluno. Qual o nome completo?');
    end if;
    if v_n > 1 then return conv_private.vfail('STUDENT_AMBIGUOUS', 'Achei mais de um: ' || v_list || '. Qual deles?'); end if;
    select (student_status = 'active') into v_cur from public.student_profiles where id = v_id2;
    if (v_status = 'active') = coalesce(v_cur, false) then
      return conv_private.vfail('ALREADY_SET', case when v_status = 'active' then 'Esse aluno já está ativo.' else 'Esse aluno já está pausado.' end);
    end if;
    v_payload := jsonb_build_object('student_profile_id', v_id2, 'student_name', v_pname, 'status', v_status);

  elsif v_action = 'adm_member_status' then
    -- O sócio é achado pelo nome entre TODOS os cadastros (reativar precisa achar quem está inativo).
    v_active := (p->>'active')::boolean;
    if v_active is null then return conv_private.vfail('INVALID_DATA', 'É para inativar ou reativar?'); end if;
    if nullif(trim(coalesce(p->>'member_name', '')), '') is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Qual sócio?'); end if;
    select count(*), min(x.id::text)::uuid, string_agg(x.name, ', ' order by x.name) into v_n, v_profile, v_list from (
      select pr.id, pr.name from public.profiles pr
      where fin_private.fold_text(pr.name) like '%' || fin_private.fold_text(p->>'member_name') || '%') x;
    if v_n = 0 then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio. Qual o nome completo?'); end if;
    if v_n > 1 then return conv_private.vfail('MEMBER_AMBIGUOUS', 'Achei mais de um: ' || v_list || '. Qual deles?'); end if;
    select name, role::text, coalesce(is_active, true) into v_pname, v_role, v_cur from public.profiles where id = v_profile;
    if v_role = 'admin' then return conv_private.vfail('ADMIN_PROTECTED', 'Administrador não é alterado por aqui. Isso é pelo painel (Sócios).'); end if;
    if v_cur = v_active then
      return conv_private.vfail('ALREADY_SET', case when v_active then 'Esse sócio já está ativo.' else 'Esse sócio já está inativo.' end);
    end if;
    v_payload := jsonb_build_object('profile_id', v_profile, 'member_name', v_pname, 'active', v_active);

  elsif v_action = 'adm_signature_resend' then
    select count(*), min(d.id::text)::uuid, min(d.title), string_agg(d.title, '; ' order by d.published_at desc)
      into v_n, v_id2, v_title, v_list from public.sig_documents_overview d
    where d.status = 'published' and fin_private.fold_text(d.title) like '%' || fin_private.fold_text(coalesce(p->>'title', '')) || '%';
    if v_n = 0 then return conv_private.vfail('DOCUMENT_NOT_FOUND', 'Não achei documento publicado com esse nome.'); end if;
    if v_n > 1 then return conv_private.vfail('DOCUMENT_AMBIGUOUS', 'Achei mais de um: ' || v_list || '. Qual deles?'); end if;
    select d.notifications_failed into v_n from public.sig_documents_overview d where d.id = v_id2;
    if coalesce(v_n, 0) = 0 then return conv_private.vfail('NOTHING_TO_RESEND', 'Esse documento não tem aviso com falha para reenviar.'); end if;
    v_payload := jsonb_build_object('document_id', v_id2, 'title', v_title, 'failed_count', v_n);

  elsif v_action = 'adm_reservation_cancel' then
    v_date := nullif(p->>'date', '')::date; v_start := nullif(p->>'start', '')::time; v_court := nullif(trim(coalesce(p->>'court_label', '')), '');
    if v_date is null or v_start is null then return conv_private.vfail('INVALID_DATA', 'Qual dia e horário de início da reserva?'); end if;
    select count(*), min(r.id::text)::uuid into v_n, v_id2 from public.reservations r join public.courts c on c.id = r.court_id
    where r.date = v_date and r.start_time = v_start and coalesce(r.status::text, 'active') = 'active'
      and (v_court is null or fin_private.fold_text(c.name) like '%' || fin_private.fold_text(v_court) || '%')
      and (nullif(trim(coalesce(p->>'by_name', '')), '') is null or exists (
        select 1 from public.profiles pr where pr.id = r.creator_id and fin_private.fold_text(pr.name) like '%' || fin_private.fold_text(p->>'by_name') || '%')
        or fin_private.fold_text(coalesce(r.guest_name, '')) like '%' || fin_private.fold_text(coalesce(p->>'by_name', '')) || '%');
    if v_n = 0 then return conv_private.vfail('RESERVATION_NOT_FOUND', 'Não achei reserva ativa nesse dia e horário.'); end if;
    if v_n > 1 then return conv_private.vfail('RESERVATION_AMBIGUOUS', 'Há ' || v_n || ' reservas nesse horário. Me diga a quadra ou quem reservou.'); end if;
    select jsonb_build_object('reservation_id', r.id, 'court', c.name, 'date', r.date, 'start', to_char(r.start_time, 'HH24:MI'),
      'end', to_char(r.end_time, 'HH24:MI'), 'type', r.type, 'by', coalesce(pr.name, r.guest_name),
      'reason', nullif(trim(coalesce(p->>'reason', '')), ''))
      into v_payload from public.reservations r join public.courts c on c.id = r.court_id left join public.profiles pr on pr.id = r.creator_id
    where r.id = v_id2;
    v_payload := jsonb_strip_nulls(v_payload);
  else
    return conv_private.vfail('INVALID_ACTION', 'Ação inválida.');
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, v_action, v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data, hora ou valor).');
end $$;

create function public.conv_svc_ai_admin_adm_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_adm_propose(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- execução
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_wave2_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text; v_n int;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not like 'adm\_%' then return conv_private.ai_confirm_wave2_step(p_proposal, p_message); end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'adm_announcement_create' then
      insert into public.announcements(title, message, show_once, expires_at, is_active)
      values (bp.payload->>'title', bp.payload->>'message', coalesce((bp.payload->>'show_once')::boolean, false),
        case when bp.payload->>'expires_on' is null then null else ((bp.payload->>'expires_on') || ' 23:59:59-03')::timestamptz end, true)
      returning jsonb_build_object('id', id) into v_res;
    elsif bp.action = 'adm_announcement_deactivate' then
      update public.announcements set is_active = false, updated_at = now() where id = (bp.payload->>'announcement_id')::uuid and coalesce(is_active, true);
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'ANNOUNCEMENT_NOT_FOUND'; end if;
      v_res := jsonb_build_object('id', bp.payload->>'announcement_id');
    elsif bp.action = 'adm_student_status' then
      update public.student_profiles set student_status = bp.payload->>'status' where id = (bp.payload->>'student_profile_id')::uuid;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'STUDENT_NOT_FOUND'; end if;
      v_res := jsonb_build_object('id', bp.payload->>'student_profile_id');
    elsif bp.action = 'adm_member_status' then
      update public.profiles set is_active = (bp.payload->>'active')::boolean where id = (bp.payload->>'profile_id')::uuid and role::text <> 'admin';
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'MEMBER_NOT_FOUND'; end if;
      v_res := jsonb_build_object('id', bp.payload->>'profile_id');
    elsif bp.action = 'adm_signature_resend' then
      v_res := jsonb_build_object('id', bp.payload->>'document_id', 'resent', public.sig_resend_failed((bp.payload->>'document_id')::uuid));
    else
      update public.reservations set status = 'cancelled', updated_at = now() where id = (bp.payload->>'reservation_id')::uuid and coalesce(status::text, 'active') = 'active';
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'RESERVATION_NOT_FOUND'; end if;
      v_res := jsonb_build_object('id', bp.payload->>'reservation_id');
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'Não consegui concluir: ' || v_code || '.');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_booking_proposals', bp.id::text, null,
    jsonb_build_object('action', bp.action, 'target', coalesce(v_res->>'id', bp.payload->>'profile_id')),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.ai_admin_adm_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_adm_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_adm_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_wave2_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
