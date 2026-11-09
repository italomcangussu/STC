-- Caso Diego Memória (09/11): o sócio mandou o Pix de R$ 400 no WhatsApp dele; a cobrança era R$ 440 (mensalidade + multa).
-- A baixa automática exige valor exato, então o comprovante ficou esperando finalidade. O administrador pediu
-- "considere os R$ 400 e deixe os R$ 40 em aberto" e o João respondeu "Não achei comprovante pendente desse sócio" 3 vezes:
-- a aprovação só enxergava fin_receipt_submissions e os comprovantes que o próprio admin mandou.
-- Agora, sem nenhum desses, o comprovante que o sócio mandou no WhatsApp (últimos 14 dias, ainda sem uso) vira o comprovante
-- pendente dele e a proposta de aprovação segue o caminho de sempre (distribui o valor; o que faltar fica em aberto).

create or replace function conv_private.admin_receipt_to_member(p_session uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_conversation uuid; v_profile uuid; i fin_private.whatsapp_receipt_intents%rowtype; d jsonb; v_hash text;
  v_do_socio boolean := false;
begin
  if coalesce(p->>'action', '') <> 'fin_receipt_approve' then return; end if;
  v_profile := nullif(p->>'profile_id', '')::uuid;
  if v_profile is null or not exists (select 1 from public.profiles where id = v_profile and role::text = 'socio') then return; end if;
  if exists (select 1 from public.fin_receipt_submissions r where r.profile_id = v_profile and r.status in ('submitted', 'in_review')) then return; end if;

  v_admin := conv_private.ai_admin_requester(p_session);
  select conversation_id into v_conversation from public.conv_ai_sessions where id = p_session and status = 'open';
  if v_admin is null or v_conversation is null then return; end if;

  -- 1) O comprovante mais recente do admin nesta conversa que ainda não serviu para nada.
  select u.* into i from conv_private.admin_usable_receipts(v_conversation, v_admin) u
  where u.conversation_id = v_conversation and u.status in ('awaiting_purpose', 'awaiting_confirmation')
    and conv_private.receipt_used_cents(u.id) = 0
  order by u.created_at desc limit 1;

  -- 2) Senão, o que o próprio sócio mandou no WhatsApp dele e ainda espera finalidade ou confirmação.
  if i.id is null then
    select w.* into i from fin_private.whatsapp_receipt_intents w
    where w.profile_id = v_profile and w.status in ('awaiting_purpose', 'awaiting_confirmation')
      and w.finance_entry_id is null and w.finance_submission_id is null
      and w.created_at > now() - interval '14 days'
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
    case when v_do_socio then 'Comprovante enviado pelo sócio no WhatsApp; aprovado pelo administrador'
         else 'Comprovante enviado pelo administrador no WhatsApp' end,
    coalesce(d->>'ocr_status', 'not_run'), d->'ocr', false, i.id, 'whatsapp', i.source_message_id);

  update fin_private.whatsapp_receipt_intents
     set status = 'confirmed', purpose_kind = 'membership',
         purpose_detail = case when v_do_socio then 'Mensalidade, conforme o administrador' else 'Comprovante de sócio enviado pelo administrador' end,
         finance_submission_id = i.id, updated_at = now()
   where id = i.id;
  -- O mesmo arquivo reenviado não fica pendurado pedindo finalidade (na conversa do admin ou na do sócio).
  update fin_private.whatsapp_receipt_intents o
     set status = 'canceled', updated_at = now()
   where o.conversation_id in (v_conversation, i.conversation_id) and o.id <> i.id and o.status in ('awaiting_purpose', 'awaiting_confirmation')
     and lower(coalesce(o.original_data->>'content_sha256', '')) = v_hash;
end $$;

revoke all on function conv_private.admin_receipt_to_member(uuid, jsonb) from public, anon, authenticated, service_role;
