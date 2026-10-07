-- Onda 6 do assessor administrativo (financeiro, N2): aprovar comprovante e gerar as cobranças do mês. Mesmo protocolo
-- (proposta com resumo → "sim" → segunda confirmação a partir de R$ 400 → grava pelas MESMAS funções do painel,
-- fin_approve_receipt e fin_generate_member_charges, como o administrador). Aprovar pede o valor lido no comprovante e
-- o distribui pelas cobranças em aberto do sócio, da mais antiga para a mais nova; sobra ou valor ilegível seguem só no painel.

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['fin_receipt_approve', 'fin_charges_generate'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- ---------------------------------------------------------------------------------------------- proposta
alter function conv_private.ai_admin_finance_propose(uuid, jsonb) rename to ai_admin_finance_propose_w2;

create function conv_private.ai_admin_finance_propose_w6(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_action text := p->>'action';
  v_payload jsonb; v_id uuid; v_today date := conv_private.today(); v_profile uuid; v_date date; v_n int; v_sub record; v_name text;
  v_paid_on date; v_method text; v_acc_id uuid; v_acc_name text; v_acc_n int; v_acc_list text;
  v_left bigint; v_take bigint; v_total bigint := 0; v_alloc jsonb := '[]'::jsonb; v_open bigint := 0; ch record; v_due bigint;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  if v_action = 'fin_receipt_approve' then
    v_profile := nullif(p->>'profile_id', '')::uuid;
    v_date := nullif(p->>'receipt_date', '')::date;
    select count(*) into v_n from public.fin_receipt_submissions r
    where r.profile_id = v_profile and r.status in ('submitted', 'in_review')
      and (v_date is null or (r.created_at at time zone 'America/Fortaleza')::date = v_date);
    if v_n = 0 then return conv_private.vfail('RECEIPT_NOT_FOUND', 'Não achei comprovante pendente desse sócio.'); end if;
    if v_n > 1 then
      return conv_private.vfail('RECEIPT_AMBIGUOUS', 'Esse sócio tem ' || v_n || ' comprovantes pendentes. De qual dia é o que você quer aprovar?');
    end if;
    select r.id, r.declared_amount_cents, r.declared_paid_on, r.created_at into v_sub from public.fin_receipt_submissions r
    where r.profile_id = v_profile and r.status in ('submitted', 'in_review')
      and (v_date is null or (r.created_at at time zone 'America/Fortaleza')::date = v_date);
    if v_sub.declared_amount_cents is null or v_sub.declared_amount_cents <= 0 then
      return conv_private.vfail('RECEIPT_AMOUNT_UNKNOWN', 'Não consegui ler o valor desse comprovante. Aprove pelo painel (Financeiro), onde você confere a imagem.');
    end if;
    select name into v_name from public.profiles where id = v_profile;
    v_paid_on := coalesce(nullif(p->>'paid_on', '')::date, v_sub.declared_paid_on, v_today);
    if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento não pode ser no futuro.'); end if;
    v_method := coalesce(nullif(p->>'method', ''), 'pix');
    if v_method not in ('pix', 'transfer', 'cash', 'card', 'other') then v_method := 'pix'; end if;

    -- Conta pelo nome; sem nome vale a conta padrão de recebimentos (ou a única ativa).
    select string_agg(a.name, ', ' order by a.position, a.name) into v_acc_list from public.fin_accounts a where a.active;
    if nullif(trim(coalesce(p->>'account_name', '')), '') is not null then
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a
      where a.active and fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'account_name') || '%';
    else
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active and a.is_default_receipts;
      if v_acc_n <> 1 then select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active; end if;
    end if;
    if v_acc_n <> 1 then
      return conv_private.vfail('ACCOUNT_REQUIRED', 'Em qual conta entrou? Contas: ' || coalesce(v_acc_list, '(nenhuma ativa)') || '.');
    end if;
    select name into v_acc_name from public.fin_accounts where id = v_acc_id;

    -- Distribuição: cobranças em aberto do sócio, da mais antiga para a mais nova, pelo saldo na data do pagamento.
    v_left := v_sub.declared_amount_cents;
    for ch in select c.id, c.description, c.due_date from public.fin_member_charges c
              where c.profile_id = v_profile and c.status in ('open', 'partial') order by c.due_date, c.created_at loop
      select st.total_due into v_due from fin_private.charge_statement(ch.id, v_paid_on) st;
      if coalesce(v_due, 0) <= 0 then continue; end if;
      v_open := v_open + v_due;
      if v_left > 0 then
        v_take := least(v_left, v_due);
        v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('charge_id', ch.id, 'amount_cents', v_take,
          'description', coalesce(ch.description, 'Mensalidade'), 'due_date', ch.due_date));
        v_left := v_left - v_take; v_total := v_total + v_take;
      end if;
    end loop;
    if jsonb_array_length(v_alloc) = 0 then
      return conv_private.vfail('NO_OPEN_CHARGES', 'Esse sócio não tem cobrança em aberto para receber esse comprovante. Veja no painel (Financeiro).');
    end if;
    if v_left > 0 then
      return conv_private.vfail('RECEIPT_EXCEEDS_OPEN', 'O comprovante (R$ ' || replace(trim(to_char(v_sub.declared_amount_cents::numeric / 100, 'FM999999990D00')), '.', ',')
        || ') passa do que esse sócio tem em aberto (R$ ' || replace(trim(to_char(v_open::numeric / 100, 'FM999999990D00')), '.', ',')
        || '). A sobra é tratada no painel (Financeiro).');
    end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object('submission_id', v_sub.id, 'profile_id', v_profile, 'member_name', v_name,
      'amount_cents', v_total, 'paid_on', v_paid_on, 'method', v_method, 'account_id', v_acc_id, 'account_name', v_acc_name,
      'sent_on', (v_sub.created_at at time zone 'America/Fortaleza')::date, 'allocations', v_alloc));

  elsif v_action = 'fin_charges_generate' then
    select count(*) into v_n from public.fin_member_plans where status = 'active';
    if v_n = 0 then return conv_private.vfail('NO_ACTIVE_PLANS', 'Não há plano de sócio ativo para gerar cobrança.'); end if;
    v_payload := jsonb_build_object('plans_count', v_n);
  else
    return conv_private.ai_admin_finance_propose_w2(p_session, p);
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

create function conv_private.ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_finance_propose_w6(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- execução
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_wave3_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_receipt_approve', 'fin_charges_generate') then
    return conv_private.ai_confirm_wave3_step(p_proposal, p_message);
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

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'fin_receipt_approve' then
      v_res := public.fin_approve_receipt(bp.request_key, (bp.payload->>'submission_id')::uuid, jsonb_build_object(
        'paid_on', bp.payload->>'paid_on', 'method', bp.payload->>'method', 'account_id', bp.payload->>'account_id',
        'note', 'Aprovado pelo João (WhatsApp)',
        'allocations', (select jsonb_agg(jsonb_build_object('charge_id', a->>'charge_id', 'amount_cents', (a->>'amount_cents')::bigint))
                        from jsonb_array_elements(bp.payload->'allocations') a)));
    else
      v_res := public.fin_generate_member_charges(bp.request_key, null, null);
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
  perform conv_private.audit('ai_admin_finance', 'fin_receipt_submissions', coalesce(bp.payload->>'submission_id', bp.id::text), null,
    jsonb_build_object('action', bp.action, 'amount_cents', bp.payload->'amount_cents'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.ai_admin_finance_propose_w2(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose_w6(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_wave3_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
