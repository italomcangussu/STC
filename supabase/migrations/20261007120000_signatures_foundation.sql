-- Documentos e Assinaturas — fundação (1/3).
--
-- O administrador publica um PDF; cada sócio lê até o fim, aceita ("li e
-- concordo") e assina digitalmente com um código de 6 dígitos enviado ao
-- WhatsApp. Esta migration cria só a base: tabelas, regras de imutabilidade,
-- RLS, bucket privado e auditoria. As funções (RPC) vêm nas migrations 2 e 3.
--
-- Nível de assinatura: ELETRÔNICA SIMPLES (Lei 14.063/2020) com dossiê de
-- prova — hash SHA-256 do PDF, telefone provado pelo código no WhatsApp, log
-- de leitura/aceite/código com data e hora do SERVIDOR, IP, aparelho e local.
-- Não é ICP-Brasil. O CPF é DECLARADO pelo sócio (validado nos dígitos), não
-- verificado: quem prova a identidade é a posse do WhatsApp.
--
-- Regras que organizam o módulo:
--  * toda escrita passa por função `SECURITY DEFINER` (`public.sig_*`);
--    `anon`/`authenticated` só leem, e só o que é deles (RLS);
--  * assinaturas e eventos são APPEND-ONLY (UPDATE/DELETE/TRUNCATE barrados);
--  * documento publicado é imutável (título, arquivo, hash, versão);
--  * a prova NÃO depende de linhas que o app apaga: a assinatura guarda um
--    retrato (nome, telefone, CPF, título, hash) e não tem FK para `profiles`;
--  * assinaturas encadeadas por hash (`chain_hash`): apagar ou reordenar uma
--    assinatura quebra a cadeia e `sig_verify_integrity` aponta onde;
--  * o código de 6 dígitos nunca é guardado em claro (hash com sal), vale 10
--    min, tem no máximo 5 tentativas e fica em schema não exposto.
--
-- Funções internas ficam em `sig_private` (schema não exposto pela API).
-- Nenhuma tabela existente é alterada (o gatilho de sócio novo, na migration
-- 3, é o único ponto que toca `profiles` e nunca bloqueia a edição do perfil).

create schema if not exists sig_private;
revoke all on schema sig_private from public, anon, authenticated;
alter default privileges in schema sig_private revoke execute on functions from public;

-- ------------------------------------------------------------------
-- 1. Utilidades
-- ------------------------------------------------------------------
create function sig_private.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- Texto exato do aceite. Fica fixo por documento/versão e é gravado na assinatura.
create function sig_private.consent_text(p_title text, p_version integer) returns text
language sql immutable set search_path = '' as $$
  select format('Li e concordo com todos os termos do documento "%s" (versão %s).', btrim(p_title), p_version) $$;

-- CPF só com dígitos: 11 dígitos, não repetidos, dígitos verificadores corretos.
create function sig_private.cpf_valid(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare s integer; i integer; r integer;
begin
  if p is null or p !~ '^[0-9]{11}$' then return false; end if;
  if p ~ '^(.)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(p, i, 1)::integer * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(p, 10, 1)::integer then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(p, i, 1)::integer * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(p, 11, 1)::integer;
end $$;

-- Só administrador gere documentos (papel já existente no STC: `is_admin()`).
create function sig_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'SIG_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create function sig_private.require_member() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not sig_private.is_active_member(auth.uid()) then
    raise exception 'SIG_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- "Sócio" no STC inclui o admin (ver `MEMBER_ROLES` em utils.ts).
create function sig_private.is_active_member(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = p_profile and p.role::text in ('socio', 'admin') and coalesce(p.is_active, true)) $$;

-- Cabeçalho da requisição que o PostgREST expõe (IP e aparelho vistos pelo SERVIDOR).
create function sig_private.request_header(p_name text) returns text
language plpgsql stable set search_path = '' as $$
declare v_headers text := current_setting('request.headers', true);
begin
  if v_headers is null or v_headers = '' then return null; end if;
  return nullif(btrim(v_headers::json ->> lower(p_name)), '');
exception when others then
  return null;
end $$;

create function sig_private.request_ip() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(
    sig_private.request_header('cf-connecting-ip'),
    sig_private.request_header('x-real-ip'),
    nullif(btrim(split_part(coalesce(sig_private.request_header('x-forwarded-for'), ''), ',', 1)), '')), 64) $$;

-- ------------------------------------------------------------------
-- 2. Documentos
-- ------------------------------------------------------------------
create table public.sig_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text check (description is null or char_length(description) <= 2000),
  file_name text not null check (char_length(file_name) between 1 and 255),
  -- `<id>/<sha256>.pdf` no bucket `sig-docs`. Trocar o PDF de um rascunho = novo hash = novo caminho.
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  page_count integer not null check (page_count between 1 and 1000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version >= 1),
  replaces_id uuid references public.sig_documents(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  audience_mode text not null default 'all' check (audience_mode in ('all', 'selected')),
  -- vale também para quem virar sócio depois da publicação (só no modo 'all')
  applies_to_new_members boolean not null default false,
  due_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  archived_reason text,
  check (applies_to_new_members = false or audience_mode = 'all'),
  check (storage_path = id::text || '/' || content_sha256 || '.pdf')
);
create index sig_documents_status_idx on public.sig_documents(status, published_at desc);
create index sig_documents_replaces_idx on public.sig_documents(replaces_id) where replaces_id is not null;

create function sig_private.guard_document() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'SIG_DOCUMENT_IMMUTABLE' using errcode = '23000'; end if;
    return old;
  end if;
  new.updated_at := now();
  if old.status = 'draft' then return new; end if;
  -- Publicado/arquivado: conteúdo congelado. (`created_by`/`*_by` ficam de fora:
  -- viram NULL se o perfil for apagado.)
  if (new.title, new.description, new.file_name, new.storage_path, new.size_bytes, new.page_count,
      new.content_sha256, new.version, new.replaces_id, new.audience_mode, new.created_at)
     is distinct from
     (old.title, old.description, old.file_name, old.storage_path, old.size_bytes, old.page_count,
      old.content_sha256, old.version, old.replaces_id, old.audience_mode, old.created_at) then
    raise exception 'SIG_DOCUMENT_IMMUTABLE' using errcode = '23000';
  end if;
  if old.status = 'archived' and (new.status <> 'archived' or new.due_at is distinct from old.due_at
     or new.applies_to_new_members is distinct from old.applies_to_new_members) then
    raise exception 'SIG_DOCUMENT_ARCHIVED' using errcode = '23000';
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'SIG_BAD_TRANSITION' using errcode = '23000';
  end if;
  return new;
end $$;
create trigger sig_documents_guard before update or delete on public.sig_documents
  for each row execute function sig_private.guard_document();

-- ------------------------------------------------------------------
-- 3. Destinatários (a "obrigação" de assinar)
-- ------------------------------------------------------------------
create table public.sig_recipients (
  document_id uuid not null references public.sig_documents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'selected' check (source in ('all', 'selected', 'new_member')),
  added_at timestamptz not null default now(),
  added_by uuid,
  signed_at timestamptz,
  signature_id uuid,
  primary key (document_id, profile_id),
  check ((signed_at is null) = (signature_id is null))
);
create index sig_recipients_pending_idx on public.sig_recipients(profile_id) where signed_at is null;

-- ------------------------------------------------------------------
-- 4. Assinaturas (prova) — append-only
-- ------------------------------------------------------------------
create table public.sig_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sig_documents(id),
  profile_id uuid not null,            -- sem FK: a prova sobrevive ao perfil
  seq integer not null,                -- ordem dentro do documento (1, 2, 3…)
  signed_at timestamptz not null,
  -- retrato do documento
  document_title text not null,
  document_version integer not null,
  document_sha256 text not null,
  -- retrato do signatário
  signer_name text not null,
  signer_phone text not null,          -- o número que recebeu o código
  signer_cpf text not null,            -- declarado pelo sócio (dígitos validados)
  -- aceite
  consent_text text not null,
  accepted_at timestamptz not null,
  -- leitura (horários do SERVIDOR; `pages_*` vêm do aparelho)
  read_started_at timestamptz,
  read_completed_at timestamptz,
  read_seconds integer,
  pages_seen integer,
  pages_total integer,
  -- código
  challenge_id uuid not null,
  code_sent_at timestamptz not null,
  code_verified_at timestamptz not null,
  code_attempts integer not null,
  provider_message_id text,            -- id da mensagem do WhatsApp
  -- onde e com o quê
  ip text,
  user_agent text,
  geo jsonb not null default '{}'::jsonb,     -- {source: 'ip'|'gps', city, region, country, lat, lng, accuracy_m}
  device jsonb not null default '{}'::jsonb,  -- {timezone, language, screen, platform}
  -- integridade
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  prev_chain_hash text,
  chain_hash text not null check (chain_hash ~ '^[0-9a-f]{64}$'),
  unique (document_id, profile_id),
  unique (document_id, seq)
);
create index sig_signatures_profile_idx on public.sig_signatures(profile_id);

alter table public.sig_recipients
  add constraint sig_recipients_signature_fk foreign key (signature_id) references public.sig_signatures(id);

create function sig_private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'SIG_APPEND_ONLY' using errcode = '23000';
end $$;

create trigger sig_signatures_append_only before update or delete on public.sig_signatures
  for each row execute function sig_private.forbid_change();
create trigger sig_signatures_no_truncate before truncate on public.sig_signatures
  for each statement execute function sig_private.forbid_change();

-- ------------------------------------------------------------------
-- 5. Eventos da jornada do sócio — append-only
-- ------------------------------------------------------------------
create table public.sig_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  document_id uuid not null references public.sig_documents(id),
  profile_id uuid,                     -- sem FK, como na assinatura
  kind text not null check (kind in (
    'viewed', 'read_started', 'read_completed', 'consent_checked',
    'code_requested', 'code_sent', 'code_send_failed', 'code_wrong', 'code_expired', 'code_locked',
    'signed', 'notified', 'notification_failed')),
  ip text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb
);
create index sig_events_trail_idx on public.sig_events(document_id, profile_id, kind, occurred_at);

create trigger sig_events_append_only before update or delete on public.sig_events
  for each row execute function sig_private.forbid_change();
create trigger sig_events_no_truncate before truncate on public.sig_events
  for each statement execute function sig_private.forbid_change();

-- ------------------------------------------------------------------
-- 6. Fila de avisos por WhatsApp (envio ao publicar + lembretes)
-- ------------------------------------------------------------------
create table public.sig_notifications (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sig_documents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('publish', 'reminder', 'new_member')),
  -- lembretes: 'd-3@2026-10-20' / 'd0@2026-10-20' (inclui a data: mudar o prazo reabre os lembretes)
  slot text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason text,
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (document_id, profile_id, kind, slot)
);
create index sig_notifications_queue_idx on public.sig_notifications(not_before) where status in ('queued', 'sending');
create index sig_notifications_document_idx on public.sig_notifications(document_id, status);

-- ------------------------------------------------------------------
-- 7. CPF declarado pelo sócio
-- ------------------------------------------------------------------
create table public.sig_member_identities (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  cpf text not null check (sig_private.cpf_valid(cpf)),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 8. Desafios do código de 6 dígitos (schema privado: a API não enxerga)
-- ------------------------------------------------------------------
create table sig_private.challenges (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sig_documents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,             -- sha256(sal || código); o código em claro nunca é gravado
  salt text not null,
  phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'verified', 'expired', 'locked', 'superseded', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz,
  provider_message_id text,
  send_error text,
  ip text,
  user_agent text,
  evidence jsonb not null default '{}'::jsonb   -- GPS opcional e aparelho informados na solicitação
);
create index sig_challenges_lookup_idx on sig_private.challenges(profile_id, document_id, created_at desc);
alter table sig_private.challenges enable row level security;

-- ------------------------------------------------------------------
-- 9. Evidência canônica da assinatura (usada ao gravar e ao verificar)
-- ------------------------------------------------------------------
-- Data em UTC com formato fixo: o hash não pode depender do fuso da sessão que o calcula.
create function sig_private.ts(p timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

create function sig_private.signature_evidence(r public.sig_signatures) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'document_id', r.document_id, 'profile_id', r.profile_id, 'seq', r.seq,
    'signed_at', sig_private.ts(r.signed_at), 'document_title', r.document_title,
    'document_version', r.document_version, 'document_sha256', r.document_sha256,
    'signer_name', r.signer_name, 'signer_phone', r.signer_phone, 'signer_cpf', r.signer_cpf,
    'consent_text', r.consent_text, 'accepted_at', sig_private.ts(r.accepted_at),
    'read_started_at', sig_private.ts(r.read_started_at), 'read_completed_at', sig_private.ts(r.read_completed_at),
    'read_seconds', r.read_seconds, 'pages_seen', r.pages_seen, 'pages_total', r.pages_total,
    'challenge_id', r.challenge_id, 'code_sent_at', sig_private.ts(r.code_sent_at),
    'code_verified_at', sig_private.ts(r.code_verified_at), 'code_attempts', r.code_attempts,
    'provider_message_id', r.provider_message_id, 'ip', r.ip, 'user_agent', r.user_agent,
    'geo', r.geo, 'device', r.device) $$;

-- ------------------------------------------------------------------
-- 10. Auditoria (reusa a trilha do STC: `admin_audit_logs`)
-- ------------------------------------------------------------------
-- Dado pessoal (CPF, telefone) NÃO é copiado para o log de auditoria.
create function sig_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[]; v_target uuid;
begin
  if tg_table_name = 'sig_signatures' then
    v_new := jsonb_build_object('id', new.id, 'document_id', new.document_id, 'seq', new.seq,
      'signed_at', new.signed_at, 'document_sha256', new.document_sha256, 'evidence_hash', new.evidence_hash);
    v_row := v_new; v_target := new.profile_id;
  else
    if tg_op = 'DELETE' then v_old := to_jsonb(old); v_row := v_old;
    elsif tg_op = 'UPDATE' then
      v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
      if v_old = v_new then return new; end if;
      v_changed := public.admin_audit_changed_fields(v_old, v_new);
    else v_new := to_jsonb(new); v_row := v_new; end if;
  end if;
  perform public.admin_audit_insert_log(
    'sig.' || coalesce(nullif(current_setting('sig.action', true), ''), lower(tg_op)),
    tg_table_name, v_row->>'id', v_target,
    case when v_target is null then '{}'::uuid[] else array[v_target] end,
    v_changed, v_old, v_new,
    jsonb_strip_nulls(jsonb_build_object('op', lower(tg_op))),
    'signatures', now());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger sig_documents_audit after insert or update or delete on public.sig_documents
  for each row execute function sig_private.audit_row();
create trigger sig_signatures_audit after insert on public.sig_signatures
  for each row execute function sig_private.audit_row();

-- ------------------------------------------------------------------
-- 11. RLS: o sócio lê só o que é dele; o administrador lê tudo
-- ------------------------------------------------------------------
-- Funções públicas e `SECURITY DEFINER` porque as políticas rodam com o papel
-- do usuário (que não enxerga `sig_private`) e evitam recursão entre tabelas.
create function public.sig_is_recipient(p_document uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sig_recipients r
    where r.document_id = p_document and r.profile_id = (select auth.uid())) $$;

-- Publicado: visível ao destinatário. Arquivado: só a quem já assinou (para consultar o que assinou).
create function public.sig_member_can_see(p_document uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sig_documents d
    join public.sig_recipients r on r.document_id = d.id and r.profile_id = (select auth.uid())
    where d.id = p_document and (d.status = 'published' or (d.status = 'archived' and r.signed_at is not null))) $$;

alter table public.sig_documents enable row level security;
alter table public.sig_recipients enable row level security;
alter table public.sig_signatures enable row level security;
alter table public.sig_events enable row level security;
alter table public.sig_notifications enable row level security;
alter table public.sig_member_identities enable row level security;

create policy sig_documents_admin_read on public.sig_documents for select to authenticated
  using ((select public.is_admin()));
create policy sig_documents_member_read on public.sig_documents for select to authenticated
  using (public.sig_member_can_see(id));

create policy sig_recipients_admin_read on public.sig_recipients for select to authenticated
  using ((select public.is_admin()));
create policy sig_recipients_member_read on public.sig_recipients for select to authenticated
  using (profile_id = (select auth.uid()) and public.sig_member_can_see(document_id));

create policy sig_signatures_admin_read on public.sig_signatures for select to authenticated
  using ((select public.is_admin()));
create policy sig_signatures_member_read on public.sig_signatures for select to authenticated
  using (profile_id = (select auth.uid()));

create policy sig_events_admin_read on public.sig_events for select to authenticated
  using ((select public.is_admin()));
create policy sig_notifications_admin_read on public.sig_notifications for select to authenticated
  using ((select public.is_admin()));

create policy sig_identities_admin_read on public.sig_member_identities for select to authenticated
  using ((select public.is_admin()));
create policy sig_identities_own_read on public.sig_member_identities for select to authenticated
  using (profile_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['sig_documents', 'sig_recipients', 'sig_signatures', 'sig_events', 'sig_notifications', 'sig_member_identities'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on function public.sig_is_recipient(uuid) from public, anon;
revoke all on function public.sig_member_can_see(uuid) from public, anon;
grant execute on function public.sig_is_recipient(uuid) to authenticated;
grant execute on function public.sig_member_can_see(uuid) to authenticated;

-- ------------------------------------------------------------------
-- 12. Armazenamento: bucket PRIVADO `sig-docs`, caminho `<id-do-documento>/<sha256>.pdf`
-- ------------------------------------------------------------------
insert into storage.buckets(id, name, public) values ('sig-docs', 'sig-docs', false) on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf']
where id = 'sig-docs';

-- O administrador só envia para um RASCUNHO que já existe (o caminho vem do banco).
create function public.sig_can_upload_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and exists (select 1 from public.sig_documents d where d.storage_path = p_name and d.status = 'draft') $$;

-- Sócio lê o PDF só dos documentos que ele deve assinar (ou já assinou).
create function public.sig_can_read_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sig_documents d
    join public.sig_recipients r on r.document_id = d.id and r.profile_id = (select auth.uid())
    where d.storage_path = p_name and (d.status = 'published' or (d.status = 'archived' and r.signed_at is not null))) $$;

-- Arquivo de documento publicado nunca é apagado; o de rascunho ou órfão, sim.
create function public.sig_can_delete_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and not exists (select 1 from public.sig_documents d where d.storage_path = p_name and d.status <> 'draft') $$;

revoke all on function public.sig_can_upload_file(text), public.sig_can_read_file(text), public.sig_can_delete_file(text) from public, anon;
grant execute on function public.sig_can_upload_file(text), public.sig_can_read_file(text), public.sig_can_delete_file(text) to authenticated;

create policy sig_docs_admin_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'sig-docs' and public.sig_can_upload_file(name));
create policy sig_docs_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'sig-docs' and public.is_admin());
create policy sig_docs_member_read on storage.objects for select to authenticated
  using (bucket_id = 'sig-docs' and public.sig_can_read_file(name));
create policy sig_docs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sig-docs' and public.sig_can_delete_file(name));
