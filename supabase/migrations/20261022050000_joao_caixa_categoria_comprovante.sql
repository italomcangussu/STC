-- Auditoria do caixa de outubro (22/10): o João errava em quatro pontos que deixavam o caixa diferente do banco.
-- 1) Categoria: "material de limpeza", "outros" ou "manutenção de quadra" não casavam com o nome cadastrado e ele
--    repetia a lista inteira. Agora casa por palavras, sugere pelo histórico e pelas palavras da descrição quando o
--    administrador não diz, e cria a categoria nova quando ele pede (category_new), no grupo da sugestão.
-- 2) Sócio novo que entra no meio do mês paga um valor proporcional: o cadastro exigia o valor cheio e travava.
--    Agora o 1º mês pode ser proporcional (first_amount_cents): a diferença vira desconto só nessa cobrança.
-- 3) Comprovante de pendência (Day Card de convidado) que bate com o devido também tem baixa automática.
-- 4) Comprovante de despesa que o administrador manda depois de lançar a despesa vira anexo dela sozinho.

-- Raízes de 4 letras das palavras (sem acento, sem palavras vazias): "quadra" e "quadras" casam.
create or replace function fin_private.word_stems(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct left(w, 4)), '{}'::text[])
  from regexp_split_to_table(fin_private.fold_text(p_text), '[^a-z0-9]+') w
  where length(w) >= 4 and w not in ('para', 'pelo', 'pela', 'como', 'mais', 'esse', 'essa', 'este', 'esta', 'valor',
    'despesa', 'despesas', 'gasto', 'gastos', 'compra', 'compras', 'pagamento', 'pago', 'paga', 'referente', 'clube', 'lancar', 'favor')
$$;

-- Categorias que podem receber lançamento: ativas, do tipo certo, filhas de um grupo e sem chave de sistema.
create or replace function conv_private.entry_categories(p_kind text) returns setof public.fin_categories
language sql stable security definer set search_path = '' as $$
  select c.* from public.fin_categories c
  where c.active and c.kind = p_kind and c.parent_id is not null and c.system_key is null
$$;

-- A categoria do lançamento. how = 'nome' (o administrador disse e casou), 'historico' (lançamentos parecidos já
-- usaram) ou 'palavra' (o nome da categoria aparece na descrição). Sem resposta única, nada volta.
create or replace function conv_private.entry_category_pick(p_kind text, p_name text, p_desc text)
returns table(id uuid, name text, how text)
language plpgsql stable security definer set search_path = '' as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), ''); v_n int;
begin
  if v_name is not null then
    return query select c.id, c.name, 'nome'::text from conv_private.entry_categories(p_kind) c
      where fin_private.fold_text(c.name) = fin_private.fold_text(v_name) order by c.position limit 1;
    if found then return; end if;
    select count(*) into v_n from conv_private.entry_categories(p_kind) c
      where fin_private.fold_text(c.name) like '%' || fin_private.fold_text(v_name) || '%'
         or fin_private.fold_text(v_name) like '%' || fin_private.fold_text(c.name) || '%';
    if v_n = 1 then
      return query select c.id, c.name, 'nome'::text from conv_private.entry_categories(p_kind) c
        where fin_private.fold_text(c.name) like '%' || fin_private.fold_text(v_name) || '%'
           or fin_private.fold_text(v_name) like '%' || fin_private.fold_text(c.name) || '%';
      return;
    end if;
    return query with s as (
      -- todas as palavras ditas estão no nome da categoria ("material esportivo" não vira "Material de limpeza")
      select c.id, c.name, cardinality(array(select unnest(fin_private.word_stems(c.name)) intersect select unnest(fin_private.word_stems(v_name)))) sc
      from conv_private.entry_categories(p_kind) c)
      select s.id, s.name, 'nome'::text from s
      where s.sc > 0 and s.sc = cardinality(fin_private.word_stems(v_name))
        and (select count(*) from s s2 where s2.sc = s.sc) = 1;
    if found then return; end if;
  end if;
  -- Lançamentos parecidos (palavras em comum) dos últimos 18 meses: a categoria mais usada; "Outras" só se não houver outra.
  return query with h as (
    select e.category_id cid, count(*) n from public.fin_entries e
    where e.kind = p_kind and e.status <> 'canceled' and e.category_id is not null and e.created_at > now() - interval '18 months'
      and fin_private.word_stems(e.description) && fin_private.word_stems(p_desc)
    group by e.category_id)
    select c.id, c.name, 'historico'::text from h join conv_private.entry_categories(p_kind) c on c.id = h.cid
    order by (fin_private.fold_text(c.name) like 'outr%'), h.n desc, c.name limit 1;
  if found then return; end if;
  return query with s as (
    select c.id, c.name, cardinality(array(select unnest(fin_private.word_stems(c.name)) intersect select unnest(fin_private.word_stems(p_desc)))) sc
    from conv_private.entry_categories(p_kind) c)
    select s.id, s.name, 'palavra'::text from s
    where s.sc > 0 and s.sc = (select max(sc) from s) and (select count(*) from s s2 where s2.sc = s.sc) = 1;
end $$;

-- Grupo onde nasce a categoria nova: o da sugestão; sem sugestão, "Outras despesas" ou "Receitas do clube".
create or replace function conv_private.entry_category_group(p_kind text, p_hint uuid)
returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name from public.fin_categories g
  where g.active and g.kind = p_kind and g.parent_id is null
    and (g.id = (select c.parent_id from public.fin_categories c where c.id = p_hint)
         or g.system_key = case p_kind when 'expense' then 'group.other' else 'group.revenue' end)
  order by (g.id = (select c.parent_id from public.fin_categories c where c.id = p_hint)) desc nulls last
  limit 1
$$;

revoke all on function fin_private.word_stems(text) from public, anon, authenticated;
revoke all on function conv_private.entry_categories(text) from public, anon, authenticated;
revoke all on function conv_private.entry_category_pick(text, text, text) from public, anon, authenticated;
revoke all on function conv_private.entry_category_group(text, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION conv_private.ai_admin_finance_propose_ext(p_session uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; ch public.fin_member_charges%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_payload jsonb; v_id uuid; v_today date := conv_private.today();
  v_name text; v_reason text := trim(coalesce(p->>'reason', '')); v_amount bigint; v_total bigint; v_fees bigint; v_rem bigint;
  v_kind text; v_profile uuid; v_pay_id uuid; v_pay_charge uuid; v_pay_amount bigint; v_pay_on date; v_sub record; v_n int; v_date date; v_desc text; v_status text; v_due date; v_paid_on date;
  v_acc_id uuid; v_acc_name text; v_acc_n int; v_acc_list text; v_cat_id uuid; v_cat_name text; v_cat_n int; v_cat_list text; v_entry text;
  v_pick record; v_cat_how text; v_cat_given text; v_cat_new boolean := false; v_parent_id uuid; v_parent_name text;
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
    -- Categoria: o nome dito (mesmo aproximado: "material de limpeza", "outros") ou, sem nome, a sugestão pelo
    -- histórico e pelas palavras da descrição. Nome que não existe só vira categoria nova se o administrador pedir.
    v_cat_given := nullif(trim(coalesce(p->>'category_name', '')), '');
    select k.id, k.name, k.how into v_pick from conv_private.entry_category_pick(v_entry, v_cat_given, v_desc) k;
    select string_agg(c.name, ', ' order by c.position, c.name) into v_cat_list from (
      select * from public.fin_categories c0 where c0.active and c0.kind = v_entry and c0.parent_id is not null and c0.system_key is null
      order by c0.position, c0.name limit 14) c;
    if v_pick.id is not null and (v_pick.how = 'nome' or v_cat_given is null) then
      v_cat_id := v_pick.id; v_cat_name := v_pick.name; v_cat_how := v_pick.how;
    elsif v_cat_given is not null and coalesce((p->>'category_new')::boolean, false) then
      if length(v_cat_given) not between 2 and 60 then return conv_private.vfail('INVALID_CATEGORY', 'Qual o nome da categoria nova? (até 60 letras)'); end if;
      select g.id, g.name into v_parent_id, v_parent_name from conv_private.entry_category_group(v_entry, v_pick.id) g;
      if v_parent_id is null then return conv_private.vfail('CATEGORY_REQUIRED', 'Em qual categoria? ' || coalesce(v_cat_list, '(nenhuma ativa)') || '.'); end if;
      v_cat_new := true; v_cat_name := upper(left(v_cat_given, 1)) || substr(v_cat_given, 2); v_cat_how := 'nova';
    elsif v_cat_given is not null then
      return conv_private.vfail('CATEGORY_UNKNOWN', 'Não tenho a categoria "' || v_cat_given || '".'
        || case when v_pick.id is not null then ' Pela descrição, sugiro "' || v_pick.name || '".' else '' end
        || ' Uso ' || case when v_pick.id is not null then 'essa, ' else '' end || 'uma destas (' || coalesce(v_cat_list, 'nenhuma ativa')
        || ') ou crio "' || v_cat_given || '" como categoria nova?');
    else
      return conv_private.vfail('CATEGORY_REQUIRED', 'Em qual categoria? ' || coalesce(v_cat_list, '(nenhuma ativa)')
        || '. Se nenhuma servir, me diga o nome que eu crio uma nova.');
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
      'entry_status', v_status, 'due_date', v_due, 'paid_on', v_paid_on, 'category_id', v_cat_id, 'category_name', v_cat_name, 'category_how', v_cat_how,
      'category_new', case when v_cat_new then true end, 'category_parent_id', v_parent_id, 'category_parent_name', v_parent_name,
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
end $function$;;


CREATE OR REPLACE FUNCTION conv_private.ai_confirm_wave2_step(p_proposal uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text; v_cat text;
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
      v_cat := nullif(bp.payload->>'category_id', '');
      if v_cat is null and coalesce((bp.payload->>'category_new')::boolean, false) then
        v_res := public.fin_save_category(md5(bp.id::text || 'category')::uuid, null, null, jsonb_build_object(
          'kind', bp.payload->>'entry_kind', 'parent_id', bp.payload->>'category_parent_id', 'name', bp.payload->>'category_name'));
        v_cat := v_res->>'id';
        bp.payload := bp.payload || jsonb_build_object('category_id', v_cat);
      end if;
      v_res := public.fin_create_entry(bp.request_key, jsonb_strip_nulls(jsonb_build_object(
        'kind', bp.payload->>'entry_kind', 'description', bp.payload->>'description', 'amount_cents', (bp.payload->>'amount_cents')::bigint,
        'status', bp.payload->>'entry_status', 'due_date', bp.payload->>'due_date', 'paid_on', bp.payload->>'paid_on',
        'account_id', bp.payload->>'account_id', 'category_id', v_cat, 'supplier', bp.payload->>'supplier')));
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
end $function$;;


CREATE OR REPLACE FUNCTION conv_private.ai_admin_access_propose(p_session uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; fs public.fin_settings%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_id uuid; v_payload jsonb; v_today date := conv_private.today(); v_first bigint;
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
      case when nullif(trim(coalesce(p->>'name', '')), '') is null then '.' else ' com esse nome.' end
      || ' Se é sócio novo sem pedido no app, me passe o nome completo e o telefone com DDD que eu cadastro direto.'); end if;
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
    select r.id, r.declared_amount_cents, r.declared_paid_on, r.ocr, r.created_at into v_sub
    from conv_private.admin_pending_receipt(sess.conversation_id, v_admin) r;
    if v_sub.id is null then
      return conv_private.vfail('RECEIPT_REQUIRED', 'Para cadastrar o sócio preciso do comprovante de pagamento da mensalidade deste mês. Mande a imagem ou o PDF aqui e me diga para continuar.');
    end if;
    -- 1º mês proporcional (entrou no meio do mês): paga first_amount agora, a mensalidade cheia vale do mês seguinte.
    v_first := nullif(p->>'first_amount_cents', '')::bigint;
    if v_first is not null and (v_first <= 0 or v_first >= v_amount) then v_first := null; end if;
    if v_first is null and v_sub.declared_amount_cents is not null and v_sub.declared_amount_cents < v_amount then
      return conv_private.vfail('RECEIPT_PRORATED', 'O comprovante mostra R$ ' || replace(trim(to_char(v_sub.declared_amount_cents::numeric / 100, 'FM999999990D00')), '.', ',')
        || ' e a mensalidade é R$ ' || replace(trim(to_char(v_amount::numeric / 100, 'FM999999990D00')), '.', ',')
        || '. O primeiro mês foi proporcional (o resto vira desconto e a mensalidade cheia vale a partir do mês que vem)?');
    end if;
    if v_sub.declared_amount_cents is not null and v_sub.declared_amount_cents <> coalesce(v_first, v_amount) then
      return conv_private.vfail('RECEIPT_AMOUNT_MISMATCH', 'O comprovante mostra R$ ' || replace(trim(to_char(v_sub.declared_amount_cents::numeric / 100, 'FM999999990D00')), '.', ',')
        || ', mas o valor informado é R$ ' || replace(trim(to_char(coalesce(v_first, v_amount)::numeric / 100, 'FM999999990D00')), '.', ',') || '. Qual vale?');
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
      'month', date_trunc('month', v_today::timestamp)::date, 'amount_read', v_sub.declared_amount_cents is not null, 'reactivate', v_reactivate, 'first_amount_cents', v_first));
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
end $function$;;


CREATE OR REPLACE FUNCTION conv_private.ai_member_onboard(p_proposal uuid, p_profile uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; pr public.profiles%rowtype;
  v_prev_claims text; v_prev_sub text; v_err text; v_code text; v_today date := conv_private.today();
  v_month date; v_amount bigint; v_plan uuid; v_charge uuid; v_remaining bigint; v_fees bigint; v_status text; v_sub_status text;
  v_sub uuid; v_paid_on date; v_alloc jsonb; v_waivers jsonb := '[]'::jsonb; v_res jsonb := '{}'::jsonb; v_first bigint;
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
    -- 1º mês proporcional: o que não foi pago agora vira desconto só nesta cobrança (o plano segue com o valor cheio).
    v_first := coalesce(nullif(bp.payload->>'first_amount_cents', '')::bigint, v_amount);
    if v_first < v_amount then
      perform public.fin_adjust_charge(md5(bp.id::text || 'prorate')::uuid, v_charge, 'discount', v_amount - v_first,
        'Primeiro mês proporcional: sócio entrou no meio do mês');
    end if;
    -- 3) comprovante para o novo sócio e aprovação com baixa total do mês (juros do mês de entrada dispensados)
    v_sub := conv_private.admin_receipt_materialize(v_sub, v_admin);
    select status into v_sub_status from public.fin_receipt_submissions where id = v_sub;
    if v_sub_status is null then raise exception 'RECEIPT_NOT_FOUND'; end if;
    if v_sub_status in ('submitted', 'in_review') then
      select st.principal_remaining, st.fees_due into v_remaining, v_fees from fin_private.charge_statement(v_charge, v_paid_on) st;
      if v_remaining <> v_first then raise exception 'AMOUNT_MISMATCH'; end if;
      update public.fin_receipt_submissions set profile_id = p_profile, updated_at = now() where id = v_sub;
      if coalesce(v_fees, 0) > 0 then
        v_waivers := jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_fees,
          'reason', 'Sócio novo: mensalidade do mês de entrada'));
      end if;
      v_alloc := jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_first));
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
end $function$;;


-- 3) Comprovante de sócio: além da mensalidade do mês, a pendência com o mesmo valor devido também baixa sozinha.
create or replace function public.conv_svc_receipt_membership_auto(p_stage uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; pr public.profiles%rowtype;
  v_admin uuid; v_admin_name text; v_contact uuid; v_conv uuid; v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_month date := date_trunc('month', (now() at time zone 'America/Fortaleza'))::date; v_amount bigint; v_paid_on date; v_payee text;
  v_hash text; v_charge uuid; v_due bigint; v_type text; v_desc text; v_n int; v_account uuid; v_prev_claims text; v_prev_sub text; v_err text; v_res jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_stage for update;
  if not found or s.status <> 'awaiting_purpose' then return jsonb_build_object('applied', false, 'reason', 'NOT_PENDING'); end if;
  select * into pr from public.profiles where id = s.profile_id;
  if pr.id is null or pr.role::text <> 'socio' or not coalesce(pr.is_active, false) then
    return jsonb_build_object('applied', false, 'reason', 'NOT_ACTIVE_MEMBER');
  end if;
  d := s.original_data;
  v_amount := nullif(d->>'declared_amount_cents', '')::bigint;
  v_paid_on := least(coalesce(nullif(d->>'declared_paid_on', '')::date, v_today), v_today);
  v_payee := nullif(trim(coalesce(d->'ocr'->>'payee', '')), '');
  v_hash := lower(coalesce(d->>'content_sha256', ''));
  select * into fs from public.fin_settings where id;
  if v_amount is null or v_amount <= 0 then return jsonb_build_object('applied', false, 'reason', 'AMOUNT_NOT_READ'); end if;
  if v_payee is null or not fin_private.payee_matches(v_payee, fs.payee_names) then return jsonb_build_object('applied', false, 'reason', 'PAYEE'); end if;
  if v_hash !~ '^[0-9a-f]{64}$' or exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved'))
     or exists (select 1 from fin_private.whatsapp_receipt_intents o where o.id <> s.id and o.original_data->>'content_sha256' = v_hash
                and o.status in ('confirmed', 'escalated', 'needs_review')) then
    return jsonb_build_object('applied', false, 'reason', 'DUPLICATE');
  end if;

  -- Cobrança em aberto com o total devido igual ao comprovante: a mensalidade do mês primeiro; senão a ÚNICA
  -- cobrança com esse valor (pendência, como o Day Card do convidado, ou mensalidade atrasada). Mês futuro nunca.
  select count(*) into v_n from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and st.total_due = v_amount
    and (c.charge_type <> 'membership' or c.competence_month <= v_month);
  select c.id, st.total_due, c.charge_type, c.description into v_charge, v_due, v_type, v_desc
  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and st.total_due = v_amount
    and (c.charge_type <> 'membership' or c.competence_month <= v_month)
  order by (c.charge_type = 'membership' and c.competence_month = v_month) desc, c.due_date limit 1;
  if v_charge is not null and v_n > 1 and not (v_type = 'membership' and exists (select 1 from public.fin_member_charges c
      where c.id = v_charge and c.competence_month = v_month)) then
    return jsonb_build_object('applied', false, 'reason', 'AMBIGUOUS');
  end if;
  if v_charge is null then
    select st.total_due into v_due from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
    where c.profile_id = s.profile_id and c.charge_type = 'membership' and c.competence_month = v_month and c.status in ('open', 'partial')
    order by c.due_date limit 1;
    if v_due is null then return jsonb_build_object('applied', false, 'reason', 'NO_OPEN_CHARGE'); end if;
    return jsonb_build_object('applied', false, 'reason', 'AMOUNT_MISMATCH', 'due_cents', v_due);
  end if;

  select p.id, p.name into v_admin, v_admin_name from public.profiles p
   where p.id = fs.finance_admin_profile_id and p.role::text = 'admin' and coalesce(p.is_active, true);
  if v_admin is null then return jsonb_build_object('applied', false, 'reason', 'NO_FINANCE_ADMIN'); end if;
  select a.id into v_account from public.fin_accounts a where a.active and a.is_default_receipts limit 1;
  if v_account is null then select min(a.id::text)::uuid into v_account from public.fin_accounts a where a.active having count(*) = 1; end if;
  if v_account is null then return jsonb_build_object('applied', false, 'reason', 'ACCOUNT'); end if;

  insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, request_id, source, source_message_id)
  values (s.id, s.profile_id, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
    v_amount, v_paid_on, d->>'declared_reference', case when v_type = 'membership' then 'Mensalidade pelo WhatsApp (baixa automática do João)' else 'Pendência pelo WhatsApp (baixa automática do João)' end,
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, s.id, 'whatsapp', s.source_message_id);

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    v_res := public.fin_approve_receipt(md5(s.id::text || 'auto-membership')::uuid, s.id, jsonb_build_object(
      'paid_on', v_paid_on, 'method', 'pix', 'account_id', v_account,
      'allocations', jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_amount)),
      'note', 'Comprovante do WhatsApp com valor e favorecido conferidos pelo João'));
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null then
    delete from public.fin_receipt_submissions where id = s.id and status = 'submitted';
    return jsonb_build_object('applied', false, 'reason', 'APPROVE_FAILED', 'error', left(v_err, 120));
  end if;

  update fin_private.whatsapp_receipt_intents set status = 'confirmed',
    purpose_kind = case when v_type = 'membership' then 'membership' else 'member_pendency' end,
    purpose_detail = left(case when v_type = 'membership' then 'Mensalidade de ' || to_char(v_month, 'MM/YYYY')
      else coalesce(v_desc, 'Pendência') end || ' (baixa automática)', 200), finance_submission_id = s.id, updated_at = now()
  where id = s.id;

  select c.id into v_contact from public.conv_contacts c where c.profile_id = v_admin and not coalesce(c.opt_out, false)
   order by c.updated_at desc nulls last limit 1;
  if v_contact is not null then v_conv := conv_private.open_direct(v_contact); end if;
  return jsonb_build_object('applied', true, 'month', v_month, 'charge_type', v_type, 'description', v_desc, 'amount_cents', v_amount, 'charge_id', v_charge,
    'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', pr.name);
end $$;
revoke all on function public.conv_svc_receipt_membership_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_membership_auto(uuid) to service_role;


-- 4) Comprovante que o administrador manda de um pagamento a terceiro (despesa) que JÁ está lançado sem anexo:
--    a despesa paga com o mesmo valor, em até 3 dias da data lida, e sem comprovante. Só quando há uma única.
create or replace function public.conv_svc_ai_admin_receipt(p_session uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_admin uuid; v_intent uuid; v_amount bigint; v_paid_on date; v_n int; v_entry uuid; v_desc text; v_on date;
begin
  r := conv_private.ai_admin_receipt(p_session, p_message);
  if not coalesce((r->>'found')::boolean, false) or r->>'status' <> 'staged' or coalesce((r->>'duplicate')::boolean, false)
     or (r->>'payee_ok')::boolean is distinct from false then
    return r;
  end if;
  v_amount := nullif(r->>'amount_cents', '')::bigint;
  v_paid_on := nullif(r->>'paid_on', '')::date;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_amount is null or v_paid_on is null or v_admin is null then return r; end if;
  select i.id into v_intent from fin_private.whatsapp_receipt_intents i
   where i.source_message_id = p_message and i.profile_id = v_admin and i.status = 'awaiting_purpose' and i.finance_entry_id is null;
  if v_intent is null then return r; end if;
  select count(*), min(e.id::text)::uuid into v_n, v_entry
  from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id and x.kind = 'payment'
  where e.kind = 'expense' and e.status = 'paid' and e.amount_cents = v_amount
    and x.paid_on between v_paid_on - 3 and v_paid_on + 3
    and not exists (select 1 from public.fin_attachments f where f.entry_id = e.id)
    and not exists (select 1 from fin_private.cash_removed d where d.source_type = 'entry_payment' and d.source_id = x.id::text);
  if v_n <> 1 then return r; end if;
  if not conv_private.attach_receipt_to_entry(v_intent, v_entry, v_admin) then return r; end if;
  select e.description, max(x.paid_on) into v_desc, v_on from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
   where e.id = v_entry group by e.description;
  return r || jsonb_build_object('attached_entry', jsonb_build_object('id', v_entry, 'description', v_desc, 'paid_on', v_on));
end $$;
revoke all on function public.conv_svc_ai_admin_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_receipt(uuid, uuid) to service_role;

