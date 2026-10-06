-- Financeiro do clube — comprovantes de pagamento (3/5).
--
-- O sócio envia imagem/PDF; a leitura automática (feita no aparelho) só SUGERE
-- valor/data/identificador/favorecido. Nada aqui marca cobrança como paga por
-- ter recebido ou lido um arquivo: a quitação só acontece em
-- `fin_approve_receipt`, ação do administrador, que cria os pagamentos.
--
-- Estados: submitted → in_review → approved | rejected; submitted/in_review/
-- rejected → superseded (o sócio reenviou). Aprovado é terminal.
-- Armazenamento: bucket PRIVADO `fin-receipts`, caminho `<uid>/<id>/<arquivo>`.

-- ------------------------------------------------------------------
-- 1. Storage (privado; acesso mínimo)
-- ------------------------------------------------------------------
insert into storage.buckets(id, name, public) values ('fin-receipts', 'fin-receipts', false) on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'fin-receipts';

-- Este wrapper público existe porque as policies de storage rodam com o papel
-- do usuário, que (de propósito) não enxerga o schema `fin_private`.
create function public.fin_is_active_member(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select fin_private.is_active_member(p_profile) $$;

-- O sócio grava só dentro da própria pasta e lê só o que é dele; o administrador lê tudo.
-- Sem UPDATE/DELETE: arquivo enviado não se troca nem se apaga (reenviar = novo envio).
create policy fin_receipts_member_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-receipts' and public.fin_is_active_member((select auth.uid()))
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$');
create policy fin_receipts_member_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fin_receipts_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-receipts' and public.is_admin());

-- ------------------------------------------------------------------
-- 2. Envio pelo sócio
-- ------------------------------------------------------------------
create function public.fin_submit_receipt(p_request_id uuid, p_submission_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_replay jsonb; v_path text := p_data->>'storage_path'; v_hash text := lower(p_data->>'content_sha256');
  v_charges uuid[]; v_dup uuid; v_old public.fin_receipt_submissions%rowtype; v_replaces uuid := (p_data->>'replaces')::uuid;
  v_declared bigint := (p_data->>'declared_amount_cents')::bigint; v_ocr jsonb := p_data->'ocr';
begin
  if v_uid is null then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
  if not fin_private.is_active_member(v_uid) then raise exception 'NOT_A_MEMBER'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'receipt_submit');
  if v_replay is not null then return v_replay; end if;
  -- O arquivo precisa estar na pasta do próprio sócio, na pasta deste envio.
  if v_path is null or v_path !~ ('^' || v_uid::text || '/' || p_submission_id::text || '/[^/]+$') then raise exception 'INVALID_ATTACHMENT'; end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_ATTACHMENT'; end if;
  if v_declared is not null and (v_declared <= 0 or v_declared > 1000000000) then raise exception 'INVALID_AMOUNT'; end if;
  if (p_data->>'declared_paid_on') is not null and (p_data->>'declared_paid_on')::date > fin_private.today() then raise exception 'INVALID_DATE'; end if;

  select coalesce(array_agg(x::uuid), '{}') into v_charges from jsonb_array_elements_text(coalesce(p_data->'charge_ids', '[]'::jsonb)) x;
  if cardinality(v_charges) = 0 then raise exception 'NO_CHARGES_SELECTED'; end if;
  -- Só cobranças do próprio sócio, ainda em aberto.
  if (select count(*) from public.fin_member_charges c where c.id = any(v_charges) and c.profile_id = v_uid and c.status in ('open', 'partial'))
     <> cardinality(v_charges) then raise exception 'INVALID_CHARGES'; end if;

  -- Possível duplicidade: mesmo arquivo (hash) já enviado e não substituído/rejeitado.
  -- Devolve só o aviso — nunca dados de outro sócio.
  select s.id into v_dup from public.fin_receipt_submissions s
  where s.content_sha256 = v_hash and s.status in ('submitted', 'in_review', 'approved') and s.id is distinct from v_replaces
  order by s.created_at limit 1;

  if v_replaces is not null then
    select * into v_old from public.fin_receipt_submissions where id = v_replaces for update;
    if not found or v_old.profile_id <> v_uid then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
    if v_old.status not in ('submitted', 'in_review', 'rejected') then raise exception 'RECEIPT_NOT_REPLACEABLE'; end if;
  end if;

  insert into public.fin_receipt_submissions(id, profile_id, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, duplicate_of, request_id)
  values (p_submission_id, v_uid, v_path, p_data->>'file_name', p_data->>'content_type', (p_data->>'size_bytes')::integer, v_hash,
    v_declared, (p_data->>'declared_paid_on')::date, nullif(left(trim(coalesce(p_data->>'declared_reference', '')), 120), ''),
    nullif(left(trim(coalesce(p_data->>'member_note', '')), 500), ''), coalesce(p_data->>'ocr_status', 'not_run'),
    case when v_ocr is null then null else v_ocr - 'raw_text' - 'text' end, v_dup is not null, v_dup, p_request_id);
  insert into public.fin_receipt_charges(submission_id, charge_id) select p_submission_id, unnest(v_charges);

  if v_replaces is not null then
    update public.fin_receipt_submissions set status = 'superseded', superseded_by = p_submission_id, version = version + 1, updated_at = now()
    where id = v_replaces;
  end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_submission_id, 'status', 'submitted', 'possible_duplicate', v_dup is not null));
end $$;

-- ------------------------------------------------------------------
-- 3. Revisão (administrador)
-- ------------------------------------------------------------------
create function public.fin_start_receipt_review(p_request_id uuid, p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_receipt_submissions%rowtype;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'receipt_review_start');
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_receipt_submissions where id = p_submission_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status = 'in_review' then return fin_private.finish_op(p_request_id, jsonb_build_object('id', s.id, 'status', 'in_review')); end if;
  if s.status <> 'submitted' then raise exception 'RECEIPT_NOT_PENDING'; end if;
  update public.fin_receipt_submissions set status = 'in_review', reviewed_by = v_actor, version = version + 1, updated_at = now()
  where id = p_submission_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', s.id, 'status', 'in_review'));
end $$;

-- Aprovar = o administrador confirma que o dinheiro entrou e distribui o valor
-- pelas cobranças (multa → juros → principal; sobra vira crédito). Dispensa de
-- encargos opcional, com justificativa, por cobrança (`waivers`).
-- p_data: { paid_on, method, account_id, allocations: [{charge_id, amount_cents}],
--           waivers: [{charge_id, amount_cents, reason}], note }
create function public.fin_approve_receipt(p_request_id uuid, p_submission_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_receipt_submissions%rowtype; a jsonb; w jsonb; v_res jsonb; v_ids uuid[] := '{}';
  v_paid_on date := (p_data->>'paid_on')::date; v_method text := coalesce(p_data->>'method', 'pix'); v_account uuid := (p_data->>'account_id')::uuid;
  v_total bigint := 0; v_i integer := 0; v_wres jsonb;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'receipt_approve', p_data->>'note');
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_receipt_submissions where id = p_submission_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status not in ('submitted', 'in_review') then raise exception 'RECEIPT_NOT_PENDING'; end if;
  if jsonb_typeof(p_data->'allocations') <> 'array' or jsonb_array_length(p_data->'allocations') = 0 then raise exception 'NO_CHARGES_SELECTED'; end if;

  -- Dispensas de encargo primeiro, para o pagamento já calcular com elas.
  for w in select * from jsonb_array_elements(coalesce(p_data->'waivers', '[]'::jsonb)) loop
    if not exists (select 1 from public.fin_member_charges c where c.id = (w->>'charge_id')::uuid and c.profile_id = s.profile_id) then
      raise exception 'INVALID_CHARGES';
    end if;
    perform fin_private.waive_fees((w->>'charge_id')::uuid, (w->>'amount_cents')::bigint, w->>'reason', v_paid_on, gen_random_uuid());
  end loop;

  for a in select * from jsonb_array_elements(p_data->'allocations') loop
    v_i := v_i + 1;
    -- Só cobranças do próprio sócio que enviou.
    if not exists (select 1 from public.fin_member_charges c where c.id = (a->>'charge_id')::uuid and c.profile_id = s.profile_id) then
      raise exception 'INVALID_CHARGES';
    end if;
    v_res := fin_private.apply_payment((a->>'charge_id')::uuid, (a->>'amount_cents')::bigint, v_paid_on, v_method, v_account,
      p_submission_id, null, 'Comprovante aprovado', gen_random_uuid());
    v_ids := v_ids || (v_res->>'payment_id')::uuid;
    v_total := v_total + (a->>'amount_cents')::bigint;
  end loop;

  update public.fin_receipt_submissions set status = 'approved', reviewed_by = v_actor, reviewed_at = now(),
    decision_reason = nullif(trim(p_data->>'note'), ''), approved_payment_ids = v_ids, version = version + 1, updated_at = now()
  where id = p_submission_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_submission_id, 'status', 'approved', 'payment_ids', to_jsonb(v_ids), 'total_cents', v_total));
end $$;

create function public.fin_reject_receipt(p_request_id uuid, p_submission_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_receipt_submissions%rowtype;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'receipt_reject', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_receipt_submissions where id = p_submission_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status not in ('submitted', 'in_review') then raise exception 'RECEIPT_NOT_PENDING'; end if;
  update public.fin_receipt_submissions set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(),
    decision_reason = trim(p_reason), version = version + 1, updated_at = now() where id = p_submission_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_submission_id, 'status', 'rejected'));
end $$;

-- Dispensa de encargos, chamada de dentro da aprovação (mesma regra de
-- `fin_adjust_charge`, sem nova idempotência pública). Auditada igual.
create function fin_private.waive_fees(p_charge uuid, p_amount bigint, p_reason text, p_as_of date, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare st record; v_id uuid; v_before jsonb;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  perform 1 from public.fin_member_charges where id = p_charge for update;
  select * into st from fin_private.charge_statement(p_charge, p_as_of);
  if p_amount > st.fees_due then raise exception 'WAIVER_EXCEEDS_FEES'; end if;
  v_before := fin_private.statement_json(p_charge, p_as_of);
  insert into public.fin_charge_adjustments(charge_id, kind, amount_cents, reason, before_data, actor_id, request_id)
  values (p_charge, 'fee_waiver', p_amount, trim(p_reason), v_before, auth.uid(), p_request) returning id into v_id;
  update public.fin_charge_adjustments set after_data = fin_private.statement_json(p_charge, p_as_of) where id = v_id;
end $$;

-- Fila de comprovantes para o administrador (com nome do sócio e quantas
-- cobranças cada um aponta).
create function public.fin_receipt_queue(p_status text default null, p_limit integer default 100, p_offset integer default 0)
returns table(id uuid, profile_id uuid, profile_name text, status text, file_name text, content_type text, size_bytes integer,
  declared_amount_cents bigint, declared_paid_on date, ocr_status text, ocr jsonb, possible_duplicate boolean,
  charge_count bigint, created_at timestamptz, reviewed_at timestamptz, decision_reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  return query
  select s.id, s.profile_id, p.name, s.status, s.file_name, s.content_type, s.size_bytes, s.declared_amount_cents, s.declared_paid_on,
    s.ocr_status, s.ocr, s.possible_duplicate, (select count(*) from public.fin_receipt_charges rc where rc.submission_id = s.id),
    s.created_at, s.reviewed_at, s.decision_reason, count(*) over()
  from public.fin_receipt_submissions s join public.profiles p on p.id = s.profile_id
  where (p_status is null or (p_status = 'pending' and s.status in ('submitted', 'in_review')) or s.status = p_status)
  order by case when s.status in ('submitted', 'in_review') then 0 else 1 end, s.created_at desc
  limit least(greatest(p_limit, 0), 500) offset greatest(p_offset, 0);
end $$;

-- ------------------------------------------------------------------
-- 4. Permissões
-- ------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
