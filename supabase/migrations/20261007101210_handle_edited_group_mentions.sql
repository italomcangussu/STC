create or replace function conv_private.apply_edit_with_mention(
  p_provider_id text,
  p_body text,
  p_mention_direct boolean,
  p_mention_evidence text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.conv_svc_apply_edit_with_mention(
  p_provider_id text,
  p_body text,
  p_mention_direct boolean,
  p_mention_evidence text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select conv_private.apply_edit_with_mention(
    p_provider_id,
    p_body,
    p_mention_direct,
    p_mention_evidence
  )
$$;

revoke all on function public.conv_svc_apply_edit_with_mention(text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.conv_svc_apply_edit_with_mention(text,text,boolean,text) to service_role;
