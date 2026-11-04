-- Comprovante reenviado que já pagou outra coisa não vira pendência nova do financeiro.
-- Caso Marcelo Sampieri (03/11): reenviou o Pix de R$ 130 de 28/10, que já tinha pago a inscrição do Serra e Sertão
-- (intenção confirmada + lançamento do campeonato, sem fin_receipt_submissions). O repasse só procurava duplicado em
-- fin_receipt_submissions, então criou uma submissão "mensalidade" em análise que ninguém conseguia baixar.

-- Primeiro uso anterior do mesmo arquivo (sha256) ou do mesmo identificador Pix; nulo quando o comprovante é inédito.
create or replace function fin_private.receipt_prior_use(p_intent uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select i.id, i.created_at,
           lower(coalesce(i.original_data->>'content_sha256', '')) as hash,
           nullif(regexp_replace(upper(coalesce(i.original_data->>'declared_reference', i.original_data->'ocr'->>'identifier', '')), '[^A-Z0-9]', '', 'g'), '') as ref
      from fin_private.whatsapp_receipt_intents i where i.id = p_intent
  ), uses as (
    select coalesce(o.purpose_detail, 'comprovante já recebido') as used_for, o.created_at as used_at
      from fin_private.whatsapp_receipt_intents o, me
     where o.id <> me.id and o.created_at < me.created_at and o.status in ('confirmed', 'escalated', 'needs_review')
       and ((me.hash ~ '^[0-9a-f]{64}$' and lower(coalesce(o.original_data->>'content_sha256', '')) = me.hash)
         or (length(me.ref) >= 6 and regexp_replace(upper(coalesce(o.original_data->>'declared_reference', o.original_data->'ocr'->>'identifier', '')), '[^A-Z0-9]', '', 'g') = me.ref))
    union all
    select coalesce(r.member_note, 'comprovante já enviado ao financeiro'), r.created_at
      from public.fin_receipt_submissions r, me
     where r.id <> me.id and r.created_at < me.created_at and r.status in ('submitted', 'in_review', 'approved')
       and ((me.hash ~ '^[0-9a-f]{64}$' and r.content_sha256 = me.hash)
         or (length(me.ref) >= 6 and regexp_replace(upper(coalesce(r.declared_reference, r.ocr->>'identifier', '')), '[^A-Z0-9]', '', 'g') = me.ref))
  )
  select jsonb_build_object('used_for', used_for, 'used_on', (used_at at time zone 'America/Fortaleza')::date)
    from uses order by used_at limit 1
$$;
revoke all on function fin_private.receipt_prior_use(uuid) from public, anon, authenticated;

create or replace function public.conv_svc_receipt_escalate(p_stage uuid, p_message uuid, p_kind text, p_detail text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; d jsonb; src public.conv_messages%rowtype;
  v_admin uuid; v_admin_name text; v_contact uuid; v_conv uuid; v_sender text; v_sub uuid; v_hash text; v_prior jsonb;
  v_kind text := case when p_kind in ('donation', 'membership', 'member_pendency', 'student_card', 'day_card', 'other') then p_kind else 'other' end;
  v_detail text := left(nullif(trim(coalesce(p_detail, '')), ''), 300);
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id = p_stage for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if s.status = 'escalated' then return jsonb_build_object('ok', false, 'code', 'ALREADY_ESCALATED'); end if;
  if s.status not in ('awaiting_purpose', 'awaiting_confirmation') then return jsonb_build_object('ok', false, 'code', 'NOT_PENDING'); end if;

  -- Reenvio de comprovante já usado: encerra a intenção e devolve o uso anterior para o João explicar.
  v_prior := fin_private.receipt_prior_use(s.id);
  if v_prior is not null then
    update fin_private.whatsapp_receipt_intents set status = 'canceled', purpose_kind = v_kind,
      purpose_detail = left('Reenvio de comprovante já usado: ' || (v_prior->>'used_for'), 300), purpose_message_id = p_message, updated_at = now()
    where id = s.id;
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'used_for', v_prior->>'used_for', 'used_on', v_prior->>'used_on');
  end if;

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

-- Limpa as pendências que esse buraco já criou (em 04/11, só a do Marcelo): submissão repassada pelo João cujo arquivo
-- ou Pix já tinha sido usado antes. Rejeita com o motivo, em nome de quem recebeu o repasse; a auditoria é do gatilho.
with stuck as (
  select r.id, i.escalated_to, fin_private.receipt_prior_use(i.id) as prior
    from public.fin_receipt_submissions r
    join fin_private.whatsapp_receipt_intents i on i.id = r.id and i.status = 'escalated' and i.escalated_to is not null
   where r.source = 'whatsapp' and r.status in ('submitted', 'in_review')
), fixed as (
  update public.fin_receipt_submissions r
     set status = 'rejected', possible_duplicate = true, reviewed_by = s.escalated_to, reviewed_at = now(),
         decision_reason = left('Reenvio de comprovante já usado em ' || to_char((s.prior->>'used_on')::date, 'DD/MM/YYYY') || ': '
                                || (s.prior->>'used_for') || '. Nada a baixar.', 1000),
         version = r.version + 1, updated_at = now()
    from stuck s
   where r.id = s.id and s.prior is not null
  returning r.id, s.prior
)
update fin_private.whatsapp_receipt_intents i
   set status = 'canceled', purpose_detail = left('Reenvio de comprovante já usado: ' || (f.prior->>'used_for'), 300), updated_at = now()
  from fixed f
 where i.id = f.id;
