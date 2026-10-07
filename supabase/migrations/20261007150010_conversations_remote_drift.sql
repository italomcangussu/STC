-- Funções criadas direto no banco real (fora de migration), versionadas aqui como estão em produção.
-- Só alinha as permissões ao padrão do módulo: conv_private nunca é executável por public/anon/authenticated;
-- os embrulhos conv_svc_* só pelo service_role. (fin_private.zz_probe3 é sobra de depuração e NÃO é versionada.)

CREATE OR REPLACE FUNCTION conv_private.apply_edit_with_mention(p_provider_id text, p_body text, p_mention_direct boolean, p_mention_evidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_msg public.conv_messages%rowtype;
  v_previous boolean;
begin
  select *
    into v_msg
    from public.conv_messages
   where provider_message_id = p_provider_id
     and deleted_at is null
   for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  v_previous := coalesce(v_msg.mention_direct, false);

  update public.conv_messages
     set body = left(p_body, 8192),
         edited_at = now(),
         mention_direct = case
           when direction = 'inbound' then coalesce(p_mention_direct, mention_direct)
           else mention_direct
         end,
         mention_evidence = case
           when direction = 'inbound' and p_mention_evidence is not null
             then left(p_mention_evidence, 80)
           else mention_evidence
         end
   where id = v_msg.id;

  return jsonb_build_object(
    'found', true,
    'message_id', v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'direction', v_msg.direction,
    'became_direct_mention',
      v_msg.direction = 'inbound'
      and not v_previous
      and coalesce(p_mention_direct, false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.conv_svc_apply_edit_with_mention(p_provider_id text, p_body text, p_mention_direct boolean, p_mention_evidence text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select conv_private.apply_edit_with_mention(
    p_provider_id,
    p_body,
    p_mention_direct,
    p_mention_evidence
  )
$function$;

CREATE OR REPLACE FUNCTION public.conv_svc_ai_financial_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select conv_private.ai_financial_context()
$function$;

revoke all on function conv_private.apply_edit_with_mention(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.conv_svc_apply_edit_with_mention(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.conv_svc_apply_edit_with_mention(text, text, boolean, text) to service_role;
revoke all on function public.conv_svc_ai_financial_context() from public, anon, authenticated;
grant execute on function public.conv_svc_ai_financial_context() to service_role;
