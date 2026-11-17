-- Caso Henrique (12/11): o João repassou a ele o comprovante de R$ 7,50 que o Ronaldo mandou ("3 águas no Kaleno").
-- O Henrique respondeu "desconsidere esse comprovante, não tem ligação com o clube" e o João disse "Não achei
-- comprovante pendente desse sócio": a recusa só enxergava fin_receipt_submissions, e o comprovante repassado ficou
-- "escalated" para sempre na fila do financeiro.
-- Agora a recusa faz o mesmo que a aprovação (20261109150000): sem submissão pendente do sócio, o comprovante que ele
-- mandou no WhatsApp (últimos 14 dias, sem uso; esperando finalidade ou repassado a ESTE administrador) vira a
-- submissão dele, e a proposta de recusa segue o caminho de sempre (confirmação, motivo no registro).

create or replace function conv_private.admin_receipt_to_member(p_session uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_conversation uuid; v_profile uuid; i fin_private.whatsapp_receipt_intents%rowtype; d jsonb; v_hash text;
  v_do_socio boolean := false; v_action text := coalesce(p->>'action', ''); v_recusa boolean; v_date date;
begin
  if v_action not in ('fin_receipt_approve', 'fin_receipt_reject') then return; end if;
  v_recusa := v_action = 'fin_receipt_reject';
  v_profile := nullif(p->>'profile_id', '')::uuid;
  v_date := nullif(p->>'receipt_date', '')::date;
  if v_profile is null or not exists (select 1 from public.profiles where id = v_profile and role::text = 'socio') then return; end if;
  if exists (select 1 from public.fin_receipt_submissions r where r.profile_id = v_profile and r.status in ('submitted', 'in_review')) then return; end if;

  v_admin := conv_private.ai_admin_requester(p_session);
  select conversation_id into v_conversation from public.conv_ai_sessions where id = p_session and status = 'open';
  if v_admin is null or v_conversation is null then return; end if;

  -- 1) Aprovação: o comprovante mais recente do admin nesta conversa que ainda não serviu para nada.
  if not v_recusa then
    select u.* into i from conv_private.admin_usable_receipts(v_conversation, v_admin) u
    where u.conversation_id = v_conversation and u.status in ('awaiting_purpose', 'awaiting_confirmation')
      and conv_private.receipt_used_cents(u.id) = 0
    order by u.created_at desc limit 1;
  end if;

  -- 2) O que o próprio sócio mandou no WhatsApp dele: esperando finalidade ou confirmação e, na recusa, também o que
  --    o João repassou a este administrador.
  if i.id is null then
    select w.* into i from fin_private.whatsapp_receipt_intents w
    where w.profile_id = v_profile
      and (w.status in ('awaiting_purpose', 'awaiting_confirmation') or (v_recusa and w.status = 'escalated' and w.escalated_to = v_admin))
      and w.finance_entry_id is null and w.finance_submission_id is null
      and w.created_at > now() - interval '14 days'
      and (v_date is null or (w.created_at at time zone 'America/Fortaleza')::date = v_date)
      and conv_private.receipt_used_cents(w.id) = 0
    order by w.created_at desc limit 1;
    v_do_socio := i.id is not null;
  end if;
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
    d->>'declared_reference',
    case when v_recusa then left('Comprovante enviado pelo sócio no WhatsApp' || coalesce(': ' || i.purpose_detail, '') || '; recusa pedida pelo administrador', 500)
         when v_do_socio then 'Comprovante enviado pelo sócio no WhatsApp; aprovado pelo administrador'
         else 'Comprovante enviado pelo administrador no WhatsApp' end,
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, i.id, 'whatsapp', i.source_message_id);

  update fin_private.whatsapp_receipt_intents
     set status = 'confirmed',
         purpose_kind = case when v_recusa then coalesce(i.purpose_kind, 'other') else 'membership' end,
         purpose_detail = case when v_recusa then coalesce(i.purpose_detail, 'Recusa pedida pelo administrador')
                               when v_do_socio then 'Mensalidade, conforme o administrador' else 'Comprovante de sócio enviado pelo administrador' end,
         finance_submission_id = i.id, updated_at = now()
   where id = i.id;
  -- O mesmo arquivo reenviado não fica pendurado pedindo finalidade (na conversa do admin ou na do sócio).
  update fin_private.whatsapp_receipt_intents o
     set status = 'canceled', updated_at = now()
   where o.conversation_id in (v_conversation, i.conversation_id) and o.id <> i.id and o.status in ('awaiting_purpose', 'awaiting_confirmation')
     and lower(coalesce(o.original_data->>'content_sha256', '')) = v_hash;
end $$;

revoke all on function conv_private.admin_receipt_to_member(uuid, jsonb) from public, anon, authenticated, service_role;

-- Rollback: reaplicar conv_private.admin_receipt_to_member de 20261109150000_joao_admin_aprova_comprovante_do_socio.sql.
