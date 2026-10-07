-- Conversas e WhatsApp — identidade única de contato.
--
-- Problema: o mesmo sócio aparecia em duas (ou mais) conversas. Causas:
--   * `upsert_contact` só achava o contato por telefone EXATO ou LID exato. O mesmo número com/sem o nono
--     dígito (5585996088991 × 558596088991), ou uma conversa aberta pela equipe antes de o sócio escrever,
--     criava um segundo contato — e, como a conversa direta é única por contato, uma segunda conversa;
--   * dois contatos podiam acabar ligados ao MESMO cadastro (`profiles`/`non_socio_students`) sem que nada os unisse.
--
-- Esta migration:
--   1. reconhece a pessoa antes de criar contato: telefone exato → LID → mesmo número tolerando o nono dígito
--      (só se o candidato for ÚNICO) → contato já ligado ao cadastro que tem esse telefone (só se único);
--   2. funde duplicados (`conv_private.merge_contacts`), de forma NÃO destrutiva: nada é apagado. O contato
--      absorvido fica como "fundido" (`merged_into`) sem telefone/LID; sua conversa aberta tem as mensagens, notas,
--      retornos, sessões e propostas movidas para a conversa do contato mantido e é encerrada (`merged_into`);
--   3. funde as duplicidades que já existem (backfill idempotente ao final);
--   4. a ligação manual (`conv_link_contact`) também consolida;
--   5. a caixa mostra o nome do cadastro quando o contato só tem o número como nome, e esconde conversas fundidas.
--
-- Regra de segurança da fusão (`conv_private.can_merge`): só funde quando não há conflito de identidade — nunca
-- une cadastros diferentes, LIDs diferentes, nem números cujas chaves (DDD + 8 últimos dígitos) divergem.
--
-- NÃO aplicar no remoto sem seguir docs/conversas/OPERACAO_E_MIGRATIONS.md.

-- ------------------------------------------------------------------
-- 1. Colunas de fusão
-- ------------------------------------------------------------------
alter table public.conv_contacts add column merged_into uuid references public.conv_contacts(id);
alter table public.conv_conversations add column merged_into uuid references public.conv_conversations(id);

-- Contato fundido não tem mais telefone nem LID: libera o índice único para o contato mantido.
do $c$
declare r record;
begin
  for r in select conname from pg_constraint
    where conrelid = 'public.conv_contacts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%phone IS NOT NULL%' and pg_get_constraintdef(oid) ilike '%lid IS NOT NULL%' loop
    execute format('alter table public.conv_contacts drop constraint %I', r.conname);
  end loop;
end
$c$;
alter table public.conv_contacts add constraint conv_contacts_has_identity
  check (phone is not null or lid is not null or merged_into is not null);

create index conv_contacts_merged_idx on public.conv_contacts(merged_into) where merged_into is not null;
create index conv_contacts_phone_key_idx on public.conv_contacts(conv_private.phone_key(phone))
  where phone is not null and merged_into is null;

-- ------------------------------------------------------------------
-- 2. Regras de fusão
-- ------------------------------------------------------------------
create function conv_private.older_of(a uuid, b uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.conv_contacts where id in (a, b) order by created_at, id limit 1 $$;

-- Dois contatos são a MESMA pessoa se nada os contradiz.
create function conv_private.can_merge(a uuid, b uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare ca public.conv_contacts%rowtype; cb public.conv_contacts%rowtype; ia text; ib text;
begin
  select * into ca from public.conv_contacts where id = a;
  select * into cb from public.conv_contacts where id = b;
  if ca.id is null or cb.id is null or ca.merged_into is not null or cb.merged_into is not null then return false; end if;
  ia := coalesce(ca.profile_id::text, ca.non_socio_student_id::text);
  ib := coalesce(cb.profile_id::text, cb.non_socio_student_id::text);
  if ia is not null and ib is not null and ia <> ib then return false; end if;
  if ca.lid is not null and cb.lid is not null and ca.lid <> cb.lid then return false; end if;
  if ca.phone is not null and cb.phone is not null
     and conv_private.phone_key(ca.phone) is distinct from conv_private.phone_key(cb.phone) then return false; end if;
  return true;
end $$;

-- Move o conteúdo de uma conversa direta para outra (mesma pessoa). A de origem é encerrada e marcada.
create function conv_private.fold_conversation(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_keep = p_drop then return; end if;
  -- Sessões abertas da conversa absorvida terminam (a IA recomeça no contexto da conversa mantida).
  update public.conv_ai_sessions set status = 'expired' where conversation_id = p_drop and status = 'open';
  update public.conv_messages set conversation_id = p_keep where conversation_id = p_drop;
  update public.conv_notes set conversation_id = p_keep where conversation_id = p_drop;
  update public.conv_followups set conversation_id = p_keep where conversation_id = p_drop;
  update public.conv_ai_sessions set conversation_id = p_keep where conversation_id = p_drop;
  update public.conv_booking_proposals set conversation_id = p_keep where conversation_id = p_drop;
  update public.conv_ai_decisions set conversation_id = p_keep where conversation_id = p_drop;

  update public.conv_conversations kv set
    last_message_at = greatest(kv.last_message_at, dv.last_message_at),
    last_inbound_at = greatest(kv.last_inbound_at, dv.last_inbound_at),
    last_staff_at = greatest(kv.last_staff_at, dv.last_staff_at),
    staff_read_at = least(coalesce(kv.staff_read_at, dv.staff_read_at), coalesce(dv.staff_read_at, kv.staff_read_at)),
    tags = (select coalesce(array_agg(t), '{}') from (select distinct t from unnest(kv.tags || dv.tags) t limit 12) s),
    assigned_to = coalesce(kv.assigned_to, dv.assigned_to),
    handled_by_human = kv.handled_by_human or dv.handled_by_human,
    -- O estado mais restritivo vence: se a equipe assumiu ou pausou a IA em qualquer uma, segue assim.
    ai_status = case when 'human' in (kv.ai_status, dv.ai_status) then 'human'
                     when 'paused' in (kv.ai_status, dv.ai_status) then 'paused' else 'ai' end,
    handoff_kind = case when kv.handoff_at is not null and (dv.handoff_at is null or kv.handoff_at >= dv.handoff_at)
                        then kv.handoff_kind else coalesce(dv.handoff_kind, kv.handoff_kind) end,
    handoff_note = case when kv.handoff_at is not null and (dv.handoff_at is null or kv.handoff_at >= dv.handoff_at)
                        then kv.handoff_note else coalesce(dv.handoff_note, kv.handoff_note) end,
    handoff_at = greatest(kv.handoff_at, dv.handoff_at)
  from public.conv_conversations dv
  where kv.id = p_keep and dv.id = p_drop;

  update public.conv_conversations set status = 'closed', merged_into = p_keep, last_message_at = null where id = p_drop;
end $$;

-- Funde `p_drop` em `p_keep`. Idempotente; nunca apaga linha.
create function conv_private.merge_contacts(p_keep uuid, p_drop uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  k public.conv_contacts%rowtype; d public.conv_contacts%rowtype; dc record; v_open uuid;
  v_profile uuid; v_student uuid; v_num constant text := '^[0-9+ ()-]+$';
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then return p_keep; end if;
  perform 1 from public.conv_contacts where id in (p_keep, p_drop) order by id for update;
  select * into k from public.conv_contacts where id = p_keep;
  select * into d from public.conv_contacts where id = p_drop;
  if k.id is null or d.id is null or k.merged_into is not null or d.merged_into is not null then return p_keep; end if;

  -- 1. O absorvido solta telefone/LID/cadastro (índices únicos) e passa a apontar para o mantido.
  update public.conv_contacts set merged_into = p_keep, phone = null, lid = null,
    profile_id = null, non_socio_student_id = null, link_status = 'none', updated_at = now()
  where id = p_drop;
  update public.conv_contacts set merged_into = p_keep where merged_into = p_drop;

  -- 2. O mantido herda o que faltava.
  v_profile := coalesce(k.profile_id, d.profile_id);
  v_student := case when v_profile is null then coalesce(k.non_socio_student_id, d.non_socio_student_id) end;
  update public.conv_contacts set
    phone = coalesce(phone, d.phone), lid = coalesce(lid, d.lid),
    name = case when (name is null or name ~ v_num) and d.name is not null and d.name !~ v_num then d.name else name end,
    avatar_url = coalesce(avatar_url, d.avatar_url), avatar_checked_at = coalesce(avatar_checked_at, d.avatar_checked_at),
    profile_id = v_profile, non_socio_student_id = v_student,
    link_status = case when 'manual' in (k.link_status, d.link_status) then 'manual'
                       when v_profile is not null or v_student is not null then 'linked'
                       when 'ambiguous' in (k.link_status, d.link_status) then 'ambiguous' else 'none' end,
    opt_out = k.opt_out or d.opt_out, opt_out_at = coalesce(k.opt_out_at, d.opt_out_at), updated_at = now()
  where id = p_keep;

  -- 3. Histórico: quem falou, conversas, sessões, propostas, automações.
  update public.conv_messages set sender_contact_id = p_keep where sender_contact_id = p_drop;
  select id into v_open from public.conv_conversations
    where contact_id = p_keep and kind = 'direct' and status = 'open' and merged_into is null;
  for dc in select id, status from public.conv_conversations where contact_id = p_drop and kind = 'direct' order by created_at loop
    if dc.status = 'open' and v_open is not null then
      perform conv_private.fold_conversation(v_open, dc.id);
      update public.conv_conversations set contact_id = p_keep where id = dc.id;
    else
      update public.conv_conversations set contact_id = p_keep where id = dc.id;
      if dc.status = 'open' then v_open := dc.id; end if;
    end if;
  end loop;
  update public.conv_ai_sessions s set status = 'expired'
    where s.requester_contact_id = p_drop and s.status = 'open'
      and exists (select 1 from public.conv_ai_sessions x
                  where x.conversation_id = s.conversation_id and x.requester_contact_id = p_keep and x.status = 'open');
  update public.conv_ai_sessions set requester_contact_id = p_keep where requester_contact_id = p_drop;
  update public.conv_booking_proposals set requester_contact_id = p_keep where requester_contact_id = p_drop;
  update public.conv_booking_proposals set confirmed_by_contact_id = p_keep where confirmed_by_contact_id = p_drop;
  update public.conv_automation_recipients set contact_id = p_keep where contact_id = p_drop;

  -- Só ids: nunca telefone, nome ou conteúdo.
  perform conv_private.audit('contact_merge', 'conv_contacts', p_keep::text, jsonb_build_object('merged', p_drop),
    jsonb_build_object('kept', p_keep), jsonb_build_object('actor', 'system'));
  return p_keep;
end $$;

-- Funde `p_id` com todo contato que seja a mesma pessoa e devolve o contato que sobrou.
create function conv_private.dedupe_contact(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.conv_contacts%rowtype; o record; v_cur uuid := p_id; v_keep uuid; v_key text;
begin
  select * into c from public.conv_contacts where id = p_id;
  if c.id is null then return p_id; end if;
  if c.merged_into is not null then return c.merged_into; end if;
  v_key := conv_private.phone_key(c.phone);
  for o in
    select x.id from public.conv_contacts x
    where x.merged_into is null and x.id <> p_id
      and ((c.profile_id is not null and x.profile_id = c.profile_id)
        or (c.non_socio_student_id is not null and x.non_socio_student_id = c.non_socio_student_id)
        or (v_key is not null and x.phone is not null and conv_private.phone_key(x.phone) = v_key))
    order by x.created_at, x.id
  loop
    if not conv_private.can_merge(v_cur, o.id) then continue; end if;
    v_keep := conv_private.older_of(v_cur, o.id);
    perform conv_private.merge_contacts(v_keep, case when v_keep = v_cur then o.id else v_cur end);
    v_cur := v_keep;
  end loop;
  return v_cur;
end $$;

-- ------------------------------------------------------------------
-- 3. Reconhecer a pessoa ANTES de criar contato
-- ------------------------------------------------------------------
create function conv_private.resolve_contact(p_phone text, p_lid text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := conv_private.phone_e164(p_phone); v_lid text := conv_private.norm_lid(p_lid);
  v_by_phone uuid; v_by_lid uuid; v_key text; v_ids uuid[]; v_cands uuid[]; v_id uuid;
begin
  if v_phone is not null then
    select id into v_by_phone from public.conv_contacts where phone = v_phone and merged_into is null;
  end if;
  if v_lid is not null then
    select id into v_by_lid from public.conv_contacts where lid = v_lid and merged_into is null;
  end if;
  -- Telefone e LID do MESMO evento apontando para dois contatos: é a mesma pessoa.
  if v_by_phone is not null and v_by_lid is not null and v_by_phone <> v_by_lid
     and conv_private.can_merge(v_by_phone, v_by_lid) then
    return conv_private.merge_contacts(conv_private.older_of(v_by_phone, v_by_lid),
      case when conv_private.older_of(v_by_phone, v_by_lid) = v_by_phone then v_by_lid else v_by_phone end);
  end if;
  if v_by_phone is not null then return v_by_phone; end if;
  if v_by_lid is not null then return v_by_lid; end if;

  v_key := conv_private.phone_key(v_phone);
  if v_key is null then return null; end if;

  -- Mesmo número (tolerando o nono dígito): só se houver um único candidato.
  select coalesce(array_agg(id), '{}') into v_ids from public.conv_contacts
    where merged_into is null and phone is not null and conv_private.phone_key(phone) = v_key
      and (v_lid is null or lid is null or lid = v_lid);
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then
    select id into v_id from public.conv_contacts where id = any (v_ids) order by created_at, id limit 1;
    return v_id;
  end if;

  -- Contato já ligado ao cadastro que tem este telefone (cadastro único).
  select coalesce(array_agg(p.id), '{}') into v_cands from public.profiles p
    where p.phone is not null and conv_private.phone_key(p.phone) = v_key;
  if cardinality(v_cands) = 1 then
    select id into v_id from public.conv_contacts where profile_id = v_cands[1] and merged_into is null
      and (v_lid is null or lid is null or lid = v_lid) order by created_at, id limit 1;
    return v_id;
  elsif cardinality(v_cands) = 0 then
    select coalesce(array_agg(s.id), '{}') into v_cands from public.non_socio_students s
      where s.phone is not null and conv_private.phone_key(s.phone) = v_key;
    if cardinality(v_cands) = 1 then
      select id into v_id from public.conv_contacts where non_socio_student_id = v_cands[1] and merged_into is null
        and (v_lid is null or lid is null or lid = v_lid) order by created_at, id limit 1;
      return v_id;
    end if;
  end if;
  return null;
end $$;

create or replace function conv_private.upsert_contact(p_phone text, p_lid text, p_name text, p_staff_sent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_phone text := conv_private.phone_e164(p_phone); v_lid text := conv_private.norm_lid(p_lid);
  v_id uuid; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_phone is null and v_lid is null then raise exception 'INVALID_CONTACT'; end if;
  v_id := conv_private.resolve_contact(p_phone, p_lid);
  if v_id is null then
    insert into public.conv_contacts(phone, lid, name) values (v_phone, v_lid, case when p_staff_sent then null else v_name end)
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.conv_contacts
        where merged_into is null and ((v_phone is not null and phone = v_phone) or (v_lid is not null and lid = v_lid)) limit 1;
    end if;
  else
    -- Completa o que faltava (telefone ou LID), sem tirar nada.
    begin
      update public.conv_contacts set
        phone = coalesce(phone, v_phone), lid = coalesce(lid, v_lid),
        name = case when p_staff_sent or v_name is null then name
                    when name is null or name ~ '^[0-9+ ()-]+$' then v_name else name end,
        updated_at = now()
      where id = v_id;
    exception when unique_violation then
      null; -- corrida: outro contato tomou este telefone/LID; a próxima mensagem se reconcilia
    end;
  end if;
  perform conv_private.link_contact(v_id);
  v_id := conv_private.dedupe_contact(v_id);
  -- O número que o provedor entrega numa mensagem recebida é o real (com ou sem nono dígito).
  if not p_staff_sent and v_phone is not null then
    begin
      update public.conv_contacts set phone = v_phone, updated_at = now() where id = v_id and phone is distinct from v_phone;
    exception when unique_violation then
      null;
    end;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------
-- 4. Ligação manual também consolida
-- ------------------------------------------------------------------
create or replace function public.conv_link_contact(p_contact uuid, p_profile uuid, p_student uuid) returns void
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
  if p_profile is not null or p_student is not null then
    perform conv_private.dedupe_contact(p_contact);
  end if;
end $$;

-- ------------------------------------------------------------------
-- 5. Caixa: nome do cadastro quando o contato só tem o número; sem conversas fundidas
-- ------------------------------------------------------------------
create or replace function public.conv_inbox(p_filter text default 'open', p_search text default null, p_limit integer default 100)
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
  select cv.id, cv.kind, cv.status,
    coalesce(case when c.name is not null and c.name !~ '^[0-9+ ()-]+$' then c.name end, pr.name, c.name, g.name,
             case when c.phone is not null then '+' || c.phone end, 'Contato'),
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
  where cv.merged_into is null
    and case coalesce(p_filter, 'open')
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

-- Funções internas: nenhuma chega ao navegador.
revoke all on function conv_private.older_of(uuid, uuid), conv_private.can_merge(uuid, uuid),
  conv_private.fold_conversation(uuid, uuid), conv_private.merge_contacts(uuid, uuid),
  conv_private.dedupe_contact(uuid), conv_private.resolve_contact(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 6. Backfill: junta as duplicidades que já existem (idempotente, nada é apagado)
-- ------------------------------------------------------------------
do $backfill$
declare r record;
begin
  -- Quem ficou sem ligação (ou ambíguo) tenta de novo; ligação manual/única nunca é sobrescrita.
  for r in select id from public.conv_contacts
    where merged_into is null and phone is not null and link_status in ('none', 'ambiguous') order by created_at loop
    perform conv_private.link_contact(r.id);
  end loop;
  for r in select id from public.conv_contacts where merged_into is null order by created_at, id loop
    perform conv_private.dedupe_contact(r.id);
  end loop;
end
$backfill$;

-- Rollback: a fusão é registrada em `merged_into` (contatos e conversas); nenhuma linha foi apagada. Para desfazer uma
-- fusão, zere `merged_into` e reabra a conversa; as mensagens movidas ficam na conversa mantida. Funções:
-- drop function conv_private.{older_of,can_merge,fold_conversation,merge_contacts,dedupe_contact,resolve_contact};
-- recriar `upsert_contact`, `conv_link_contact` e `conv_inbox` pela versão de 20261007100100_conversations_operations.sql.
