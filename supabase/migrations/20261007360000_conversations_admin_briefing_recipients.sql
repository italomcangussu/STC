-- Assessor: o administrador inclui ou tira alguém da diretoria do resumo diário das 8h ("inclua o vice-presidente e o administrador").
-- N1: resumo com quem entra/sai e como a lista fica + "sim". Só perfis administradores; o destinatário precisa ter conversa direta vinculada
-- (senão o resumo não tem por onde chegar, e o João avisa). A mudança vale já no próximo disparo.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_briefing_recipient'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

create function conv_private.briefing_list_names(p_extra uuid, p_enabled boolean) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(p.name, ', ' order by p.name), 'ninguém')
  from public.profiles p
  where p.role::text = 'admin' and coalesce(p.is_active, true)
    and ((exists (select 1 from public.conv_admin_briefing_recipients r where r.profile_id = p.id and r.enabled) and p.id is distinct from case when not p_enabled then p_extra end)
         or (p_enabled and p.id = p_extra)) $$;

create function conv_private.ai_admin_briefing_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_profile uuid := nullif(p->>'profile_id', '')::uuid; v_on boolean := coalesce((p->>'enabled')::boolean, true); pr public.profiles%rowtype;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select * into pr from public.profiles where id = v_profile and coalesce(is_active, true);
  if pr.id is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei essa pessoa ativa no cadastro.'); end if;
  if pr.role::text <> 'admin' then
    return conv_private.vfail('NOT_ADMIN', pr.name || ' não é da diretoria no sistema, e o resumo traz dados financeiros só para administradores. Se for o caso, ele precisa antes virar administrador pelo painel.');
  end if;
  if v_on and not exists (select 1 from public.conv_contacts c join public.conv_conversations v on v.contact_id = c.id and v.kind = 'direct'
                          where c.profile_id = pr.id and c.link_status in ('linked', 'manual') and not c.opt_out) then
    return conv_private.vfail('NO_CONVERSATION', pr.name || ' ainda não tem conversa direta comigo no WhatsApp. Peça para ele me mandar um "oi" e eu incluo em seguida.');
  end if;
  if v_on = exists (select 1 from public.conv_admin_briefing_recipients r where r.profile_id = pr.id and r.enabled) then
    return conv_private.vfail('NO_CHANGE', pr.name || (case when v_on then ' já recebe' else ' já não recebe' end) || ' o resumo das 8h.');
  end if;
  v_payload := jsonb_build_object('profile_id', pr.id, 'name', pr.name, 'enabled', v_on, 'list_after', conv_private.briefing_list_names(pr.id, v_on));
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_briefing_recipient', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_briefing_recipient', 'summary', v_payload);
end $$;

create function public.conv_svc_ai_admin_briefing_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_briefing_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_briefing_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_briefing_recipient' then return conv_private.ai_confirm_pre_briefing_step(p_proposal, p_message); end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  insert into public.conv_admin_briefing_recipients(profile_id, enabled)
  values ((bp.payload->>'profile_id')::uuid, (bp.payload->>'enabled')::boolean)
  on conflict (profile_id) do update set enabled = excluded.enabled;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_admin_briefing_recipients', bp.payload->>'profile_id', null,
    jsonb_build_object('action', bp.action, 'enabled', bp.payload->'enabled'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id), bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload);
end $$;

revoke all on function conv_private.briefing_list_names(uuid, boolean) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_briefing_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_briefing_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_briefing_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_pre_briefing_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
