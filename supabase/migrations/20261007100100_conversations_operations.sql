-- Conversas e WhatsApp — operações (2/4).
--
-- Entrada do webhook, envio com idempotência, estados da mensagem, leitura,
-- retornos agendados, ligação de contato a cadastro, configuração do canal e a
-- lista da caixa. Padrões do North Jato (`ingest_whatsapp_message_v2`,
-- `queue_staff_message_v2`, `finish_staff_message`, `nj_conversation_inbox`).
--
-- Duas portas, nunca misturadas:
--   * `conv_private.*` + invólucros `public.conv_svc_*` → SÓ `service_role`
--     (webhook, IA, dispatch, edge de operações). O navegador não os alcança;
--   * `public.conv_*` (SECURITY DEFINER, `conv_private.require_admin()`) → o
--     administrador autenticado.

-- ------------------------------------------------------------------
-- 1. Contatos
-- ------------------------------------------------------------------
create function conv_private.norm_lid(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(split_part(split_part(coalesce(p, ''), '@', 1), ':', 1), '[^0-9a-zA-Z._-]', '', 'g')), '') $$;

-- Liga o contato a UM cadastro do STC, e só se o candidato for único.
-- Perfil (sócio) tem prioridade sobre aluno; ligação manual nunca é sobrescrita.
create function conv_private.link_contact(p_contact uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.conv_contacts%rowtype; v_key text; v_profiles uuid[]; v_students uuid[];
begin
  select * into c from public.conv_contacts where id = p_contact for update;
  if not found or c.link_status in ('manual', 'linked') or c.phone is null then return; end if;
  v_key := conv_private.phone_key(c.phone);
  if v_key is null then return; end if;
  select coalesce(array_agg(p.id), '{}') into v_profiles from public.profiles p
    where p.phone is not null and conv_private.phone_key(p.phone) = v_key;
  if cardinality(v_profiles) = 1 then
    update public.conv_contacts set profile_id = v_profiles[1], non_socio_student_id = null, link_status = 'linked', updated_at = now() where id = p_contact;
  elsif cardinality(v_profiles) > 1 then
    update public.conv_contacts set link_status = 'ambiguous', updated_at = now() where id = p_contact;
  else
    select coalesce(array_agg(s.id), '{}') into v_students from public.non_socio_students s
      where s.phone is not null and conv_private.phone_key(s.phone) = v_key;
    if cardinality(v_students) = 1 then
      update public.conv_contacts set non_socio_student_id = v_students[1], link_status = 'linked', updated_at = now() where id = p_contact;
    elsif cardinality(v_students) > 1 then
      update public.conv_contacts set link_status = 'ambiguous', updated_at = now() where id = p_contact;
    end if;
  end if;
end $$;

create function conv_private.upsert_contact(p_phone text, p_lid text, p_name text, p_staff_sent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_phone text := conv_private.phone_e164(p_phone); v_lid text := conv_private.norm_lid(p_lid);
  v_id uuid; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_phone is null and v_lid is null then raise exception 'INVALID_CONTACT'; end if;
  if v_phone is not null then select id into v_id from public.conv_contacts where phone = v_phone; end if;
  if v_id is null and v_lid is not null then select id into v_id from public.conv_contacts where lid = v_lid; end if;
  if v_id is null then
    insert into public.conv_contacts(phone, lid, name) values (v_phone, v_lid, case when p_staff_sent then null else v_name end)
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.conv_contacts where (v_phone is not null and phone = v_phone) or (v_lid is not null and lid = v_lid) limit 1;
    end if;
  else
    -- Completa o que faltava (telefone ou LID), sem tirar nada nem forçar duplicidade.
    begin
      update public.conv_contacts set
        phone = coalesce(phone, v_phone), lid = coalesce(lid, v_lid),
        name = case when p_staff_sent or v_name is null then name
                    when name is null or name ~ '^[0-9+ ()-]+$' then v_name else name end,
        updated_at = now()
      where id = v_id;
    exception when unique_violation then
      null; -- outro contato já usa este telefone/LID: mantém separado, nunca funde sozinho
    end;
  end if;
  perform conv_private.link_contact(v_id);
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 2. Conversas
-- ------------------------------------------------------------------
create function conv_private.open_direct(p_contact uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.conv_conversations where contact_id = p_contact and kind = 'direct' and status = 'open' for update;
  if found then return v_id; end if;
  insert into public.conv_conversations(kind, contact_id, last_message_at) values ('direct', p_contact, now())
  on conflict (contact_id) where status = 'open' and kind = 'direct' do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.conv_conversations where contact_id = p_contact and kind = 'direct' and status = 'open';
  end if;
  return v_id;
end $$;

create function conv_private.open_group(p_group uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.conv_conversations where group_id = p_group and kind = 'group' and status = 'open' for update;
  if found then return v_id; end if;
  insert into public.conv_conversations(kind, group_id, last_message_at, ai_status) values ('group', p_group, now(), 'ai')
  on conflict (group_id) where status = 'open' and kind = 'group' do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.conv_conversations where group_id = p_group and kind = 'group' and status = 'open';
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 3. Entrada do webhook
-- ------------------------------------------------------------------
-- `p`: provider_id, chat_kind (direct|group), phone, lid, name, group_jid,
-- group_name, payload_shape (só chaves), body, kind, from_me, sent_at, mime,
-- file_name, reply_to, meta, mention {direct, evidence}.
-- Idempotente pelo id do provedor: o webhook repetido devolve a mesma linha.
create function conv_private.ingest_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pid text := nullif(trim(p->>'provider_id'), '');
  v_group_kind boolean := coalesce(p->>'chat_kind', 'direct') = 'group';
  v_from_me boolean := coalesce((p->>'from_me')::boolean, false);
  v_at timestamptz := coalesce(nullif(p->>'sent_at', '')::timestamptz, now());
  v_kind text := coalesce(nullif(p->>'kind', ''), 'text');
  v_body text := nullif(p->>'body', '');
  v_reply text := nullif(p->>'reply_to', '');
  v_preview text; v_msg uuid; v_conv uuid; v_contact uuid; v_sender uuid; v_group public.conv_groups%rowtype;
  v_jid text := nullif(p->>'group_jid', '');
  v_dup record;
begin
  if v_pid is null then raise exception 'PROVIDER_ID_REQUIRED'; end if;
  if v_kind not in ('text','image','video','audio','ptt','document','sticker','location','contact','other') then v_kind := 'other'; end if;

  select id, conversation_id into v_dup from public.conv_messages where provider_message_id = v_pid;
  if found then
    return jsonb_build_object('message_id', v_dup.id, 'conversation_id', v_dup.conversation_id, 'duplicate', true);
  end if;

  if v_group_kind then
    if v_jid is null or v_jid !~ '^[0-9A-Za-z._-]{5,64}@g\.us$' then raise exception 'INVALID_GROUP'; end if;
    insert into public.conv_groups(group_jid, name, last_payload_shape)
    values (v_jid, left(nullif(p->>'group_name', ''), 200), p->'payload_shape')
    on conflict (group_jid) do update set
      last_seen_at = now(), events_seen = public.conv_groups.events_seen + 1,
      name = coalesce(nullif(excluded.name, ''), public.conv_groups.name),
      last_payload_shape = coalesce(excluded.last_payload_shape, public.conv_groups.last_payload_shape)
    returning * into v_group;
    -- Grupo não permitido: não se grava nada do conteúdo.
    if v_group.status <> 'allowed' then
      return jsonb_build_object('ignored', 'group_not_allowed', 'group_id', v_group.id, 'group_status', v_group.status);
    end if;
    if not v_from_me then
      v_sender := conv_private.upsert_contact(p->>'phone', p->>'lid', p->>'name', false);
    end if;
    v_conv := conv_private.open_group(v_group.id);
  else
    v_contact := conv_private.upsert_contact(p->>'phone', null, p->>'name', v_from_me);
    v_sender := case when v_from_me then null else v_contact end;
    v_conv := conv_private.open_direct(v_contact);
  end if;

  if v_reply is not null then
    select coalesce(nullif(body, ''), case kind when 'image' then '📷 Foto' when 'video' then '🎥 Vídeo'
      when 'audio' then '🎤 Áudio' when 'ptt' then '🎤 Áudio' when 'document' then '📄 Documento' else '' end)
      into v_preview from public.conv_messages where provider_message_id = v_reply;
  end if;

  insert into public.conv_messages(conversation_id, direction, origin, sender_contact_id, kind, body, status,
    provider_message_id, sent_at, media_mime, media_name, meta, reply_to_provider_id, reply_preview, mention_direct, mention_evidence)
  values (v_conv, case when v_from_me then 'outbound' else 'inbound' end, case when v_from_me then 'staff' else 'customer' end,
    v_sender, v_kind, v_body, case when v_from_me then 'sent' else 'received' end, v_pid, v_at,
    nullif(p->>'mime', ''), left(nullif(p->>'file_name', ''), 120), coalesce(p->'meta', '{}'::jsonb), v_reply, left(v_preview, 200),
    coalesce((p#>>'{mention,direct}')::boolean, false) and v_group_kind and not v_from_me,
    left(nullif(p#>>'{mention,evidence}', ''), 80))
  on conflict (provider_message_id) where provider_message_id is not null do nothing
  returning id into v_msg;
  if v_msg is null then
    select id into v_msg from public.conv_messages where provider_message_id = v_pid;
    return jsonb_build_object('message_id', v_msg, 'conversation_id', v_conv, 'duplicate', true);
  end if;

  update public.conv_conversations set
    last_message_at = greatest(coalesce(last_message_at, v_at), v_at),
    last_inbound_at = case when v_from_me then last_inbound_at else v_at end,
    last_staff_at = case when v_from_me then v_at else last_staff_at end,
    -- Resposta dada pelo celular do clube também conta como lida pela equipe.
    staff_read_at = case when v_from_me then greatest(coalesce(staff_read_at, v_at), v_at) else staff_read_at end
  where id = v_conv;

  return jsonb_build_object('message_id', v_msg, 'conversation_id', v_conv, 'contact_id', v_sender, 'duplicate', false,
    'kind', case when v_group_kind then 'group' else 'direct' end, 'from_me', v_from_me);
end $$;

-- Entregue/lida, vindo do WhatsApp. Só avança; só mexe em mensagem NOSSA.
create function conv_private.update_message_status(p_provider_id text, p_status text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set status = p_status
  where provider_message_id = p_provider_id and direction = 'outbound' and p_status in ('delivered', 'read')
    and array_position(array['queued','sent','delivered','read'], status)
        < array_position(array['queued','sent','delivered','read'], p_status);
$$;

create function conv_private.apply_reaction(p_target text, p_emoji text, p_from_me boolean) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set reactions = case
    when coalesce(trim(p_emoji), '') = '' then reactions - (case when p_from_me then 'staff' else 'customer' end)
    else reactions || jsonb_build_object(case when p_from_me then 'staff' else 'customer' end, left(trim(p_emoji), 16)) end
  where provider_message_id = p_target;
$$;

create function conv_private.apply_edit(p_provider_id text, p_body text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set body = left(p_body, 8192), edited_at = now()
  where provider_message_id = p_provider_id and deleted_at is null and coalesce(p_body, '') <> '';
$$;

create function conv_private.apply_delete(p_provider_id text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set deleted_at = coalesce(deleted_at, now()) where provider_message_id = p_provider_id;
$$;

create function conv_private.set_message_media(p_provider_id text, p_path text, p_mime text) returns uuid
language sql security definer set search_path = '' as $$
  update public.conv_messages set media_path = p_path, media_mime = coalesce(nullif(p_mime, ''), media_mime)
  where provider_message_id = p_provider_id returning id;
$$;

-- Texto que o WhatsApp só conseguiu decifrar depois.
create function conv_private.resolve_undecryptable(p_provider_id text, p_body text, p_kind text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set body = left(p_body, 8192), kind = coalesce(nullif(p_kind, ''), kind)
  where provider_message_id = p_provider_id and body like '%[Undecryptable]%' and coalesce(p_body, '') <> '';
$$;

create function conv_private.set_avatar(p_contact uuid, p_url text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_contacts set avatar_url = nullif(p_url, ''), avatar_checked_at = now() where id = p_contact;
$$;

-- Registro curto de descartes/falhas do webhook (sem conteúdo).
create function conv_private.log_webhook(p_event text, p_outcome text, p_detail text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.conv_webhook_log(event, outcome, detail) values (left(p_event, 60), left(p_outcome, 60), left(p_detail, 200))
  returning id into v_id;
  if v_id % 50 = 0 then delete from public.conv_webhook_log where at < now() - interval '7 days'; end if;
end $$;

-- Dados do canal que o webhook precisa (token só em hash).
create function conv_private.channel_delivery()
returns table(inbound_token_hash text, bot_phone text, bot_lids text[], ai_direct_enabled boolean, ai_group_enabled boolean,
  mention_verified_at timestamptz, group_session_minutes smallint, institutional_name text)
language sql stable security definer set search_path = '' as $$
  select c.inbound_token_hash, c.bot_phone, c.bot_lids, c.ai_direct_enabled, c.ai_group_enabled, c.mention_verified_at,
    c.group_session_minutes, c.institutional_name
  from public.conv_channel c where c.id $$;

-- ------------------------------------------------------------------
-- 4. Envio com idempotência (mesma fila para equipe, IA, automação e retorno)
-- ------------------------------------------------------------------
-- Registra a mensagem ANTES de chamar o provedor. A mesma chave devolve a mesma
-- linha: dois toques em "Enviar", um retry ou um job repetido não duplicam.
create function conv_private.queue_message(
  p_conversation uuid, p jsonb, p_author uuid, p_key uuid, p_origin text default 'staff',
  p_session uuid default null, p_recipient uuid default null)
returns table(message_id uuid, destination text, already_sent boolean, reply_provider_id text, is_group boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := coalesce(nullif(p->>'kind', ''), 'text'); v_body text := nullif(p->>'body', '');
  v_existing public.conv_messages%rowtype; v_conv public.conv_conversations%rowtype;
  v_reply uuid := nullif(p->>'reply_to_message_id', '')::uuid; v_reply_provider text; v_preview text;
  v_dest text; v_group boolean; v_id uuid;
begin
  if p_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_origin not in ('staff', 'ai', 'automation', 'system') then raise exception 'INVALID_ORIGIN'; end if;
  if v_kind not in ('text','image','video','audio','ptt','document') then raise exception 'INVALID_KIND'; end if;
  if v_kind = 'text' and (v_body is null or length(trim(v_body)) = 0) then raise exception 'BODY_REQUIRED'; end if;
  if v_body is not null and length(v_body) > 4096 then raise exception 'BODY_TOO_LONG'; end if;
  if v_kind <> 'text' and nullif(p->>'media_path', '') is null then raise exception 'MEDIA_REQUIRED'; end if;
  if v_kind <> 'text' and (p->>'media_path') !~ '^(in|out)/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' then raise exception 'INVALID_MEDIA_PATH'; end if;

  select * into v_existing from public.conv_messages where request_id = p_key;
  if found then
    if v_existing.conversation_id <> p_conversation then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    select coalesce(c.phone, g.group_jid), cv.kind = 'group' into v_dest, v_group
      from public.conv_conversations cv left join public.conv_contacts c on c.id = cv.contact_id
      left join public.conv_groups g on g.id = cv.group_id where cv.id = p_conversation;
    return query select v_existing.id, v_dest, v_existing.status in ('sent','delivered','read'), v_existing.reply_to_provider_id, v_group;
    return;
  end if;

  select * into v_conv from public.conv_conversations where id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if v_conv.kind = 'direct' then
    select c.phone into v_dest from public.conv_contacts c where c.id = v_conv.contact_id;
    if v_dest is null then raise exception 'CONTACT_WITHOUT_PHONE'; end if;
    v_group := false;
  else
    select g.group_jid into v_dest from public.conv_groups g where g.id = v_conv.group_id;
    v_group := true;
  end if;

  -- Responder reabre: a conversa encerrada volta para a caixa.
  if v_conv.status = 'closed' then
    if exists (select 1 from public.conv_conversations o where o.status = 'open' and o.id <> v_conv.id and o.kind = v_conv.kind
               and ((v_conv.kind = 'direct' and o.contact_id = v_conv.contact_id) or (v_conv.kind = 'group' and o.group_id = v_conv.group_id))) then
      raise exception 'CONVERSATION_SUPERSEDED';
    end if;
    update public.conv_conversations set status = 'open' where id = v_conv.id;
  end if;

  if v_reply is not null then
    select provider_message_id, left(coalesce(body, ''), 200) into v_reply_provider, v_preview
      from public.conv_messages where id = v_reply and conversation_id = p_conversation;
  end if;

  insert into public.conv_messages(conversation_id, direction, origin, author_id, kind, body, status, request_id,
    media_path, media_mime, media_name, reply_to_provider_id, reply_preview, ai_session_id, automation_recipient_id)
  values (p_conversation, 'outbound', p_origin, p_author, v_kind, v_body, 'queued', p_key,
    nullif(p->>'media_path', ''), nullif(p->>'mime', ''), left(nullif(p->>'file_name', ''), 120), v_reply_provider, v_preview, p_session, p_recipient)
  returning id into v_id;
  return query select v_id, v_dest, false, v_reply_provider, v_group;
end $$;

-- Resultado do provedor. Só ele muda o estado para enviada/falhou.
create function conv_private.finish_message(p_message uuid, p_sent boolean, p_provider_id text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_author uuid; v_origin text; v_kind text;
begin
  update public.conv_messages set
    status = case when p_sent then 'sent' else 'failed' end,
    provider_message_id = case when p_sent then coalesce(nullif(p_provider_id, ''), provider_message_id) else provider_message_id end,
    sent_at = case when p_sent then now() else sent_at end,
    attempts = attempts + 1,
    last_error = case when p_sent then null else left(coalesce(p_error, 'SEND_FAILED'), 300) end
  where id = p_message and status in ('queued', 'failed')
  returning conversation_id, author_id, origin into v_conv, v_author, v_origin;
  if p_sent and v_conv is not null then
    select kind into v_kind from public.conv_conversations where id = v_conv;
    update public.conv_conversations set
      last_staff_at = now(), last_message_at = now(),
      -- Só resposta MANUAL de administrador assume a conversa direta; IA, automação e
      -- retorno não. Em grupo, nenhuma mensagem da equipe desliga a IA do grupo inteiro.
      staff_read_at = case when v_origin = 'staff' then now() else staff_read_at end,
      handled_by_human = handled_by_human or (v_origin = 'staff' and v_author is not null and v_kind = 'direct'),
      ai_status = case when v_origin = 'staff' and v_author is not null and v_kind = 'direct' and ai_status = 'ai' then 'human' else ai_status end
    where id = v_conv;
  end if;
end $$;

create function conv_private.message_target(p_message uuid)
returns table(provider_message_id text, destination text, direction text, created_at timestamptz, conversation_id uuid, is_group boolean)
language sql stable security definer set search_path = '' as $$
  select m.provider_message_id, coalesce(c.phone, g.group_jid), m.direction, m.created_at, m.conversation_id, cv.kind = 'group'
  from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
  left join public.conv_contacts c on c.id = cv.contact_id left join public.conv_groups g on g.id = cv.group_id
  where m.id = p_message;
$$;

create function conv_private.staff_edit_message(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'BODY_REQUIRED'; end if;
  update public.conv_messages set body = p_body, edited_at = now()
  where id = p_message and direction = 'outbound' and deleted_at is null and kind = 'text'
    and status in ('sent','delivered','read') and created_at > now() - interval '15 minutes';
  if not found then raise exception 'MESSAGE_NOT_EDITABLE'; end if;
end $$;

create function conv_private.staff_delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conv_messages set deleted_at = now()
  where id = p_message and direction = 'outbound' and deleted_at is null and status in ('sent','delivered','read');
  if not found then raise exception 'MESSAGE_NOT_DELETABLE'; end if;
end $$;

create function conv_private.staff_react(p_message uuid, p_emoji text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_messages set reactions = case when coalesce(trim(p_emoji), '') = ''
    then reactions - 'staff' else reactions || jsonb_build_object('staff', left(trim(p_emoji), 16)) end
  where id = p_message;
$$;

-- Lida: marca e devolve as mensagens do contato ainda não lidas (tiques azuis do lado dele).
create function conv_private.mark_read_collect(p_conversation uuid)
returns table(destination text, provider_ids text[], is_group boolean)
language plpgsql security definer set search_path = '' as $$
declare v_since timestamptz;
begin
  select staff_read_at into v_since from public.conv_conversations where id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  update public.conv_conversations set staff_read_at = now() where id = p_conversation;
  return query
    select coalesce(c.phone, g.group_jid),
      coalesce(array(select m.provider_message_id from public.conv_messages m
        where m.conversation_id = p_conversation and m.direction = 'inbound' and m.provider_message_id is not null
          and m.created_at > coalesce(v_since, '-infinity'::timestamptz) order by m.created_at desc limit 100), '{}'),
      cv.kind = 'group'
    from public.conv_conversations cv left join public.conv_contacts c on c.id = cv.contact_id
    left join public.conv_groups g on g.id = cv.group_id where cv.id = p_conversation;
end $$;

create function conv_private.mark_unread(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  select max(created_at) into v_last from public.conv_messages where conversation_id = p_conversation and direction = 'inbound';
  if v_last is null then raise exception 'NOTHING_TO_UNREAD'; end if;
  update public.conv_conversations set staff_read_at = v_last - interval '1 millisecond' where id = p_conversation;
end $$;

create function conv_private.conversation_contact(p_conversation uuid)
returns table(contact_id uuid, destination text, name text, avatar_url text, avatar_checked_at timestamptz, is_group boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, coalesce(c.phone, g.group_jid), coalesce(c.name, g.name), c.avatar_url, c.avatar_checked_at, cv.kind = 'group'
  from public.conv_conversations cv left join public.conv_contacts c on c.id = cv.contact_id
  left join public.conv_groups g on g.id = cv.group_id where cv.id = p_conversation;
$$;

-- Retornos com mensagem agendada que venceram: pega com trava.
create function conv_private.claim_due_followups(p_limit integer)
returns table(followup_id uuid, conversation_id uuid, send_body text)
language sql security definer set search_path = '' as $$
  update public.conv_followups f set status = 'sending'
  where f.id in (
    select id from public.conv_followups where status = 'pending' and send_body is not null and due_at <= now()
    order by due_at limit greatest(least(coalesce(p_limit, 20), 50), 1) for update skip locked)
  returning f.id, f.conversation_id, f.send_body;
$$;

create function conv_private.finish_followup(p_followup uuid, p_message uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.conv_followups set status = case when p_error is null then 'sent' else 'failed' end,
    message_id = p_message, last_error = left(p_error, 300), done_at = now()
  where id = p_followup and status = 'sending';
$$;

-- ------------------------------------------------------------------
-- 5. Invólucros do `service_role` (webhook, IA, dispatch, edge de operações)
-- ------------------------------------------------------------------
do $wrappers$
declare v record;
begin
  for v in select * from (values
    ('ingest_message', 'p jsonb', 'jsonb', 'p'),
    ('update_message_status', 'p_provider_id text, p_status text', 'void', 'p_provider_id, p_status'),
    ('apply_reaction', 'p_target text, p_emoji text, p_from_me boolean', 'void', 'p_target, p_emoji, p_from_me'),
    ('apply_edit', 'p_provider_id text, p_body text', 'void', 'p_provider_id, p_body'),
    ('apply_delete', 'p_provider_id text', 'void', 'p_provider_id'),
    ('set_message_media', 'p_provider_id text, p_path text, p_mime text', 'uuid', 'p_provider_id, p_path, p_mime'),
    ('resolve_undecryptable', 'p_provider_id text, p_body text, p_kind text', 'void', 'p_provider_id, p_body, p_kind'),
    ('set_avatar', 'p_contact uuid, p_url text', 'void', 'p_contact, p_url'),
    ('log_webhook', 'p_event text, p_outcome text, p_detail text', 'void', 'p_event, p_outcome, p_detail'),
    ('finish_message', 'p_message uuid, p_sent boolean, p_provider_id text, p_error text', 'void', 'p_message, p_sent, p_provider_id, p_error'),
    ('staff_edit_message', 'p_message uuid, p_body text', 'void', 'p_message, p_body'),
    ('staff_delete_message', 'p_message uuid', 'void', 'p_message'),
    ('staff_react', 'p_message uuid, p_emoji text', 'void', 'p_message, p_emoji'),
    ('mark_unread', 'p_conversation uuid', 'void', 'p_conversation'),
    ('finish_followup', 'p_followup uuid, p_message uuid, p_error text', 'void', 'p_followup, p_message, p_error')
  ) as t(nome, args, ret, chamada) loop
    execute format('revoke all on function conv_private.%I(%s) from public, anon, authenticated', v.nome, v.args);
    execute format('create function public.%I(%s) returns %s language sql security definer set search_path = '''' as $f$ select conv_private.%I(%s) $f$',
      'conv_svc_' || v.nome, v.args, v.ret, v.nome, v.chamada);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', 'conv_svc_' || v.nome, v.args);
    execute format('grant execute on function public.%I(%s) to service_role', 'conv_svc_' || v.nome, v.args);
  end loop;
end
$wrappers$;

-- Funções que devolvem tabela: invólucros à mão.
create function public.conv_svc_channel_delivery()
returns table(inbound_token_hash text, bot_phone text, bot_lids text[], ai_direct_enabled boolean, ai_group_enabled boolean,
  mention_verified_at timestamptz, group_session_minutes smallint, institutional_name text)
language sql stable security definer set search_path = '' as $$ select * from conv_private.channel_delivery() $$;
create function public.conv_svc_queue_message(p_conversation uuid, p jsonb, p_author uuid, p_key uuid,
  p_origin text default 'staff', p_session uuid default null, p_recipient uuid default null)
returns table(message_id uuid, destination text, already_sent boolean, reply_provider_id text, is_group boolean)
language sql security definer set search_path = '' as $$
  select * from conv_private.queue_message(p_conversation, p, p_author, p_key, p_origin, p_session, p_recipient) $$;
create function public.conv_svc_message_target(p_message uuid)
returns table(provider_message_id text, destination text, direction text, created_at timestamptz, conversation_id uuid, is_group boolean)
language sql stable security definer set search_path = '' as $$ select * from conv_private.message_target(p_message) $$;
create function public.conv_svc_mark_read_collect(p_conversation uuid)
returns table(destination text, provider_ids text[], is_group boolean)
language sql security definer set search_path = '' as $$ select * from conv_private.mark_read_collect(p_conversation) $$;
create function public.conv_svc_conversation_contact(p_conversation uuid)
returns table(contact_id uuid, destination text, name text, avatar_url text, avatar_checked_at timestamptz, is_group boolean)
language sql stable security definer set search_path = '' as $$ select * from conv_private.conversation_contact(p_conversation) $$;
create function public.conv_svc_claim_due_followups(p_limit integer)
returns table(followup_id uuid, conversation_id uuid, send_body text)
language sql security definer set search_path = '' as $$ select * from conv_private.claim_due_followups(p_limit) $$;

revoke all on function conv_private.channel_delivery(), conv_private.queue_message(uuid, jsonb, uuid, uuid, text, uuid, uuid),
  conv_private.message_target(uuid), conv_private.mark_read_collect(uuid), conv_private.conversation_contact(uuid),
  conv_private.claim_due_followups(integer), conv_private.link_contact(uuid), conv_private.upsert_contact(text, text, text, boolean),
  conv_private.open_direct(uuid), conv_private.open_group(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_channel_delivery(), public.conv_svc_queue_message(uuid, jsonb, uuid, uuid, text, uuid, uuid),
  public.conv_svc_message_target(uuid), public.conv_svc_mark_read_collect(uuid), public.conv_svc_conversation_contact(uuid),
  public.conv_svc_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.conv_svc_channel_delivery(), public.conv_svc_queue_message(uuid, jsonb, uuid, uuid, text, uuid, uuid),
  public.conv_svc_message_target(uuid), public.conv_svc_mark_read_collect(uuid), public.conv_svc_conversation_contact(uuid),
  public.conv_svc_claim_due_followups(integer) to service_role;

-- ------------------------------------------------------------------
-- 6. Administrador: caixa, conversa, contato, canal
-- ------------------------------------------------------------------
-- Lista da caixa, com o estado da IA. `p_filter`: open | unread | waiting | mine |
-- followup | ai | handoff | groups | closed | all.
create function public.conv_inbox(p_filter text default 'open', p_search text default null, p_limit integer default 100)
returns table(
  id uuid, kind text, status text, title text, destination text, contact_id uuid, group_id uuid, avatar_url text,
  profile_id uuid, profile_name text, student_id uuid, link_status text, opt_out boolean,
  last_message_at timestamptz, last_body text, last_message_kind text, last_direction text, last_status text,
  last_origin text, last_deleted boolean, unread_count integer, tags text[], assigned_to uuid, assigned_name text,
  next_followup_at timestamptz, waiting_since timestamptz, ai_status text, handoff_kind text, handoff_note text,
  handoff_at timestamptz, ai_session_open boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(trim(coalesce(p_search, '')), ''); v_digits text;
begin
  perform conv_private.require_admin();
  v_digits := conv_private.digits(v_search);
  return query
  select cv.id, cv.kind, cv.status, coalesce(c.name, g.name, case when c.phone is not null then '+' || c.phone end, 'Contato'),
    coalesce(c.phone, g.group_jid), c.id, g.id, c.avatar_url,
    c.profile_id, pr.name, c.non_socio_student_id, c.link_status, coalesce(c.opt_out, false),
    coalesce(cv.last_message_at, cv.created_at), m.body, m.kind, m.direction, m.status, m.origin, m.deleted_at is not null,
    (select count(*)::integer from public.conv_messages i where i.conversation_id = cv.id and i.direction = 'inbound'
       and i.created_at > coalesce(cv.staff_read_at, '-infinity'::timestamptz)),
    cv.tags, cv.assigned_to, s.name,
    (select min(f.due_at) from public.conv_followups f where f.conversation_id = cv.id and f.status = 'pending'),
    case when m.direction = 'inbound' then coalesce(cv.last_message_at, cv.created_at) end,
    cv.ai_status, cv.handoff_kind, cv.handoff_note, cv.handoff_at,
    exists (select 1 from public.conv_ai_sessions x where x.conversation_id = cv.id and x.status = 'open' and x.expires_at > now())
  from public.conv_conversations cv
  left join public.conv_contacts c on c.id = cv.contact_id
  left join public.conv_groups g on g.id = cv.group_id
  left join public.profiles pr on pr.id = c.profile_id
  left join public.profiles s on s.id = cv.assigned_to
  left join lateral (
    select x.body, x.kind, x.direction, x.status, x.origin, x.deleted_at from public.conv_messages x
    where x.conversation_id = cv.id order by x.created_at desc limit 1) m on true
  where case coalesce(p_filter, 'open')
      when 'closed' then cv.status = 'closed'
      when 'all' then true
      when 'groups' then cv.status = 'open' and cv.kind = 'group'
      when 'unread' then cv.status = 'open' and exists (select 1 from public.conv_messages i where i.conversation_id = cv.id
        and i.direction = 'inbound' and i.created_at > coalesce(cv.staff_read_at, '-infinity'::timestamptz))
      when 'waiting' then cv.status = 'open' and m.direction = 'inbound'
      when 'mine' then cv.status = 'open' and cv.assigned_to = auth.uid()
      when 'followup' then exists (select 1 from public.conv_followups f where f.conversation_id = cv.id and f.status = 'pending'
        and f.due_at < (date_trunc('day', now() at time zone 'America/Fortaleza') + interval '1 day') at time zone 'America/Fortaleza')
      when 'ai' then cv.status = 'open' and cv.ai_status = 'ai'
        and exists (select 1 from public.conv_ai_sessions x where x.conversation_id = cv.id and x.status = 'open' and x.expires_at > now())
      when 'handoff' then cv.status = 'open' and (cv.ai_status = 'human' or cv.kind = 'group') and cv.handoff_at is not null
        and cv.handoff_at >= coalesce(cv.last_staff_at, '-infinity'::timestamptz)
      else cv.status = 'open' end
    and (v_search is null
         or c.name ilike '%' || v_search || '%' or g.name ilike '%' || v_search || '%' or pr.name ilike '%' || v_search || '%'
         or v_search = any (cv.tags)
         or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%'))
  order by coalesce(cv.last_message_at, cv.created_at) desc
  limit greatest(least(coalesce(p_limit, 100), 200), 1);
end $$;

create function public.conv_set_status(p_conversation uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare cv public.conv_conversations%rowtype;
begin
  perform conv_private.require_admin();
  if p_status not in ('open', 'closed') then raise exception 'INVALID_STATUS'; end if;
  select * into cv from public.conv_conversations where id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_status = 'open' and exists (select 1 from public.conv_conversations o where o.status = 'open' and o.id <> cv.id and o.kind = cv.kind
      and ((cv.kind = 'direct' and o.contact_id = cv.contact_id) or (cv.kind = 'group' and o.group_id = cv.group_id))) then
    raise exception 'CONVERSATION_SUPERSEDED';
  end if;
  update public.conv_conversations set status = p_status where id = p_conversation;
  -- Encerrar fecha as sessões de IA daquela conversa.
  if p_status = 'closed' and to_regclass('public.conv_ai_sessions') is not null then
    update public.conv_ai_sessions set status = 'done' where conversation_id = p_conversation and status = 'open';
  end if;
end $$;

create function public.conv_set_meta(p_conversation uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tags text[]; v_assignee uuid;
begin
  perform conv_private.require_admin();
  if p ? 'tags' then
    select coalesce(array_agg(distinct left(lower(trim(t)), 30)) filter (where length(trim(t)) > 0), '{}') into v_tags
      from jsonb_array_elements_text(p->'tags') t;
    if cardinality(v_tags) > 12 then raise exception 'TOO_MANY_TAGS'; end if;
  end if;
  if p ? 'assigned_to' and nullif(p->>'assigned_to', '') is not null then
    v_assignee := (p->>'assigned_to')::uuid;
    if not exists (select 1 from public.profiles where id = v_assignee and role::text = 'admin') then raise exception 'ASSIGNEE_NOT_ADMIN'; end if;
  end if;
  update public.conv_conversations set
    tags = coalesce(v_tags, tags),
    assigned_to = case when p ? 'assigned_to' then v_assignee else assigned_to end
  where id = p_conversation;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
end $$;

-- Quem responde a conversa: assumir, devolver à IA, pausar. Auditado.
create function public.conv_set_ai_status(p_conversation uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_old text;
begin
  v_actor := conv_private.require_admin();
  if p_status not in ('ai', 'human', 'paused') then raise exception 'INVALID_STATUS'; end if;
  select ai_status into v_old from public.conv_conversations where id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  update public.conv_conversations set
    ai_status = p_status, handled_by_human = p_status <> 'ai',
    handoff_kind = case when p_status = 'ai' then null else handoff_kind end,
    handoff_note = case when p_status = 'ai' then null else handoff_note end,
    ai_turns = case when p_status = 'ai' then 0 else ai_turns end
  where id = p_conversation;
  if p_status <> 'ai' and to_regclass('public.conv_ai_sessions') is not null then
    update public.conv_ai_sessions set status = 'handoff' where conversation_id = p_conversation and status = 'open';
  end if;
  perform conv_private.audit('ai_status', 'conv_conversations', p_conversation::text,
    jsonb_build_object('ai_status', v_old), jsonb_build_object('ai_status', p_status), jsonb_build_object('actor', 'admin'));
end $$;

create function public.conv_open_conversation(p_phone text, p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid;
begin
  perform conv_private.require_admin();
  if conv_private.phone_e164(p_phone) is null or length(conv_private.phone_e164(p_phone)) < 12 then raise exception 'INVALID_PHONE'; end if;
  v_contact := conv_private.upsert_contact(p_phone, null, p_name, true);
  return conv_private.open_direct(v_contact);
end $$;

create function public.conv_add_note(p_conversation uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform conv_private.require_admin();
  if length(trim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'BODY_REQUIRED'; end if;
  insert into public.conv_notes(conversation_id, body, author_id) values (p_conversation, trim(p_body), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.conv_save_quick_reply(p_id uuid, p_shortcut text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  perform conv_private.require_admin();
  if p_id is null then
    insert into public.conv_quick_replies(shortcut, title, body, created_by) values (lower(trim(p_shortcut)), trim(p_title), trim(p_body), auth.uid())
    returning id into v_id;
  else
    update public.conv_quick_replies set shortcut = lower(trim(p_shortcut)), title = trim(p_title), body = trim(p_body) where id = p_id;
    if not found then raise exception 'QUICK_REPLY_NOT_FOUND'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'SHORTCUT_TAKEN';
end $$;

create function public.conv_delete_quick_reply(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  delete from public.conv_quick_replies where id = p_id;
end $$;

create function public.conv_add_followup(p_conversation uuid, p_due_at timestamptz, p_note text, p_send_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform conv_private.require_admin();
  if p_due_at is null or p_due_at < now() - interval '1 minute' then raise exception 'INVALID_DUE_DATE'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null and nullif(trim(coalesce(p_send_body, '')), '') is null then raise exception 'FOLLOWUP_EMPTY'; end if;
  insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
  values (p_conversation, p_due_at, nullif(trim(p_note), ''), nullif(trim(p_send_body), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Concluir, cancelar ou remarcar um retorno pendente; o que já saiu não muda.
create function public.conv_update_followup(p_id uuid, p_status text, p_due_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  if p_status not in ('pending', 'done', 'canceled') then raise exception 'INVALID_STATUS'; end if;
  update public.conv_followups set status = p_status, due_at = coalesce(p_due_at, due_at),
    done_at = case when p_status in ('done', 'canceled') then now() else done_at end
  where id = p_id and status = 'pending';
  if not found then raise exception 'FOLLOWUP_NOT_PENDING'; end if;
end $$;

-- Ligação manual do contato a um cadastro (ou desligamento).
create function public.conv_link_contact(p_contact uuid, p_profile uuid, p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.conv_contacts%rowtype;
begin
  perform conv_private.require_admin();
  if p_profile is not null and p_student is not null then raise exception 'LINK_ONE_ONLY'; end if;
  select * into v_old from public.conv_contacts where id = p_contact for update;
  if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then raise exception 'PROFILE_NOT_FOUND'; end if;
  if p_student is not null and not exists (select 1 from public.non_socio_students where id = p_student) then raise exception 'STUDENT_NOT_FOUND'; end if;
  update public.conv_contacts set profile_id = p_profile, non_socio_student_id = p_student,
    link_status = case when p_profile is null and p_student is null then 'none' else 'manual' end, updated_at = now()
  where id = p_contact;
  perform conv_private.audit('contact_link', 'conv_contacts', p_contact::text,
    jsonb_build_object('profile_id', v_old.profile_id, 'student_id', v_old.non_socio_student_id, 'link_status', v_old.link_status),
    jsonb_build_object('profile_id', p_profile, 'student_id', p_student), jsonb_build_object('actor', 'admin'), p_profile);
end $$;

create function public.conv_set_opt_out(p_contact uuid, p_opt_out boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  update public.conv_contacts set opt_out = coalesce(p_opt_out, false),
    opt_out_at = case when coalesce(p_opt_out, false) then now() else null end, updated_at = now()
  where id = p_contact;
  if not found then raise exception 'CONTACT_NOT_FOUND'; end if;
  perform conv_private.audit('contact_opt_out', 'conv_contacts', p_contact::text, null, jsonb_build_object('opt_out', coalesce(p_opt_out, false)),
    jsonb_build_object('actor', 'admin'));
end $$;

-- Canal: identidade da conta e chaves da IA. Salvar exige chave de idempotência.
create function public.conv_save_channel(p_request uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_old public.conv_channel%rowtype; v_new public.conv_channel%rowtype; v_lids text[]; v_phone text;
begin
  perform conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'channel_save');
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.conv_channel where id for update;
  if p ? 'bot_lids' then
    select coalesce(array_agg(distinct conv_private.norm_lid(x)) filter (where conv_private.norm_lid(x) is not null), '{}') into v_lids
      from jsonb_array_elements_text(p->'bot_lids') x;
  end if;
  v_phone := case when p ? 'bot_phone' then conv_private.phone_e164(p->>'bot_phone') else v_old.bot_phone end;
  if p ? 'bot_phone' and nullif(p->>'bot_phone', '') is not null and v_phone is null then raise exception 'INVALID_PHONE'; end if;
  update public.conv_channel set
    institutional_name = left(coalesce(nullif(trim(p->>'institutional_name'), ''), institutional_name), 80),
    bot_phone = v_phone, bot_lids = coalesce(v_lids, bot_lids),
    ai_direct_enabled = coalesce((p->>'ai_direct_enabled')::boolean, ai_direct_enabled),
    group_session_minutes = coalesce(least(greatest((p->>'group_session_minutes')::int, 2), 120), group_session_minutes),
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where id returning * into v_new;
  perform conv_private.audit('channel_save', 'conv_channel', 'channel', to_jsonb(v_old), to_jsonb(v_new), jsonb_build_object('actor', 'admin'));
  return conv_private.finish_op(p_request, jsonb_build_object('version', v_new.version));
end $$;

-- Gera um novo token de webhook. O token em claro é devolvido UMA vez; no banco fica só o hash.
create function public.conv_rotate_inbound_token(p_request uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb;
begin
  perform conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'token_rotate');
  if v_replay is not null then return v_replay - 'token'; end if;
  if p_token is null or p_token !~ '^[0-9A-Za-z_-]{32,128}$' then raise exception 'INVALID_TOKEN'; end if;
  update public.conv_channel set inbound_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'),
    inbound_token_rotated_at = now(), version = version + 1, updated_at = now(), updated_by = auth.uid() where id;
  perform conv_private.audit('token_rotate', 'conv_channel', 'channel', null, jsonb_build_object('rotated', true), jsonb_build_object('actor', 'admin'));
  -- O resultado gravado em `conv_requests` NÃO guarda o token.
  return conv_private.finish_op(p_request, jsonb_build_object('rotated', true));
end $$;

-- "Verifiquei, em payload real, que o provedor entrega a menção direta": só então
-- a IA pode ser ligada em grupos. Desmarcar desliga a IA de todos os grupos.
create function public.conv_set_mention_verified(p_verified boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := conv_private.require_admin();
  if coalesce(p_verified, false) then
    if not exists (select 1 from public.conv_channel where id and (bot_phone is not null or cardinality(bot_lids) > 0)) then
      raise exception 'BOT_IDENTITY_REQUIRED';
    end if;
    update public.conv_channel set mention_verified_at = now(), mention_verified_by = v_actor, version = version + 1, updated_at = now(), updated_by = v_actor where id;
  else
    update public.conv_channel set mention_verified_at = null, mention_verified_by = null, ai_group_enabled = false, version = version + 1, updated_at = now(), updated_by = v_actor where id;
    update public.conv_groups set ai_enabled = false where ai_enabled;
  end if;
  perform conv_private.audit('mention_verified', 'conv_channel', 'channel', null, jsonb_build_object('verified', coalesce(p_verified, false)),
    jsonb_build_object('actor', 'admin'));
end $$;

create function public.conv_set_ai_channel(p_direct boolean, p_group boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  if coalesce(p_group, false) and not exists (select 1 from public.conv_channel where id and mention_verified_at is not null) then
    raise exception 'MENTION_NOT_VERIFIED';
  end if;
  update public.conv_channel set ai_direct_enabled = coalesce(p_direct, false), ai_group_enabled = coalesce(p_group, false),
    version = version + 1, updated_at = now(), updated_by = auth.uid() where id;
  if not coalesce(p_group, false) then update public.conv_groups set ai_enabled = false where ai_enabled; end if;
  perform conv_private.audit('ai_channel', 'conv_channel', 'channel', null,
    jsonb_build_object('ai_direct_enabled', coalesce(p_direct, false), 'ai_group_enabled', coalesce(p_group, false)), jsonb_build_object('actor', 'admin'));
end $$;

-- Grupo: permitir (passa a ser gravado), bloquear, e IA por grupo.
create function public.conv_set_group(p_group uuid, p_status text, p_ai boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_old public.conv_groups%rowtype;
begin
  v_actor := conv_private.require_admin();
  if p_status not in ('detected', 'allowed', 'blocked') then raise exception 'INVALID_STATUS'; end if;
  select * into v_old from public.conv_groups where id = p_group for update;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if coalesce(p_ai, false) and (p_status <> 'allowed'
     or not exists (select 1 from public.conv_channel where id and ai_group_enabled and mention_verified_at is not null)) then
    raise exception 'GROUP_AI_NOT_ALLOWED';
  end if;
  update public.conv_groups set status = p_status, ai_enabled = coalesce(p_ai, false) and p_status = 'allowed',
    allowed_by = case when p_status = 'allowed' then v_actor else allowed_by end,
    allowed_at = case when p_status = 'allowed' then now() else allowed_at end
  where id = p_group;
  perform conv_private.audit('group_set', 'conv_groups', p_group::text,
    jsonb_build_object('status', v_old.status, 'ai_enabled', v_old.ai_enabled),
    jsonb_build_object('status', p_status, 'ai_enabled', coalesce(p_ai, false) and p_status = 'allowed'),
    jsonb_build_object('actor', 'admin', 'group_name', left(v_old.name, 80)));
end $$;

-- Administradores que podem ser responsáveis por uma conversa.
create function public.conv_admins() returns table(id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  return query select p.id, p.name from public.profiles p where p.role::text = 'admin' and coalesce(p.is_active, true) order by p.name;
end $$;

-- Busca de cadastros para ligar um contato (sócios e alunos). Só nomes e ids.
create function public.conv_search_people(p_query text) returns table(kind text, id uuid, name text, hint text)
language plpgsql stable security definer set search_path = '' as $$
declare v text := '%' || conv_private.fold(trim(coalesce(p_query, ''))) || '%';
begin
  perform conv_private.require_admin();
  if length(trim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
    (select 'profile'::text, p.id, p.name, coalesce(p.category, p.role::text)
       from public.profiles p where conv_private.fold(p.name) like v order by p.name limit 10)
    union all
    (select 'student'::text, s.id, s.name::text, coalesce(s.plan_type, 'Aluno')::text
       from public.non_socio_students s where conv_private.fold(s.name) like v order by s.name limit 10);
end $$;

revoke all on function public.conv_inbox(text, text, integer), public.conv_set_status(uuid, text), public.conv_set_meta(uuid, jsonb),
  public.conv_set_ai_status(uuid, text), public.conv_open_conversation(text, text), public.conv_add_note(uuid, text),
  public.conv_save_quick_reply(uuid, text, text, text), public.conv_delete_quick_reply(uuid),
  public.conv_add_followup(uuid, timestamptz, text, text), public.conv_update_followup(uuid, text, timestamptz),
  public.conv_link_contact(uuid, uuid, uuid), public.conv_set_opt_out(uuid, boolean), public.conv_save_channel(uuid, jsonb),
  public.conv_rotate_inbound_token(uuid, text), public.conv_set_mention_verified(boolean), public.conv_set_ai_channel(boolean, boolean),
  public.conv_set_group(uuid, text, boolean), public.conv_admins(), public.conv_search_people(text) from public, anon;
grant execute on function public.conv_inbox(text, text, integer), public.conv_set_status(uuid, text), public.conv_set_meta(uuid, jsonb),
  public.conv_set_ai_status(uuid, text), public.conv_open_conversation(text, text), public.conv_add_note(uuid, text),
  public.conv_save_quick_reply(uuid, text, text, text), public.conv_delete_quick_reply(uuid),
  public.conv_add_followup(uuid, timestamptz, text, text), public.conv_update_followup(uuid, text, timestamptz),
  public.conv_link_contact(uuid, uuid, uuid), public.conv_set_opt_out(uuid, boolean), public.conv_save_channel(uuid, jsonb),
  public.conv_rotate_inbound_token(uuid, text), public.conv_set_mention_verified(boolean), public.conv_set_ai_channel(boolean, boolean),
  public.conv_set_group(uuid, text, boolean), public.conv_admins(), public.conv_search_people(text) to authenticated;

-- Rollback: drop das funções public.conv_* e conv_private.* criadas aqui.
