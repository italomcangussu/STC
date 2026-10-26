-- Serra e Sertão 2026: mensagens de inscrição no modelo pedido pela organização (Hermeson, 26/10).
-- O evento se apresenta como "AUGE OPEN · 3ª Etapa do Circuito Serra e Sertão de Tênis": esse título vai em joao_info.title
-- e as funções do João devolvem o título e, na confirmação pelo comprovante, o cartão de cada atleta (classe, camisa,
-- telefone, situação) e o que o comprovante mostrou (data e favorecido), para a mensagem de confirmação dispensar dados bancários.

update public.championships
set joao_info = joao_info
  || jsonb_build_object('title', jsonb_build_array('AUGE OPEN', '3ª Etapa do Circuito Serra e Sertão de Tênis'))
  || jsonb_build_object('info', (joao_info->>'info') || E'\n' ||
       'Nome do evento: AUGE OPEN, a 3ª Etapa do Circuito Serra e Sertão de Tênis (Serra e Sertão 2026 é o mesmo campeonato).')
where slug = 'serra-e-sertao-2026' and joao_info->'title' is null;

create or replace function public.conv_svc_ai_championship_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_contact uuid; v_phone text; v_pk text; v_admin uuid; fs public.fin_settings%rowtype; c public.championships%rowtype; v_list jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select s.requester_contact_id, ct.phone into v_contact, v_phone
  from public.conv_ai_sessions s join public.conv_contacts ct on ct.id = s.requester_contact_id where s.id = p_session;
  if v_contact is null then return null; end if;
  v_pk := conv_private.phone_key(v_phone);
  v_admin := conv_private.ai_admin_requester(p_session);
  select * into fs from public.fin_settings where id;
  for c in select * from public.championships x
           where coalesce((x.joao_info->>'enabled')::boolean, false) and x.status in ('draft', 'ongoing') order by x.start_date loop
    v_list := v_list || jsonb_build_object(
      'id', c.id, 'name', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'start_date', c.start_date, 'end_date', c.end_date, 'status', c.status,
      'info', c.joao_info->>'info', 'price_cents', (c.joao_info->>'price_cents')::bigint, 'shirt_sizes', c.joao_info->'shirt_sizes',
      'max_per_class', coalesce((c.joao_info->>'max_per_class')::int, 16), 'deadline', c.joao_info->>'deadline',
      'registration_open', conv_private.champ_open(c.id), 'shirt_image', case when c.joao_info->'shirt_image'->>'path' is not null then c.joao_info->'shirt_image' end,
      'classes', conv_private.champ_classes(c.id),
      'mine', (select coalesce(jsonb_agg(conv_private.champ_signup_json(s) order by s.created_at), '[]'::jsonb)
               from public.championship_signups s
               where s.championship_id = c.id and s.status <> 'canceled' and (s.registered_by_contact_id = v_contact or s.phone_key = v_pk)),
      'admin', case when v_admin is null then null else jsonb_build_object(
        'signups', (select coalesce(jsonb_agg(conv_private.champ_signup_json(s) order by s.class, s.status, s.created_at), '[]'::jsonb)
                    from public.championship_signups s where s.championship_id = c.id and s.status <> 'canceled'),
        'registered', (select coalesce(jsonb_agg(jsonb_build_object('class', r.class, 'name', coalesce(r.guest_name, p.name), 'seed', r.seed_number)
                         order by r.class, r.seed_number nulls last, coalesce(r.guest_name, p.name)), '[]'::jsonb)
                       from public.championship_registrations r left join public.profiles p on p.id = r.user_id where r.championship_id = c.id)) end);
  end loop;
  if jsonb_array_length(v_list) = 0 then return null; end if;
  return jsonb_build_object('requester_phone', conv_private.phone_local(v_phone), 'is_admin', v_admin is not null,
    'pix_key', fs.pix_key, 'payee', coalesce(fs.payee_names[1], 'Sobral Tênis Clube'), 'championships', v_list);
end $$;
revoke all on function public.conv_svc_ai_championship_context(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_context(uuid) to service_role;

create or replace function public.conv_svc_ai_championship_signup(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid; v_conv uuid; c public.championships%rowtype; fs public.fin_settings%rowtype; v_class text; v_name text; v_nk text;
  v_phone text; v_pk text; v_size text; v_city text; v_profile uuid; v_status text; v_dup public.championship_signups%rowtype;
  v_reg text; v_max int; s public.championship_signups%rowtype; v_sizes text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select x.requester_contact_id, x.conversation_id into v_contact, v_conv from public.conv_ai_sessions x where x.id = p_session;
  if v_contact is null then return conv_private.vfail('NO_SESSION', 'Sessão não encontrada.'); end if;
  select * into c from public.championships where id = conv_private.champ_pick(nullif(p->>'championship_id', '')::uuid);
  if c.id is null then return conv_private.vfail('NO_CHAMPIONSHIP', 'Não há campeonato com inscrição aberta pelo WhatsApp.'); end if;
  if not conv_private.champ_open(c.id) then return conv_private.vfail('CLOSED', 'As inscrições do ' || c.name || ' estão encerradas.'); end if;

  v_class := conv_private.champ_class(c.id, p->>'class');
  if v_class is null then
    return conv_private.vfail('INVALID_CLASS', 'Classe não encontrada. Classes: ' || (select string_agg(k, ' e ' order by k) from jsonb_object_keys(c.format_config) k) || '.');
  end if;
  if conv_private.champ_drawn(c.id, v_class) then return conv_private.vfail('CLOSED', 'A chave da ' || v_class || ' já foi sorteada; as inscrições dela fecharam.'); end if;

  v_name := regexp_replace(trim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  if length(v_name) < 5 or array_length(string_to_array(v_name, ' '), 1) < 2 then
    return conv_private.vfail('NAME_INCOMPLETE', 'Preciso do nome completo do atleta (nome e sobrenome).');
  end if;
  v_nk := conv_private.champ_name_key(v_name);
  v_phone := conv_private.phone_e164(p->>'phone');
  v_pk := conv_private.phone_key(v_phone);
  if v_phone is null or v_pk is null then return conv_private.vfail('INVALID_PHONE', 'O telefone precisa ter DDD e número.'); end if;
  v_size := upper(trim(coalesce(p->>'shirt_size', '')));
  select string_agg(x, ', ') into v_sizes from jsonb_array_elements_text(coalesce(c.joao_info->'shirt_sizes', '[]'::jsonb)) x;
  if not coalesce(c.joao_info->'shirt_sizes', '[]'::jsonb) ? v_size then
    return conv_private.vfail('INVALID_SIZE', 'Tamanhos da camisa: ' || coalesce(v_sizes, '') || '.');
  end if;
  v_city := nullif(trim(coalesce(p->>'city', '')), '');

  -- Sem duplicar: mesmo telefone ou mesmo nome no campeonato (pré-inscrição, lista de espera ou inscrito pelo painel).
  select * into v_dup from public.championship_signups x
  where x.championship_id = c.id and x.status <> 'canceled' and (x.phone_key = v_pk or x.name_key = v_nk)
  order by (x.phone_key = v_pk) desc limit 1;
  if v_dup.id is not null then
    return conv_private.vfail('DUPLICATE', 'Já existe inscrição desse atleta.') || jsonb_build_object('existing', conv_private.champ_signup_json(v_dup),
      'same_phone', v_dup.phone_key = v_pk);
  end if;
  select coalesce(r.guest_name, pr.name) into v_reg from public.championship_registrations r left join public.profiles pr on pr.id = r.user_id
  where r.championship_id = c.id and (conv_private.champ_name_key(coalesce(r.guest_name, pr.name)) = v_nk or conv_private.phone_key(pr.phone) = v_pk) limit 1;
  if v_reg is not null then
    return conv_private.vfail('DUPLICATE', 'Esse atleta já está inscrito.') || jsonb_build_object('existing', jsonb_build_object('full_name', v_reg, 'status', 'confirmed'));
  end if;

  -- Sócio do STC é reconhecido pelo telefone do cadastro (entra como sócio na chave).
  select pr.id into v_profile from public.profiles pr
  where conv_private.phone_key(pr.phone) = v_pk and coalesce(pr.is_active, true) order by pr.created_at limit 1;

  v_max := coalesce((c.joao_info->>'max_per_class')::int, 16);
  v_status := case when conv_private.champ_confirmed(c.id, v_class) >= v_max then 'waitlist' else 'pre' end;
  begin
    insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, city, shirt_size, profile_id, status,
      registered_by_contact_id, conversation_id, amount_cents)
    values (c.id, v_class, v_name, v_nk, v_phone, v_pk, v_city, v_size, v_profile, v_status, v_contact, v_conv, (c.joao_info->>'price_cents')::bigint)
    returning * into s;
  exception when unique_violation then
    return conv_private.vfail('DUPLICATE', 'Já existe inscrição desse atleta.');
  end;

  select * into fs from public.fin_settings where id;
  return jsonb_build_object('ok', true, 'championship', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'signup', conv_private.champ_signup_json(s), 'waitlist', v_status = 'waitlist',
    'is_member', v_profile is not null, 'price_cents', s.amount_cents, 'pix_key', fs.pix_key, 'payee', coalesce(fs.payee_names[1], 'Sobral Tênis Clube'),
    'spots_left', greatest(0, v_max - conv_private.champ_confirmed(c.id, v_class)),
    'my_pending', (select coalesce(jsonb_agg(x.full_name order by x.created_at), '[]'::jsonb) from public.championship_signups x
                   where x.registered_by_contact_id = v_contact and x.championship_id = c.id and x.status = 'pre'),
    'my_pending_total_cents', (select coalesce(sum(x.amount_cents), 0) from public.championship_signups x
                   where x.registered_by_contact_id = v_contact and x.championship_id = c.id and x.status = 'pre'));
end $$;
revoke all on function public.conv_svc_ai_championship_signup(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_signup(uuid, jsonb) to service_role;

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
  if v_payee is null or not fin_private.payee_matches(v_payee, fs.payee_names) then
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
    'athletes', (select jsonb_agg(conv_private.champ_signup_json(z) order by z.created_at) from public.championship_signups z where z.id = any(v_ids)), 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait),
    'entry_id', v_entry, 'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', coalesce(v_sender, 'Atleta'));
end $$;
revoke all on function public.conv_svc_receipt_championship_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_championship_auto(uuid) to service_role;
