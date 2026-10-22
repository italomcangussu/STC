-- Comprovante de sócio comum vai ao responsável pelo financeiro (hoje o Henrique), que decide na conversa com o João.
-- Regra do clube (21/10): o João NÃO deduz a finalidade pelo comprovante (nem pelo nome, nem pelo valor) e quem não é
-- administrador não gera pagamento. O João pergunta a que se refere, e com a resposta repassa ao financeiro: texto com
-- quem mandou, valor, data, favorecido e o que a pessoa disse, mais a própria imagem. Na conversa do financeiro o
-- comprovante fica disponível por 7 dias para cadastrar aluno, renovar Card, lançar despesa/receita, cadastrar sócio
-- ou dar baixa: a palavra do administrador basta, sem conferir no app.
-- Mensalidade ou pendência do próprio sócio: o repasse já cria a submissão do sócio, e "pode dar baixa" usa a
-- aprovação de comprovante que existe (fin_receipt_approve).

-- 1) quem responde pelo financeiro
alter table public.fin_settings add column if not exists finance_admin_profile_id uuid references public.profiles(id);
comment on column public.fin_settings.finance_admin_profile_id is 'Administrador que recebe do João os comprovantes de sócios para decidir.';
update public.fin_settings s set finance_admin_profile_id = h.id
from (select p.id from public.profiles p where p.role::text = 'admin' and coalesce(p.is_active, true)
      and fin_private.fold_text(p.name) like 'henrique%' order by p.created_at limit 1) h
where s.id and s.finance_admin_profile_id is null;

-- 2) intenção repassada
alter table fin_private.whatsapp_receipt_intents drop constraint whatsapp_receipt_intents_status_check;
alter table fin_private.whatsapp_receipt_intents add constraint whatsapp_receipt_intents_status_check
  check (status in ('awaiting_purpose', 'awaiting_confirmation', 'escalated', 'confirmed', 'needs_review', 'canceled'));
alter table fin_private.whatsapp_receipt_intents add column if not exists escalated_to uuid references public.profiles(id);
alter table fin_private.whatsapp_receipt_intents add column if not exists escalated_at timestamptz;
create index if not exists whatsapp_receipt_intents_escalated_idx on fin_private.whatsapp_receipt_intents(escalated_to, escalated_at)
  where status = 'escalated';

-- 3) repasse (chamado pelo turno do sócio depois que ele diz a finalidade)
create or replace function public.conv_svc_receipt_escalate(p_stage uuid, p_message uuid, p_kind text, p_detail text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; src public.conv_messages%rowtype;
  v_admin uuid; v_admin_name text; v_contact uuid; v_conv uuid; v_sender text; v_sub uuid; v_hash text;
  v_kind text := case when p_kind in ('donation', 'membership', 'member_pendency', 'student_card', 'day_card', 'other') then p_kind else 'other' end;
  v_detail text := left(nullif(trim(coalesce(p_detail, '')), ''), 300);
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_stage for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if s.status = 'escalated' then return jsonb_build_object('ok', false, 'code', 'ALREADY_ESCALATED'); end if;
  if s.status not in ('awaiting_purpose', 'awaiting_confirmation') then return jsonb_build_object('ok', false, 'code', 'NOT_PENDING'); end if;
  select * into fs from public.fin_settings where id;
  select p.id, p.name into v_admin, v_admin_name from public.profiles p
   where p.id = fs.finance_admin_profile_id and p.role::text = 'admin' and coalesce(p.is_active, true);
  if v_admin is null then return jsonb_build_object('ok', false, 'code', 'NO_FINANCE_ADMIN'); end if;
  select c.id into v_contact from public.conv_contacts c where c.profile_id = v_admin and not coalesce(c.opt_out, false)
   order by c.updated_at desc nulls last limit 1;
  if v_contact is null then return jsonb_build_object('ok', false, 'code', 'FINANCE_ADMIN_NO_WHATSAPP'); end if;
  v_conv := conv_private.open_direct(v_contact);
  select * into src from public.conv_messages where id = s.source_message_id;
  select coalesce(pr.name, c.name, 'Um contato') into v_sender from public.conv_contacts c left join public.profiles pr on pr.id = c.profile_id
   where c.id = s.contact_id;
  d := s.original_data;

  -- Mensalidade/pendência do próprio sócio: vira submissão dele, pronta para "pode dar baixa".
  if v_kind in ('membership', 'member_pendency') and s.profile_id is not null then
    v_hash := lower(coalesce(d->>'content_sha256', ''));
    if not exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved')) then
      insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
        declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, request_id, source, source_message_id)
      values (s.id, s.profile_id, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
        nullif(d->>'declared_amount_cents', '')::bigint, nullif(d->>'declared_paid_on', '')::date, d->>'declared_reference',
        left('Repassado ao financeiro pelo João: ' || coalesce(v_detail, ''), 500), coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, s.id, 'whatsapp', s.source_message_id)
      returning id into v_sub;
    end if;
  end if;

  update fin_private.whatsapp_receipt_intents set status = 'escalated', purpose_kind = v_kind, purpose_detail = v_detail,
    purpose_message_id = p_message, escalated_to = v_admin, escalated_at = now(), finance_submission_id = v_sub, updated_at = now()
  where id = s.id;

  return jsonb_build_object('ok', true, 'admin_conversation_id', v_conv, 'admin_name', split_part(v_admin_name, ' ', 1),
    'sender_name', v_sender, 'kind', v_kind, 'detail', v_detail, 'submission_id', v_sub,
    'amount_cents', nullif(d->>'declared_amount_cents', '')::bigint, 'paid_on', nullif(d->>'declared_paid_on', '')::date,
    'payee', nullif(trim(coalesce(d->'ocr'->>'payee', '')), ''),
    'media_path', src.media_path, 'media_mime', src.media_mime, 'media_name', coalesce(src.media_name, d->>'file_name'), 'media_kind', src.kind);
end $$;
revoke all on function public.conv_svc_receipt_escalate(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conv_svc_receipt_escalate(uuid, uuid, text, text) to service_role;

-- 4) o que o administrador pode usar: os que ele mandou (6 h) e os repassados a ele (7 dias)
create or replace function conv_private.admin_usable_receipts(p_conversation uuid, p_admin uuid)
returns setof fin_private.whatsapp_receipt_intents
language sql stable security definer set search_path = '' as $$
  select i.* from fin_private.whatsapp_receipt_intents i
  where i.finance_entry_id is null and i.finance_submission_id is null
    and ((i.conversation_id = p_conversation and i.profile_id = p_admin and i.created_at > now() - interval '6 hours'
          and i.status in ('awaiting_purpose', 'awaiting_confirmation'))
      or (i.escalated_to = p_admin and i.status = 'escalated' and i.escalated_at > now() - interval '7 days'))
$$;

create or replace function conv_private.admin_entry_receipt(p_conversation uuid, p_admin uuid, p_amount bigint)
returns table(id uuid, file_name text)
language sql stable security definer set search_path = '' as $$
  select i.id, coalesce(nullif(i.original_data->>'file_name', ''), 'comprovante')
  from conv_private.admin_usable_receipts(p_conversation, p_admin) i
  where nullif(i.original_data->>'declared_amount_cents', '')::bigint = p_amount and conv_private.receipt_used_cents(i.id) = 0
  order by coalesce(i.escalated_at, i.created_at) desc, i.id desc limit 1
$$;

create or replace function conv_private.admin_pending_receipt(p_conversation uuid, p_admin uuid)
returns table(id uuid, declared_amount_cents bigint, declared_paid_on date, ocr jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.id, x.amount, x.paid_on, x.ocr, x.at from (
    select r.id, r.declared_amount_cents amount, r.declared_paid_on paid_on, r.ocr, r.created_at at
    from public.fin_receipt_submissions r join public.conv_messages m on m.id = r.source_message_id
    where m.conversation_id = p_conversation and r.profile_id = p_admin and r.status in ('submitted', 'in_review')
      and r.created_at > now() - interval '6 hours'
    union all
    select i.id, nullif(i.original_data->>'declared_amount_cents', '')::bigint, nullif(i.original_data->>'declared_paid_on', '')::date,
      i.original_data->'ocr', coalesce(i.escalated_at, i.created_at)
    from conv_private.admin_usable_receipts(p_conversation, p_admin) i
    where conv_private.receipt_used_cents(i.id) = 0
  ) x order by x.at desc, x.id desc limit 1
$$;

-- a intenção repassada também pode virar submissão (sócio novo) e anexo (despesa/receita) e fecha quando usada
create or replace function conv_private.admin_receipt_materialize(p_receipt uuid, p_admin uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype; d jsonb; v_hash text;
begin
  if exists (select 1 from public.fin_receipt_submissions where id = p_receipt) then return p_receipt; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_receipt and (profile_id = p_admin or escalated_to = p_admin) for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status not in ('awaiting_purpose', 'awaiting_confirmation', 'escalated') then raise exception 'RECEIPT_NOT_PENDING'; end if;
  d := s.original_data;
  v_hash := lower(coalesce(d->>'content_sha256', ''));
  if exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved')) then
    raise exception 'RECEIPT_DUPLICATE';
  end if;
  insert into public.fin_receipt_submissions(
    id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr,
    possible_duplicate, request_id, source, source_message_id
  ) values (
    s.id, p_admin, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
    nullif(d->>'declared_amount_cents', '')::bigint, nullif(d->>'declared_paid_on', '')::date, d->>'declared_reference',
    'Mensalidade de sócio novo, enviada pelo WhatsApp', coalesce(d->>'ocr_status', 'not_run'), d->'ocr',
    false, s.id, 'whatsapp', s.source_message_id
  );
  update fin_private.whatsapp_receipt_intents set status = 'confirmed', purpose_kind = 'membership',
    purpose_detail = coalesce(purpose_detail, 'Mensalidade de sócio novo'), finance_submission_id = s.id, updated_at = now()
  where id = s.id;
  return s.id;
end $$;

create or replace function conv_private.close_receipt_if_used(p_intent uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update fin_private.whatsapp_receipt_intents i
     set status = 'confirmed', purpose_kind = 'student_card', purpose_detail = coalesce(i.purpose_detail, 'Card Mensal de aluno'), updated_at = now()
   where i.id = p_intent and i.status in ('awaiting_purpose', 'awaiting_confirmation', 'escalated')
     and conv_private.receipt_used_cents(i.id) >= nullif(i.original_data->>'declared_amount_cents', '')::bigint;
end $$;

create or replace function conv_private.attach_receipt_to_entry(p_receipt uuid, p_entry uuid, p_admin uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype; d jsonb; e public.fin_entries%rowtype;
begin
  select * into s from fin_private.whatsapp_receipt_intents where id = p_receipt and (profile_id = p_admin or escalated_to = p_admin) for update;
  select * into e from public.fin_entries where id = p_entry;
  if s.id is null or e.id is null or s.finance_entry_id is not null or s.status not in ('awaiting_purpose', 'awaiting_confirmation', 'escalated') then
    return false;
  end if;
  d := s.original_data;
  insert into public.fin_attachments(entry_id, storage_path, bucket, file_name, content_type, size_bytes, uploaded_by)
  values (e.id, d->>'storage_path', 'fin-receipts', left(coalesce(nullif(d->>'file_name', ''), 'comprovante'), 200),
    d->>'content_type', (d->>'size_bytes')::integer, p_admin)
  on conflict (storage_path) do nothing;
  update fin_private.whatsapp_receipt_intents
     set status = 'confirmed', purpose_kind = coalesce(purpose_kind, 'other'), purpose_detail = coalesce(purpose_detail, left(e.description, 200)),
         finance_entry_id = e.id, updated_at = now()
   where id = s.id;
  return true;
end $$;
