-- Serra e Sertão 2026: o que o João faz com campeonato.
--   conv_svc_ai_championship_context  → o que o João sabe (informações, vagas, inscrições de quem fala; tudo, para o admin)
--   conv_svc_ai_championship_signup   → pré-inscrição de um atleta (sem duplicar telefone nem nome)
--   conv_svc_receipt_championship_auto → comprovante do Pix: confere valor e favorecido, lança a receita com o comprovante e inscreve
--   conv_svc_ai_championship_seeds    → administrador define os cabeças de chave de uma classe
--   conv_svc_ai_championship_draw     → administrador pede o sorteio: grava a chave inteira (oitavas → final)
-- Todas só para service_role (a borda do João). Admin é conferido pela sessão (conv_private.ai_admin_requester).

/* ------------------------------- Peças ------------------------------- */

-- Campeonato que o João atende: o pedido, ou o único com inscrição pelo João ligada e ainda não encerrado.
create or replace function conv_private.champ_pick(p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.championships c
  where coalesce((c.joao_info->>'enabled')::boolean, false) and c.status in ('draft', 'ongoing') and (p_id is null or c.id = p_id)
  order by c.start_date nulls last, c.created_at limit 1
$$;

-- "4", "4ª", "quarta", "4ª Classe" → o nome da classe como o campeonato a guarda.
create or replace function conv_private.champ_class(p_champ uuid, p_input text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_in text := conv_private.fold(coalesce(p_input, '')); v_digit text; k text;
begin
  v_digit := case when v_in ~ 'quart' then '4' when v_in ~ 'quint' then '5' when v_in ~ 'sext' then '6' when v_in ~ 'terc' then '3'
                  else substring(v_in from '([0-9])') end;
  if v_digit is null then return null; end if;
  for k in select jsonb_object_keys(c.format_config) from public.championships c where c.id = p_champ loop
    if substring(k from '([0-9])') = v_digit then return k; end if;
  end loop;
  return null;
end $$;

-- A classe já tem chave sorteada: inscrição fechada e sorteio não repete.
create or replace function conv_private.champ_drawn(p_champ uuid, p_class text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m join public.championship_rounds r on r.id = m.round_id
                 where r.championship_id = p_champ and r.class = p_class)
$$;

create or replace function conv_private.champ_confirmed(p_champ uuid, p_class text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.championship_registrations r where r.championship_id = p_champ and r.class = p_class
$$;

-- Inscrição aberta hoje (Fortaleza): campeonato aberto e prazo não vencido. A classe cheia não fecha: vira lista de espera.
create or replace function conv_private.champ_open(p_champ uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.registration_open and not coalesce(c.registration_closed, false)
     and (c.joao_info->>'deadline' is null or (now() at time zone 'America/Fortaleza')::date <= (c.joao_info->>'deadline')::date)
  from public.championships c where c.id = p_champ
$$;

create or replace function conv_private.champ_name_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(trim(conv_private.fold(p)), '\s+', ' ', 'g')
$$;

-- Vagas por classe.
create or replace function conv_private.champ_classes(p_champ uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'class', k.classe,
    'confirmed', conv_private.champ_confirmed(c.id, k.classe),
    'pre', (select count(*) from public.championship_signups s where s.championship_id = c.id and s.class = k.classe and s.status = 'pre'),
    'waitlist', (select count(*) from public.championship_signups s where s.championship_id = c.id and s.class = k.classe and s.status = 'waitlist'),
    'spots_left', greatest(0, coalesce((c.joao_info->>'max_per_class')::int, 16) - conv_private.champ_confirmed(c.id, k.classe)),
    'drawn', conv_private.champ_drawn(c.id, k.classe)) order by k.classe), '[]'::jsonb)
  from public.championships c cross join lateral jsonb_object_keys(c.format_config) as k(classe)
  where c.id = p_champ
$$;

create or replace function conv_private.champ_signup_json(s public.championship_signups) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'full_name', s.full_name, 'class', s.class, 'shirt_size', s.shirt_size, 'city', s.city,
    'status', s.status, 'phone', conv_private.phone_local(s.phone), 'created_at', s.created_at)
$$;

/* ------------------------------- Contexto ------------------------------- */

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
      'id', c.id, 'name', c.name, 'start_date', c.start_date, 'end_date', c.end_date, 'status', c.status,
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

/* ------------------------------- Pré-inscrição ------------------------------- */

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
  return jsonb_build_object('ok', true, 'championship', c.name, 'signup', conv_private.champ_signup_json(s), 'waitlist', v_status = 'waitlist',
    'is_member', v_profile is not null, 'price_cents', s.amount_cents, 'pix_key', fs.pix_key, 'payee', coalesce(fs.payee_names[1], 'Sobral Tênis Clube'),
    'spots_left', greatest(0, v_max - conv_private.champ_confirmed(c.id, v_class)),
    'my_pending', (select coalesce(jsonb_agg(x.full_name order by x.created_at), '[]'::jsonb) from public.championship_signups x
                   where x.registered_by_contact_id = v_contact and x.championship_id = c.id and x.status = 'pre'),
    'my_pending_total_cents', (select coalesce(sum(x.amount_cents), 0) from public.championship_signups x
                   where x.registered_by_contact_id = v_contact and x.championship_id = c.id and x.status = 'pre'));
end $$;
revoke all on function public.conv_svc_ai_championship_signup(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_signup(uuid, jsonb) to service_role;

/* ------------------------------- Comprovante do Pix ------------------------------- */

-- Comprovante de quem tem pré-inscrição: valor = inscrições pendentes desse contato (todas, ou a única), Pix para o clube,
-- arquivo inédito → receita paga na categoria do campeonato com o comprovante anexado, e cada atleta inscrito na classe
-- (lista de espera se a classe lotou no meio do caminho). Sem confirmação em duas etapas: o valor e o favorecido decidem.
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
  return jsonb_build_object('applied', true, 'championship', c.name, 'amount_cents', v_amount, 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait),
    'entry_id', v_entry, 'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1), 'sender_name', coalesce(v_sender, 'Atleta'));
end $$;
revoke all on function public.conv_svc_receipt_championship_auto(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_championship_auto(uuid) to service_role;

/* ------------------------------- Cabeças de chave ------------------------------- */

-- Acha um inscrito confirmado da classe pelo nome: igual, ou todas as palavras ditas dentro do nome. Mais de um = ambíguo.
create or replace function conv_private.champ_find_registration(p_champ uuid, p_class text, p_name text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_key text := conv_private.champ_name_key(p_name); v_hits jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', coalesce(r.guest_name, p.name))), '[]'::jsonb) into v_hits
  from public.championship_registrations r left join public.profiles p on p.id = r.user_id
  where r.championship_id = p_champ and r.class = p_class and conv_private.champ_name_key(coalesce(r.guest_name, p.name)) = v_key;
  if jsonb_array_length(v_hits) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', coalesce(r.guest_name, p.name))), '[]'::jsonb) into v_hits
    from public.championship_registrations r left join public.profiles p on p.id = r.user_id
    where r.championship_id = p_champ and r.class = p_class
      and not exists (select 1 from unnest(string_to_array(v_key, ' ')) w
                      where w <> '' and position(w in conv_private.champ_name_key(coalesce(r.guest_name, p.name))) = 0);
  end if;
  return v_hits;
end $$;

create or replace function public.conv_svc_ai_championship_seeds(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid; v_champ uuid; v_class text; v_name text; v_hits jsonb; v_ids uuid[] := '{}'; v_names text[] := '{}'; i int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then return conv_private.vfail('FORBIDDEN', 'Só a administração define os cabeças de chave.'); end if;
  v_champ := conv_private.champ_pick(nullif(p->>'championship_id', '')::uuid);
  if v_champ is null then return conv_private.vfail('NO_CHAMPIONSHIP', 'Não achei o campeonato.'); end if;
  v_class := conv_private.champ_class(v_champ, p->>'class');
  if v_class is null then return conv_private.vfail('INVALID_CLASS', 'De qual classe são os cabeças de chave?'); end if;
  if conv_private.champ_drawn(v_champ, v_class) then return conv_private.vfail('DRAWN', 'A chave da ' || v_class || ' já foi sorteada.'); end if;
  if jsonb_typeof(p->'names') <> 'array' or jsonb_array_length(p->'names') > 8 then
    return conv_private.vfail('INVALID_SEEDS', 'Me diga até 8 nomes, na ordem: o primeiro é o cabeça 1.');
  end if;
  for v_name in select jsonb_array_elements_text(p->'names') loop
    v_hits := conv_private.champ_find_registration(v_champ, v_class, v_name);
    if jsonb_array_length(v_hits) = 0 then
      return conv_private.vfail('NOT_FOUND', 'Não achei ' || v_name || ' entre os inscritos confirmados da ' || v_class || '.');
    end if;
    if jsonb_array_length(v_hits) > 1 then
      return conv_private.vfail('AMBIGUOUS', v_name || ' pode ser: ' || (select string_agg(h->>'name', ', ') from jsonb_array_elements(v_hits) h) || '. Qual deles?');
    end if;
    if (v_hits->0->>'id')::uuid = any(v_ids) then continue; end if;
    v_ids := v_ids || (v_hits->0->>'id')::uuid;
    v_names := v_names || (v_hits->0->>'name');
  end loop;
  update public.championship_registrations set cabeca_de_chave = false, seed_number = null where championship_id = v_champ and class = v_class;
  foreach v_name in array v_names loop
    i := i + 1;
    update public.championship_registrations set cabeca_de_chave = true, seed_number = i where id = v_ids[i];
  end loop;
  return jsonb_build_object('ok', true, 'class', v_class, 'seeds', to_jsonb(v_names));
end $$;
revoke all on function public.conv_svc_ai_championship_seeds(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_seeds(uuid, jsonb) to service_role;

/* ------------------------------- Sorteio ------------------------------- */

-- Chave de 16: cada atleta recebe um número (cabeças primeiro, na ordem; o resto sorteado) e o número vai para a posição
-- padrão do tênis (1 no topo, 2 na base; seedSlots(16) em lib/championship/bracket.ts). Números acima do total de
-- inscritos são vagas sem adversário: o atleta do outro lado passa direto (WO) e o banco já o leva às quartas.
create or replace function public.conv_svc_ai_championship_draw(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_champ uuid; v_class text; v_n int; v_order int[] := array[1,16,9,8,5,12,13,4,3,14,11,6,7,10,15,2];
  v_by_number uuid[] := array_fill(null::uuid, array[16]); v_slot uuid[] := array_fill(null::uuid, array[16]);
  v_round jsonb; v_m uuid[] := array_fill(null::uuid, array[15]); r record; i int; v_a uuid; v_b uuid; v_win uuid; v_out jsonb := '[]'::jsonb;
  v_name_a text; v_name_b text; v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then return conv_private.vfail('FORBIDDEN', 'Só a administração pode pedir o sorteio.'); end if;
  v_champ := conv_private.champ_pick(nullif(p->>'championship_id', '')::uuid);
  if v_champ is null then return conv_private.vfail('NO_CHAMPIONSHIP', 'Não achei o campeonato.'); end if;
  v_class := conv_private.champ_class(v_champ, p->>'class');
  if v_class is null then return conv_private.vfail('INVALID_CLASS', 'Qual classe eu sorteio?'); end if;
  perform pg_advisory_xact_lock(hashtext(v_champ::text || v_class));
  if conv_private.champ_drawn(v_champ, v_class) then return conv_private.vfail('DRAWN', 'A chave da ' || v_class || ' já foi sorteada.'); end if;

  select jsonb_object_agg(x.phase, x.id) into v_round from public.championship_rounds x where x.championship_id = v_champ and x.class = v_class;
  if v_round is null or not (v_round ?& array['oitavas', 'quartas', 'semifinal', 'final']) then
    return conv_private.vfail('NO_ROUNDS', 'A ' || v_class || ' não tem as rodadas de oitavas até a final.');
  end if;
  v_n := conv_private.champ_confirmed(v_champ, v_class);
  if v_n < 9 or v_n > 16 then
    return conv_private.vfail('COUNT', 'A ' || v_class || ' tem ' || v_n || ' inscritos confirmados; o sorteio automático das oitavas precisa de 9 a 16. Com outro número, monte a chave pelo Criador no painel.');
  end if;

  -- Números: cabeças na ordem (1, 2, 3…), os demais embaralhados nos números seguintes.
  i := 0;
  for r in select x.id from public.championship_registrations x where x.championship_id = v_champ and x.class = v_class
           order by x.seed_number nulls last, case when x.seed_number is null then random() end loop
    i := i + 1;
    v_by_number[i] := r.id;
  end loop;
  for i in 1..16 loop v_slot[i] := v_by_number[v_order[i]]; end loop;

  for i in 1..8 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, registration_a_id, registration_b_id, player_a_id, player_b_id, scheduled_date)
    select v_champ, (v_round->>'oitavas')::uuid, 'Campeonato', 'pending', i, v_slot[2*i-1], v_slot[2*i],
      (select user_id from public.championship_registrations where id = v_slot[2*i-1]),
      (select user_id from public.championship_registrations where id = v_slot[2*i]),
      (select x.start_date from public.championship_rounds x where x.id = (v_round->>'oitavas')::uuid)
    returning id into v_id;
    v_m[i] := v_id;
  end loop;
  for i in 1..4 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
    values (v_champ, (v_round->>'quartas')::uuid, 'Campeonato', 'pending', 8 + i, v_m[2*i-1], v_m[2*i]) returning id into v_id;
    v_m[8 + i] := v_id;
  end loop;
  for i in 1..2 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
    values (v_champ, (v_round->>'semifinal')::uuid, 'Campeonato', 'pending', 12 + i, v_m[7 + 2*i], v_m[8 + 2*i]) returning id into v_id;
    v_m[12 + i] := v_id;
  end loop;
  insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
  values (v_champ, (v_round->>'final')::uuid, 'Campeonato', 'pending', 15, v_m[13], v_m[14]) returning id into v_id;
    v_m[15] := v_id;

  -- Sem adversário: passa direto (WO). O gatilho propagate_bracket_winner coloca o atleta nas quartas.
  for i in 1..8 loop
    v_a := v_slot[2*i-1]; v_b := v_slot[2*i];
    select coalesce(x.guest_name, pr.name) into v_name_a from public.championship_registrations x left join public.profiles pr on pr.id = x.user_id where x.id = v_a;
    select coalesce(x.guest_name, pr.name) into v_name_b from public.championship_registrations x left join public.profiles pr on pr.id = x.user_id where x.id = v_b;
    if (v_a is null) <> (v_b is null) then
      v_win := coalesce(v_a, v_b);
      update public.matches set status = 'finished', result_type = 'walkover', is_walkover = true,
        walkover_winner_registration_id = v_win, winner_registration_id = v_win,
        walkover_winner_id = (select user_id from public.championship_registrations where id = v_win),
        winner_id = (select user_id from public.championship_registrations where id = v_win),
        admin_notes = 'Sem adversário no sorteio: passa direto', result_set_by = v_admin, result_set_at = now()
      where id = v_m[i];
    end if;
    v_out := v_out || jsonb_build_object('match', i, 'a', v_name_a, 'b', v_name_b, 'bye', (v_a is null) <> (v_b is null));
  end loop;

  update public.championship_rounds set status = 'active' where id = (v_round->>'oitavas')::uuid and status = 'pending';
  update public.championships set status = 'ongoing' where id = v_champ and status = 'draft';
  return jsonb_build_object('ok', true, 'class', v_class, 'count', v_n, 'matches', v_out);
end $$;
revoke all on function public.conv_svc_ai_championship_draw(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_draw(uuid, jsonb) to service_role;

revoke all on function conv_private.champ_pick(uuid), conv_private.champ_class(uuid, text), conv_private.champ_drawn(uuid, text),
  conv_private.champ_confirmed(uuid, text), conv_private.champ_open(uuid), conv_private.champ_classes(uuid),
  conv_private.champ_find_registration(uuid, text, text) from public, anon, authenticated;
