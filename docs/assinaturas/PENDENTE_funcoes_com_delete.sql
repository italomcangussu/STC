-- Documentos e Assinaturas — PENDENTE: 4 funções da migration 2 que contêm `delete from`.
--
-- Por que existe: o conector Supabase usado pelo assistente trava (sem erro do banco) em qualquer
-- SQL com `delete from`, então estas 4 funções não puderam ser aplicadas por ele. TODO o resto da
-- migration 2 (e as migrations 1 e 3) já está no banco. Rode ESTE arquivo inteiro uma vez, no
-- SQL Editor do Supabase (projeto smztsayzldjmkzmufqcz). Ele é o trecho literal de
-- supabase/migrations/20261007120100_signatures_admin.sql (nada foi alterado), mais as permissões
-- e o registro da migration 2 no final.
--
-- Funções: sig_set_recipients, sig_delete_draft, sig_publish, sig_remove_recipient.
-- Sem `sig_publish` nenhum documento pode ser publicado.

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


-- Permissões (mesmo laço da migration 2; refaz só o que falta, é idempotente).
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

-- Registro: agora a migration 2 está completa.
insert into supabase_migrations.schema_migrations(version, name)
values ('20261007120100', 'signatures_admin')
on conflict (version) do nothing;
