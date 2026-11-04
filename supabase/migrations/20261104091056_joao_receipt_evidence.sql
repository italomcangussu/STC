-- Comprovantes: evidência legível, competência explícita e transação única antes da baixa.
-- Sem backfill: preserva lançamentos existentes e mantém a assinatura antiga para clientes publicados.
create or replace function fin_private.receipt_payment_issue(d jsonb, today date) returns text
language plpgsql set search_path = '' as $$
begin
  if d->'ocr'->>'payment_status' in ('scheduled', 'pending', 'failed') then return 'PAYMENT_NOT_COMPLETED'; end if;
  if d->>'ocr_status' is distinct from 'ok'
     or d#>>'{ocr,confidence,amount}' is distinct from 'high'
     or d#>>'{ocr,confidence,date}' is distinct from 'high'
     or d->>'declared_amount_cents' is distinct from d->'ocr'->>'amount_cents'
     or d->>'declared_paid_on' is distinct from d->'ocr'->>'paid_on' then return 'OCR_UNCERTAIN'; end if;
  if nullif(d->>'declared_paid_on', '') is null or (d->>'declared_paid_on')::date > today then
    return 'INVALID_PAYMENT_DATE';
  end if;
  return null;
exception when invalid_datetime_format or datetime_field_overflow then
  return 'INVALID_PAYMENT_DATE';
end $$;
revoke all on function fin_private.receipt_payment_issue(jsonb, date) from public, anon, authenticated;

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
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and st.total_due = v_amount
    and (c.charge_type <> 'membership' or c.competence_month <= v_month)
    and (v_requested_month is null or (c.charge_type = 'membership' and c.competence_month = v_requested_month))
    and (p_context->>'purpose_kind' is null or c.charge_type = p_context->>'purpose_kind');
  if v_n > 1 then return jsonb_build_object('applied', false, 'reason', 'AMBIGUOUS'); end if;
  select c.id, st.total_due, c.charge_type, c.description, c.competence_month into v_charge, v_due, v_type, v_desc, v_charge_month
  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.status in ('open', 'partial') and st.total_due = v_amount
    and (c.charge_type <> 'membership' or c.competence_month <= v_month)
    and (v_requested_month is null or (c.charge_type = 'membership' and c.competence_month = v_requested_month))
    and (p_context->>'purpose_kind' is null or c.charge_type = p_context->>'purpose_kind')
  order by c.due_date, c.id limit 1;
  if v_charge is null then
    select st.total_due into v_due from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
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
    'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', pr.name);
end $function$;

revoke all on function public.conv_svc_receipt_membership_auto(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_membership_auto(uuid, jsonb) to service_role;

-- Chamadas antigas ficam sujeitas às mesmas guardas; não há preferência implícita pelo mês atual.
create or replace function public.conv_svc_receipt_membership_auto(p_stage uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select public.conv_svc_receipt_membership_auto(p_stage, '{}'::jsonb);
$$;
revoke all on function public.conv_svc_receipt_membership_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_membership_auto(uuid) to service_role;
