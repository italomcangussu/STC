-- Conversas e WhatsApp — fundação (1/4).
--
-- Canal do WhatsApp, contatos, grupos permitidos, conversas, mensagens, notas,
-- respostas rápidas, retornos agendados, log do webhook, idempotência e
-- auditoria. Uma única caixa de mensagens serve ao chat da equipe, às
-- automações e à IA: não existe histórico paralelo para ninguém.
--
-- Origem do desenho: North Jato (`nj_conversations`, `nj_messages`, migrations
-- 20260926090000 e 20260926110000), adaptado ao clube. O North Jato NÃO é
-- alterado. O que muda de lá para cá:
--   * no lugar de "cliente" há CONTATO (telefone/LID) que pode ser ligado a um
--     `profiles` ou a um `non_socio_students` do STC — só quando a
--     correspondência é única;
--   * conversa pode ser de GRUPO (só gravado se um administrador permitir);
--   * autorização = `public.is_admin()` (papel que o STC já tem). Nenhum papel
--     ou permissão novos;
--   * as tabelas `crm_*` (outro produto, RLS aberta a autenticados) NÃO são
--     usadas.
--
-- Segurança: RLS em tudo, leitura só de administrador; ninguém escreve direto
-- (`anon`/`authenticated` sem INSERT/UPDATE/DELETE): toda escrita passa por
-- função `SECURITY DEFINER` (admin) ou por `service_role` (webhook, IA,
-- dispatch). Funções internas ficam em `conv_private` (schema não exposto).
-- Nada daqui apaga dado existente. Não há DELETE em mensagem/conversa.
--
-- NÃO aplicar no remoto sem seguir docs/conversas/OPERACAO_E_MIGRATIONS.md.

create schema if not exists conv_private;
revoke all on schema conv_private from public, anon, authenticated;
alter default privileges in schema conv_private revoke execute on functions from public;

-- ------------------------------------------------------------------
-- 1. Utilidades
-- ------------------------------------------------------------------
create function conv_private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Fortaleza')::date $$;

-- Só administrador gere Conversas (papel já existente: `is_admin()`).
create function conv_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'CONV_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Dígitos de um telefone qualquer.
create function conv_private.digits(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $$;

-- E.164 sem "+": acrescenta 55 a número brasileiro de 10/11 dígitos. Nulo se não servir.
create function conv_private.phone_e164(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := conv_private.digits(p);
begin
  if length(d) in (10, 11) then d := '55' || d; end if;
  if d ~ '^[1-9][0-9]{9,14}$' then return d; end if;
  return null;
end $$;

-- Forma local do STC (`profiles.phone`): DDD + número, sem DDI.
create function conv_private.phone_local(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := conv_private.digits(p);
begin
  if d like '55%' and length(d) >= 12 then d := substr(d, 3); end if;
  if length(d) > 11 then d := right(d, 11); end if;
  return nullif(d, '');
end $$;

-- Chave tolerante ao nono dígito: DDD + últimos 8. Só para BUSCAR candidatos;
-- a ligação a um cadastro exige candidato único.
create function conv_private.phone_key(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare l text := conv_private.phone_local(p);
begin
  if l is null or length(l) < 10 then return null; end if;
  return substr(l, 1, 2) || right(l, 8);
end $$;

-- Sem acento e minúsculo (busca de nome).
create function conv_private.fold(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')) $$;

-- ------------------------------------------------------------------
-- 2. Idempotência e auditoria
-- ------------------------------------------------------------------
-- A mesma chave devolve o mesmo resultado. Chave reaproveitada para outra
-- ação/usuário é recusada.
create table public.conv_requests (
  request_id uuid primary key,
  action text not null,
  actor_id uuid references public.profiles(id),
  result jsonb,
  created_at timestamptz not null default now()
);
create index conv_requests_actor_idx on public.conv_requests(actor_id);

create function conv_private.begin_op(p_key uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_row public.conv_requests%rowtype;
begin
  if v_actor is null then raise exception 'CONV_FORBIDDEN' using errcode = '42501'; end if;
  if p_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  insert into public.conv_requests(request_id, action, actor_id) values (p_key, p_action, v_actor)
  on conflict (request_id) do nothing;
  if not found then
    select * into v_row from public.conv_requests where request_id = p_key;
    if v_row.action <> p_action or v_row.actor_id is distinct from v_actor then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return coalesce(v_row.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  return null;
end $$;

create function conv_private.finish_op(p_key uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.conv_requests set result = p_result where request_id = p_key;
  return p_result;
end $$;

-- Auditoria na trilha que o STC já tem (`admin_audit_logs`). Ator = quem chamou
-- (`auth.uid()`); chamadas de serviço (webhook, IA, dispatch) ficam sem ator e
-- dizem quem agiu em `metadata.actor`. NUNCA entram token, payload bruto de
-- provedor nem corpo de mensagem de contato.
create function conv_private.audit(
  p_action text, p_table text, p_record text, p_old jsonb, p_new jsonb, p_meta jsonb default '{}'::jsonb,
  p_target uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb := p_old; v_new jsonb := p_new; v_key text;
begin
  foreach v_key in array array['inbound_token_hash', 'token', 'secret', 'api_key', 'payload'] loop
    v_old := v_old - v_key; v_new := v_new - v_key;
  end loop;
  perform public.admin_audit_insert_log(
    'conv.' || p_action, p_table, p_record, p_target,
    case when p_target is null then '{}'::uuid[] else array[p_target] end,
    case when v_old is not null and v_new is not null then public.admin_audit_changed_fields(v_old, v_new) else null end,
    v_old, v_new, coalesce(p_meta, '{}'::jsonb), 'conversations', now());
end $$;

-- ------------------------------------------------------------------
-- 3. Canal (singleton): identidade institucional, token do webhook, chaves de IA
-- ------------------------------------------------------------------
create table public.conv_channel (
  id boolean primary key default true check (id),
  provider text not null default 'uazapi' check (provider in ('uazapi')),
  -- Nome da conta institucional ("STC Institucional"). Só informativo: a menção
  -- direta NUNCA é decidida pelo nome digitado no texto.
  institutional_name text not null default 'STC Institucional' check (length(trim(institutional_name)) between 2 and 80),
  -- Identificadores da conta que o provedor usa nas menções: telefone (com DDI)
  -- e/ou LID. Sem pelo menos um, nenhuma menção é reconhecida.
  bot_phone text check (bot_phone is null or bot_phone ~ '^[1-9][0-9]{9,14}$'),
  bot_lids text[] not null default '{}' check (cardinality(bot_lids) <= 5),
  -- SHA-256 do token que vai na URL do webhook. O token em claro só aparece uma
  -- vez, ao gerar (`conv_rotate_inbound_token`).
  inbound_token_hash text check (inbound_token_hash is null or inbound_token_hash ~ '^[0-9a-f]{64}$'),
  inbound_token_rotated_at timestamptz,
  -- IA: 1:1 e grupos são chaves separadas. Grupo exige menção verificada.
  ai_direct_enabled boolean not null default false,
  ai_group_enabled boolean not null default false,
  mention_verified_at timestamptz,
  mention_verified_by uuid references public.profiles(id),
  -- Por quanto tempo a IA segue atendendo quem a chamou no grupo.
  group_session_minutes smallint not null default 15 check (group_session_minutes between 2 and 120),
  -- A IA só se liga a grupo com a menção verificada.
  constraint conv_channel_group_needs_verified check (not ai_group_enabled or mention_verified_at is not null),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.conv_channel(id) values (true);

-- ------------------------------------------------------------------
-- 4. Grupos: só são gravados os que um administrador permitiu
-- ------------------------------------------------------------------
create table public.conv_groups (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null unique check (group_jid ~ '^[0-9A-Za-z._-]{5,64}@g\.us$'),
  name text check (name is null or length(name) <= 200),
  status text not null default 'detected' check (status in ('detected', 'allowed', 'blocked')),
  ai_enabled boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  events_seen integer not null default 1,
  -- SÓ os nomes das chaves do último evento (nunca valores): serve para o
  -- administrador conferir quais metadados o provedor entrega (ex.: menções).
  last_payload_shape jsonb,
  allowed_by uuid references public.profiles(id),
  allowed_at timestamptz,
  constraint conv_groups_ai_needs_allowed check (not ai_enabled or status = 'allowed')
);

-- ------------------------------------------------------------------
-- 5. Contatos
-- ------------------------------------------------------------------
create table public.conv_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text check (phone is null or phone ~ '^[1-9][0-9]{9,14}$'),
  lid text check (lid is null or lid ~ '^[0-9A-Za-z._-]{3,64}$'),
  name text check (name is null or length(name) <= 200),
  avatar_url text,
  avatar_checked_at timestamptz,
  -- Ligação ao cadastro do STC. Só automática quando o candidato é ÚNICO.
  profile_id uuid references public.profiles(id) on delete set null,
  non_socio_student_id uuid references public.non_socio_students(id) on delete set null,
  link_status text not null default 'none' check (link_status in ('none', 'linked', 'ambiguous', 'manual')),
  opt_out boolean not null default false,
  opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or lid is not null),
  check (not (profile_id is not null and non_socio_student_id is not null))
);
create unique index conv_contacts_phone_uidx on public.conv_contacts(phone) where phone is not null;
create unique index conv_contacts_lid_uidx on public.conv_contacts(lid) where lid is not null;
create index conv_contacts_profile_idx on public.conv_contacts(profile_id) where profile_id is not null;
create index conv_contacts_student_idx on public.conv_contacts(non_socio_student_id) where non_socio_student_id is not null;

-- ------------------------------------------------------------------
-- 6. Conversas e mensagens
-- ------------------------------------------------------------------
create table public.conv_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  contact_id uuid references public.conv_contacts(id),
  group_id uuid references public.conv_groups(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  assigned_to uuid references public.profiles(id),
  staff_read_at timestamptz,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_staff_at timestamptz,
  handled_by_human boolean not null default false,
  -- Quem responde: ai (agente), human (equipe assumiu), paused (IA desligada só aqui).
  ai_status text not null default 'ai' check (ai_status in ('ai', 'human', 'paused')),
  ai_turns integer not null default 0,
  ai_last_turn_at timestamptz,
  handoff_kind text check (handoff_kind in ('soft', 'hard')),
  handoff_note text check (handoff_note is null or length(handoff_note) <= 1000),
  handoff_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'direct' and contact_id is not null and group_id is null)
      or (kind = 'group' and group_id is not null and contact_id is null))
);
create unique index conv_conversations_one_open_direct on public.conv_conversations(contact_id)
  where status = 'open' and kind = 'direct';
create unique index conv_conversations_one_open_group on public.conv_conversations(group_id)
  where status = 'open' and kind = 'group';
create index conv_conversations_last_idx on public.conv_conversations(last_message_at desc nulls last);
create index conv_conversations_contact_idx on public.conv_conversations(contact_id);
create index conv_conversations_group_idx on public.conv_conversations(group_id);

create table public.conv_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conv_conversations(id),
  direction text not null check (direction in ('inbound', 'outbound')),
  -- Quem produziu: customer (contato), staff (administrador ou celular do clube),
  -- ai (agente), automation (automação), system.
  origin text not null check (origin in ('customer', 'staff', 'ai', 'automation', 'system')),
  -- Em grupo: quem falou. Em conversa direta de entrada: o próprio contato.
  sender_contact_id uuid references public.conv_contacts(id),
  author_id uuid references public.profiles(id),
  kind text not null default 'text'
    check (kind in ('text', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'contact', 'other')),
  body text check (body is null or length(body) <= 8192),
  -- Estados SÓ refletem o que o provedor devolveu: queued (gravada, não enviada),
  -- sent (provedor aceitou), delivered/read (provedor informou), failed, received.
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  provider_message_id text,
  request_id uuid,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text check (last_error is null or length(last_error) <= 300),
  media_path text,
  media_mime text,
  media_name text,
  meta jsonb not null default '{}'::jsonb,
  reply_to_provider_id text,
  reply_preview text check (reply_preview is null or length(reply_preview) <= 200),
  edited_at timestamptz,
  deleted_at timestamptz,
  reactions jsonb not null default '{}'::jsonb,
  -- Menção à conta institucional, como o webhook a classificou (ver
  -- `_shared/groupMention.ts`). `evidence` diz por que (ou por que não).
  mention_direct boolean not null default false,
  mention_evidence text check (mention_evidence is null or length(mention_evidence) <= 80),
  -- A que sessão de IA a mensagem pertence (contexto só do solicitante).
  ai_session_id uuid,
  -- Quem a originou, quando veio de automação.
  automation_recipient_id uuid,
  created_at timestamptz not null default now(),
  check ((direction = 'inbound' and origin = 'customer') or (direction = 'outbound' and origin <> 'customer'))
);
create unique index conv_messages_provider_uidx on public.conv_messages(provider_message_id) where provider_message_id is not null;
create unique index conv_messages_request_uidx on public.conv_messages(request_id) where request_id is not null;
create index conv_messages_conversation_idx on public.conv_messages(conversation_id, created_at desc);
create index conv_messages_session_idx on public.conv_messages(ai_session_id, created_at) where ai_session_id is not null;
create index conv_messages_sender_idx on public.conv_messages(sender_contact_id, created_at desc) where sender_contact_id is not null;

create table public.conv_quick_replies (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$') unique,
  title text not null check (length(trim(title)) between 1 and 80),
  body text not null check (length(trim(body)) between 1 and 4096),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.conv_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conv_conversations(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index conv_notes_conversation_idx on public.conv_notes(conversation_id, created_at desc);

-- Retorno: lembrete para a equipe e, opcionalmente, mensagem que sai sozinha.
create table public.conv_followups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conv_conversations(id),
  due_at timestamptz not null,
  note text check (note is null or length(note) <= 500),
  send_body text check (send_body is null or length(trim(send_body)) between 1 and 4096),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'done', 'canceled', 'failed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  message_id uuid references public.conv_messages(id),
  last_error text
);
create index conv_followups_due_idx on public.conv_followups(due_at) where status = 'pending';
create index conv_followups_conversation_idx on public.conv_followups(conversation_id, due_at);

-- Registro curto do que o webhook descartou ou falhou (para investigar). SEM
-- payload bruto e SEM conteúdo de mensagem: só o motivo e o formato.
create table public.conv_webhook_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null,
  outcome text not null,
  detail text check (detail is null or length(detail) <= 200)
);
create index conv_webhook_log_at_idx on public.conv_webhook_log(at desc);

-- ------------------------------------------------------------------
-- 7. RLS: leitura só de administrador; nenhuma escrita direta
-- ------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['conv_requests', 'conv_channel', 'conv_groups', 'conv_contacts', 'conv_conversations',
    'conv_messages', 'conv_quick_replies', 'conv_notes', 'conv_followups', 'conv_webhook_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    if t <> 'conv_requests' then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
    end if;
  end loop;
end
$rls$;

grant select on public.conv_groups, public.conv_contacts, public.conv_conversations, public.conv_messages,
  public.conv_quick_replies, public.conv_notes, public.conv_followups, public.conv_webhook_log to authenticated;
-- O canal NÃO expõe o hash do token (concessão por coluna).
grant select (id, provider, institutional_name, bot_phone, bot_lids, inbound_token_rotated_at, ai_direct_enabled,
  ai_group_enabled, mention_verified_at, mention_verified_by, group_session_minutes, version, updated_at, updated_by)
  on public.conv_channel to authenticated;

-- Histórico não se apaga: mensagens e conversas não têm DELETE nem para o dono.
create function conv_private.no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'CONV_NO_DELETE: % não é apagado; arquive ou encerre.', tg_table_name using errcode = '42501';
end $$;
create trigger conv_messages_no_delete before delete on public.conv_messages
  for each row execute function conv_private.no_delete();
create trigger conv_conversations_no_delete before delete on public.conv_conversations
  for each row execute function conv_private.no_delete();
create trigger conv_contacts_no_delete before delete on public.conv_contacts
  for each row execute function conv_private.no_delete();

-- ------------------------------------------------------------------
-- 8. Tempo real, Storage e respostas rápidas iniciais
-- ------------------------------------------------------------------
do $realtime$
declare v_tabela text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publicação supabase_realtime ausente: conversas sem tempo real';
    return;
  end if;
  foreach v_tabela in array array['conv_messages', 'conv_conversations'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabela) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabela);
    end if;
  end loop;
end
$realtime$;

do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'schema storage ausente: bucket conv-media não criado';
    return;
  end if;
  -- 16 MB é o limite do WhatsApp. `file_size_limit` só existe no storage do Supabase.
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('conv-media', 'conv-media', false, 16777216) on conflict (id) do nothing;
  else
    insert into storage.buckets (id, name, public) values ('conv-media', 'conv-media', false) on conflict (id) do nothing;
  end if;
  drop policy if exists conv_media_read on storage.objects;
  create policy conv_media_read on storage.objects for select to authenticated
    using (bucket_id = 'conv-media' and public.is_admin());
  -- O administrador só sobe na pasta de saída; a de entrada é do webhook (service_role).
  drop policy if exists conv_media_upload on storage.objects;
  create policy conv_media_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'conv-media' and public.is_admin() and name like 'out/%');
end
$storage$;

insert into public.conv_quick_replies (shortcut, title, body, created_by) values
  ('ola', 'Saudação', 'Olá, {nome}! Aqui é o Sobral Tênis Clube. Como posso ajudar?', null),
  ('aguarde', 'Já retorno', 'Obrigado, {nome}. Vamos verificar e já retornamos por aqui.', null),
  ('obrigado', 'Agradecimento', 'Obrigado, {nome}! Qualquer coisa é só chamar por aqui.', null)
on conflict (shortcut) do nothing;

-- Rollback: drop das tabelas conv_* (na ordem inversa das FKs), das funções conv_private.* e do
-- bucket conv-media (só vazio), das políticas conv_media_*; retirar conv_messages e conv_conversations
-- da publicação supabase_realtime. Nenhuma tabela existente do STC é alterada por esta migration.
