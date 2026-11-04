-- Mensalidade com despesas abatidas (Ítalo, 04/11/2026): o clube paga ao Ítalo o custo do aplicativo (R$ 148) e,
-- a partir de 11/2026, o do agente de IA (R$ 23). Ele paga a mensalidade já com esses valores descontados.
-- Uma despesa recorrente pode ficar "abatida da mensalidade" de um sócio (fin_recurrences.offset_profile_id).
-- Quando o comprovante cobre a mensalidade menos as despesas abatidas daquele mês, a baixa quita a mensalidade
-- inteira e paga as despesas na mesma data e conta: o saldo líquido da conta é o valor do Pix e o DRE fica certo.
-- Vale para a baixa automática do João, a aprovação pelo WhatsApp e a aprovação no painel (todas passam por fin_approve_receipt).

alter table public.fin_recurrences add column if not exists offset_profile_id uuid references public.profiles(id);
comment on column public.fin_recurrences.offset_profile_id is 'Sócio que desconta esta despesa da própria mensalidade (o clube paga a ele abatendo).';

-- Despesas do mês da mensalidade que o sócio abate, com o que falta pagar de cada uma.
create or replace function fin_private.member_offsets(p_charge uuid)
returns table(entry_id uuid, description text, remaining_cents bigint)
language sql stable security definer set search_path = '' as $$
  select e.id, e.description, e.amount_cents - fin_private.entry_paid_cents(e.id)
  from public.fin_member_charges c
  join public.fin_recurrences r on r.offset_profile_id = c.profile_id
  join public.fin_entries e on e.recurrence_id = r.id and e.competence_date = c.competence_month
  where c.id = p_charge and c.charge_type = 'membership' and c.status in ('open', 'partial')
    and e.kind = 'expense' and e.status in ('pending', 'partial')
    and e.amount_cents - fin_private.entry_paid_cents(e.id) > 0
  order by e.description, e.id;
$$;

create or replace function fin_private.member_offset_cents(p_charge uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.remaining_cents), 0)::bigint from fin_private.member_offsets(p_charge) o;
$$;

revoke all on function fin_private.member_offsets(uuid) from public, anon, authenticated;
revoke all on function fin_private.member_offset_cents(uuid) from public, anon, authenticated;

-- Valor pago + despesas abatidas = saldo da mensalidade: quita a mensalidade e paga as despesas na mesma conta.
create or replace function fin_private.settle_member_offsets(p_charge uuid, p_paid_on date, p_account uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare o record; v_total bigint := 0; v_note text;
begin
  select 'Abatido da mensalidade ' || to_char(c.competence_month, 'MM/YYYY') || ' de ' || p.name into v_note
  from public.fin_member_charges c join public.profiles p on p.id = c.profile_id where c.id = p_charge;
  for o in select * from fin_private.member_offsets(p_charge) loop
    perform fin_private.add_entry_payment(o.entry_id, o.remaining_cents, p_paid_on, p_account, v_note, true, gen_random_uuid());
    v_total := v_total + o.remaining_cents;
  end loop;
  return v_total;
end $$;
revoke all on function fin_private.settle_member_offsets(uuid, date, uuid) from public, anon, authenticated;

create or replace function public.fin_approve_receipt(p_request_id uuid, p_submission_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_receipt_submissions%rowtype; a jsonb; w jsonb; v_res jsonb; v_ids uuid[] := '{}';
  v_paid_on date := (p_data->>'paid_on')::date; v_method text := coalesce(p_data->>'method', 'pix'); v_account uuid := (p_data->>'account_id')::uuid;
  v_total bigint := 0; v_i integer := 0; v_wres jsonb; v_charge uuid; v_amount bigint; v_offset bigint; v_offset_total bigint := 0;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'receipt_approve', p_data->>'note');
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_receipt_submissions where id = p_submission_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status not in ('submitted', 'in_review') then raise exception 'RECEIPT_NOT_PENDING'; end if;
  if jsonb_typeof(p_data->'allocations') <> 'array' or jsonb_array_length(p_data->'allocations') = 0 then raise exception 'NO_CHARGES_SELECTED'; end if;

  -- Dispensas de encargo primeiro, para o pagamento já calcular com elas.
  for w in select * from jsonb_array_elements(coalesce(p_data->'waivers', '[]'::jsonb)) loop
    if not exists (select 1 from public.fin_member_charges c where c.id = (w->>'charge_id')::uuid and c.profile_id = s.profile_id) then
      raise exception 'INVALID_CHARGES';
    end if;
    perform fin_private.waive_fees((w->>'charge_id')::uuid, (w->>'amount_cents')::bigint, w->>'reason', v_paid_on, gen_random_uuid());
  end loop;

  for a in select * from jsonb_array_elements(p_data->'allocations') loop
    v_i := v_i + 1;
    v_charge := (a->>'charge_id')::uuid;
    v_amount := (a->>'amount_cents')::bigint;
    -- Só cobranças do próprio sócio que enviou.
    if not exists (select 1 from public.fin_member_charges c where c.id = v_charge and c.profile_id = s.profile_id) then
      raise exception 'INVALID_CHARGES';
    end if;
    -- Pix da mensalidade já com as despesas abatidas: quita a mensalidade inteira e paga as despesas.
    v_offset := case when v_account is null then 0 else fin_private.member_offset_cents(v_charge) end;
    if v_offset > 0 and v_amount + v_offset = (select st.total_due from fin_private.charge_statement(v_charge, v_paid_on) st) then
      perform fin_private.settle_member_offsets(v_charge, v_paid_on, v_account);
      v_amount := v_amount + v_offset;
      v_offset_total := v_offset_total + v_offset;
    end if;
    v_res := fin_private.apply_payment(v_charge, v_amount, v_paid_on, v_method, v_account,
      p_submission_id, null, 'Comprovante aprovado', gen_random_uuid());
    v_ids := v_ids || (v_res->>'payment_id')::uuid;
    v_total := v_total + v_amount;
  end loop;

  update public.fin_receipt_submissions set status = 'approved', reviewed_by = v_actor, reviewed_at = now(),
    decision_reason = nullif(trim(p_data->>'note'), ''), approved_payment_ids = v_ids, version = version + 1, updated_at = now()
  where id = p_submission_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_submission_id, 'status', 'approved', 'payment_ids', to_jsonb(v_ids),
    'total_cents', v_total, 'offset_cents', v_offset_total));
end $$;

-- Baixa automática: o Pix pode vir cheio ou com as despesas abatidas daquele mês; a divergência informa o valor líquido.

CREATE OR REPLACE FUNCTION public.conv_svc_receipt_membership_auto(p_stage uuid, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; pr public.profiles%rowtype;
  v_admin uuid; v_admin_name text; v_contact uuid; v_conv uuid; v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_month date := date_trunc('month', (now() at time zone 'America/Fortaleza'))::date; v_amount bigint; v_paid_on date; v_payee text;
  v_hash text; v_reference text; v_issue text; v_requested_month date; v_charge_month date; v_charge uuid; v_due bigint; v_type text; v_desc text; v_n int; v_account uuid; v_prev_claims text; v_prev_sub text; v_err text; v_res jsonb;
  v_offset bigint; v_offset_items text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_stage for update;
  if not found or s.status <> 'awaiting_purpose' then return jsonb_build_object('applied', false, 'reason', 'NOT_PENDING'); end if;
  select * into pr from public.profiles where id = s.profile_id;
  if pr.id is null or pr.role::text not in ('socio', 'admin') or not coalesce(pr.is_active, false) then
    return jsonb_build_object('applied', false, 'reason', 'NOT_ACTIVE_MEMBER');
  end if;
  d := s.original_data;
  v_issue := fin_private.receipt_payment_issue(d, v_today);
  if v_issue is not null then return jsonb_build_object('applied', false, 'reason', v_issue); end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object'
     or coalesce(p_context->>'purpose_kind', 'membership') not in ('membership', 'member_pendency') then
    return jsonb_build_object('applied', false, 'reason', 'INVALID_CONTEXT');
  end if;
  begin
    v_requested_month := nullif(p_context->>'month', '')::date;
    if v_requested_month is not null and extract(day from v_requested_month) <> 1 then
      return jsonb_build_object('applied', false, 'reason', 'INVALID_CONTEXT');
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('applied', false, 'reason', 'INVALID_CONTEXT');
  end;
  -- Serializa recibos da mesma pessoa e reenvios do mesmo Pix, mesmo em arquivos diferentes.
  perform pg_advisory_xact_lock(hashtextextended('membership-profile:' || s.profile_id::text, 0));
  v_amount := nullif(d->>'declared_amount_cents', '')::bigint;
  v_paid_on := (d->>'declared_paid_on')::date;
  v_payee := nullif(trim(coalesce(d->'ocr'->>'payee', '')), '');
  v_hash := lower(coalesce(d->>'content_sha256', ''));
  v_reference := nullif(regexp_replace(upper(coalesce(d->>'declared_reference', d->'ocr'->>'identifier', '')), '[^A-Z0-9]', '', 'g'), '');
  perform pg_advisory_xact_lock(hashtextextended('receipt-hash:' || v_hash, 0));
  if length(v_reference) >= 6 then
    perform pg_advisory_xact_lock(hashtextextended('receipt-reference:' || v_reference, 0));
    if exists (select 1 from public.fin_receipt_submissions r
      where r.status in ('submitted', 'in_review', 'approved')
        and regexp_replace(upper(coalesce(r.declared_reference, r.ocr->>'identifier', '')), '[^A-Z0-9]', '', 'g') = v_reference) then
      return jsonb_build_object('applied', false, 'reason', 'DUPLICATE');
    end if;
  end if;
  select * into fs from public.fin_settings where id;
  if v_amount is null or v_amount <= 0 then return jsonb_build_object('applied', false, 'reason', 'AMOUNT_NOT_READ'); end if;
  if not fin_private.cnpj_matches(nullif(trim(d->'ocr'->>'payee_document'), ''), fs.pix_key)
     and (v_payee is null or not fin_private.payee_matches(v_payee, fs.payee_names)) then return jsonb_build_object('applied', false, 'reason', 'PAYEE'); end if;
  if v_hash !~ '^[0-9a-f]{64}$' or exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved'))
     or exists (select 1 from fin_private.whatsapp_receipt_intents o where o.id <> s.id and o.original_data->>'content_sha256' = v_hash
                and o.status in ('confirmed', 'escalated', 'needs_review')) then
    return jsonb_build_object('applied', false, 'reason', 'DUPLICATE');
  end if;

  -- O valor sozinho não escolhe entre meses ou finalidades. Competência explícita filtra antes da contagem.
  select count(*) into v_n from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and (st.total_due = v_amount or st.total_due - fin_private.member_offset_cents(c.id) = v_amount)
    and (c.charge_type <> 'membership' or c.competence_month <= v_month)
    and (v_requested_month is null or (c.charge_type = 'membership' and c.competence_month = v_requested_month))
    and (p_context->>'purpose_kind' is null or c.charge_type = p_context->>'purpose_kind');
  if v_n > 1 then return jsonb_build_object('applied', false, 'reason', 'AMBIGUOUS'); end if;
  select c.id, st.total_due, c.charge_type, c.description, c.competence_month into v_charge, v_due, v_type, v_desc, v_charge_month
  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and (st.total_due = v_amount or st.total_due - fin_private.member_offset_cents(c.id) = v_amount)
    and (c.charge_type <> 'membership' or c.competence_month <= v_month)
    and (v_requested_month is null or (c.charge_type = 'membership' and c.competence_month = v_requested_month))
    and (p_context->>'purpose_kind' is null or c.charge_type = p_context->>'purpose_kind')
  order by c.due_date, c.id limit 1;
  if v_charge is null then
    select st.total_due - fin_private.member_offset_cents(c.id) into v_due from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
    where c.profile_id = s.profile_id and c.charge_type = 'membership' and c.competence_month = coalesce(v_requested_month, v_month) and c.status in ('open', 'partial')
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

  -- Antes da baixa: depois dela as despesas abatidas já estão pagas.
  -- Pix cheio: nada a abater.
  v_offset := case when v_due = v_amount then 0 else fin_private.member_offset_cents(v_charge) end;
  select string_agg(o.description || ' ' || replace(trim(to_char(o.remaining_cents::numeric / 100, 'FM999999990D00')), '.', ','), ', ') into v_offset_items
  from fin_private.member_offsets(v_charge) o where v_offset > 0;
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
  insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, request_id, source, source_message_id)
  values (s.id, s.profile_id, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
    v_amount, v_paid_on, d->>'declared_reference', case when v_type = 'membership' then 'Mensalidade pelo WhatsApp (baixa automática do João)' else 'Pendência pelo WhatsApp (baixa automática do João)' end,
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, s.id, 'whatsapp', s.source_message_id);

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
    return jsonb_build_object('applied', false, 'reason', 'APPROVE_FAILED', 'error', left(v_err, 120));
  end if;

  update fin_private.whatsapp_receipt_intents set status = 'confirmed',
    purpose_kind = case when v_type = 'membership' then 'membership' else 'member_pendency' end,
    purpose_detail = left(case when v_type = 'membership' then 'Mensalidade de ' || to_char(v_charge_month, 'MM/YYYY')
      else coalesce(v_desc, 'Pendência') end || ' (baixa automática)', 200), finance_submission_id = s.id, updated_at = now()
  where id = s.id;

  select c.id into v_contact from public.conv_contacts c where c.profile_id = v_admin and not coalesce(c.opt_out, false)
   order by c.updated_at desc nulls last limit 1;
  if v_contact is not null then v_conv := conv_private.open_direct(v_contact); end if;
  return jsonb_build_object('applied', true, 'month', v_charge_month, 'charge_type', v_type, 'description', v_desc, 'amount_cents', v_amount, 'charge_id', v_charge,
    'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', pr.name,
    'offset_cents', v_offset, 'offset_items', v_offset_items);
end $function$;

revoke all on function public.conv_svc_receipt_membership_auto(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_membership_auto(uuid, jsonb) to service_role;


-- O que um sócio abate da mensalidade todo mês (despesas recorrentes ativas).
create or replace function fin_private.member_offset_plan(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('description', r.description, 'amount_cents', r.amount_cents,
    'start_month', r.start_month) order by r.start_month, r.description), '[]'::jsonb)
  from public.fin_recurrences r
  where r.offset_profile_id = p_profile and r.active
    and (r.end_month is null or r.end_month >= date_trunc('month', fin_private.today())::date);
$$;
revoke all on function fin_private.member_offset_plan(uuid) from public, anon, authenticated;

-- Ficha do sócio: o João vê o que é abatido da mensalidade (e por isso o Pix vem menor).
create or replace function public.conv_svc_ai_admin_read_more(p_session uuid, p_domain text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb := conv_private.ai_admin_read_more(p_session, p_domain, coalesce(p_args, '{}'::jsonb)); v_profile uuid;
begin
  if p_domain <> 'socio_ficha' or not coalesce((v_res->>'ok')::boolean, false) then return v_res; end if;
  v_profile := nullif(p_args->>'profile_id', '')::uuid;
  return jsonb_set(v_res, '{data,offsets}', fin_private.member_offset_plan(v_profile));
exception when invalid_text_representation then
  return v_res;
end $$;
revoke all on function public.conv_svc_ai_admin_read_more(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_read_more(uuid, text, jsonb) to service_role;

-- Aprovação pelo WhatsApp: a proposta já diz que o comprovante vem com as despesas abatidas.
create or replace function conv_private.receipt_proposal_offsets(p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a jsonb; v_charge uuid; v_off bigint; v_total bigint := 0; v_items text[] := '{}'; v_paid_on date := (p_payload->>'paid_on')::date;
begin
  for a in select * from jsonb_array_elements(coalesce(p_payload->'allocations', '[]'::jsonb)) loop
    v_charge := (a->>'charge_id')::uuid;
    v_off := fin_private.member_offset_cents(v_charge);
    if v_off > 0 and (a->>'amount_cents')::bigint + v_off = (select st.total_due from fin_private.charge_statement(v_charge, v_paid_on) st) then
      v_total := v_total + v_off;
      v_items := v_items || array(select o.description || ' ' || replace(trim(to_char(o.remaining_cents::numeric / 100, 'FM999999990D00')), '.', ',')
                                  from fin_private.member_offsets(v_charge) o);
    end if;
  end loop;
  if v_total = 0 then return '{}'::jsonb; end if;
  return jsonb_build_object('offset_cents', v_total, 'offset_items', array_to_string(v_items, ', '));
end $$;
revoke all on function conv_private.receipt_proposal_offsets(jsonb) from public, anon, authenticated, service_role;

create or replace function public.conv_svc_ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_off jsonb;
begin
  begin
    perform conv_private.admin_receipt_to_member(p_session, p);
  exception when invalid_text_representation then null;
  end;
  v_res := conv_private.ai_admin_finance_propose(p_session, p);
  if v_res->>'action' is distinct from 'fin_receipt_approve' or not coalesce((v_res->>'ok')::boolean, false) then return v_res; end if;
  v_off := conv_private.receipt_proposal_offsets(v_res->'summary');
  if v_off = '{}'::jsonb then return v_res; end if;
  update public.conv_booking_proposals set payload = payload || v_off where id = (v_res->>'proposal_id')::uuid;
  return jsonb_set(v_res, '{summary}', (v_res->'summary') || v_off);
exception when invalid_text_representation then
  return conv_private.ai_admin_finance_propose(p_session, p);
end $$;
revoke all on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) to service_role;

-- Dados do Ítalo: o custo do aplicativo passa a ser abatido da mensalidade dele, e entra o custo do agente de IA
-- (R$ 23 por mês, a partir de 11/2026), na mesma categoria, conta e vencimento. Em banco sem esses dados, nada acontece.
do $$
declare v_italo uuid; v_app public.fin_recurrences%rowtype; v_ia uuid;
begin
  select id into v_italo from public.profiles where lower(email) = 'italomcangussu@icloud.com';
  select * into v_app from public.fin_recurrences where description = 'Custo aplicativo' and active order by created_at limit 1;
  if v_italo is null or v_app.id is null then return; end if;
  update public.fin_recurrences set offset_profile_id = v_italo,
    notes = coalesce(notes, 'Abatido da mensalidade do Ítalo Cangussú'), version = version + 1, updated_at = now()
  where id = v_app.id;
  if not exists (select 1 from public.fin_recurrences where description = 'Custo agente de IA') then
    insert into public.fin_recurrences(description, supplier, category_id, amount_cents, frequency, due_day, due_month_offset,
      start_month, account_id, notes, active, offset_profile_id, created_by, updated_by)
    values ('Custo agente de IA', v_app.supplier, v_app.category_id, 2300, 'monthly', v_app.due_day, v_app.due_month_offset,
      '2026-11-01', v_app.account_id, 'Agente de IA (João). Abatido da mensalidade do Ítalo Cangussú', true, v_italo, v_italo, v_italo)
    returning id into v_ia;
    perform fin_private.generate_recurrences(v_ia, null);
  end if;
end $$;
