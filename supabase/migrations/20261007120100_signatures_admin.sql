-- Documentos e Assinaturas — funções do administrador (2/3).
--
-- Ciclo do documento: rascunho → publicado → arquivado.
--   1. `sig_create_draft` registra título, prazo e metadados do PDF (o hash é
--      calculado no aparelho do admin) e devolve o caminho onde o arquivo deve
--      ser enviado ao bucket `sig-docs`;
--   2. `sig_set_recipients` (modo 'selected') escolhe os sócios;
--   3. `sig_publish` confere que o arquivo subiu, materializa os destinatários
--      e ENFILEIRA o aviso de WhatsApp (link + passo a passo) para cada um;
--   4. depois de publicado, o documento é imutável: corrigir = nova versão
--      (`replaces_id`), que arquiva a anterior ao ser publicada.
--
-- O envio em si (UazAPI) é feito pela edge function (fase 2) lendo a fila
-- `sig_notifications` pelas funções `sig_svc_*` (migration 3).
-- Erros de regra são códigos `SIG_*` (mensagem da exceção).

-- ------------------------------------------------------------------
-- 1. Auxiliares
-- ------------------------------------------------------------------
create function sig_private.set_action(p text) returns void
language sql set search_path = '' as $$ select set_config('sig.action', p, true) $$;

-- Linha de resumo na trilha de auditoria (operações em lote, que o gatilho de linha não resume).
create function sig_private.audit(p_action text, p_document uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_audit_insert_log('sig.' || p_action, 'sig_documents', p_document::text, null, '{}'::uuid[],
    null, null, p_data, '{}'::jsonb, 'signatures', now());
end $$;

-- Enfileira um aviso. Sem telefone no cadastro, nasce `skipped` (o admin vê quem ficou sem aviso).
-- Idempotente: a mesma (documento, sócio, tipo, slot) nunca entra duas vezes.
create function sig_private.enqueue_notification(p_doc uuid, p_profile uuid, p_kind text,
  p_slot text default '', p_not_before timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare v_has_phone boolean;
begin
  select nullif(btrim(phone), '') is not null into v_has_phone from public.profiles where id = p_profile;
  insert into public.sig_notifications(document_id, profile_id, kind, slot, status, skip_reason, not_before)
  values (p_doc, p_profile, p_kind, p_slot,
    case when coalesce(v_has_phone, false) then 'queued' else 'skipped' end,
    case when coalesce(v_has_phone, false) then null else 'no_phone' end, p_not_before)
  on conflict (document_id, profile_id, kind, slot) do nothing;
  if not found then return 'exists'; end if;
  return case when coalesce(v_has_phone, false) then 'queued' else 'skipped' end;
end $$;

create function sig_private.get_document(p_id uuid, p_lock boolean default true) returns public.sig_documents
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype;
begin
  if p_lock then select * into d from public.sig_documents where id = p_id for update;
  else select * into d from public.sig_documents where id = p_id; end if;
  if not found then raise exception 'SIG_NOT_FOUND'; end if;
  return d;
end $$;

-- ------------------------------------------------------------------
-- 2. Rascunho
-- ------------------------------------------------------------------
-- p: title, description?, file_name, size_bytes, page_count, content_sha256, due_at?,
--    audience_mode? ('all'|'selected'), applies_to_new_members?, replaces_id?
create function public.sig_create_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := sig_private.require_admin(); v_id uuid := gen_random_uuid();
  v_sha text := lower(p->>'content_sha256'); v_version integer := 1;
  v_replaces uuid := nullif(p->>'replaces_id', '')::uuid; v_mode text := coalesce(p->>'audience_mode', 'all');
begin
  if v_replaces is not null then
    select version + 1 into v_version from public.sig_documents where id = v_replaces and status in ('published', 'archived');
    if not found then raise exception 'SIG_REPLACES_INVALID'; end if;
  end if;
  perform sig_private.set_action('create_draft');
  insert into public.sig_documents(id, title, description, file_name, storage_path, size_bytes, page_count,
    content_sha256, version, replaces_id, audience_mode, applies_to_new_members, due_at, created_by)
  values (v_id, btrim(p->>'title'), nullif(btrim(p->>'description'), ''), p->>'file_name',
    v_id::text || '/' || v_sha || '.pdf', (p->>'size_bytes')::bigint, (p->>'page_count')::integer,
    v_sha, v_version, v_replaces, v_mode,
    v_mode = 'all' and coalesce((p->>'applies_to_new_members')::boolean, false),
    nullif(p->>'due_at', '')::timestamptz, v_actor);
  return jsonb_build_object('id', v_id, 'storage_path', v_id::text || '/' || v_sha || '.pdf', 'version', v_version);
end $$;

-- Só rascunho. Trocar o PDF (novo `content_sha256`) muda o caminho: o arquivo antigo fica órfão e pode ser apagado.
create function public.sig_update_draft(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.sig_documents%rowtype; v_new_file boolean := p ? 'content_sha256';
  v_sha text; v_mode text; v_old_path text;
begin
  perform sig_private.require_admin();
  d := sig_private.get_document(p_id);
  if d.status <> 'draft' then raise exception 'SIG_DOCUMENT_IMMUTABLE'; end if;
  v_old_path := d.storage_path;
  v_mode := coalesce(p->>'audience_mode', d.audience_mode);
  v_sha := case when v_new_file then lower(p->>'content_sha256') else d.content_sha256 end;
  if v_new_file and (p->>'file_name' is null or p->>'size_bytes' is null or p->>'page_count' is null) then
    raise exception 'SIG_FILE_DATA_REQUIRED';
  end if;
  perform sig_private.set_action('update_draft');
  update public.sig_documents x set
    title = coalesce(nullif(btrim(p->>'title'), ''), x.title),
    description = case when p ? 'description' then nullif(btrim(p->>'description'), '') else x.description end,
    due_at = case when p ? 'due_at' then nullif(p->>'due_at', '')::timestamptz else x.due_at end,
    audience_mode = v_mode,
    applies_to_new_members = v_mode = 'all' and coalesce((p->>'applies_to_new_members')::boolean, x.applies_to_new_members),
    file_name = case when v_new_file then p->>'file_name' else x.file_name end,
    size_bytes = case when v_new_file then (p->>'size_bytes')::bigint else x.size_bytes end,
    page_count = case when v_new_file then (p->>'page_count')::integer else x.page_count end,
    content_sha256 = v_sha,
    storage_path = x.id::text || '/' || v_sha || '.pdf'
  where x.id = p_id;
  return jsonb_build_object('id', p_id, 'storage_path', p_id::text || '/' || v_sha || '.pdf',
    'previous_storage_path', case when v_old_path <> p_id::text || '/' || v_sha || '.pdf' then v_old_path end);
end $$;

-- Modo 'selected': substitui a lista de destinatários do rascunho. Só sócios ativos.
create function public.sig_set_recipients(p_id uuid, p_profiles uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype; v_actor uuid := sig_private.require_admin(); v_ids uuid[]; v_valid integer; v_n integer;
begin
  d := sig_private.get_document(p_id);
  if d.status <> 'draft' then raise exception 'SIG_DOCUMENT_IMMUTABLE'; end if;
  if d.audience_mode <> 'selected' then raise exception 'SIG_NOT_SELECTED_MODE'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_profiles, '{}')) x;
  select count(*) into v_valid from public.profiles p
    where p.id = any (v_ids) and p.role::text in ('socio', 'admin') and coalesce(p.is_active, true);
  if v_valid <> coalesce(array_length(v_ids, 1), 0) then raise exception 'SIG_RECIPIENT_INVALID'; end if;
  delete from public.sig_recipients where document_id = p_id;
  insert into public.sig_recipients(document_id, profile_id, source, added_by)
    select p_id, x, 'selected', v_actor from unnest(v_ids) x;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Apaga o rascunho. Devolve o caminho do arquivo para o app removê-lo do bucket.
create function public.sig_delete_draft(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype;
begin
  perform sig_private.require_admin();
  d := sig_private.get_document(p_id);
  if d.status <> 'draft' then raise exception 'SIG_DOCUMENT_IMMUTABLE'; end if;
  perform sig_private.set_action('delete_draft');
  delete from public.sig_documents where id = p_id;
  return d.storage_path;
end $$;

-- ------------------------------------------------------------------
-- 3. Publicação (dispara o aviso de WhatsApp a cada destinatário)
-- ------------------------------------------------------------------
create function public.sig_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := sig_private.require_admin(); d public.sig_documents%rowtype;
  v_total integer; v_queued integer; v_skipped integer;
begin
  d := sig_private.get_document(p_id);
  if d.status <> 'draft' then raise exception 'SIG_ALREADY_PUBLISHED'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'sig-docs' and o.name = d.storage_path) then
    raise exception 'SIG_FILE_MISSING';
  end if;
  if d.due_at is not null and d.due_at <= now() then raise exception 'SIG_DUE_IN_PAST'; end if;

  perform sig_private.set_action('publish');
  if d.audience_mode = 'all' then
    delete from public.sig_recipients where document_id = d.id;
    insert into public.sig_recipients(document_id, profile_id, source, added_by)
      select d.id, p.id, 'all', v_actor from public.profiles p
      where p.role::text in ('socio', 'admin') and coalesce(p.is_active, true);
  end if;
  select count(*) into v_total from public.sig_recipients where document_id = d.id;
  if v_total = 0 then raise exception 'SIG_NO_RECIPIENTS'; end if;

  update public.sig_documents set status = 'published', published_at = now(), published_by = v_actor where id = d.id;

  -- Nova versão: a anterior sai de circulação (as assinaturas dela continuam valendo).
  if d.replaces_id is not null then
    perform sig_private.set_action('archive_replaced');
    update public.sig_documents set status = 'archived', archived_at = now(), archived_by = v_actor,
      archived_reason = 'replaced' where id = d.replaces_id and status = 'published';
    update public.sig_notifications set status = 'skipped', skip_reason = 'replaced'
      where document_id = d.replaces_id and status = 'queued';
  end if;

  insert into public.sig_notifications(document_id, profile_id, kind, slot, status, skip_reason)
    select r.document_id, r.profile_id, 'publish', '',
      case when nullif(btrim(p.phone), '') is null then 'skipped' else 'queued' end,
      case when nullif(btrim(p.phone), '') is null then 'no_phone' end
    from public.sig_recipients r join public.profiles p on p.id = r.profile_id
    where r.document_id = d.id
    on conflict (document_id, profile_id, kind, slot) do nothing;

  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'skipped')
    into v_queued, v_skipped from public.sig_notifications where document_id = d.id and kind = 'publish';
  perform sig_private.audit('publish_summary', d.id,
    jsonb_build_object('recipients', v_total, 'queued', v_queued, 'skipped_no_phone', v_skipped));
  return jsonb_build_object('id', d.id, 'recipients', v_total, 'queued', v_queued, 'skipped_no_phone', v_skipped);
end $$;

-- ------------------------------------------------------------------
-- 4. Depois de publicado
-- ------------------------------------------------------------------
-- Inclui mais sócios (ex.: quem estava inativo). Cada novo destinatário recebe o aviso de publicação.
create function public.sig_add_recipients(p_id uuid, p_profiles uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := sig_private.require_admin(); d public.sig_documents%rowtype; v_ids uuid[]; v_valid integer;
  v_new uuid[]; v_one uuid; v_queued integer := 0; v_skipped integer := 0; v_res text;
begin
  d := sig_private.get_document(p_id);
  if d.status <> 'published' then raise exception 'SIG_NOT_PUBLISHED'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_profiles, '{}')) x;
  select count(*) into v_valid from public.profiles p
    where p.id = any (v_ids) and p.role::text in ('socio', 'admin') and coalesce(p.is_active, true);
  if v_valid <> coalesce(array_length(v_ids, 1), 0) then raise exception 'SIG_RECIPIENT_INVALID'; end if;
  with ins as (
    insert into public.sig_recipients(document_id, profile_id, source, added_by)
      select p_id, x, 'selected', v_actor from unnest(v_ids) x
      on conflict do nothing returning profile_id)
  select coalesce(array_agg(profile_id), '{}') into v_new from ins;
  foreach v_one in array v_new loop
    v_res := sig_private.enqueue_notification(p_id, v_one, 'publish');
    if v_res = 'queued' then v_queued := v_queued + 1; elsif v_res = 'skipped' then v_skipped := v_skipped + 1; end if;
  end loop;
  perform sig_private.audit('add_recipients', p_id, jsonb_build_object('added', coalesce(array_length(v_new, 1), 0)));
  return jsonb_build_object('added', coalesce(array_length(v_new, 1), 0), 'queued', v_queued, 'skipped_no_phone', v_skipped);
end $$;

-- Tira um destinatário que ainda NÃO assinou. Quem já assinou fica (a prova não se apaga).
create function public.sig_remove_recipient(p_id uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.sig_recipients%rowtype;
begin
  perform sig_private.require_admin();
  perform sig_private.get_document(p_id);
  select * into r from public.sig_recipients where document_id = p_id and profile_id = p_profile for update;
  if not found then raise exception 'SIG_NOT_FOUND'; end if;
  if r.signed_at is not null then raise exception 'SIG_ALREADY_SIGNED'; end if;
  delete from public.sig_recipients where document_id = p_id and profile_id = p_profile;
  update public.sig_notifications set status = 'skipped', skip_reason = 'removed'
    where document_id = p_id and profile_id = p_profile and status = 'queued';
  perform sig_private.audit('remove_recipient', p_id, jsonb_build_object('profile_id', p_profile));
end $$;

-- Muda (ou remove, com null) o prazo. Os lembretes passam a seguir o novo prazo.
create function public.sig_update_due(p_id uuid, p_due timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype;
begin
  perform sig_private.require_admin();
  d := sig_private.get_document(p_id);
  if d.status <> 'published' then raise exception 'SIG_NOT_PUBLISHED'; end if;
  if p_due is not null and p_due <= now() then raise exception 'SIG_DUE_IN_PAST'; end if;
  perform sig_private.set_action('update_due');
  update public.sig_documents set due_at = p_due where id = p_id;
end $$;

-- Vale (ou não) para quem virar sócio depois. Só no modo 'all'.
create function public.sig_set_new_members(p_id uuid, p_value boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype;
begin
  perform sig_private.require_admin();
  d := sig_private.get_document(p_id);
  if d.status not in ('draft', 'published') then raise exception 'SIG_DOCUMENT_ARCHIVED'; end if;
  if p_value and d.audience_mode <> 'all' then raise exception 'SIG_NEW_MEMBERS_NEEDS_ALL'; end if;
  perform sig_private.set_action('set_new_members');
  update public.sig_documents set applies_to_new_members = coalesce(p_value, false) where id = p_id;
end $$;

create function public.sig_archive(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := sig_private.require_admin(); d public.sig_documents%rowtype;
begin
  d := sig_private.get_document(p_id);
  if d.status <> 'published' then raise exception 'SIG_NOT_PUBLISHED'; end if;
  perform sig_private.set_action('archive');
  update public.sig_documents set status = 'archived', archived_at = now(), archived_by = v_actor,
    archived_reason = coalesce(nullif(btrim(p_reason), ''), 'manual') where id = p_id;
  update public.sig_notifications set status = 'skipped', skip_reason = 'archived'
    where document_id = p_id and status = 'queued';
end $$;

-- "Reenviar falhas": volta para a fila só o que falhou. Quem já recebeu não recebe de novo.
create function public.sig_resend_failed(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.sig_documents%rowtype; v_n integer;
begin
  perform sig_private.require_admin();
  d := sig_private.get_document(p_id);
  if d.status <> 'published' then raise exception 'SIG_NOT_PUBLISHED'; end if;
  update public.sig_notifications n set status = 'queued', attempts = 0, error = null, not_before = now(), claimed_at = null
    where n.document_id = p_id and n.status = 'failed'
      and exists (select 1 from public.sig_recipients r where r.document_id = n.document_id and r.profile_id = n.profile_id and r.signed_at is null);
  get diagnostics v_n = row_count;
  perform sig_private.audit('resend_failed', p_id, jsonb_build_object('requeued', v_n));
  return v_n;
end $$;

-- ------------------------------------------------------------------
-- 5. Acompanhamento do admin
-- ------------------------------------------------------------------
create view public.sig_documents_overview with (security_invoker = true) as
select d.id, d.title, d.version, d.status, d.audience_mode, d.applies_to_new_members, d.page_count,
  d.due_at, d.created_at, d.published_at,
  (select count(*) from public.sig_recipients r where r.document_id = d.id) as recipients,
  (select count(*) from public.sig_recipients r where r.document_id = d.id and r.signed_at is not null) as signed,
  (select count(*) from public.sig_notifications n where n.document_id = d.id and n.status in ('queued', 'sending')) as notifications_pending,
  (select count(*) from public.sig_notifications n where n.document_id = d.id and n.status = 'failed') as notifications_failed,
  (select count(*) from public.sig_notifications n where n.document_id = d.id and n.status = 'skipped' and n.skip_reason = 'no_phone') as no_phone
from public.sig_documents d;
revoke all on public.sig_documents_overview from public, anon, authenticated;
grant select on public.sig_documents_overview to authenticated;

-- Quem assinou, quem falta e como foi o aviso de cada um.
create function public.sig_admin_recipients(p_id uuid)
returns table(profile_id uuid, name text, phone text, source text, signed_at timestamptz, signature_id uuid,
  notification_status text, notification_error text, last_notified_at timestamptz, reminders_sent integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform sig_private.require_admin();
  return query
  select r.profile_id, p.name, p.phone, r.source, r.signed_at, r.signature_id,
    (select n.status from public.sig_notifications n where n.document_id = r.document_id and n.profile_id = r.profile_id
       and n.kind in ('publish', 'new_member') order by n.created_at desc limit 1),
    (select n.error from public.sig_notifications n where n.document_id = r.document_id and n.profile_id = r.profile_id
       and n.status = 'failed' order by n.created_at desc limit 1),
    (select max(n.sent_at) from public.sig_notifications n where n.document_id = r.document_id and n.profile_id = r.profile_id
       and n.status = 'sent'),
    (select count(*)::integer from public.sig_notifications n where n.document_id = r.document_id and n.profile_id = r.profile_id
       and n.kind = 'reminder' and n.status = 'sent')
  from public.sig_recipients r join public.profiles p on p.id = r.profile_id
  where r.document_id = p_id
  order by (r.signed_at is not null), p.name;
end $$;

-- Recalcula hash de evidência e cadeia de todas as assinaturas do documento.
-- Qualquer linha alterada, apagada ou reordenada aparece em `problems`.
create function public.sig_verify_integrity(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sig_signatures%rowtype; v_prev text; v_expected_seq integer := 1; v_checked integer := 0;
  v_problems jsonb := '[]'::jsonb;
begin
  perform sig_private.require_admin();
  for s in select * from public.sig_signatures where document_id = p_id order by seq loop
    v_checked := v_checked + 1;
    if s.seq <> v_expected_seq then
      v_problems := v_problems || jsonb_build_object('seq', s.seq, 'problem', 'sequence_gap');
      v_expected_seq := s.seq;
    end if;
    if s.evidence_hash <> sig_private.sha256_hex(sig_private.signature_evidence(s)::text) then
      v_problems := v_problems || jsonb_build_object('seq', s.seq, 'problem', 'evidence_changed');
    end if;
    if s.prev_chain_hash is distinct from v_prev then
      v_problems := v_problems || jsonb_build_object('seq', s.seq, 'problem', 'chain_broken');
    end if;
    if s.chain_hash <> sig_private.sha256_hex(coalesce(s.prev_chain_hash, '') || s.evidence_hash) then
      v_problems := v_problems || jsonb_build_object('seq', s.seq, 'problem', 'chain_hash_changed');
    end if;
    v_prev := s.chain_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;
  return jsonb_build_object('checked', v_checked, 'ok', jsonb_array_length(v_problems) = 0, 'problems', v_problems);
end $$;

-- ------------------------------------------------------------------
-- 6. Permissões: só `authenticated` chama (cada função confere o papel dentro dela)
-- ------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sig_create_draft', 'sig_update_draft', 'sig_set_recipients',
      'sig_delete_draft', 'sig_publish', 'sig_add_recipients', 'sig_remove_recipient', 'sig_update_due',
      'sig_set_new_members', 'sig_archive', 'sig_resend_failed', 'sig_admin_recipients', 'sig_verify_integrity')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
