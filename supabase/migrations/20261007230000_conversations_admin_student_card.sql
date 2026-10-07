-- Assessor administrativo do João: renovar o Card Mensal de um aluno (non_socio_students) pelo WhatsApp, lendo o
-- comprovante que o administrador mandou na conversa. Mesmo protocolo das demais ações: proposta com resumo
-- (aluno, valor, data, nova validade, o que o comprovante diz) → "sim" do próprio administrador → grava como o painel
-- (student_payments + validade do aluno) e fecha o comprovante, que deixa de aparecer "em análise" para o administrador.
-- Acima de R$ 400 a proposta é recusada: valores altos seguem pelo painel (Alunos).

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
  'student_card_renew'));

create or replace function conv_private.ai_student_card_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; st public.non_socio_students%rowtype;
  rc public.fin_receipt_submissions%rowtype; fs public.fin_settings%rowtype;
  v_admin uuid; v_id uuid; v_today date := conv_private.today(); v_default constant bigint := 20000;
  v_amount bigint; v_paid_on date; v_new_exp date; v_prev_exp date; v_payload jsonb; v_receipt jsonb := null;
  v_warn text[] := '{}'; v_use boolean := coalesce((p->>'use_receipt')::boolean, true);
  v_payee text; v_ident text; v_has_receipt boolean := false;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  select * into st from public.non_socio_students where id = nullif(p->>'student_id', '')::uuid and coalesce(is_active, true);
  if not found then return conv_private.vfail('STUDENT_NOT_FOUND', 'Não achei esse aluno no cadastro.'); end if;
  if st.plan_type <> 'Card Mensal' then
    return conv_private.vfail('NOT_CARD_MENSAL', st.name || ' está no plano ' || st.plan_type || ', não no Card Mensal. Essa renovação eu só faço para Card Mensal.');
  end if;

  -- Último comprovante que o administrador mandou nesta conversa (ainda não usado).
  if v_use then
    select r.* into rc
    from public.fin_receipt_submissions r
    join public.conv_messages m on m.id = r.source_message_id
    where m.conversation_id = sess.conversation_id and m.direction = 'inbound'
      and r.source = 'whatsapp' and r.status in ('submitted', 'in_review')
      and r.created_at > now() - interval '3 hours'
    order by r.created_at desc limit 1;
    v_has_receipt := found;
  end if;

  v_amount := nullif(p->>'amount_cents', '')::bigint;
  v_paid_on := nullif(p->>'paid_on', '')::date;
  if v_has_receipt then
    v_payee := nullif(trim(coalesce(rc.ocr->>'payee', '')), '');
    v_ident := nullif(trim(coalesce(rc.ocr->>'identifier', '')), '');
    select * into fs from public.fin_settings where id;
    if rc.ocr_status <> 'ok' then
      v_warn := v_warn || 'Não consegui ler o comprovante; confira valor e data com ele.';
    else
      if v_payee is not null and not fin_private.payee_matches(v_payee, fs.payee_names) then
        return conv_private.vfail('PAYEE_MISMATCH', 'O comprovante é para "' || v_payee || '", que não é o clube. Não registro assim.');
      elsif v_payee is null then
        v_warn := v_warn || 'Não li o favorecido no comprovante.';
      end if;
      if v_amount is null then v_amount := rc.declared_amount_cents; end if;
      if v_paid_on is null then v_paid_on := rc.declared_paid_on; end if;
      if rc.declared_amount_cents is not null and v_amount is not null and rc.declared_amount_cents <> v_amount then
        v_warn := v_warn || 'O comprovante mostra R$ ' || replace(to_char(rc.declared_amount_cents / 100.0, 'FM999990.00'), '.', ',') || ', diferente do valor informado.';
      end if;
    end if;
    if rc.possible_duplicate or (v_ident is not null and exists (
      select 1 from public.fin_receipt_submissions o
      where o.id <> rc.id and o.status = 'approved' and nullif(trim(o.ocr->>'identifier'), '') = v_ident)) then
      return conv_private.vfail('RECEIPT_DUPLICATE', 'Esse comprovante parece já ter sido usado antes. Não registro de novo.');
    end if;
    v_receipt := jsonb_strip_nulls(jsonb_build_object('id', rc.id, 'file_name', rc.file_name, 'payee', v_payee,
      'identifier', v_ident, 'amount_cents', rc.declared_amount_cents, 'paid_on', rc.declared_paid_on, 'ocr_status', rc.ocr_status));
  end if;

  v_amount := coalesce(v_amount, v_default);
  if v_amount <= 0 or v_amount >= 40000 then
    return conv_private.vfail('INVALID_AMOUNT', 'Valor fora do que registro por aqui (de R$ 0,01 até R$ 399,99). Acima disso, pelo painel, em Alunos.');
  end if;
  v_paid_on := coalesce(v_paid_on, v_today);
  if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento não pode ser no futuro.'); end if;
  if v_paid_on < v_today - 60 then
    v_warn := v_warn || 'A data do pagamento é de mais de 60 dias atrás.';
  end if;

  select max(valid_until::date) into v_prev_exp from public.student_payments where student_id = st.id and status = 'active';
  if exists (select 1 from public.student_payments x where x.student_id = st.id and x.status = 'active'
             and (x.payment_date at time zone 'America/Fortaleza')::date = v_paid_on and round(x.amount * 100) = v_amount) then
    return conv_private.vfail('ALREADY_RECORDED', 'O Card de ' || st.name || ' já tem um pagamento de R$ ' || replace(to_char(v_amount / 100.0, 'FM999990.00'), '.', ',')
      || ' em ' || to_char(v_paid_on, 'DD/MM/YYYY') || ' (válido até ' || to_char(coalesce(v_prev_exp, v_paid_on), 'DD/MM/YYYY') || '). Não registro em duplicidade.');
  end if;
  v_new_exp := (v_paid_on + interval '1 month')::date;

  v_payload := jsonb_strip_nulls(jsonb_build_object('student_id', st.id, 'student_name', st.name, 'plan_type', st.plan_type,
    'amount_cents', v_amount, 'default_price_cents', v_default, 'paid_on', v_paid_on, 'method', 'pix',
    'previous_valid_until', coalesce(v_prev_exp, st.master_expiration_date), 'new_valid_until', v_new_exp,
    'receipt', v_receipt, 'warnings', to_jsonb(v_warn)));

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'student_card_renew', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'student_card_renew', 'summary', v_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data ou valor).');
end $$;

-- A confirmação das outras ações continua igual; a renovação de Card ganha o ramo próprio, na frente.
alter function conv_private.ai_confirm(uuid, uuid) rename to ai_confirm_before_student_card;

create function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_pay uuid; v_exp date; v_paid_on date; v_amount bigint; v_sub uuid; v_name text;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'student_card_renew' then return conv_private.ai_confirm_before_student_card(p_proposal, p_message); end if;
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

  v_name := bp.payload->>'student_name';
  v_paid_on := (bp.payload->>'paid_on')::date;
  v_exp := (bp.payload->>'new_valid_until')::date;
  v_amount := (bp.payload->>'amount_cents')::bigint;
  v_sub := nullif(bp.payload#>>'{receipt,id}', '')::uuid;
  if exists (select 1 from public.student_payments x where x.student_id = (bp.payload->>'student_id')::uuid and x.status = 'active'
             and (x.payment_date at time zone 'America/Fortaleza')::date = v_paid_on and round(x.amount * 100) = v_amount) then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ALREADY_RECORDED' where id = bp.id;
    return conv_private.vfail('ALREADY_RECORDED', 'Esse pagamento já foi registrado. Não duplico.');
  end if;

  -- Executa como o administrador: a trilha de auditoria da tabela enxerga quem aprovou.
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.student_payments(student_id, amount, payment_date, valid_until, approved_by, status)
  values ((bp.payload->>'student_id')::uuid, v_amount / 100.0,
          ((v_paid_on::timestamp + time '12:00') at time zone 'America/Fortaleza'),
          ((v_exp::timestamp + time '23:59:59') at time zone 'America/Fortaleza'), v_admin, 'active')
  returning id into v_pay;
  update public.non_socio_students set plan_status = 'active', master_expiration_date = v_exp
   where id = (bp.payload->>'student_id')::uuid;
  if v_sub is not null then
    update public.fin_receipt_submissions
       set status = 'approved', reviewed_at = now(), reviewed_by = v_admin,
           decision_reason = 'Renovação do Card Mensal de ' || left(v_name, 80) || ' pelo João (WhatsApp)'
     where id = v_sub and status in ('submitted', 'in_review');
  end if;

  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', jsonb_build_object('payment_id', v_pay)) where id = bp.id;
  perform conv_private.audit('ai_admin_student_card', 'student_payments', v_pay::text, null,
    jsonb_build_object('action', bp.action, 'amount_cents', v_amount, 'student_id', bp.payload->'student_id', 'new_valid_until', v_exp),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', jsonb_build_object('payment_id', v_pay)));
end $$;

create or replace function public.conv_svc_ai_student_card_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_student_card_propose(p_session, p) $$;

-- O que o servidor leu do comprovante que o administrador acabou de mandar (para o João responder sem chamar o modelo).
create or replace function conv_private.ai_admin_receipt(p_session uuid, p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; r public.fin_receipt_submissions%rowtype; fs public.fin_settings%rowtype; v_payee text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open';
  if not found or conv_private.ai_admin_requester(p_session) is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select r2.* into r from public.fin_receipt_submissions r2
    join public.conv_messages m on m.id = r2.source_message_id
   where r2.source_message_id = p_message and m.conversation_id = sess.conversation_id;
  if not found then return jsonb_build_object('ok', true, 'found', false); end if;
  select * into fs from public.fin_settings where id;
  v_payee := nullif(trim(coalesce(r.ocr->>'payee', '')), '');
  return jsonb_build_object('ok', true, 'found', true, 'status', r.status, 'ocr_status', r.ocr_status,
    'amount_cents', r.declared_amount_cents, 'paid_on', r.declared_paid_on, 'payee', v_payee,
    'payee_ok', case when v_payee is null then null else fin_private.payee_matches(v_payee, fs.payee_names) end,
    'duplicate', r.possible_duplicate);
end $$;

create or replace function public.conv_svc_ai_admin_receipt(p_session uuid, p_message uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_receipt(p_session, p_message) $$;

revoke all on function conv_private.ai_student_card_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_before_student_card(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_student_card_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_student_card_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_admin_receipt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_receipt(uuid, uuid) to service_role;
