-- Pix do torneio: o CNPJ do favorecido igual à chave Pix do clube confirma o favorecido (caso Bruno, 28/10).
-- O PDF dele trazia o CNPJ do clube, mas o leitor pegou a palavra "Recebedor" como nome do favorecido, e a conferência,
-- que só olhava o nome, respondeu que o clube não era o favorecido. A baixa da mensalidade já aceitava o CNPJ
-- (20261008101944); a inscrição passa a aceitar também. O resto da função é o mesmo de 20261026180000.

create or replace function public.conv_svc_receipt_championship_auto(p_stage uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; c public.championships%rowtype; x public.championship_signups%rowtype;
  v_today date := (now() at time zone 'America/Fortaleza')::date; v_amount bigint; v_paid_on date; v_payee text; v_hash text;
  v_n int; v_total bigint; v_price bigint; v_ids uuid[]; v_admin uuid; v_admin_name text; v_account uuid; v_category uuid; v_entry uuid;
  v_prev_claims text; v_prev_sub text; v_err text; v_res jsonb; v_names text; v_reg uuid; v_ok text[] := '{}'; v_wait text[] := '{}';
  v_sender text; v_contact uuid; v_conv uuid; v_pending jsonb; v_champ uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_stage for update;
  if not found or s.status <> 'awaiting_purpose' then return jsonb_build_object('applied', false, 'reason', 'NOT_PENDING'); end if;
  select array_agg(z.id order by z.created_at), count(*), coalesce(sum(z.amount_cents), 0), min(z.championship_id::text)::uuid
    into v_ids, v_n, v_total, v_champ
  from public.championship_signups z where z.registered_by_contact_id = s.contact_id and z.status = 'pre';
  if v_n = 0 then return jsonb_build_object('applied', false, 'reason', 'NO_SIGNUP'); end if;
  select * into c from public.championships where id = v_champ;
  v_pending := (select jsonb_agg(jsonb_build_object('name', z.full_name, 'class', z.class) order by z.created_at)
                from public.championship_signups z where z.id = any(v_ids));

  d := s.original_data;
  v_amount := nullif(d->>'declared_amount_cents', '')::bigint;
  v_paid_on := least(coalesce(nullif(d->>'declared_paid_on', '')::date, v_today), v_today);
  v_payee := nullif(trim(coalesce(d->'ocr'->>'payee', '')), '');
  v_hash := lower(coalesce(d->>'content_sha256', ''));
  select * into fs from public.fin_settings where id;
  if v_amount is null or v_amount <= 0 then return jsonb_build_object('applied', false, 'reason', 'AMOUNT_NOT_READ', 'pending', v_pending, 'total_cents', v_total); end if;
  -- O CNPJ do favorecido igual à chave Pix (CNPJ) do clube basta, como na baixa da mensalidade; sem ele, vale o nome.
  if not fin_private.cnpj_matches(nullif(trim(d->'ocr'->>'payee_document'), ''), fs.pix_key)
     and (v_payee is null or not fin_private.payee_matches(v_payee, fs.payee_names)) then
    return jsonb_build_object('applied', false, 'reason', 'PAYEE', 'pending', v_pending, 'total_cents', v_total, 'amount_cents', v_amount);
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' or exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved'))
     or exists (select 1 from fin_private.whatsapp_receipt_intents o where o.id <> s.id and o.original_data->>'content_sha256' = v_hash
                and o.status in ('confirmed', 'escalated', 'needs_review')) then
    return jsonb_build_object('applied', false, 'reason', 'DUPLICATE');
  end if;
  -- Paga todas as pendentes, ou a única pendente. Outro valor não adivinha qual atleta foi pago.
  if v_amount <> v_total then
    return jsonb_build_object('applied', false, 'reason', case when v_n > 1 and v_amount < v_total then 'AMBIGUOUS' else 'AMOUNT_MISMATCH' end,
      'pending', v_pending, 'total_cents', v_total, 'amount_cents', v_amount);
  end if;

  select p.id, p.name into v_admin, v_admin_name from public.profiles p
   where p.id = fs.finance_admin_profile_id and p.role::text = 'admin' and coalesce(p.is_active, true);
  if v_admin is null then return jsonb_build_object('applied', false, 'reason', 'NO_FINANCE_ADMIN', 'pending', v_pending, 'total_cents', v_total); end if;
  select a.id into v_account from public.fin_accounts a where a.active and a.is_default_receipts limit 1;
  if v_account is null then select min(a.id::text)::uuid into v_account from public.fin_accounts a where a.active having count(*) = 1; end if;
  select k.id into v_category from public.fin_categories k
   where k.kind = 'revenue' and k.active and k.name = coalesce(c.joao_info->>'category_name', 'Inscrição Serra e Sertão') limit 1;
  if v_account is null or v_category is null then return jsonb_build_object('applied', false, 'reason', 'ACCOUNT', 'pending', v_pending, 'total_cents', v_total); end if;
  select ct.name into v_sender from public.conv_contacts ct where ct.id = s.contact_id;
  select string_agg(z.full_name, ', ' order by z.created_at) into v_names from public.championship_signups z where z.id = any(v_ids);

  -- O lançamento é do responsável pelo financeiro (fin_create_entry exige administrador), como na baixa automática da mensalidade.
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    v_res := public.fin_create_entry(md5(s.id::text || 'championship-signup')::uuid, jsonb_build_object(
      'kind', 'revenue', 'status', 'paid', 'amount_cents', v_amount, 'paid_on', v_paid_on, 'competence_date', v_paid_on,
      'account_id', v_account, 'category_id', v_category, 'supplier', left(coalesce(v_sender, 'WhatsApp'), 120),
      'description', left('Inscrição ' || c.name || ': ' || v_names, 140),
      'notes', 'Pix conferido pelo João (valor e favorecido) a partir do comprovante do WhatsApp.'));
    v_entry := (v_res->>'id')::uuid;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null or v_entry is null then
    return jsonb_build_object('applied', false, 'reason', 'ENTRY_FAILED', 'error', left(coalesce(v_err, 'sem id'), 120), 'pending', v_pending, 'total_cents', v_total);
  end if;

  insert into public.fin_attachments (entry_id, storage_path, bucket, file_name, content_type, size_bytes, uploaded_by)
  values (v_entry, d->>'storage_path', 'fin-receipts', left(coalesce(nullif(d->>'file_name', ''), 'comprovante'), 200),
    coalesce(d->>'content_type', 'application/octet-stream'), coalesce((d->>'size_bytes')::integer, 1), v_admin)
  on conflict (storage_path) do nothing;
  update fin_private.whatsapp_receipt_intents set status = 'confirmed', purpose_kind = 'other',
    purpose_detail = left('Inscrição ' || c.name || ': ' || v_names, 200), finance_entry_id = v_entry, updated_at = now()
  where id = s.id;

  -- Cada atleta entra na classe; quem chegou com a classe já cheia fica pago na lista de espera.
  for x in select * from public.championship_signups z where z.id = any(v_ids) order by z.created_at for update loop
    perform pg_advisory_xact_lock(hashtext(x.championship_id::text || x.class));
    if conv_private.champ_confirmed(x.championship_id, x.class) < coalesce((c.joao_info->>'max_per_class')::int, 16) then
      insert into public.championship_registrations (championship_id, participant_type, user_id, guest_name, class, shirt_size, registered_by, guest_cidade)
      values (x.championship_id, case when x.profile_id is null then 'guest' else 'socio' end, x.profile_id,
        case when x.profile_id is null then x.full_name end, x.class, x.shirt_size, v_admin, x.city)
      returning id into v_reg;
      update public.championship_signups set status = 'confirmed', registration_id = v_reg, paid_at = now(), receipt_intent_id = s.id, fin_entry_id = v_entry where id = x.id;
      v_ok := v_ok || x.full_name;
    else
      update public.championship_signups set status = 'waitlist', paid_at = now(), receipt_intent_id = s.id, fin_entry_id = v_entry where id = x.id;
      v_wait := v_wait || x.full_name;
    end if;
  end loop;

  select ct.id into v_contact from public.conv_contacts ct where ct.profile_id = v_admin and not coalesce(ct.opt_out, false)
   order by ct.updated_at desc nulls last limit 1;
  if v_contact is not null then v_conv := conv_private.open_direct(v_contact); end if;
  return jsonb_build_object('applied', true, 'championship', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'amount_cents', v_amount,
    'paid_on', v_paid_on, 'payee', v_payee,
    'athletes', (select jsonb_agg(conv_private.champ_signup_json(z) order by z.created_at) from public.championship_signups z where z.id = any(v_ids)),
    'media_path', (select m.media_path from public.conv_messages m where m.id = s.source_message_id),
    'media_mime', (select m.media_mime from public.conv_messages m where m.id = s.source_message_id),
    'media_name', (select coalesce(m.media_name, d->>'file_name') from public.conv_messages m where m.id = s.source_message_id),
    'media_kind', (select m.kind from public.conv_messages m where m.id = s.source_message_id), 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait),
    'entry_id', v_entry, 'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', coalesce(v_sender, 'Atleta'));
end $$;
revoke all on function public.conv_svc_receipt_championship_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_championship_auto(uuid) to service_role;

-- Rollback: reaplicar a função de 20261026180000_serra_sertao_aviso_financeiro.sql.
