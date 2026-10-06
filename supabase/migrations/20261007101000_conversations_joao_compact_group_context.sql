-- Conversas · João/STC: mantém o papo recente do grupo compacto para não aumentar custo da IA.
-- A janela cobre contexto social/referências próximas ao @ sem carregar o histórico inteiro.

create or replace function conv_private.ai_group_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conv uuid; v_kind text; v_persona text;
begin
  select s.conversation_id, c.kind into v_conv, v_kind
  from public.conv_ai_sessions s
  join public.conv_conversations c on c.id = s.conversation_id
  where s.id = p_session;
  if v_conv is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_kind <> 'group' then return '[]'::jsonb; end if;

  select coalesce(a.persona_name, 'João Fonseca') into v_persona
  from public.conv_ai_settings a where a.active order by a.version desc limit 1;

  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
    from (
      select m.created_at,
             case
               when m.direction = 'inbound' then coalesce(p.name, cc.name, 'Participante')
               when m.origin = 'ai' then v_persona
               when m.origin = 'automation' then 'Clube'
               else 'Equipe'
             end as sender,
             left(coalesce(m.body, case when m.kind <> 'text' then '[' || m.kind || ']' else '' end), 320) as body
      from public.conv_messages m
      left join public.conv_contacts cc on cc.id = m.sender_contact_id
      left join public.profiles p on p.id = cc.profile_id
      where m.conversation_id = v_conv
        and m.deleted_at is null
        and m.created_at > now() - interval '60 minutes'
      order by m.created_at desc
      limit 12
    ) x
  );
end $$;

revoke all on function conv_private.ai_group_context(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_group_context(uuid) to service_role;
