-- Conversas · João/STC
-- Resposta MANUAL de administrador numa conversa direta não desliga mais a IA.
-- O João continua atendendo e lê a mensagem da equipe como se fosse dele (ver prompts.ts · transcript).
-- Assumir a conversa passa a ser decisão explícita (conv_set_ai_status), nunca efeito colateral de um envio.

create or replace function conv_private.finish_message(p_message uuid, p_sent boolean, p_provider_id text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_origin text;
begin
  update public.conv_messages set
    status = case when p_sent then 'sent' else 'failed' end,
    provider_message_id = case when p_sent then coalesce(nullif(p_provider_id, ''), provider_message_id) else provider_message_id end,
    sent_at = case when p_sent then now() else sent_at end,
    attempts = attempts + 1,
    last_error = case when p_sent then null else left(coalesce(p_error, 'SEND_FAILED'), 300) end
  where id = p_message and status in ('queued', 'failed')
  returning conversation_id, origin into v_conv, v_origin;
  if p_sent and v_conv is not null then
    update public.conv_conversations set
      last_staff_at = now(), last_message_at = now(),
      staff_read_at = case when v_origin = 'staff' then now() else staff_read_at end
    where id = v_conv;
  end if;
end $$;

-- Conversas diretas que a regra antiga entregou à equipe só por causa de um envio manual voltam para a IA.
update public.conv_conversations
set ai_status = 'ai', handled_by_human = false
where kind = 'direct' and ai_status = 'human' and handoff_kind is null and handoff_at is null and ai_turns = 0;
