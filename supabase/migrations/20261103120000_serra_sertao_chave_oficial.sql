-- Chave oficial do AUGE OPEN (Serra e Sertão 2026), montada a partir das imagens da organização (03/11), sem sorteio.
-- 4ª Classe: quali (Q1–Q4) → oitavas → quartas → semi → final; 5ª Classe: oitavas → final. Os jogos ficam ligados
-- pelo vencedor (player_*_source_match_id), na ordem das imagens: metade esquerda de cima para baixo, depois a direita.
-- Decisões do Ítalo (03/11): os 8 atletas que faltavam entram na chave e o Pix de quem tinha pré-inscrição segue
-- pendente; Hermeson Veras joga a 5ª (cabeça 3) e também a quali da 4ª; campeonato publicado; quali sem data.
-- Os pares da quali seguem a imagem (o texto do João tinha outros pares e é corrigido aqui).

-- 1. Pix de quem já está na chave: confirma a vaga existente, sem criar outra inscrição.
CREATE OR REPLACE FUNCTION public.conv_svc_receipt_championship_auto(p_stage uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Já está na chave (inscrito pela organização antes do Pix): o pagamento só confirma a vaga, sem outra inscrição.
    if x.registration_id is not null then
      update public.championship_signups set status = 'confirmed', paid_at = now(), receipt_intent_id = s.id, fin_entry_id = v_entry, updated_at = now() where id = x.id;
      v_ok := v_ok || x.full_name;
      continue;
    end if;
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
end $function$;

CREATE OR REPLACE FUNCTION conv_private.champ_confirm_from_entry(p_entry uuid, p_admin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.fin_entries%rowtype; v_cat text; v_text text; c public.championships%rowtype; x public.championship_signups%rowtype;
  v_ids uuid[]; v_names jsonb; v_price bigint; v_reg uuid; v_ok text[] := '{}'; v_wait text[] := '{}';
  v_panel jsonb; p jsonb; v_count int;
begin
  select * into e from public.fin_entries where id = p_entry;
  if not found or e.kind <> 'revenue' or e.status <> 'paid' then return null; end if;
  select k.name into v_cat from public.fin_categories k where k.id = e.category_id;
  v_text := conv_private.champ_name_key(coalesce(v_cat, '') || ' ' || coalesce(e.description, ''));
  select * into c from public.championships ch
   where coalesce((ch.joao_info->>'enabled')::boolean, false) and ch.status in ('draft', 'ongoing')
     and (conv_private.champ_name_key(v_cat) = conv_private.champ_name_key(ch.joao_info->>'category_name')
          or (v_text like '%inscri%' and (position(conv_private.champ_name_key(ch.name) in v_text) > 0
              or (nullif(ch.joao_info->'title'->>0, '') is not null and position(conv_private.champ_name_key(ch.joao_info->'title'->>0) in v_text) > 0))))
   order by ch.start_date limit 1;
  if not found then return null; end if;
  if exists (select 1 from public.championship_signups s where s.fin_entry_id = e.id) then
    return jsonb_build_object('championship', c.name, 'reason', 'ALREADY');
  end if;

  select array_agg(s.id order by s.created_at), jsonb_agg(s.full_name order by s.created_at) into v_ids, v_names
  from public.championship_signups s
  where s.championship_id = c.id and s.status = 'pre' and conv_private.champ_name_in_text(s.full_name, e.description);

  -- Inscritos pelo painel, ainda sem pagamento: já estão na chave, só falta ligar ao Pix.
  select jsonb_agg(jsonb_build_object('reg', r.id, 'class', r.class, 'name', coalesce(r.guest_name, pr.name), 'profile', r.user_id,
           'phone', pr.phone, 'size', coalesce(r.shirt_size, 'G'), 'city', r.guest_cidade) order by r.created_at)
    into v_panel
  from public.championship_registrations r left join public.profiles pr on pr.id = r.user_id
  where r.championship_id = c.id
    and not exists (select 1 from public.championship_signups s where s.registration_id = r.id and s.status <> 'canceled')
    and conv_private.phone_key(pr.phone) is not null and pr.phone ~ '^[1-9][0-9]{9,14}$'
    and length(trim(coalesce(r.guest_name, pr.name))) between 5 and 120
    and conv_private.champ_name_in_text(coalesce(r.guest_name, pr.name), e.description);

  v_count := coalesce(cardinality(v_ids), 0) + coalesce(jsonb_array_length(v_panel), 0);
  if v_count = 0 then return jsonb_build_object('championship', c.name, 'reason', 'NO_MATCH'); end if;
  v_names := coalesce(v_names, '[]'::jsonb) || coalesce((select jsonb_agg(q->'name') from jsonb_array_elements(v_panel) q), '[]'::jsonb);
  v_price := coalesce((c.joao_info->>'price_cents')::bigint, 0);
  if e.amount_cents <> v_price * v_count then
    return jsonb_build_object('championship', c.name, 'reason', 'AMOUNT', 'names', v_names, 'amount_cents', e.amount_cents,
      'expected_cents', v_price * v_count);
  end if;

  -- Como no comprovante do atleta: entra na classe; com a classe cheia, fica pago na lista de espera.
  for x in select * from public.championship_signups s where s.id = any(coalesce(v_ids, '{}')) order by s.created_at for update loop
    -- Já está na chave (inscrito pela organização antes do Pix): o pagamento só confirma a vaga, sem outra inscrição.
    if x.registration_id is not null then
      update public.championship_signups set status = 'confirmed', paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_ok := v_ok || x.full_name;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtext(x.championship_id::text || x.class));
    if conv_private.champ_confirmed(x.championship_id, x.class) < coalesce((c.joao_info->>'max_per_class')::int, 16) then
      insert into public.championship_registrations (championship_id, participant_type, user_id, guest_name, class, shirt_size, registered_by, guest_cidade)
      values (x.championship_id, case when x.profile_id is null then 'guest' else 'socio' end, x.profile_id,
        case when x.profile_id is null then x.full_name end, x.class, x.shirt_size, p_admin, x.city)
      returning id into v_reg;
      update public.championship_signups set status = 'confirmed', registration_id = v_reg, paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_ok := v_ok || x.full_name;
    else
      update public.championship_signups set status = 'waitlist', paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_wait := v_wait || x.full_name;
    end if;
  end loop;

  -- Do painel: a vaga já é dele; a linha confirmada só registra o pagamento.
  for p in select * from jsonb_array_elements(coalesce(v_panel, '[]'::jsonb)) loop
    begin
      insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, city, shirt_size, profile_id,
        status, amount_cents, paid_at, fin_entry_id, registration_id)
      values (c.id, p->>'class', trim(p->>'name'), conv_private.champ_name_key(p->>'name'), p->>'phone', conv_private.phone_key(p->>'phone'),
        nullif(trim(coalesce(p->>'city', '')), ''), p->>'size', (p->>'profile')::uuid, 'confirmed', v_price, now(), e.id, (p->>'reg')::uuid);
      v_ok := v_ok || (p->>'name');
    exception when unique_violation then
      -- Já há outra pré-inscrição com o mesmo nome ou telefone: não adivinha, fica de fora.
      null;
    end;
  end loop;
  if cardinality(v_ok) + cardinality(v_wait) = 0 then return jsonb_build_object('championship', c.name, 'reason', 'NO_MATCH'); end if;
  return jsonb_build_object('championship', c.name, 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait));
end $function$;

-- 2. Inscrições, cabeças, formato, rodadas e jogos.
create function pg_temp.reg(p_champ uuid, p_class text, p_name text) returns uuid language plpgsql as $$
declare v uuid[];
begin
  select array_agg(r.id) into v from public.championship_registrations r left join public.profiles p on p.id = r.user_id
  where r.championship_id = p_champ and r.class = p_class and coalesce(r.guest_name, p.name) ilike p_name || '%';
  if coalesce(cardinality(v), 0) <> 1 then raise exception 'Inscrição de "%" na % : achei %', p_name, p_class, coalesce(cardinality(v), 0); end if;
  return v[1];
end $$;

create function pg_temp.jogo(p_champ uuid, p_round uuid, p_num int, p_a uuid, p_b uuid, p_src_a uuid, p_src_b uuid, p_date date)
returns uuid language sql as $$
  insert into public.matches (championship_id, round_id, type, status, match_number, registration_a_id, registration_b_id,
    player_a_id, player_b_id, player_a_source_match_id, player_b_source_match_id, scheduled_date)
  values (p_champ, p_round, 'Campeonato', 'pending', p_num, p_a, p_b,
    (select user_id from public.championship_registrations where id = p_a),
    (select user_id from public.championship_registrations where id = p_b), p_src_a, p_src_b, p_date)
  returning id
$$;

do $$
declare
  c uuid := (select id from public.championships where slug = 'serra-e-sertao-2026');
  v_reg uuid; s record; r4 jsonb; r5 jsonb; v_q uuid; v_oit date; m uuid[] := array_fill(null::uuid, array[19]);
  q4 constant text := '4ª Classe'; q5 constant text := '5ª Classe';
begin
  if c is null then raise notice 'Serra e Sertão 2026 não existe neste banco: nada a fazer'; return; end if;
  if exists (select 1 from public.matches where championship_id = c) then
    raise notice 'Serra e Sertão 2026 já tem jogos: nada a fazer'; return;
  end if;

  -- Pré-inscritos sem Pix: entram na chave ligados à pré-inscrição, que continua 'pre' para a cobrança.
  for s in select * from public.championship_signups where championship_id = c and status = 'pre' and registration_id is null
           and name_key in ('daniel rodrigues', 'derlan andre', 'ismael pedrosa machado', 'italo cangussu') loop
    insert into public.championship_registrations (championship_id, participant_type, user_id, guest_name, class, shirt_size, guest_cidade)
    values (c, case when s.profile_id is null then 'guest' else 'socio' end, s.profile_id,
      case when s.profile_id is null then s.full_name end, s.class, s.shirt_size, s.city)
    returning id into v_reg;
    update public.championship_signups set registration_id = v_reg, updated_at = now() where id = s.id;
  end loop;

  -- Sem inscrição nenhuma: sócios pelo perfil, Anísio como convidado (Tianguá).
  insert into public.championship_registrations (championship_id, participant_type, user_id, class)
  select c, 'socio', p.id, q4 from public.profiles p
  where p.id in ('7aa9c0e6-465d-4be0-b304-9d4c6c7369b7', '2eb5790f-e181-40d0-9b6e-4f2247113798', 'accfb67c-cfea-4779-b7df-734d548d0de9')
    and not exists (select 1 from public.championship_registrations r where r.championship_id = c and r.class = q4 and r.user_id = p.id);
  if not exists (select 1 from public.championship_registrations r where r.championship_id = c and r.class = q4 and r.guest_name ilike 'Anísio%') then
    insert into public.championship_registrations (championship_id, participant_type, guest_name, class, guest_cidade)
    values (c, 'guest', 'Anísio Queiroz', q4, 'Tianguá');
  end if;

  -- Cabeças de chave das imagens (C1–C8).
  update public.championship_registrations set seed_number = 5 where id = pg_temp.reg(c, q4, 'Daniel Rodrigues');
  update public.championship_registrations x set seed_number = v.n
  from (values (1, 'José Helder'), (2, 'Ealber'), (3, 'Hermeson'), (4, 'Mailson'), (5, 'Davi'), (6, 'Emanuel'), (7, 'Romário'), (8, 'Lino')) v(n, nome)
  where x.id = pg_temp.reg(c, q5, v.nome);
  update public.championship_registrations set cabeca_de_chave = (seed_number is not null) where championship_id = c;

  -- Formato da 4ª com quali: vencedores de Q1, Q2, Q3 e Q4 entram nas posições 2, 10, 14 e 6 das oitavas.
  update public.championships
  set format_config = jsonb_set(format_config, array[q4, 'qualifying'], '{"matchCount": 4, "entrySlots": [2, 10, 14, 6]}'::jsonb),
      status = 'ongoing'
  where id = c;

  -- Rodada da quali antes das oitavas (as demais andam uma posição).
  update public.championship_rounds set round_number = round_number + 10 where championship_id = c and class = q4;
  update public.championship_rounds set round_number = round_number - 9 where championship_id = c and class = q4;
  insert into public.championship_rounds (championship_id, class, round_number, name, phase, start_date, end_date, status)
  values (c, q4, 1, 'Qualificatórias', 'qualify', '2026-11-20', '2026-11-26', 'active');
  update public.championship_rounds set status = 'active' where championship_id = c and phase = 'oitavas';

  select jsonb_object_agg(phase, id) into r4 from public.championship_rounds where championship_id = c and class = q4;
  select jsonb_object_agg(phase, id) into r5 from public.championship_rounds where championship_id = c and class = q5;
  v_oit := (select start_date from public.championship_rounds where id = (r4->>'oitavas')::uuid);

  -- 4ª Classe. Quali: Q1–Q4 (jogos 1–4).
  v_q := (r4->>'qualify')::uuid;
  m[1] := pg_temp.jogo(c, v_q, 1, pg_temp.reg(c, q4, 'Tiago Gomes'), pg_temp.reg(c, q4, 'Joaquim'), null, null, null);
  m[2] := pg_temp.jogo(c, v_q, 2, pg_temp.reg(c, q4, 'Diego'), pg_temp.reg(c, q4, 'Carlos'), null, null, null);
  m[3] := pg_temp.jogo(c, v_q, 3, pg_temp.reg(c, q4, 'Cristhian'), pg_temp.reg(c, q4, 'Francielton'), null, null, null);
  m[4] := pg_temp.jogo(c, v_q, 4, pg_temp.reg(c, q4, 'Anísio'), pg_temp.reg(c, q4, 'Hermeson'), null, null, null);
  -- Oitavas (jogos 5–12): esquerda de cima para baixo, depois a direita.
  v_q := (r4->>'oitavas')::uuid;
  m[5]  := pg_temp.jogo(c, v_q, 5,  pg_temp.reg(c, q4, 'Thieslley'), null, null, m[1], v_oit);
  m[6]  := pg_temp.jogo(c, v_q, 6,  pg_temp.reg(c, q4, 'Mario'), pg_temp.reg(c, q4, 'Philippe'), null, null, v_oit);
  m[7]  := pg_temp.jogo(c, v_q, 7,  pg_temp.reg(c, q4, 'Gustavo'), null, null, m[4], v_oit);
  m[8]  := pg_temp.jogo(c, v_q, 8,  pg_temp.reg(c, q4, 'Daniel'), pg_temp.reg(c, q4, 'Miguel'), null, null, v_oit);
  m[9]  := pg_temp.jogo(c, v_q, 9,  pg_temp.reg(c, q4, 'Josiel'), null, null, m[2], v_oit);
  m[10] := pg_temp.jogo(c, v_q, 10, pg_temp.reg(c, q4, 'Bruno'), pg_temp.reg(c, q4, 'Ednaldo'), null, null, v_oit);
  m[11] := pg_temp.jogo(c, v_q, 11, pg_temp.reg(c, q4, 'Rafael'), null, null, m[3], v_oit);
  m[12] := pg_temp.jogo(c, v_q, 12, pg_temp.reg(c, q4, 'Marcelo'), pg_temp.reg(c, q4, 'Henrique'), null, null, v_oit);
  for i in 0..3 loop m[13 + i] := pg_temp.jogo(c, (r4->>'quartas')::uuid, 13 + i, null, null, m[5 + 2*i], m[6 + 2*i], null); end loop;
  m[17] := pg_temp.jogo(c, (r4->>'semifinal')::uuid, 17, null, null, m[13], m[14], null);
  m[18] := pg_temp.jogo(c, (r4->>'semifinal')::uuid, 18, null, null, m[15], m[16], null);
  m[19] := pg_temp.jogo(c, (r4->>'final')::uuid, 19, null, null, m[17], m[18], null);

  -- 5ª Classe. Oitavas (jogos 1–8) na mesma ordem.
  m := array_fill(null::uuid, array[19]);
  v_q := (r5->>'oitavas')::uuid;
  v_oit := (select start_date from public.championship_rounds where id = v_q);
  m[1] := pg_temp.jogo(c, v_q, 1, pg_temp.reg(c, q5, 'José Helder'), pg_temp.reg(c, q5, 'Juarez'), null, null, v_oit);
  m[2] := pg_temp.jogo(c, v_q, 2, pg_temp.reg(c, q5, 'Lino'), pg_temp.reg(c, q5, 'Maria Eduarda'), null, null, v_oit);
  m[3] := pg_temp.jogo(c, v_q, 3, pg_temp.reg(c, q5, 'Mailson'), pg_temp.reg(c, q5, 'Derlan'), null, null, v_oit);
  m[4] := pg_temp.jogo(c, v_q, 4, pg_temp.reg(c, q5, 'Davi'), pg_temp.reg(c, q5, 'Marcelino'), null, null, v_oit);
  m[5] := pg_temp.jogo(c, v_q, 5, pg_temp.reg(c, q5, 'Ealber'), pg_temp.reg(c, q5, 'Ismael'), null, null, v_oit);
  m[6] := pg_temp.jogo(c, v_q, 6, pg_temp.reg(c, q5, 'Romário'), pg_temp.reg(c, q5, 'Heitor'), null, null, v_oit);
  m[7] := pg_temp.jogo(c, v_q, 7, pg_temp.reg(c, q5, 'Hermeson'), pg_temp.reg(c, q5, 'Thiago Pontes'), null, null, v_oit);
  m[8] := pg_temp.jogo(c, v_q, 8, pg_temp.reg(c, q5, 'Emanuel'), pg_temp.reg(c, q5, 'Ítalo'), null, null, v_oit);
  for i in 0..3 loop m[9 + i] := pg_temp.jogo(c, (r5->>'quartas')::uuid, 9 + i, null, null, m[1 + 2*i], m[2 + 2*i], null); end loop;
  m[13] := pg_temp.jogo(c, (r5->>'semifinal')::uuid, 13, null, null, m[9], m[10], null);
  m[14] := pg_temp.jogo(c, (r5->>'semifinal')::uuid, 14, null, null, m[11], m[12], null);
  m[15] := pg_temp.jogo(c, (r5->>'final')::uuid, 15, null, null, m[13], m[14], null);
end $$;

-- 3. O João passa a conhecer a chave oficial (e os pares da quali da imagem).
do $$
declare
  c uuid := (select id from public.championships where slug = 'serra-e-sertao-2026');
  v_info text := (select joao_info->>'info' from public.championships where id = c);
  v_old_quali constant text := 'Jogo 1, em Nova Russas: Francielton Miranda Rosa (NRTC) x Joaquim Brandão (NRTC).
Jogo 2, em Sobral: Cristhian Pinheiro Aurélio (CTC) x Anísio Queiroz (MTC).
Jogo 3, em Sobral: Thiago Gomes (STC) x Carlos Carneiro (STC).
Jogo 4, em Sobral: Diego Memória (STC) x Hermerson Veras (STC).
Data e horário dos jogos da quali: a organização confirma.';
  v_old_one constant text := 'Cada atleta joga uma classe só.';
begin
  if c is null or position('CHAVE OFICIAL' in coalesce(v_info, '')) > 0 then return; end if;
  if position(v_old_quali in v_info) = 0 or position(v_old_one in v_info) = 0 then
    raise exception 'Texto do João mudou: revisar a troca dos pares da quali';
  end if;
  v_info := replace(v_info, v_old_quali, 'Q1: Tiago Gomes (STC) x Joaquim Brandão (NRTC).
Q2: Diego Memória (STC) x Carlos Carneiro (STC).
Q3: Cristhian Pinheiro Aurélio (CTC) x Francielton Miranda Rosa (NRTC).
Q4: Anísio Queiroz (MTC) x Hermeson Veras (STC).
Local, data e horário dos jogos da quali: a organização confirma.');
  v_info := replace(v_info, v_old_one, 'Cada atleta joga uma classe só, com uma exceção: Hermeson Veras joga a 5ª Classe (cabeça 3) e a quali da 4ª.');
  v_info := v_info || '

CHAVE OFICIAL (publicada pela organização em 03/11, sem sorteio; já está no app).
4ª Classe, oitavas. Lado esquerdo: Thieslley (C1) x vencedor Q1; Mário (C8) x Philippe; Gustavo (C4) x vencedor Q4; Daniel (C5) x Miguel. Lado direito: Josiel (C2) x vencedor Q2; Bruno (C7) x Ednaldo; Rafael (C3) x vencedor Q3; Marcelo (C6) x Henrique. Quartas: os dois primeiros jogos de cada lado se cruzam, e os dois últimos também; as semis fecham cada lado; a final é esquerda x direita.
5ª Classe, oitavas. Lado esquerdo: Helder (C1) x Juarez; Lino (C8) x Eduarda; Mailson (C4) x Derlan; Davi (C5) x Marcelino. Lado direito: Ealber (C2) x Ismael; Romário (C7) x Heitor; Hermeson (C3) x Thiago; Emanuel (C6) x Ítalo. Mesmo cruzamento da 4ª até a final.';
  update public.championships set joao_info = jsonb_set(joao_info, '{info}', to_jsonb(v_info)) where id = c;
end $$;

-- Rollback: apagar os jogos do campeonato e a rodada 'qualify' da 4ª (round_number das outras volta 1–4),
-- format_config 4ª qualifying = null, status 'draft', inscrições criadas aqui (e registration_id das pré-inscrições = null),
-- e reaplicar as duas funções de confirmação de 20261030210000 / remoto anterior.
