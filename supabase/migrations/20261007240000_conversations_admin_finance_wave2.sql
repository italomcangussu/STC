-- Onda 2 do assessor administrativo (financeiro completo, N2): cancelar e ajustar cobrança, estornar o último
-- pagamento, rejeitar comprovante e lançar despesa/receita. Mesmo protocolo das ações atuais: proposta com resumo
-- → "sim" do próprio administrador (segunda confirmação a partir de R$ 400, regra de 20261007210000) → grava pelas
-- MESMAS funções do painel (fin_*), com a identidade do administrador e auditoria. Aprovar comprovante e gerar
-- cobranças do mês seguem só no painel (exigem alocação de cobranças/planos).
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
end $$;
alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action in (
  'create', 'cancel', 'reschedule', 'join', 'participants',
  'fin_pendency_create', 'fin_pendency_collection', 'fin_pendency_send', 'fin_payment',
  'student_card_renew',
  'fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse', 'fin_receipt_reject', 'fin_entry_create'));

-- ---------------------------------------------------------------------------------------------- proposta
alter function conv_private.ai_admin_finance_propose(uuid, jsonb) rename to ai_admin_finance_propose_pendency;

create function conv_private.ai_admin_finance_propose_ext(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; ch public.fin_member_charges%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_payload jsonb; v_id uuid; v_today date := conv_private.today();
  v_name text; v_reason text := trim(coalesce(p->>'reason', '')); v_amount bigint; v_total bigint; v_fees bigint; v_rem bigint;
  v_kind text; v_profile uuid; v_pay_id uuid; v_pay_charge uuid; v_pay_amount bigint; v_pay_on date; v_sub record; v_n int; v_date date; v_desc text; v_status text; v_due date; v_paid_on date;
  v_acc_id uuid; v_acc_name text; v_acc_n int; v_acc_list text; v_cat_id uuid; v_cat_name text; v_cat_n int; v_cat_list text; v_entry text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  if v_action in ('fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse') then
    if length(v_reason) < 5 then return conv_private.vfail('REASON_REQUIRED', 'Qual o motivo? Preciso de uma frase curta para o registro.'); end if;
    if v_action = 'fin_payment_reverse' and nullif(p->>'charge_id', '') is null then
      -- "Estorna o último pagamento do Beto": o mais recente ainda efetivo entre as pendências dele.
      select e.id, e.charge_id, e.amount_cents, e.paid_on into v_pay_id, v_pay_charge, v_pay_amount, v_pay_on
      from fin_private.charge_payments_effective e join public.fin_member_charges c on c.id = e.charge_id
      where c.profile_id = nullif(p->>'profile_id', '')::uuid and c.charge_type = 'member_pendency' and e.kind = 'payment'
        and not exists (select 1 from public.fin_charge_payments r where r.reverses_payment_id = e.id)
      order by e.paid_on desc, e.created_at desc limit 1;
      if v_pay_id is null then return conv_private.vfail('PAYMENT_NOT_FOUND', 'Não achei pagamento desse sócio para estornar.'); end if;
      select * into ch from public.fin_member_charges where id = v_pay_charge;
    elsif nullif(p->>'charge_id', '') is not null then
      select * into ch from public.fin_member_charges where id = (p->>'charge_id')::uuid and charge_type = 'member_pendency';
    end if;
    if ch.id is null then return conv_private.vfail('PENDENCY_NOT_FOUND', 'Não achei essa pendência.'); end if;
    select name into v_name from public.profiles where id = ch.profile_id;
    select st.total_due, st.fees_due, st.principal_remaining into v_total, v_fees, v_rem from fin_private.charge_statement(ch.id, v_today) st;
    v_payload := jsonb_build_object('charge_id', ch.id, 'profile_id', ch.profile_id, 'member_name', v_name, 'description', ch.description,
      'due_date', ch.due_date, 'total_due_cents', v_total, 'reason', v_reason);

    if v_action = 'fin_charge_cancel' then
      if ch.status = 'canceled' then return conv_private.vfail('CHARGE_CANCELED', 'Essa pendência já está cancelada.'); end if;
      if exists (select 1 from fin_private.charge_payments_effective where charge_id = ch.id) then
        return conv_private.vfail('CHARGE_HAS_PAYMENTS', 'Essa pendência já tem pagamento. Dá para ajustar com desconto, ou estornar o pagamento antes.');
      end if;
      v_payload := v_payload || jsonb_build_object('amount_cents', v_total);

    elsif v_action = 'fin_charge_adjust' then
      if ch.status = 'canceled' then return conv_private.vfail('CHARGE_CANCELED', 'Essa pendência está cancelada.'); end if;
      v_kind := p->>'adjust_kind';
      if v_kind not in ('discount', 'increase', 'fee_waiver') then
        return conv_private.vfail('INVALID_ADJUSTMENT', 'É desconto, acréscimo ou perdão de juros/multa?');
      end if;
      v_amount := nullif(p->>'amount_cents', '')::bigint;
      if v_amount is null or v_amount <= 0 or v_amount > 1000000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual o valor do ajuste?'); end if;
      if v_kind = 'discount' and v_amount > v_rem then
        return conv_private.vfail('DISCOUNT_EXCEEDS_BALANCE', 'O desconto passa do valor em aberto (' || trim(to_char(v_rem::numeric / 100, 'FM999999990D00')) || ').');
      end if;
      if v_kind = 'fee_waiver' and v_amount > v_fees then
        return conv_private.vfail('WAIVER_EXCEEDS_FEES', 'Os juros/multa dessa pendência somam menos que isso.');
      end if;
      v_payload := v_payload || jsonb_build_object('adjust_kind', v_kind, 'amount_cents', v_amount);

    else
      if v_pay_id is null then
        select e.id, e.charge_id, e.amount_cents, e.paid_on into v_pay_id, v_pay_charge, v_pay_amount, v_pay_on
        from fin_private.charge_payments_effective e
        where e.charge_id = ch.id and e.kind = 'payment'
          and not exists (select 1 from public.fin_charge_payments r where r.reverses_payment_id = e.id)
        order by e.paid_on desc, e.created_at desc limit 1;
        if v_pay_id is null then return conv_private.vfail('PAYMENT_NOT_FOUND', 'Essa pendência não tem pagamento para estornar.'); end if;
      end if;
      v_payload := v_payload || jsonb_build_object('payment_id', v_pay_id, 'amount_cents', v_pay_amount, 'paid_on', v_pay_on);
    end if;

  elsif v_action = 'fin_receipt_reject' then
    if length(v_reason) < 5 then return conv_private.vfail('REASON_REQUIRED', 'Qual o motivo da recusa? Vai no registro e o sócio pode ver.'); end if;
    v_profile := nullif(p->>'profile_id', '')::uuid;
    v_date := nullif(p->>'receipt_date', '')::date;
    select count(*) into v_n from public.fin_receipt_submissions r
    where r.profile_id = v_profile and r.status in ('submitted', 'in_review')
      and (v_date is null or (r.created_at at time zone 'America/Fortaleza')::date = v_date);
    if v_n = 0 then return conv_private.vfail('RECEIPT_NOT_FOUND', 'Não achei comprovante pendente desse sócio.'); end if;
    if v_n > 1 then
      return conv_private.vfail('RECEIPT_AMBIGUOUS', 'Esse sócio tem ' || v_n || ' comprovantes pendentes. De qual dia é o que você quer recusar?');
    end if;
    select r.id, r.declared_amount_cents, r.created_at, r.declared_paid_on into v_sub from public.fin_receipt_submissions r
    where r.profile_id = v_profile and r.status in ('submitted', 'in_review')
      and (v_date is null or (r.created_at at time zone 'America/Fortaleza')::date = v_date);
    select name into v_name from public.profiles where id = v_profile;
    v_payload := jsonb_strip_nulls(jsonb_build_object('submission_id', v_sub.id, 'profile_id', v_profile, 'member_name', v_name,
      'amount_cents', v_sub.declared_amount_cents, 'sent_on', (v_sub.created_at at time zone 'America/Fortaleza')::date,
      'paid_on', v_sub.declared_paid_on, 'reason', v_reason));

  elsif v_action = 'fin_entry_create' then
    v_entry := p->>'entry_kind';
    if v_entry not in ('expense', 'revenue') then return conv_private.vfail('INVALID_ENTRY', 'É despesa ou receita?'); end if;
    v_desc := trim(coalesce(p->>'description', ''));
    if length(v_desc) not between 2 and 140 then return conv_private.vfail('INVALID_DESCRIPTION', 'Qual a descrição do lançamento?'); end if;
    v_amount := nullif(p->>'amount_cents', '')::bigint;
    if v_amount is null or v_amount <= 0 or v_amount > 100000000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual o valor?'); end if;
    v_status := coalesce(nullif(p->>'entry_status', ''), 'paid');
    if v_status not in ('paid', 'pending') then v_status := 'paid'; end if;
    v_due := nullif(p->>'due_date', '')::date;
    if v_status = 'pending' and v_due is null then return conv_private.vfail('DUE_DATE_REQUIRED', 'Qual o vencimento?'); end if;
    v_paid_on := case when v_status = 'paid' then coalesce(nullif(p->>'paid_on', '')::date, v_today) end;
    if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento não pode ser no futuro.'); end if;
    -- Categoria pelo nome (só categorias ativas do tipo certo; nome ambíguo ou ausente pergunta).
    select count(*), min(c.id::text)::uuid, min(c.name) into v_cat_n, v_cat_id, v_cat_name from public.fin_categories c
    where c.active and c.kind = v_entry and c.parent_id is not null and c.system_key is null
      and nullif(trim(coalesce(p->>'category_name', '')), '') is not null
      and fin_private.fold_text(c.name) like '%' || fin_private.fold_text(p->>'category_name') || '%';
    if v_cat_n <> 1 then
      select string_agg(c.name, ', ' order by c.position, c.name) into v_cat_list from (
        select * from public.fin_categories c0 where c0.active and c0.kind = v_entry and c0.parent_id is not null and c0.system_key is null
        order by c0.position, c0.name limit 14) c;
      return conv_private.vfail('CATEGORY_REQUIRED', 'Em qual categoria? ' || coalesce(v_cat_list, '(nenhuma ativa)') || '.');
    end if;
    -- Conta pelo nome; sem nome vale a conta única/padrão.
    select string_agg(a.name, ', ' order by a.position, a.name) into v_acc_list from public.fin_accounts a where a.active;
    if nullif(trim(coalesce(p->>'account_name', '')), '') is not null then
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a
      where a.active and fin_private.fold_text(a.name) like '%' || fin_private.fold_text(p->>'account_name') || '%';
    else
      select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active and a.is_default_receipts;
      if v_acc_n <> 1 then select count(*), min(a.id::text)::uuid into v_acc_n, v_acc_id from public.fin_accounts a where a.active; end if;
    end if;
    if v_acc_n <> 1 then
      return conv_private.vfail('ACCOUNT_REQUIRED', 'Em qual conta? Contas: ' || coalesce(v_acc_list, '(nenhuma ativa)') || '.');
    end if;
    select name into v_acc_name from public.fin_accounts where id = v_acc_id;
    v_payload := jsonb_strip_nulls(jsonb_build_object('entry_kind', v_entry, 'description', v_desc, 'amount_cents', v_amount,
      'entry_status', v_status, 'due_date', v_due, 'paid_on', v_paid_on, 'category_id', v_cat_id, 'category_name', v_cat_name,
      'account_id', v_acc_id, 'account_name', v_acc_name, 'supplier', nullif(trim(coalesce(p->>'supplier', '')), '')));
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
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data ou valor).');
end $$;

create function conv_private.ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select case when coalesce(p->>'action', '') in ('fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse', 'fin_receipt_reject', 'fin_entry_create')
    then conv_private.ai_admin_finance_propose_ext(p_session, p)
    else conv_private.ai_admin_finance_propose_pendency(p_session, p) end
$$;

-- ---------------------------------------------------------------------------------------------- execução
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pendency_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse', 'fin_receipt_reject', 'fin_entry_create') then
    return conv_private.ai_confirm_pendency_step(p_proposal, p_message);
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
    if bp.action = 'fin_charge_cancel' then
      v_res := public.fin_cancel_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_charge_adjust' then
      v_res := public.fin_adjust_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'adjust_kind',
        (bp.payload->>'amount_cents')::bigint, bp.payload->>'reason');
    elsif bp.action = 'fin_payment_reverse' then
      v_res := public.fin_reverse_payment(bp.request_key, (bp.payload->>'payment_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_receipt_reject' then
      v_res := public.fin_reject_receipt(bp.request_key, (bp.payload->>'submission_id')::uuid, bp.payload->>'reason');
    else
      v_res := public.fin_create_entry(bp.request_key, jsonb_strip_nulls(jsonb_build_object(
        'kind', bp.payload->>'entry_kind', 'description', bp.payload->>'description', 'amount_cents', (bp.payload->>'amount_cents')::bigint,
        'status', bp.payload->>'entry_status', 'due_date', bp.payload->>'due_date', 'paid_on', bp.payload->>'paid_on',
        'account_id', bp.payload->>'account_id', 'category_id', bp.payload->>'category_id', 'supplier', bp.payload->>'supplier')));
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
  perform conv_private.audit('ai_admin_finance', 'fin_member_charges', coalesce(v_res->>'id', bp.payload->>'charge_id', bp.payload->>'submission_id'), null,
    jsonb_build_object('action', bp.action, 'amount_cents', bp.payload->'amount_cents', 'reason', bp.payload->'reason'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.ai_admin_finance_propose_pendency(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose_ext(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_pendency_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
