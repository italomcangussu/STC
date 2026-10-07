-- Onda 7 do assessor administrativo (pessoas): recusar pedido de acesso (N1) e cadastrar sócio novo, seja por pedido
-- de acesso aprovado ou por cadastro direto (N2). Regra do clube: sócio novo entra com a mensalidade do mês de entrada
-- PAGA, comprovada por imagem enviada na conversa; sem comprovante o João não propõe nada. Depois do "sim" (e da segunda
-- confirmação a partir de R$ 400, porque a ação é `fin_`), o servidor cria o usuário no Auth (função de borda, que o
-- banco não alcança) e chama `conv_svc_ai_admin_member_onboard`, que — como o administrador, pelas MESMAS funções do
-- painel — cria o plano, gera a cobrança do mês, move o comprovante para o novo sócio e o aprova (juros do mês de
-- entrada dispensados). Cada passo é idempotente: se algo falhar, o "sim" pode ser repetido até a proposta vencer.

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['fin_member_create', 'fin_access_approve', 'adm_access_reject'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- Mesmo critério de telefone do painel (admin-athlete-access): só dígitos, sem 55, até 11 dígitos.
create function conv_private.br_local_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '55%' and length(d) >= 12 then d := substr(d, 3); end if;
  if length(d) > 11 then d := right(d, 11); end if;
  return d;
end $$;

-- ---------------------------------------------------------------------------------------------- proposta
create function conv_private.ai_admin_access_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; fs public.fin_settings%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_id uuid; v_payload jsonb; v_today date := conv_private.today();
  v_req_id uuid; v_n int; v_list text; v_name text; v_phone text; v_email text; v_amount bigint; v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_prof record; v_sub record; v_payee text; v_paid_on date; v_acc_id uuid; v_acc_name text; v_acc_n int; v_acc_list text; v_reactivate boolean := false;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if v_action not in ('fin_member_create', 'fin_access_approve', 'adm_access_reject') then
    return conv_private.vfail('INVALID_ACTION', 'Ação inválida.');
  end if;

  -- Pedido de acesso pendente (aprovar/recusar), por nome; sem nome vale o único pendente.
  if v_action in ('fin_access_approve', 'adm_access_reject') then
    select count(*) into v_n from public.access_requests a
    where a.status = 'pending' and (nullif(trim(coalesce(p->>'name', '')), '') is null
      or fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'name') || '%');
    if v_n = 0 then return conv_private.vfail('ACCESS_NOT_FOUND', 'Não achei pedido de acesso pendente' ||
      case when nullif(trim(coalesce(p->>'name', '')), '') is null then '.' else ' com esse nome.' end); end if;
    if v_n > 1 then
      select string_agg(a.name, ', ' order by a.created_at) into v_list from (
        select a0.name, a0.created_at from public.access_requests a0 where a0.status = 'pending' and (nullif(trim(coalesce(p->>'name', '')), '') is null
          or fin_private.fold_text(a0.name) like '%' || fin_private.fold_text(p->>'name') || '%') order by a0.created_at limit 8) a;
      return conv_private.vfail('ACCESS_AMBIGUOUS', 'Tem mais de um pedido pendente: ' || v_list || '. Qual deles?');
    end if;
    select a.id, a.name, conv_private.br_local_phone(a.phone_normalized), nullif(trim(coalesce(a.email, '')), '')
      into v_req_id, v_name, v_phone, v_email from public.access_requests a
    where a.status = 'pending' and (nullif(trim(coalesce(p->>'name', '')), '') is null
      or fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'name') || '%');
  else
    v_name := trim(coalesce(p->>'name', ''));
    v_phone := conv_private.br_local_phone(p->>'phone');
    v_email := lower(nullif(trim(coalesce(p->>'email', '')), ''));
  end if;

  if v_action = 'adm_access_reject' then
    v_payload := jsonb_strip_nulls(jsonb_build_object('request_id', v_req_id, 'name', v_name, 'phone', v_phone, 'reason', v_reason));
  else
    if length(v_name) < 3 then return conv_private.vfail('INVALID_NAME', 'Qual o nome completo do sócio?'); end if;
    if length(v_phone) not between 10 and 11 then return conv_private.vfail('INVALID_PHONE', 'Qual o telefone com DDD? (ex.: 88 99999-9999)'); end if;
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return conv_private.vfail('INVALID_EMAIL', 'Esse e-mail não parece válido. Qual o e-mail certo, ou deixo sem?'); end if;
    v_amount := nullif(p->>'amount_cents', '')::bigint;
    if v_amount is null or v_amount <= 0 or v_amount > 100000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual o valor da mensalidade dele?'); end if;

    -- Telefone já cadastrado: só reativa quem já é sócio; outro papel (professor, admin) fica no painel.
    select pr.id, pr.name, pr.role::text role, pr.is_active into v_prof from public.profiles pr where pr.phone = v_phone limit 1;
    if v_prof.id is not null then
      if v_prof.role <> 'socio' then
        return conv_private.vfail('PHONE_BELONGS', 'Esse telefone já é de ' || v_prof.name || ' (' || v_prof.role || '). Isso eu não mudo por aqui; use o painel.');
      end if;
      if v_prof.is_active then return conv_private.vfail('MEMBER_EXISTS', v_prof.name || ' já é sócio ativo.'); end if;
      if exists (select 1 from public.fin_member_plans where profile_id = v_prof.id and status <> 'ended') then
        return conv_private.vfail('PLAN_EXISTS', v_prof.name || ' já tem plano de sócio. Reative e acerte a mensalidade pelo painel.');
      end if;
      v_reactivate := true;
    end if;

    -- Comprovante da mensalidade: imagem que o administrador mandou nesta conversa nas últimas horas e ainda não foi usada.
    select r.id, r.declared_amount_cents, r.declared_paid_on, r.ocr, r.created_at into v_sub from public.fin_receipt_submissions r
    join public.conv_messages m on m.id = r.source_message_id
    where m.conversation_id = sess.conversation_id and r.profile_id = v_admin and r.status in ('submitted', 'in_review')
      and r.created_at > now() - interval '6 hours'
    order by r.created_at desc limit 1;
    if v_sub.id is null then
      return conv_private.vfail('RECEIPT_REQUIRED', 'Para cadastrar o sócio preciso do comprovante de pagamento da mensalidade deste mês. Mande a imagem ou o PDF aqui e me diga para continuar.');
    end if;
    if v_sub.declared_amount_cents is not null and v_sub.declared_amount_cents <> v_amount then
      return conv_private.vfail('RECEIPT_AMOUNT_MISMATCH', 'O comprovante mostra R$ ' || replace(trim(to_char(v_sub.declared_amount_cents::numeric / 100, 'FM999999990D00')), '.', ',')
        || ', mas a mensalidade informada é R$ ' || replace(trim(to_char(v_amount::numeric / 100, 'FM999999990D00')), '.', ',') || '. Qual vale?');
    end if;
    select * into fs from public.fin_settings where id;
    v_payee := nullif(trim(coalesce(v_sub.ocr->>'payee', '')), '');
    if v_payee is not null and not fin_private.payee_matches(v_payee, fs.payee_names) then
      return conv_private.vfail('RECEIPT_PAYEE', 'O favorecido do comprovante (' || v_payee || ') não bate com o clube. Confira a imagem; se estiver certo, cadastre pelo painel.');
    end if;
    v_paid_on := coalesce(v_sub.declared_paid_on, v_today);
    if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento no comprovante é futura. Confira a imagem.'); end if;

    -- Conta que recebeu: a padrão de recebimentos (ou a única ativa), como na aprovação de comprovante.
    select string_agg(a.name, ', ' order by a.position, a.name) into v_acc_list from public.fin_accounts a where a.active;
    if nullif(trim(coalesce(p->>'account_name', '')), '') is not null then
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a
      where a.active and fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'account_name') || '%';
    else
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active and a.is_default_receipts;
      if v_acc_n <> 1 then select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active; end if;
    end if;
    if v_acc_n <> 1 then return conv_private.vfail('ACCOUNT_REQUIRED', 'Em qual conta entrou? Contas: ' || coalesce(v_acc_list, '(nenhuma ativa)') || '.'); end if;
    select name into v_acc_name from public.fin_accounts where id = v_acc_id;

    v_payload := jsonb_strip_nulls(jsonb_build_object('request_id', v_req_id, 'name', v_name, 'phone', v_phone, 'email', v_email,
      'amount_cents', v_amount, 'submission_id', v_sub.id, 'paid_on', v_paid_on, 'account_id', v_acc_id, 'account_name', v_acc_name,
      'month', date_trunc('month', v_today::timestamp)::date, 'amount_read', v_sub.declared_amount_cents is not null, 'reactivate', v_reactivate));
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, v_action, v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi.');
end $$;

create function public.conv_svc_ai_admin_access_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_access_propose(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- confirmação
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_wave6_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_err text; v_code text; v_n int;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_member_create', 'fin_access_approve', 'adm_access_reject') then
    return conv_private.ai_confirm_wave6_step(p_proposal, p_message);
  end if;
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

  -- Cadastro: o servidor cria o usuário no Auth e depois chama conv_svc_ai_admin_member_onboard (a proposta segue aberta até lá).
  if bp.action <> 'adm_access_reject' then
    -- Marca que a confirmação (e a segunda, de R$ 400 em diante) já passou: só então o cadastro pode ser concluído.
    update public.conv_booking_proposals set payload = payload || jsonb_build_object('cleared', true, 'cleared_message_id', m.id) where id = bp.id;
    return jsonb_build_object('ok', true, 'needs_provision', true, 'action', bp.action, 'proposal_id', bp.id, 'summary', bp.payload);
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    update public.access_requests set status = 'rejected', rejection_reason = bp.payload->>'reason', decided_by = v_admin, decided_at = now()
    where id = (bp.payload->>'request_id')::uuid and status = 'pending';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'ACCESS_NOT_FOUND'; end if;
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
    confirmed_by_contact_id = m.sender_contact_id where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'access_requests', bp.payload->>'request_id', null,
    jsonb_build_object('action', bp.action, 'target', bp.payload->>'name'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload);
end $$;

-- ---------------------------------------------------------------------------------------------- cadastro (depois do Auth)
create function conv_private.ai_member_onboard(p_proposal uuid, p_profile uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; pr public.profiles%rowtype;
  v_prev_claims text; v_prev_sub text; v_err text; v_code text; v_today date := conv_private.today();
  v_month date; v_amount bigint; v_plan uuid; v_charge uuid; v_remaining bigint; v_fees bigint; v_status text; v_sub_status text;
  v_sub uuid; v_paid_on date; v_alloc jsonb; v_waivers jsonb := '[]'::jsonb; v_res jsonb := '{}'::jsonb;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_member_create', 'fin_access_approve') then
    return conv_private.vfail('INVALID_ACTION', 'Proposta inválida.');
  end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' or bp.expires_at <= now() then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id
    and sender_contact_id = bp.requester_contact_id;
  if not found or m.created_at <= bp.created_at or coalesce((bp.payload->>'cleared')::boolean, false) is not true
     or (bp.payload->>'cleared_message_id')::uuid is distinct from m.id then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select * into pr from public.profiles where id = p_profile;
  if not found or pr.role::text <> 'socio' or not coalesce(pr.is_active, false) or conv_private.br_local_phone(pr.phone) <> bp.payload->>'phone' then
    return conv_private.vfail('PROFILE_MISMATCH', 'O cadastro criado não confere com o pedido. Confira no painel.');
  end if;

  v_amount := (bp.payload->>'amount_cents')::bigint;
  v_month := (bp.payload->>'month')::date;
  v_sub := (bp.payload->>'submission_id')::uuid;
  v_paid_on := (bp.payload->>'paid_on')::date;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    -- 1) plano de sócio com a mensalidade informada, desde o início do mês de entrada
    select id into v_plan from public.fin_member_plans where profile_id = p_profile and status <> 'ended' limit 1;
    if v_plan is null then
      v_res := public.fin_create_member_plan(md5(bp.id::text || 'plan')::uuid,
        jsonb_build_object('profile_id', p_profile, 'start_on', v_month, 'amount_cents', v_amount));
      v_plan := (v_res->>'id')::uuid;
    end if;
    -- 2) cobranças (idempotente)
    perform public.fin_generate_member_charges(md5(bp.id::text || 'gen')::uuid, v_plan, v_today);
    select c.id, c.status into v_charge, v_status from public.fin_member_charges c
    where c.plan_id = v_plan and c.competence_month = v_month and c.status <> 'canceled';
    if v_charge is null then raise exception 'CHARGE_NOT_GENERATED'; end if;
    -- 3) comprovante para o novo sócio e aprovação com baixa total do mês (juros do mês de entrada dispensados)
    select status into v_sub_status from public.fin_receipt_submissions where id = v_sub;
    if v_sub_status is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
    if v_sub_status in ('submitted', 'in_review') then
      select st.principal_remaining, st.fees_due into v_remaining, v_fees from fin_private.charge_statement(v_charge, v_paid_on) st;
      if v_remaining <> v_amount then raise exception 'AMOUNT_MISMATCH'; end if;
      update public.fin_receipt_submissions set profile_id = p_profile, updated_at = now() where id = v_sub;
      if coalesce(v_fees, 0) > 0 then
        v_waivers := jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_fees,
          'reason', 'Sócio novo: mensalidade do mês de entrada'));
      end if;
      v_alloc := jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_amount));
      v_res := public.fin_approve_receipt(md5(bp.id::text || 'approve')::uuid, v_sub, jsonb_build_object(
        'paid_on', v_paid_on, 'method', 'pix', 'account_id', bp.payload->>'account_id', 'allocations', v_alloc, 'waivers', v_waivers,
        'note', 'Sócio novo cadastrado pelo João (WhatsApp)'));
    elsif v_sub_status <> 'approved' then
      raise exception 'RECEIPT_NOT_PENDING';
    end if;
    -- 4) pedido(s) de acesso deste telefone
    update public.access_requests set status = 'approved', rejection_reason = null, decided_by = v_admin, decided_at = now()
    where status = 'pending' and (id = nullif(bp.payload->>'request_id', '')::uuid or phone_normalized = bp.payload->>'phone');
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ONBOARD_FAILED' end;
    return conv_private.vfail(v_code, 'O cadastro de ' || (bp.payload->>'name') || ' foi criado, mas não consegui concluir a mensalidade (' || v_code
      || '). Confira no painel (Financeiro) ou me peça de novo com "sim".');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('profile_id', p_profile) where id = bp.id;
  perform conv_private.audit('ai_admin_finance', 'profiles', p_profile::text, null,
    jsonb_build_object('action', bp.action, 'amount_cents', v_amount, 'name', bp.payload->>'name'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('profile_id', p_profile));
end $$;

create function public.conv_svc_ai_admin_member_onboard(p_proposal uuid, p_profile uuid, p_message uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_member_onboard(p_proposal, p_profile, p_message) $$;

revoke all on function conv_private.br_local_phone(text) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_access_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_access_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_access_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_wave6_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_member_onboard(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_member_onboard(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_member_onboard(uuid, uuid, uuid) to service_role;

-- Grupos do clube onde o João dá as boas-vindas a sócio novo: os liberados (status 'allowed') com a IA ligada.
-- Abre a conversa do grupo se ainda não existir (é por ela que a mensagem sai).
create function public.conv_svc_welcome_groups() returns table(conversation_id uuid, group_name text)
language sql volatile security definer set search_path = '' as $$
  select conv_private.open_group(g.id), g.name from public.conv_groups g where g.status = 'allowed' and g.ai_enabled order by g.name $$;
revoke all on function public.conv_svc_welcome_groups() from public, anon, authenticated;
grant execute on function public.conv_svc_welcome_groups() to service_role;
