-- Caso Romário (28/10), na conversa do Hermeson:
--  1. "Diga isso a ele": o recado do administrador só achava SÓCIO; o Romário é atleta convidado e já conversa com o João.
--     Agora, sem sócio com o nome, vale quem tem conversa privada com o João (contato com mensagem recebida).
--  2. "Ele enviou o comprovante para você": o administrador não via os comprovantes que chegam na conversa de outra pessoa.
--     Nova consulta: os comprovantes recebidos pelo WhatsApp, com quem mandou, valor, arquivo e o que foi feito.
-- Rollback: drop das funções novas (ai_admin_find_contact, ai_admin_whatsapp_receipts e invólucros) e recriar
-- ai_admin_message_propose da 20261007320000.

-- Nome do contato bate com o pedido: igual, contido, ou com erro de digitação em qualquer sentido ("Romário Pontes Soares"
-- acha o contato "Romário Soares"). No sentido contrário o contato precisa ter nome e sobrenome, para "Romário" não casar com todos.
create or replace function conv_private.contact_name_match(p_query text, p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_name, '') <> '' and length(trim(coalesce(p_query, ''))) >= 3 and (
    conv_private.fold(p_name) like '%' || conv_private.fold(trim(p_query)) || '%'
    or conv_private.name_typo_match(p_query, p_name)
    or ((select count(*) from regexp_split_to_table(trim(p_name), '\s+') w where length(w) >= 3) >= 2
        and conv_private.name_typo_match(p_name, p_query)))
$$;

-- Quem tem conversa privada com o João e se chama assim. Não escolhe entre vários: devolve todos para o administrador decidir.
create or replace function conv_private.ai_admin_find_contact(p_session uuid, p_name text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_matches jsonb;
begin
  if conv_private.ai_admin_requester(p_session) is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('contact_id', x.id, 'name', x.name) order by x.last_at desc), '[]'::jsonb) into v_matches
  from (select ct.id, ct.name, max(cv.last_message_at) last_at
        from public.conv_contacts ct join public.conv_conversations cv on cv.contact_id = ct.id and cv.kind = 'direct'
        where ct.merged_into is null and not coalesce(ct.opt_out, false) and ct.phone is not null
          and conv_private.contact_name_match(p_name, ct.name)
          and exists (select 1 from public.conv_messages m where m.conversation_id = cv.id and m.direction = 'inbound')
        group by ct.id, ct.name order by last_at desc nulls last limit 5) x;
  return jsonb_build_object('ok', true, 'status', case jsonb_array_length(v_matches) when 0 then 'none' when 1 then 'unique' else 'many' end,
    'matches', v_matches);
end $$;

create or replace function public.conv_svc_ai_admin_find_contact(p_session uuid, p_name text) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_find_contact(p_session, p_name) $$;

-- Recado: sócio (profile_id) como antes, ou contato com conversa (contact_id).
create or replace function conv_private.ai_admin_message_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_profile uuid := nullif(p->>'profile_id', '')::uuid; v_contact uuid := nullif(p->>'contact_id', '')::uuid;
  v_name text; v_phone text; v_body text := trim(coalesce(p->>'body', ''));
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if v_profile is not null then
    select pr.name, conv_private.phone_e164(pr.phone) into v_name, v_phone from public.profiles pr where pr.id = v_profile and coalesce(pr.is_active, true);
    if v_name is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio ativo.'); end if;
  else
    select ct.name, ct.phone into v_name, v_phone from public.conv_contacts ct where ct.id = v_contact and ct.merged_into is null;
    if v_name is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei essa pessoa nas conversas.'); end if;
  end if;
  if v_phone is null or length(v_phone) < 12 then
    return conv_private.vfail('NO_PHONE', v_name || ' não tem telefone válido no cadastro, então não consigo chamar no WhatsApp.');
  end if;
  if exists (select 1 from public.conv_contacts c where c.phone = v_phone and c.opt_out) then
    return conv_private.vfail('OPT_OUT', v_name || ' pediu para não receber mensagens por aqui.');
  end if;
  if length(v_body) not between 3 and 1000 then return conv_private.vfail('INVALID_BODY', 'Qual o texto da mensagem?'); end if;
  v_payload := jsonb_build_object('profile_id', v_profile, 'contact_id', v_contact, 'member_name', v_name, 'phone', v_phone, 'body', v_body);
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_message_send', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_message_send', 'summary', v_payload);
end $$;

-- Comprovantes que chegaram pelo WhatsApp em qualquer conversa (padrão: últimos 7 dias), com o que foi feito com cada um.
create or replace function conv_private.ai_admin_whatsapp_receipts(p_session uuid, p_name text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from date := coalesce(p_from, (now() at time zone 'America/Fortaleza')::date - 6);
  v_to date := coalesce(p_to, (now() at time zone 'America/Fortaleza')::date); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if conv_private.ai_admin_requester(p_session) is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('from', v_from, 'to', v_to, 'name', v_name,
    'items', coalesce((select jsonb_agg(x.item order by x.created_at desc) from (
      select i.created_at, jsonb_build_object('sender', coalesce(pr.name, ct.name, 'sem nome'), 'detail', i.purpose_detail, 'status', i.status,
        'amount_cents', coalesce(nullif(i.original_data->>'declared_amount_cents', '')::bigint, nullif(i.original_data->'ocr'->>'amount_cents', '')::bigint),
        'paid_on', coalesce(i.original_data->>'declared_paid_on', i.original_data->'ocr'->>'paid_on'),
        'pdf', i.original_data->>'content_type' = 'application/pdf', 'file_name', i.original_data->>'file_name',
        'launched', i.finance_entry_id is not null, 'created_at', i.created_at) item
      from fin_private.whatsapp_receipt_intents i
      join public.conv_contacts ct on ct.id = i.contact_id left join public.profiles pr on pr.id = i.profile_id
      where (i.created_at at time zone 'America/Fortaleza')::date between v_from and v_to
        and (v_name is null or conv_private.contact_name_match(v_name, coalesce(pr.name, ct.name)) or conv_private.contact_name_match(v_name, ct.name)
             or conv_private.fold(coalesce(i.purpose_detail, '')) like '%' || conv_private.fold(v_name) || '%')
      order by i.created_at desc limit 15) x), '[]'::jsonb)));
end $$;

create or replace function public.conv_svc_ai_admin_whatsapp_receipts(p_session uuid, p_name text default null, p_from date default null, p_to date default null)
returns jsonb language sql security definer set search_path = '' as $$ select conv_private.ai_admin_whatsapp_receipts(p_session, p_name, p_from, p_to) $$;

revoke all on function conv_private.contact_name_match(text, text) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_find_contact(uuid, text) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_whatsapp_receipts(uuid, text, date, date) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_find_contact(uuid, text) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_whatsapp_receipts(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_find_contact(uuid, text) to service_role;
grant execute on function public.conv_svc_ai_admin_whatsapp_receipts(uuid, text, date, date) to service_role;
