-- Conversas · contexto da IA: janela de 8 trocas + resumo (v1)
--
-- O agente passa a ver as ÚLTIMAS 8 TROCAS de cada pessoa (8 mensagens dela e o que veio no meio) e não mais "as últimas 30
-- mensagens". Tudo que ficou para trás é compactado pelo próprio agente num resumo curto, guardado em `conv_ai_sessions.memory.summary`
-- (a memória já é gravada inteira por `ai_save_turn`). `ai_context` agora também devolve quantas mensagens ficaram fora da janela
-- (`older_messages`) e o resumo do atendimento anterior da mesma pessoa na mesma conversa (`prior_summary`, até 30 dias).
--
-- Só recria `ai_context` (mesma assinatura, mesmos grants). Nenhum dado é alterado.
-- Rollback: voltar `ai_context` para o corpo de 20261007100200_conversations_ai.sql.

create or replace function conv_private.ai_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; cv public.conv_conversations%rowtype; c public.conv_contacts%rowtype;
  pr public.profiles%rowtype; s public.conv_ai_settings%rowtype; ch public.conv_channel%rowtype; v_transcript jsonb;
  v_prof_json jsonb := null; v_prof_id uuid; v_since timestamptz; v_cutoff timestamptz; v_older integer; v_prior text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select * into cv from public.conv_conversations where id = sess.conversation_id;
  select * into c from public.conv_contacts where id = sess.requester_contact_id;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  select * into ch from public.conv_channel where id;
  v_since := coalesce(cv.handoff_at, '-infinity'::timestamptz);

  if c.profile_id is not null and c.link_status in ('linked', 'manual') then
    select * into pr from public.profiles where id = c.profile_id;
    v_prof_json := jsonb_build_object('id', pr.id, 'name', pr.name, 'is_admin', pr.role::text = 'admin',
      'is_member', pr.role::text in ('socio', 'admin') and coalesce(pr.is_active, true),
      'professor_id', (select p2.id from public.professors p2 where p2.user_id = pr.id and coalesce(p2.is_active, true) limit 1));
    v_prof_id := pr.id;
  end if;

  -- Janela de contexto: as últimas 8 trocas desta pessoa (8 mensagens dela e o que veio no meio: IA, equipe, automação).
  -- O que ficou para trás não some: vira o resumo que o agente mantém na memória da sessão (`memory.summary`).
  if cv.kind = 'group' then
    select min(x.created_at) into v_cutoff from (
      select m.created_at from public.conv_messages m
      where m.ai_session_id = p_session and m.direction = 'inbound' and m.deleted_at is null order by m.created_at desc limit 8) x;
    select count(*) into v_older from public.conv_messages m
      where m.ai_session_id = p_session and m.deleted_at is null and m.created_at < coalesce(v_cutoff, '-infinity'::timestamptz);
    select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb) into v_transcript from (
      select m.id, m.created_at, m.direction, m.origin, m.kind, left(coalesce(m.body, ''), 1000) as body
      from public.conv_messages m
      where m.ai_session_id = p_session and m.deleted_at is null and m.created_at >= coalesce(v_cutoff, '-infinity'::timestamptz)
      order by m.created_at desc limit 40) t;
  else
    select min(x.created_at) into v_cutoff from (
      select m.created_at from public.conv_messages m
      where m.conversation_id = cv.id and m.direction = 'inbound' and m.deleted_at is null and m.created_at > v_since order by m.created_at desc limit 8) x;
    select count(*) into v_older from public.conv_messages m
      where m.conversation_id = cv.id and m.deleted_at is null and m.created_at > v_since and m.created_at < coalesce(v_cutoff, '-infinity'::timestamptz);
    select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb) into v_transcript from (
      select m.id, m.created_at, m.direction, m.origin, m.kind, left(coalesce(m.body, ''), 1000) as body
      from public.conv_messages m
      where m.conversation_id = cv.id and m.deleted_at is null and m.created_at > v_since and m.created_at >= coalesce(v_cutoff, '-infinity'::timestamptz)
      order by m.created_at desc limit 40) t;
  end if;

  -- Atendimento anterior da MESMA pessoa nesta conversa: o resumo dele continua valendo (a sessão nova começa sem memória).
  select left(s2.memory->>'summary', 700) into v_prior from public.conv_ai_sessions s2
    where s2.conversation_id = sess.conversation_id and s2.requester_contact_id = sess.requester_contact_id and s2.id <> sess.id
      and nullif(s2.memory->>'summary', '') is not null and s2.started_at > now() - interval '30 days'
    order by s2.started_at desc limit 1;

  return jsonb_build_object(
    'now_local', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
    'weekday_today', extract(dow from now() at time zone 'America/Fortaleza')::int,
    'settings', to_jsonb(s) - 'created_by',
    'institutional_name', ch.institutional_name,
    'is_group', cv.kind = 'group',
    'group_name', (select g.name from public.conv_groups g where g.id = cv.group_id),
    'session', jsonb_build_object('id', sess.id, 'turns', sess.turns, 'memory', sess.memory, 'status', sess.status, 'expires_at', sess.expires_at),
    'requester', jsonb_build_object('contact_name', c.name, 'link_status', c.link_status, 'profile', v_prof_json),
    'courts', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'type', x.type::text) order by x.name), '[]'::jsonb)
               from public.courts x where coalesce(x.is_active, true)),
    'my_reservations', case when v_prof_id is null then '[]'::jsonb else conv_private.ai_my_reservations(v_prof_id) end,
    'open_proposal', (select jsonb_build_object('id', bp.id, 'action', bp.action, 'payload', bp.payload, 'expires_at', bp.expires_at)
                      from public.conv_booking_proposals bp where bp.session_id = p_session and bp.status = 'open' and bp.expires_at > now()
                      order by bp.created_at desc limit 1),
    'transcript', v_transcript, 'older_messages', v_older, 'prior_summary', v_prior);
end $$;
