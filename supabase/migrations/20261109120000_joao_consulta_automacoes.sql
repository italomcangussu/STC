-- Consulta "automacoes" do assessor: o João vê quais réguas estão ativas, em rascunho ou pausadas, o horário e os últimos envios.
-- Caso do Hermeson (09/11): as réguas da mensalidade estavam em rascunho e os atrasados só foram lembrados quando ele pediu.

create function conv_private.ai_admin_automations(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if conv_private.ai_admin_requester(p_session) is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'enabled', coalesce((select s.enabled from public.conv_automation_settings s limit 1), false),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.name, 'status', a.status, 'trigger_type', a.trigger_type, 'schedule', a.schedule,
        'last_sent_at', r.last_sent_at, 'sent_30d', coalesce(r.sent_30d, 0), 'queued', coalesce(r.queued, 0))
        order by case a.status when 'active' then 0 when 'paused' then 1 when 'draft' then 2 else 3 end, a.name)
      from public.conv_automations a
      left join lateral (
        select max(x.sent_at) filter (where x.status = 'sent') as last_sent_at,
               count(*) filter (where x.status = 'sent' and x.sent_at > now() - interval '30 days') as sent_30d,
               count(*) filter (where x.status in ('pending', 'processing')) as queued
        from public.conv_automation_recipients x where x.automation_id = a.id) r on true
      where a.status <> 'ended'), '[]'::jsonb)));
end $$;

create function public.conv_svc_ai_admin_automations(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select conv_private.ai_admin_automations(p_session) $$;

revoke all on function conv_private.ai_admin_automations(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_automations(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_automations(uuid) to service_role;
