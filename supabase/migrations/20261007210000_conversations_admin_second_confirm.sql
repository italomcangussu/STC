-- Onda 0 do assessor administrativo: operação financeira de R$ 400,00 ou mais pede uma segunda confirmação,
-- na qual o administrador repete o valor. Regra no banco (não depende do modelo): o ramo financeiro de
-- `ai_confirm` só executa depois do segundo passo. Reservas e ações abaixo do limite seguem como antes.
alter function conv_private.ai_confirm(uuid, uuid) rename to ai_confirm_single_step;

create function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype;
  v_limit constant bigint := 40000;
  v_cents bigint; v_reais text; v_asked jsonb; v_text text; v_body text;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not like 'fin\_%' or bp.status <> 'open' or bp.expires_at <= now() then
    return conv_private.ai_confirm_single_step(p_proposal, p_message);
  end if;
  v_cents := coalesce(nullif(bp.payload->>'amount_cents', '')::bigint, 0);
  if v_cents < v_limit then return conv_private.ai_confirm_single_step(p_proposal, p_message); end if;

  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  -- Mensagem inválida: o ramo normal devolve o erro certo.
  if not found or m.created_at <= bp.created_at or m.kind <> 'text'
     or m.sender_contact_id is distinct from bp.requester_contact_id
     or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.ai_confirm_single_step(p_proposal, p_message);
  end if;

  v_reais := trim(to_char(v_cents / 100, 'FM999999999999'));
  v_text := 'R$ ' || to_char(v_cents::numeric / 100, 'FM999G999G990D00');
  v_text := replace(replace(replace(v_text, ',', '#'), '.', ','), '#', '.');
  v_asked := bp.payload->'second_confirm';

  if v_asked is null then
    update public.conv_booking_proposals
       set payload = payload || jsonb_build_object('second_confirm', jsonb_build_object('message_id', m.id, 'asked_at', now()))
     where id = bp.id;
    return conv_private.vfail('CONFIRM_AMOUNT',
      'Esse valor é alto (' || v_text || '). Para eu seguir, responda "confirmo ' || v_text || '" com o valor.');
  end if;

  -- Segundo passo: outra mensagem, depois do pedido, repetindo o valor.
  v_body := regexp_replace(coalesce(m.body, ''), '(\d)\.(\d{3})', '\1\2', 'g');
  if (v_asked->>'message_id')::uuid = m.id or v_body !~ ('(^|[^0-9])' || v_reais || '([^0-9]|$)') then
    return conv_private.vfail('CONFIRM_AMOUNT',
      'Para valores a partir de R$ 400,00 preciso que você repita o valor. Responda "confirmo ' || v_text || '".');
  end if;
  return conv_private.ai_confirm_single_step(p_proposal, p_message);
end $$;

revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm(uuid, uuid) from public, anon, authenticated;
