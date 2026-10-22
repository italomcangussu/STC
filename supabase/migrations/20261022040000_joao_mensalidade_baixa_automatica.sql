-- Época da mensalidade: do dia 1 do mês até o sócio pagar, o João ESPERA o comprovante da mensalidade dele.
-- Decisão do clube (21/10): se tudo bate, o João dá baixa sozinho e avisa o financeiro. "Bate" quer dizer:
--   * quem manda é sócio ativo (não administrador) e tem a cobrança de mensalidade DO MÊS em aberto;
--   * o valor lido é exatamente o total devido hoje (principal + encargos, se houver);
--   * o favorecido lido é o clube (fin_settings.payee_names) e o arquivo não foi usado antes.
-- Qualquer divergência (valor diferente, favorecido não lido ou de outro, sem cobrança do mês, arquivo repetido):
-- nada é baixado; o turno segue o caminho normal (pergunta a que se refere e repassa ao financeiro).
-- A baixa roda como o responsável financeiro, pelas mesmas funções do painel (fin_approve_receipt).

create or replace function public.conv_svc_receipt_membership_auto(p_stage uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; pr public.profiles%rowtype;
  v_admin uuid; v_admin_name text; v_contact uuid; v_conv uuid; v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_month date := date_trunc('month', (now() at time zone 'America/Fortaleza'))::date; v_amount bigint; v_paid_on date; v_payee text;
  v_hash text; v_charge uuid; v_due bigint; v_account uuid; v_prev_claims text; v_prev_sub text; v_err text; v_res jsonb;
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

  -- Cobrança de mensalidade do mês ainda aberta, com o total devido igual ao comprovante.
  select c.id, st.total_due into v_charge, v_due
  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_paid_on) st
  where c.profile_id = s.profile_id and c.charge_type = 'membership' and c.competence_month = v_month and c.status in ('open', 'partial')
  order by c.due_date limit 1;
  if v_charge is null then return jsonb_build_object('applied', false, 'reason', 'NO_OPEN_CHARGE'); end if;
  if v_due <> v_amount then return jsonb_build_object('applied', false, 'reason', 'AMOUNT_MISMATCH', 'due_cents', v_due); end if;

  select p.id, p.name into v_admin, v_admin_name from public.profiles p
   where p.id = fs.finance_admin_profile_id and p.role::text = 'admin' and coalesce(p.is_active, true);
  if v_admin is null then return jsonb_build_object('applied', false, 'reason', 'NO_FINANCE_ADMIN'); end if;
  select a.id into v_account from public.fin_accounts a where a.active and a.is_default_receipts limit 1;
  if v_account is null then select min(a.id::text)::uuid into v_account from public.fin_accounts a where a.active having count(*) = 1; end if;
  if v_account is null then return jsonb_build_object('applied', false, 'reason', 'ACCOUNT'); end if;

  insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, request_id, source, source_message_id)
  values (s.id, s.profile_id, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
    v_amount, v_paid_on, d->>'declared_reference', 'Mensalidade do mês pelo WhatsApp (baixa automática do João)',
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, s.id, 'whatsapp', s.source_message_id);

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    v_res := public.fin_approve_receipt(md5(s.id::text || 'auto-membership')::uuid, s.id, jsonb_build_object(
      'paid_on', v_paid_on, 'method', 'pix', 'account_id', v_account,
      'allocations', jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_amount)),
      'note', 'Mensalidade do mês: comprovante do WhatsApp com valor e favorecido conferidos pelo João'));
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null then
    delete from public.fin_receipt_submissions where id = s.id and status = 'submitted';
    return jsonb_build_object('applied', false, 'reason', 'APPROVE_FAILED', 'error', left(v_err, 120));
  end if;

  update fin_private.whatsapp_receipt_intents set status = 'confirmed', purpose_kind = 'membership',
    purpose_detail = 'Mensalidade de ' || to_char(v_month, 'MM/YYYY') || ' (baixa automática)', finance_submission_id = s.id, updated_at = now()
  where id = s.id;

  select c.id into v_contact from public.conv_contacts c where c.profile_id = v_admin and not coalesce(c.opt_out, false)
   order by c.updated_at desc nulls last limit 1;
  if v_contact is not null then v_conv := conv_private.open_direct(v_contact); end if;
  return jsonb_build_object('applied', true, 'month', v_month, 'amount_cents', v_amount, 'charge_id', v_charge,
    'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', pr.name);
end $$;
revoke all on function public.conv_svc_receipt_membership_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_membership_auto(uuid) to service_role;
