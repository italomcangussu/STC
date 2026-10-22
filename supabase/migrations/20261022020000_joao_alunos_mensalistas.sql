-- João cadastra aluno (mensalista, Mensalista Kids ou Day Card) e registra o pagamento já com o comprovante.
-- Pedido do Henrique (19/10): "cadastrar Matheus e José como alunos, vence todo dia 14, Matheus R$ 200, José R$ 100,
-- segue o comprovante de R$ 300". Antes o João dizia "ainda não consigo".
-- * Cada pagamento de aluno lembra de qual comprovante veio (student_payments.receipt_intent_id): um comprovante de
--   R$ 300 paga dois alunos; a intenção só sai de "aguardando" quando o valor inteiro foi usado.
-- * Comprovante do administrador: a intenção (WhatsApp) com saldo suficiente, das últimas 6 h, nesta conversa.
-- * Renovação de Card (student_card_renew) passa a cobrar o preço da faixa (Kids = metade) e a aceitar a intenção.

alter table public.student_payments add column if not exists receipt_intent_id uuid;
create index if not exists student_payments_receipt_intent_idx on public.student_payments(receipt_intent_id) where receipt_intent_id is not null;
comment on column public.student_payments.receipt_intent_id is 'Comprovante do WhatsApp (fin_private.whatsapp_receipt_intents) que pagou este Card.';

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_student_create'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- Quanto de um comprovante já pagou Cards de aluno.
create or replace function conv_private.receipt_used_cents(p_intent uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(round(sp.amount * 100)), 0)::bigint from public.student_payments sp
  where sp.receipt_intent_id = p_intent and sp.status = 'active'
$$;

-- Comprovantes que o administrador pode usar agora: os que ele mesmo mandou nesta conversa nas últimas 6 h.
create or replace function conv_private.admin_usable_receipts(p_conversation uuid, p_admin uuid)
returns setof fin_private.whatsapp_receipt_intents
language sql stable security definer set search_path = '' as $$
  select i.* from fin_private.whatsapp_receipt_intents i
  where i.conversation_id = p_conversation and i.profile_id = p_admin and i.created_at > now() - interval '6 hours'
    and i.status in ('awaiting_purpose', 'awaiting_confirmation') and i.finance_entry_id is null and i.finance_submission_id is null
$$;

-- O mais recente com saldo para pagar p_amount.
create or replace function conv_private.admin_student_receipt(p_conversation uuid, p_admin uuid, p_amount bigint)
returns table(id uuid, amount_cents bigint, remaining_cents bigint, paid_on date, payee text, from_name text)
language sql stable security definer set search_path = '' as $$
  select x.id, x.amount, x.amount - x.used, x.paid_on, x.payee, x.from_name from (
    select i.id, nullif(i.original_data->>'declared_amount_cents', '')::bigint amount, conv_private.receipt_used_cents(i.id) used,
      nullif(i.original_data->>'declared_paid_on', '')::date paid_on, nullif(trim(coalesce(i.original_data->'ocr'->>'payee', '')), '') payee,
      (select pr.name from public.profiles pr where pr.id = i.profile_id) from_name, i.created_at
    from conv_private.admin_usable_receipts(p_conversation, p_admin) i
  ) x
  where x.amount is not null and x.amount - x.used >= coalesce(p_amount, 1)
  order by x.created_at desc, x.id desc limit 1
$$;

-- Comprovante todo usado em Cards: sai de "aguardando".
create or replace function conv_private.close_receipt_if_used(p_intent uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update fin_private.whatsapp_receipt_intents i
     set status = 'confirmed', purpose_kind = 'student_card', purpose_detail = coalesce(i.purpose_detail, 'Card Mensal de aluno'), updated_at = now()
   where i.id = p_intent and i.status in ('awaiting_purpose', 'awaiting_confirmation')
     and conv_private.receipt_used_cents(i.id) >= nullif(i.original_data->>'declared_amount_cents', '')::bigint;
end $$;

-- ------------------------------------------------------------------------------------------- cadastrar aluno
create or replace function conv_private.ai_admin_student_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; fs public.fin_settings%rowtype; v_admin uuid; v_id uuid;
  v_name text := regexp_replace(trim(coalesce(p->>'name', '')), '\s+', ' ', 'g'); v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_plan text := coalesce(nullif(p->>'plan', ''), 'Card Mensal'); v_tier text := case when p->>'card_tier' = 'kids' then 'kids' else 'regular' end;
  v_paid boolean; v_amount bigint := nullif(p->>'amount_cents', '')::bigint; v_paid_on date := nullif(p->>'paid_on', '')::date;
  v_today date := conv_private.today(); v_rc record; v_receipt jsonb; v_price bigint;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.'); end if;
  if length(v_name) < 3 or length(v_name) > 120 then return conv_private.vfail('INVALID_NAME', 'Qual o nome completo do aluno?'); end if;
  if v_plan not in ('Card Mensal', 'Day Card') then return conv_private.vfail('INVALID_PLAN', 'É mensalista, Mensalista Kids ou Day Card (aula avulsa)?'); end if;
  if v_plan <> 'Card Mensal' then v_tier := 'regular'; end if;
  if v_phone <> '' and length(v_phone) not between 10 and 13 then
    return conv_private.vfail('INVALID_PHONE', 'O telefone precisa ter DDD. Pode conferir? (O telefone é opcional.)');
  end if;
  if exists (select 1 from public.non_socio_students n where coalesce(n.is_active, true) and n.student_type = 'regular'
             and fin_private.fold_text(n.name) = fin_private.fold_text(v_name)) then
    return conv_private.vfail('STUDENT_EXISTS', v_name || ' já está cadastrado como aluno. Se for registrar o pagamento, me diga "renovar o Card de ' || v_name || '".');
  end if;

  v_price := fin_private.card_price_cents(v_tier);
  v_paid := v_plan = 'Card Mensal' and (coalesce((p->>'paid')::boolean, false) or v_amount is not null or v_paid_on is not null);
  if v_paid then
    v_amount := coalesce(v_amount, v_price);
    if v_amount <= 0 or v_amount > 100000000 then return conv_private.vfail('INVALID_AMOUNT', 'Qual o valor pago?'); end if;
    select * into v_rc from conv_private.admin_student_receipt(sess.conversation_id, v_admin, v_amount);
    if v_rc.id is not null then
      select * into fs from public.fin_settings where id;
      if v_rc.payee is not null and not fin_private.payee_matches(v_rc.payee, fs.payee_names) then
        return conv_private.vfail('PAYEE_MISMATCH', 'O comprovante é para "' || v_rc.payee || '", que não é o clube. Não registro assim.');
      end if;
      v_paid_on := coalesce(v_paid_on, v_rc.paid_on);
      v_receipt := jsonb_strip_nulls(jsonb_build_object('intent_id', v_rc.id, 'amount_cents', v_rc.amount_cents,
        'remaining_cents', v_rc.remaining_cents, 'from_name', v_rc.from_name));
    end if;
    v_paid_on := coalesce(v_paid_on, v_today);
    if v_paid_on > v_today then return conv_private.vfail('INVALID_DATE', 'A data do pagamento não pode ser no futuro.'); end if;
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_student_create',
    jsonb_strip_nulls(jsonb_build_object('name', v_name, 'phone', nullif(v_phone, ''), 'plan', v_plan, 'card_tier', v_tier,
      'price_cents', case when v_plan = 'Card Mensal' then v_price end, 'paid', v_paid, 'amount_cents', case when v_paid then v_amount end,
      'paid_on', v_paid_on, 'new_valid_until', case when v_paid then (v_paid_on + interval '1 month')::date end, 'receipt', v_receipt)),
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id, payload into v_id, v_receipt;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_student_create', 'summary', v_receipt);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data ou valor).');
end $$;

create or replace function public.conv_svc_ai_admin_student_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_student_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_student_create_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; v_id uuid; v_pay uuid; v_res jsonb;
  v_err text; v_code text; v_paid boolean; v_intent uuid; v_paid_on date; v_exp date;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_student_create' then return conv_private.ai_confirm_pre_student_create_step(p_proposal, p_message); end if;
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
  v_paid := coalesce((bp.payload->>'paid')::boolean, false);
  v_intent := nullif(bp.payload#>>'{receipt,intent_id}', '')::uuid;
  v_paid_on := nullif(bp.payload->>'paid_on', '')::date;
  v_exp := nullif(bp.payload->>'new_valid_until', '')::date;
  begin
    if exists (select 1 from public.non_socio_students n where coalesce(n.is_active, true) and n.student_type = 'regular'
               and fin_private.fold_text(n.name) = fin_private.fold_text(bp.payload->>'name')) then
      raise exception 'STUDENT_EXISTS';
    end if;
    if v_intent is not null and coalesce((select nullif(i.original_data->>'declared_amount_cents', '')::bigint from fin_private.whatsapp_receipt_intents i
                                 where i.id = v_intent), 0) - conv_private.receipt_used_cents(v_intent) < (bp.payload->>'amount_cents')::bigint then
      raise exception 'RECEIPT_ALREADY_USED';
    end if;
    insert into public.non_socio_students(name, phone, student_type, plan_type, card_tier, plan_status, master_expiration_date)
    values (bp.payload->>'name', bp.payload->>'phone', 'regular', bp.payload->>'plan', bp.payload->>'card_tier',
      case when v_paid then 'active' else 'inactive' end, v_exp)
    returning id into v_id;
    insert into public.student_profiles(non_socio_student_id, student_status) values (v_id, 'active');
    if v_paid then
      insert into public.student_payments(student_id, amount, payment_date, valid_until, approved_by, status, receipt_intent_id)
      values (v_id, (bp.payload->>'amount_cents')::bigint / 100.0, ((v_paid_on::timestamp + time '12:00') at time zone 'America/Fortaleza'),
        ((v_exp::timestamp + time '23:59:59') at time zone 'America/Fortaleza'), v_admin, 'active', v_intent)
      returning id into v_pay;
      if v_intent is not null then perform conv_private.close_receipt_if_used(v_intent); end if;
    end if;
    v_res := jsonb_strip_nulls(jsonb_build_object('id', v_id, 'payment_id', v_pay));
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, case v_code when 'STUDENT_EXISTS' then (bp.payload->>'name') || ' já está cadastrado como aluno.'
      when 'RECEIPT_ALREADY_USED' then 'Esse comprovante já foi usado inteiro. Mande o comprovante deste aluno ou registre sem comprovante.'
      else 'Não consegui concluir: ' || v_code || '.' end);
  end if;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'non_socio_students', v_id::text, null,
    jsonb_build_object('action', bp.action, 'plan', bp.payload->>'plan', 'card_tier', bp.payload->>'card_tier', 'amount_cents', bp.payload->'amount_cents'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

-- ------------------------------------------------------------------------------- renovar Card (Kids e intenção)
-- Depois da confirmação da renovação: o pagamento lembra do comprovante e a intenção fecha se foi usada inteira.
create or replace function conv_private.trg_card_renew_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_intent uuid := nullif(new.payload#>>'{receipt,intent_id}', '')::uuid;
begin
  begin
    update public.student_payments set receipt_intent_id = v_intent where id = (new.payload#>>'{result,payment_id}')::uuid;
    perform conv_private.close_receipt_if_used(v_intent);
  exception when others then
    raise warning 'trg_card_renew_receipt falhou (proposta %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_card_renew_receipt on public.conv_booking_proposals;
create trigger trg_card_renew_receipt after update of status on public.conv_booking_proposals
for each row when (new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.action = 'student_card_renew'
  and new.payload #>> '{receipt,intent_id}' is not null)
execute function conv_private.trg_card_renew_receipt();

create or replace function conv_private.ai_student_card_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; st public.non_socio_students%rowtype;
  rc public.fin_receipt_submissions%rowtype; fs public.fin_settings%rowtype;
  v_admin uuid; v_id uuid; v_today date := conv_private.today(); v_default bigint; v_intent record;
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
  v_default := fin_private.card_price_cents(st.card_tier);

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

  -- Sem submissão: comprovante do WhatsApp (intenção) com saldo para este Card.
  if v_use and not v_has_receipt then
    select * into v_intent from conv_private.admin_student_receipt(sess.conversation_id, v_admin, coalesce(v_amount, v_default));
    if v_intent.id is not null then
      select * into fs from public.fin_settings where id;
      if v_intent.payee is not null and not fin_private.payee_matches(v_intent.payee, fs.payee_names) then
        return conv_private.vfail('PAYEE_MISMATCH', 'O comprovante é para "' || v_intent.payee || '", que não é o clube. Não registro assim.');
      end if;
      if v_paid_on is null then v_paid_on := v_intent.paid_on; end if;
      v_receipt := jsonb_strip_nulls(jsonb_build_object('intent_id', v_intent.id, 'amount_cents', v_intent.amount_cents,
        'remaining_cents', v_intent.remaining_cents, 'from_name', v_intent.from_name));
    end if;
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

  v_payload := jsonb_strip_nulls(jsonb_build_object('student_id', st.id, 'student_name', st.name, 'plan_type', st.plan_type, 'card_tier', st.card_tier,
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
