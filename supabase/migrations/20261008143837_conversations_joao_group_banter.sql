-- Resenha no grupo: o administrador pede no privado ("puxa uma resenha", "cadê o Tiago?") e o João escreve a provocação.
-- N1: o João mostra o texto exato e só posta depois do "sim" do próprio administrador. O post sai pela mesma fila dos
-- retornos (conv_followups com send_body, vencimento agora) na conversa do grupo de sócios, então fica no histórico e,
-- quando a turma responder, o João sabe o que disse. Com sócio-alvo, o texto começa com "@telefone" e o despacho
-- transforma isso em menção do WhatsApp.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_group_post'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- A conversa do grupo de sócios onde o João está liberado (um grupo só).
create or replace function conv_private.members_group_conversation() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.conv_conversations c join public.conv_groups g on g.id = c.group_id
  where c.kind = 'group' and c.status = 'open' and g.status = 'allowed' and g.ai_enabled
  order by g.last_seen_at desc nulls last limit 1 $$;

create or replace function conv_private.ai_admin_group_post_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_conv uuid := conv_private.members_group_conversation(); v_body text := trim(coalesce(p->>'body', ''));
  v_target uuid := nullif(p->>'profile_id', '')::uuid; pr public.profiles%rowtype; v_phone text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if v_conv is null then return conv_private.vfail('NO_GROUP', 'Não achei o grupo de sócios liberado para mim.'); end if;
  if length(v_body) not between 3 and 1000 then return conv_private.vfail('INVALID_BODY', 'Qual a resenha que eu mando no grupo?'); end if;
  if v_target is not null then
    select * into pr from public.profiles where id = v_target;
    v_phone := conv_private.phone_e164(pr.phone);
    if v_phone is not null and length(v_phone) >= 12 and position('@' || v_phone in v_body) = 0 then
      v_body := '@' || v_phone || ' ' || v_body;
    end if;
  end if;
  v_payload := jsonb_build_object('conversation_id', v_conv, 'body', v_body, 'target_name', pr.name);
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_group_post', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_group_post', 'summary', v_payload);
end $$;

create or replace function public.conv_svc_ai_admin_group_post_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_group_post_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_group_post_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bp public.conv_booking_proposals%rowtype; v_gate jsonb; v_fu uuid; v_res jsonb;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_group_post' then return conv_private.ai_confirm_pre_group_post_step(p_proposal, p_message); end if;
  v_gate := conv_private.ai_forms_gate(bp, p_message);
  if v_gate is not null then return v_gate; end if;
  insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
  values ((bp.payload->>'conversation_id')::uuid, now(), 'Resenha pedida pela diretoria (WhatsApp)', bp.payload->>'body', bp.requester_profile_id)
  returning id into v_fu;
  v_res := jsonb_build_object('followup_id', v_fu);
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = p_message,
    confirmed_by_contact_id = bp.requester_contact_id, payload = bp.payload || v_res where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_booking_proposals', bp.id::text, null,
    jsonb_build_object('action', bp.action, 'target', bp.payload->>'target_name'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id), bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || v_res);
end $$;

-- Curiosidade: no grupo citaram um sócio de quem o João não sabe nada para a resenha. Ele pergunta ao presidente no
-- privado (quem tem a memória aprovada "Presidente…"); a resposta do presidente vira memória pelo caminho de sempre.
-- Freio: uma pergunta por sócio a cada 7 dias e no máximo 3 por dia.
create or replace function conv_private.ai_curator_ask(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_subject text := left(trim(coalesce(p->>'subject_name', '')), 120);
  v_question text := left(trim(coalesce(p->>'question', '')), 500);
  v_note text; pr public.profiles%rowtype; v_phone text; v_contact uuid; v_conv uuid; v_fu uuid;
begin
  if length(v_subject) < 2 or length(v_question) < 10 then return conv_private.vfail('INVALID', 'Pergunta vazia.'); end if;
  if not exists (select 1 from public.conv_ai_sessions s join public.conv_conversations c on c.id = s.conversation_id
                 where s.id = p_session and c.kind = 'group') then
    return conv_private.vfail('GROUP_ONLY', 'Só pergunto quando a resenha é no grupo.');
  end if;
  select pf.* into pr from public.profiles pf
  join public.conv_ai_memory_candidates m on lower(m.subject_name) = lower(pf.name)
  where m.status = 'approved' and m.kind = 'role_title' and m.content ilike 'presidente%' and coalesce(pf.is_active, true)
  order by m.created_at desc limit 1;
  if pr.id is null then return conv_private.vfail('NO_CURATOR', 'Não sei quem é o presidente.'); end if;
  v_note := 'Curiosidade do João: ' || v_subject;
  if exists (select 1 from public.conv_followups f where lower(f.note) = lower(v_note) and f.created_at > now() - interval '7 days')
     or (select count(*) from public.conv_followups f where f.note like 'Curiosidade do João: %' and f.created_at > now() - interval '1 day') >= 3 then
    return conv_private.vfail('RATE_LIMITED', 'Já perguntei há pouco.');
  end if;
  v_phone := conv_private.phone_e164(pr.phone);
  if v_phone is null or length(v_phone) < 12 then return conv_private.vfail('NO_PHONE', 'Presidente sem telefone.'); end if;
  if exists (select 1 from public.conv_contacts c where c.phone = v_phone and c.opt_out) then return conv_private.vfail('OPT_OUT', 'Opt-out.'); end if;
  v_contact := conv_private.upsert_contact(v_phone, null, pr.name, true);
  v_conv := conv_private.open_direct(v_contact);
  insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
  values (v_conv, now(), v_note, v_question, null) returning id into v_fu;
  return jsonb_build_object('ok', true, 'followup_id', v_fu, 'curator', pr.name);
end $$;

create or replace function public.conv_svc_ai_curator_ask(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_curator_ask(p_session, p) $$;

revoke all on function conv_private.ai_curator_ask(uuid, jsonb), public.conv_svc_ai_curator_ask(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_curator_ask(uuid, jsonb) to service_role;

revoke all on function conv_private.members_group_conversation(), conv_private.ai_admin_group_post_propose(uuid, jsonb),
  conv_private.ai_confirm_pre_group_post_step(uuid, uuid), conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_group_post_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_group_post_propose(uuid, jsonb) to service_role;
