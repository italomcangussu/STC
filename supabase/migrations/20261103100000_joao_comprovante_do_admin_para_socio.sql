-- Admin manda no privado o comprovante de um sócio ("mensalidade do Gianmarco, pode dar baixa").
-- Antes: fin_receipt_approve só achava comprovante enviado pelo próprio sócio e respondia RECEIPT_NOT_FOUND.
-- Agora: sem comprovante pendente do sócio, o comprovante que o admin acabou de mandar vira o comprovante
-- do sócio (com origem no WhatsApp do admin) e a proposta de aprovação segue o caminho de sempre.

create or replace function conv_private.admin_receipt_to_member(p_session uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_conversation uuid; v_profile uuid; i fin_private.whatsapp_receipt_intents%rowtype; d jsonb; v_hash text;
begin
  if coalesce(p->>'action', '') <> 'fin_receipt_approve' then return; end if;
  v_profile := nullif(p->>'profile_id', '')::uuid;
  if v_profile is null or not exists (select 1 from public.profiles where id = v_profile and role::text = 'socio') then return; end if;
  if exists (select 1 from public.fin_receipt_submissions r where r.profile_id = v_profile and r.status in ('submitted', 'in_review')) then return; end if;

  v_admin := conv_private.ai_admin_requester(p_session);
  select conversation_id into v_conversation from public.conv_ai_sessions where id = p_session and status = 'open';
  if v_admin is null or v_conversation is null then return; end if;

  -- O comprovante mais recente do admin nesta conversa que ainda não serviu para nada.
  select u.* into i from conv_private.admin_usable_receipts(v_conversation, v_admin) u
  where u.conversation_id = v_conversation and u.status in ('awaiting_purpose', 'awaiting_confirmation')
    and conv_private.receipt_used_cents(u.id) = 0
  order by u.created_at desc limit 1;
  if i.id is null then return; end if;
  select * into i from fin_private.whatsapp_receipt_intents where id = i.id for update;

  d := i.original_data;
  v_hash := lower(coalesce(d->>'content_sha256', ''));
  if v_hash !~ '^[0-9a-f]{64}$'
     or exists (select 1 from public.fin_receipt_submissions r where r.content_sha256 = v_hash and r.status in ('submitted', 'in_review', 'approved'))
     or exists (select 1 from public.fin_receipt_submissions r where r.id = i.id) then
    return;
  end if;

  insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, request_id, source, source_message_id)
  values (i.id, v_profile, 'submitted', d->>'storage_path', d->>'file_name', d->>'content_type', (d->>'size_bytes')::integer, v_hash,
    nullif(d->>'declared_amount_cents', '')::bigint,
    least(coalesce(nullif(d->>'declared_paid_on', '')::date, conv_private.today()), conv_private.today()),
    d->>'declared_reference', 'Comprovante enviado pelo administrador no WhatsApp',
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, i.id, 'whatsapp', i.source_message_id);

  update fin_private.whatsapp_receipt_intents
     set status = 'confirmed', purpose_kind = 'membership', purpose_detail = 'Comprovante de sócio enviado pelo administrador',
         finance_submission_id = i.id, updated_at = now()
   where id = i.id;
  -- O mesmo arquivo reenviado na conversa não fica pendurado pedindo finalidade.
  update fin_private.whatsapp_receipt_intents o
     set status = 'canceled', updated_at = now()
   where o.conversation_id = v_conversation and o.id <> i.id and o.status in ('awaiting_purpose', 'awaiting_confirmation')
     and lower(coalesce(o.original_data->>'content_sha256', '')) = v_hash;
end $$;

revoke all on function conv_private.admin_receipt_to_member(uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.conv_svc_ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform conv_private.admin_receipt_to_member(p_session, p);
  return conv_private.ai_admin_finance_propose(p_session, p);
exception when invalid_text_representation then
  return conv_private.ai_admin_finance_propose(p_session, p);
end $$;

revoke all on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_finance_propose(uuid, jsonb) to service_role;
