-- Renovação de Card Mensal pelo João: sem trava de valor (decisão do clube). A proposta só recusa valor inválido;
-- o "sim" do administrador continua obrigatório e o resto das regras (favorecido, duplicidade) não muda.
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
  if v_amount <= 0 or v_amount > 1000000000 then
    return conv_private.vfail('INVALID_AMOUNT', 'Qual é o valor pago?');
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
