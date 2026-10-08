-- Assessor: relação nominal dos sócios ativos (e quem é da diretoria) para o administrador no privado. Somente leitura.
create function conv_private.ai_admin_members(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('members',
    coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'role', p.role::text) order by p.name)
              from public.profiles p where coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')), '[]'::jsonb)));
end $$;
create function public.conv_svc_ai_admin_members(p_session uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_members(p_session) $$;
revoke all on function conv_private.ai_admin_members(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_members(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_members(uuid) to service_role;
