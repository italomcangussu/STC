-- Memória ampliada: fato, preferência e relação que um ADMINISTRADOR informa no privado entram aprovados (a diretoria é quem sabe); brincadeira interna e
-- qualquer coisa vinda de outra pessoa continuam como sugestão para revisão. O administrador também pergunta "o que você sabe sobre X?" (somente leitura)
-- e manda esquecer (N1: resumo do que será esquecido + "sim"). Esquecer não apaga: a memória sai do prompt e fica como "superseded" no histórico.
create or replace function public.conv_svc_ai_memory_candidate(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_kind text := nullif(trim(p->>'kind'), ''); v_subject text := nullif(trim(p->>'subject_name'), ''); v_content text := nullif(trim(p->>'content'), '');
  v_conf numeric := greatest(0, least(1, coalesce((p->>'confidence')::numeric, 0.5))); v_source uuid := nullif(p->>'source_message_id', '')::uuid;
  v_approve boolean := coalesce((p->>'approve')::boolean, false) and v_kind in ('role_title', 'confirmed_fact', 'recurring_preference', 'social_relation');
begin
  if v_kind not in ('confirmed_fact', 'recurring_preference', 'social_relation', 'inside_joke', 'role_title') or v_subject is null or v_content is null then return null; end if;
  select id into v_id from public.conv_ai_memory_candidates
   where lower(subject_name) = lower(v_subject) and lower(content) = lower(v_content) and status in ('pending', 'approved') order by created_at desc limit 1;
  if v_id is not null then
    if v_approve then update public.conv_ai_memory_candidates set status = 'approved', reviewed_at = coalesce(reviewed_at, now()) where id = v_id and status = 'pending'; end if;
    return v_id;
  end if;
  if v_approve and v_kind = 'role_title' then
    update public.conv_ai_memory_candidates set status = 'superseded'
     where kind = 'role_title' and status in ('approved', 'pending') and lower(subject_name) = lower(v_subject);
  end if;
  insert into public.conv_ai_memory_candidates(subject_name, kind, content, confidence, source_message_id, status, reviewed_at)
  values (v_subject, v_kind, left(v_content, 500), v_conf, v_source, case when v_approve then 'approved' else 'pending' end, case when v_approve then now() end)
  returning id into v_id;
  return v_id;
exception when others then return null;
end $$;

create function conv_private.ai_admin_memories(p_session uuid, p_subject text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid; v_s text := nullif(trim(coalesce(p_subject, '')), '');
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('subject', v_s,
    'items', coalesce((select jsonb_agg(jsonb_build_object('subject_name', m.subject_name, 'kind', m.kind, 'content', m.content) order by m.subject_name, m.created_at)
                       from (select * from public.conv_ai_memory_candidates c where c.status = 'approved'
                             and (v_s is null or lower(c.subject_name) like '%' || lower(v_s) || '%' or lower(v_s) like lower(split_part(c.subject_name, ' ', 1)) || '%')
                             order by c.created_at desc limit 30) m), '[]'::jsonb)));
end $$;
create function public.conv_svc_ai_admin_memories(p_session uuid, p_subject text default null) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_memories(p_session, p_subject) $$;
revoke all on function conv_private.ai_admin_memories(uuid, text) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_memories(uuid, text) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_memories(uuid, text) to service_role;

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_memory_forget'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

create function conv_private.ai_admin_memory_forget_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_subject text := nullif(trim(coalesce(p->>'subject', '')), ''); v_text text := nullif(trim(coalesce(p->>'text', '')), ''); v_items jsonb;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if v_subject is null then return conv_private.vfail('SUBJECT_REQUIRED', 'Sobre quem é a memória que devo esquecer?'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'subject_name', m.subject_name, 'content', m.content) order by m.created_at), '[]'::jsonb) into v_items
  from (select * from public.conv_ai_memory_candidates c where c.status = 'approved'
        and (lower(c.subject_name) like '%' || lower(v_subject) || '%' or lower(v_subject) like lower(split_part(c.subject_name, ' ', 1)) || '%')
        and (v_text is null or lower(c.content) like '%' || lower(v_text) || '%') order by c.created_at desc limit 10) m;
  if jsonb_array_length(v_items) = 0 then
    return conv_private.vfail('NOTHING_TO_FORGET', 'Não tenho nenhuma memória guardada ' || case when v_text is null then 'sobre ' || v_subject else 'sobre ' || v_subject || ' com "' || v_text || '"' end || '.');
  end if;
  v_payload := jsonb_build_object('subject', v_subject, 'items', v_items);
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_memory_forget', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_memory_forget', 'summary', v_payload);
end $$;
create function public.conv_svc_ai_admin_memory_forget_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_memory_forget_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_memory_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; v_n int;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_memory_forget' then return conv_private.ai_confirm_pre_memory_step(p_proposal, p_message); end if;
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
  update public.conv_ai_memory_candidates set status = 'superseded', reviewed_at = now()
   where status = 'approved' and id in (select (x->>'id')::uuid from jsonb_array_elements(bp.payload->'items') x);
  get diagnostics v_n = row_count;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('forgotten', v_n) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_ai_memory_candidates', bp.id::text, null,
    jsonb_build_object('action', bp.action, 'forgotten', v_n),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id), bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('forgotten', v_n));
end $$;

revoke all on function conv_private.ai_admin_memory_forget_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_memory_forget_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_memory_forget_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_pre_memory_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
