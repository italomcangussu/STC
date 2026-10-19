-- Comprovante pelo WhatsApp: desde 20261010090024 o arquivo vira só uma intenção (fin_private.whatsapp_receipt_intents),
-- sem fin_receipt_submissions. Dois efeitos vistos na conversa de um administrador (13 a 19/10):
-- 1) conv_svc_receipt_stage devolvia a intenção pendente MAIS ANTIGA, sem prazo: um comprovante de 13/10 nunca
--    classificado (R$ 22,50) capturava todo comprovante e texto seguintes, inclusive pedidos sem relação.
-- 2) o fluxo do administrador (conv_svc_ai_admin_receipt) só lia fin_receipt_submissions e passou a não achar nada.

-- 1) a intenção em análise é a mais recente, e só das últimas 24 h; as antigas ficam para o painel.
create or replace function public.conv_svc_receipt_stage(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents
  where conversation_id=p_conversation and status in ('awaiting_purpose','awaiting_confirmation')
    and created_at>now()-interval '24 hours'
  order by created_at desc,id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',s.id,'source_message_id',s.source_message_id,'status',s.status,
    'purpose_kind',s.purpose_kind,'purpose_detail',s.purpose_detail,
    'amount_cents',s.original_data->>'declared_amount_cents',
    'paid_on',s.original_data->>'declared_paid_on',
    'ocr_status',s.original_data->>'ocr_status','payee',s.original_data->'ocr'->>'payee',
    'created_at',s.created_at);
end $$;
revoke all on function public.conv_svc_receipt_stage(uuid) from public,anon,authenticated;
grant execute on function public.conv_svc_receipt_stage(uuid) to service_role;

-- 2) o que o servidor leu do comprovante: a submissão (fluxo antigo) ou, sem ela, a intenção da mesma mensagem.
create or replace function conv_private.ai_admin_receipt(p_session uuid, p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; r public.fin_receipt_submissions%rowtype;
  i fin_private.whatsapp_receipt_intents%rowtype; fs public.fin_settings%rowtype; v_payee text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open';
  if not found or conv_private.ai_admin_requester(p_session) is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select * into fs from public.fin_settings where id;
  select r2.* into r from public.fin_receipt_submissions r2
    join public.conv_messages m on m.id = r2.source_message_id
   where r2.source_message_id = p_message and m.conversation_id = sess.conversation_id;
  if found then
    v_payee := nullif(trim(coalesce(r.ocr->>'payee', '')), '');
    return jsonb_build_object('ok', true, 'found', true, 'status', r.status, 'ocr_status', r.ocr_status,
      'amount_cents', r.declared_amount_cents, 'paid_on', r.declared_paid_on, 'payee', v_payee,
      'payee_ok', case when v_payee is null then null else fin_private.payee_matches(v_payee, fs.payee_names) end,
      'duplicate', r.possible_duplicate);
  end if;
  select * into i from fin_private.whatsapp_receipt_intents
   where source_message_id = p_message and conversation_id = sess.conversation_id;
  if not found then return jsonb_build_object('ok', true, 'found', false); end if;
  v_payee := nullif(trim(coalesce(i.original_data->'ocr'->>'payee', '')), '');
  return jsonb_build_object('ok', true, 'found', true, 'status', 'staged',
    'ocr_status', i.original_data->>'ocr_status',
    'amount_cents', nullif(i.original_data->>'declared_amount_cents', '')::bigint,
    'paid_on', nullif(i.original_data->>'declared_paid_on', '')::date, 'payee', v_payee,
    'payee_ok', case when v_payee is null then null else fin_private.payee_matches(v_payee, fs.payee_names) end,
    'duplicate', exists(
      select 1 from fin_private.whatsapp_receipt_intents o
       where o.id <> i.id and o.original_data->>'content_sha256' = i.original_data->>'content_sha256'
      union all
      select 1 from public.fin_receipt_submissions s
       where s.content_sha256 = i.original_data->>'content_sha256' and s.status in ('submitted', 'in_review', 'approved')));
end $$;
revoke all on function conv_private.ai_admin_receipt(uuid, uuid) from public, anon, authenticated;
