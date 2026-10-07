-- Assessor administrativo do João: na conversa PRIVADA com um administrador, o João pode lançar pendência de sócio,
-- cobrar agora, pausar/retomar a régua e dar baixa manual. Mesmo fluxo das reservas: proposta com resumo → "sim" do
-- próprio administrador → grava pelas MESMAS funções do app (fin_*), executadas com a identidade do administrador
-- (mesmas validações, idempotência pela request_key da proposta e auditoria). Grupo e sócio comum: recusado no banco.

do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
end $$;
alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action in (
  'create', 'cancel', 'reschedule', 'join', 'participants',
  'fin_pendency_create', 'fin_pendency_collection', 'fin_pendency_send', 'fin_payment'));

/** Administrador ativo, falando com o João em conversa direta pelo próprio telefone vinculado. Senão, null. */
create or replace function conv_private.ai_admin_requester(p_session uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.profile_id
  from public.conv_ai_sessions s
  join public.conv_conversations cv on cv.id = s.conversation_id and cv.kind = 'direct'
  join public.conv_contacts c on c.id = s.requester_contact_id and c.link_status in ('linked', 'manual')
  join public.profiles p on p.id = c.profile_id and p.role::text = 'admin' and coalesce(p.is_active, true)
  where s.id = p_session
$$;

create or replace function conv_private.ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; ch public.fin_member_charges%rowtype;
  v_admin uuid; v_action text := coalesce(p->>'action', ''); v_payload jsonb; v_id uuid; v_today date := conv_private.today();
  v_profile uuid; v_name text; v_desc text; v_amount bigint; v_due date; v_kind text; v_enabled boolean;
  v_total bigint; v_open int; v_paid_on date; v_method text; v_acc_id uuid; v_acc_name text; v_acc_n int; v_acc_list text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if v_action not in ('fin_pendency_create', 'fin_pendency_collection', 'fin_pendency_send', 'fin_payment') then
    return conv_private.vfail('INVALID_ACTION', 'Ação inválida.');
  end if;

  if v_action = 'fin_pendency_create' then
    v_profile := nullif(p->>'profile_id', '')::uuid;
    if v_profile is null or not fin_private.is_active_member(v_profile) then
      return conv_private.vfail('MEMBER_NOT_ACTIVE', 'Não achei esse sócio ativo no cadastro.');
    end if;
    select name into v_name from public.profiles where id = v_profile;
    v_desc := trim(coalesce(p->>'description', ''));
    if length(v_desc) not between 3 and 300 then return conv_private.vfail('INVALID_DESCRIPTION', 'Qual é a descrição da pendência?'); end if;
    v_amount := nullif(p->>'amount_cents', '')::bigint;
    if v_amount is null or v_amount <= 0 or v_amount > 1000000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual é o valor?'); end if;
    v_due := coalesce(nullif(p->>'due_date', '')::date, v_today);
    v_kind := coalesce(nullif(p->>'pendency_kind', ''), 'outros');
    if v_kind not in ('day_card', 'consumo', 'evento', 'multa', 'dano_reposicao', 'outros') then v_kind := 'outros'; end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'profile_id', v_profile, 'member_name', v_name, 'description', v_desc, 'amount_cents', v_amount,
      'due_date', v_due, 'competence_month', date_trunc('month', v_due)::date, 'pendency_kind', v_kind,
      'guest_name', nullif(trim(coalesce(p->>'guest_name', '')), ''), 'guest_date', nullif(p->>'guest_date', '')::date,
      'collection_enabled', true, 'send_now', coalesce((p->>'send_now')::boolean, false)));

  elsif v_action in ('fin_pendency_collection', 'fin_pendency_send', 'fin_payment') then
    -- Pendência pela referência (id) ou, para cobrar, pelo sócio: a mais antiga em aberto com cobrança ligada.
    if nullif(p->>'charge_id', '') is not null then
      select * into ch from public.fin_member_charges where id = (p->>'charge_id')::uuid and charge_type = 'member_pendency';
    elsif v_action = 'fin_pendency_send' and nullif(p->>'profile_id', '') is not null then
      select * into ch from public.fin_member_charges
      where profile_id = (p->>'profile_id')::uuid and charge_type = 'member_pendency' and status in ('open', 'partial') and collection_enabled
      order by due_date, created_at limit 1;
    end if;
    if ch.id is null then return conv_private.vfail('PENDENCY_NOT_FOUND', 'Não achei essa pendência.'); end if;
    if ch.status not in ('open', 'partial') then return conv_private.vfail('PENDENCY_NOT_OPEN', 'Essa pendência não está em aberto.'); end if;
    select name into v_name from public.profiles where id = ch.profile_id;
    select st.total_due into v_total from fin_private.charge_statement(ch.id, v_today) st;
    v_payload := jsonb_build_object('charge_id', ch.id, 'profile_id', ch.profile_id, 'member_name', v_name,
      'description', ch.description, 'due_date', ch.due_date, 'total_due_cents', v_total);

    if v_action = 'fin_pendency_collection' then
      v_enabled := (p->>'enabled')::boolean;
      if v_enabled is null then return conv_private.vfail('INVALID_DATA', 'Quer pausar ou retomar a cobrança?'); end if;
      if ch.collection_enabled = v_enabled then
        return conv_private.vfail('ALREADY_SET', case when v_enabled then 'A cobrança dessa pendência já está ativa.' else 'A cobrança dessa pendência já está pausada.' end);
      end if;
      v_payload := v_payload || jsonb_build_object('enabled', v_enabled);

    elsif v_action = 'fin_pendency_send' then
      if not ch.collection_enabled then return conv_private.vfail('COLLECTION_PAUSED', 'A cobrança dessa pendência está pausada. Quer retomar antes?'); end if;
      select count(*), coalesce(sum(st.total_due), 0) into v_open, v_total
      from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_today) st
      where c.profile_id = ch.profile_id and c.charge_type = 'member_pendency' and c.status in ('open', 'partial') and c.collection_enabled;
      v_payload := v_payload || jsonb_build_object('open_count', v_open, 'member_total_due_cents', v_total);

    else
      v_amount := nullif(p->>'amount_cents', '')::bigint;
      if v_amount is null or v_amount <= 0 or v_amount > 1000000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual valor foi pago?'); end if;
      v_paid_on := coalesce(nullif(p->>'paid_on', '')::date, v_today);
      if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento não pode ser no futuro.'); end if;
      v_method := coalesce(nullif(p->>'method', ''), 'pix');
      if v_method not in ('pix', 'transfer', 'cash', 'card', 'other') then v_method := 'other'; end if;
      select string_agg(a.name, ', ' order by a.position, a.name) into v_acc_list from public.fin_accounts a where a.active;
      if nullif(trim(coalesce(p->>'account_name', '')), '') is not null then
        select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a
        where a.active and fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'account_name') || '%';
      else
        select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active and a.is_default_receipts;
        if v_acc_n <> 1 then select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active; end if;
      end if;
      if v_acc_n <> 1 then
        return conv_private.vfail('ACCOUNT_REQUIRED', 'Em qual conta entrou o dinheiro? Contas: ' || coalesce(v_acc_list, '(nenhuma ativa)') || '.');
      end if;
      select name into v_acc_name from public.fin_accounts where id = v_acc_id;
      v_payload := v_payload || jsonb_build_object('amount_cents', v_amount, 'paid_on', v_paid_on, 'method', v_method,
        'account_id', v_acc_id, 'account_name', v_acc_name, 'excess_cents', greatest(v_amount - coalesce(v_total, 0), 0));
    end if;
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, v_action, v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data ou valor).');
end $$;

-- A confirmação das reservas continua igual; as ações financeiras ganham um ramo próprio antes dela.
alter function conv_private.ai_confirm(uuid, uuid) rename to ai_confirm_booking;

create function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text; v_conv public.conv_conversations%rowtype;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not like 'fin\_%' then return conv_private.ai_confirm_booking(p_proposal, p_message); end if;
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
  -- Só o próprio administrador que pediu confirma (nada de outro admin confirmar por ele).
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  -- Executa como o administrador: as funções do app checam o papel por auth.uid().
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'fin_pendency_create' then
      v_res := public.fin_create_member_pendency(bp.request_key, bp.payload - 'member_name');
    elsif bp.action = 'fin_pendency_collection' then
      v_res := public.fin_set_pendency_collection(bp.request_key, (bp.payload->>'charge_id')::uuid, (bp.payload->>'enabled')::boolean);
    elsif bp.action = 'fin_pendency_send' then
      v_res := public.fin_send_pendency_now(bp.request_key, (bp.payload->>'charge_id')::uuid);
    else
      v_res := public.fin_register_payment(bp.request_key, (bp.payload->>'charge_id')::uuid, (bp.payload->>'amount_cents')::bigint,
        (bp.payload->>'paid_on')::date, bp.payload->>'method', (bp.payload->>'account_id')::uuid, 'Baixa pelo WhatsApp (João)');
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'FINANCE_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'O financeiro recusou: ' || v_code || '.');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  select * into v_conv from public.conv_conversations where id = bp.conversation_id;
  perform conv_private.audit('ai_admin_finance', 'fin_member_charges', coalesce(v_res->>'id', bp.payload->>'charge_id'), null,
    jsonb_build_object('action', bp.action, 'amount_cents', bp.payload->'amount_cents', 'enabled', bp.payload->'enabled'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

create or replace function public.conv_svc_ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_finance_propose(p_session, p) $$;

revoke all on function conv_private.ai_admin_requester(uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) to service_role;
