-- Conversas · a IA faz tudo que a Agenda faz com os atletas de uma reserva (v1)
--
-- 1. AGENDA no contexto (`ai_agenda`, dentro de `ai_context`): próximos dias com quem está em cada Play (nomes, como a Agenda mostra a todo
--    sócio), vagas, e o que a pessoa PODE fazer em cada reserva. O agente decide pelo contexto da conversa e dessa agenda; o servidor valida.
-- 2. Ação `participants` (propor + confirmar): SAIR da reserva, RETIRAR ou ADICIONAR outras pessoas, adicionar/retirar convidado. Regras
--    da Agenda: Play ativo; qualquer sócio ativo mexe nos atletas de Play que ainda não começou (até 8, contando o convidado); depois do
--    começo só dá para SAIR; o criador só sai por ele mesmo ou por administrador; o último atleta sem convidado saindo cancela a reserva.
-- 3. Aceite por sentido (`is_semantic_acceptance`) para TODAS as ações: o modelo decide que a pessoa aceitou (a função só é chamada
--    nesse caso) e o servidor barra o que não pode ser aceite — pergunta, negação, dúvida, adiamento, pedido de mudança.
--    Continuam valendo: só quem pediu (ou administrador) confirma, depois da proposta, revalidando tudo na gravação.
--
-- Recria `ai_context`, `ai_propose` e `ai_confirm` (mesmas assinaturas e grants). A proposta de `participants` não grava reservation_id
-- (índice único de propostas). Rollback: voltar as 3 funções aos corpos de 20261007100600/100500 e dropar as funções novas;
-- voltar o CHECK de conv_booking_proposals.action para ('create','cancel','reschedule','join').

alter table public.conv_booking_proposals drop constraint conv_booking_proposals_action_check;
alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check
  check (action in ('create', 'cancel', 'reschedule', 'join', 'participants'));

-- Aceite por sentido. Bloqueia o que não é aceite: pergunta, negação, dúvida/adiamento, pedido de mudança.
create function conv_private.is_semantic_acceptance(p text, p_allow_cancel boolean default false) returns boolean
language plpgsql immutable set search_path = '' as $$
declare t text; w text; n integer := 0;
  blockers text[] := array['nao','nunca','jamais','cancela','cancelar','cancelei','desisto','desisti','outro','outra','outros','outras','troca','trocar',
    'muda','mudar','depois','talvez','ver','pensar','acho','mas','porem','ou','espera','aguarda','antes','so','apenas','tambem','alem','menos'];
begin
  if p is null or length(p) > 160 or position('?' in p) > 0 then return false; end if;
  t := conv_private.fold(p);
  t := regexp_replace(t, '[^a-z ]', ' ', 'g');
  for w in select x from regexp_split_to_table(btrim(t), '\s+') x where x <> '' loop
    n := n + 1;
    -- "cancela/cancelar" só barra quando a proposta NÃO é de cancelamento ("sim, pode cancelar" aceita um cancelamento).
    if w = any (blockers) and not (p_allow_cancel and w in ('cancela', 'cancelar')) then return false; end if;
  end loop;
  return n > 0;
end $$;
revoke all on function conv_private.is_semantic_acceptance(text, boolean) from public, anon, authenticated;

-- Quem está numa reserva (id + nome), criador primeiro. Só Play mostra pessoas (aula e campeonato não expõem alunos nem atletas).
create function conv_private.game_people(p_reservation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations%rowtype; v_ids uuid[];
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or r.type <> 'Play' then return '[]'::jsonb; end if;
  select coalesce(array_agg(x order by o), '{}') into v_ids from (
    select x, min(o) o from (
      select r.creator_id x, 0 o where r.creator_id is not null
      union all select p, ord from unnest(coalesce(r.participant_ids, '{}')) with ordinality as t(p, ord)) a group by x) b;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name::text) order by array_position(v_ids, p.id))
                   from public.profiles p where p.id = any (v_ids)), '[]'::jsonb);
end $$;

-- A agenda que o agente enxerga: as reservas da pessoa (até 60 dias) e as dos próximos 4 dias, no máximo 40, com o que ela pode fazer.
create function conv_private.ai_agenda(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_member boolean := false; v_admin boolean := false; v_now timestamp := now() at time zone 'America/Fortaleza';
begin
  if p_profile is null then return '[]'::jsonb; end if;
  select (p.role::text in ('socio', 'admin') and coalesce(p.is_active, true)), p.role::text = 'admin' into v_member, v_admin
    from public.profiles p where p.id = p_profile;
  return coalesce((
    select jsonb_agg(e || jsonb_build_object('ref', 'a' || rn) order by rn) from (
      select row_number() over (order by x.date, x.start_time) rn,
        jsonb_build_object(
          'id', x.id, 'type', x.type, 'date', x.date, 'start', to_char(x.start_time, 'HH24:MI'), 'end', to_char(x.end_time, 'HH24:MI'),
          'court', (select c.name from public.courts c where c.id = x.court_id),
          'people', conv_private.game_people(x.id),
          'guest', case when x.type = 'Play' then nullif(trim(coalesce(x.guest_name, '')), '') end,
          'spots_left', case when x.type = 'Play' then greatest(8 - (jsonb_array_length(conv_private.game_people(x.id))
                                + case when nullif(trim(coalesce(x.guest_name, '')), '') is null then 0 else 1 end), 0) end,
          'mine', x.mine,
          'can', jsonb_build_object(
            'leave', x.type = 'Play' and x.in_game,
            'people', x.type = 'Play' and v_member and (x.date + x.start_time) > v_now,
            'edit', x.type in ('Play', 'Aula') and (v_admin or (x.creator_id = p_profile)) and (x.date + x.start_time) > v_now,
            'cancel', x.type in ('Play', 'Aula') and (v_admin or (x.creator_id = p_profile)) and (x.date + x.start_time) > v_now)) e
      from (
        select r.*, (r.creator_id = p_profile or p_profile = any (coalesce(r.participant_ids, '{}'))) as mine,
               (p_profile = any (coalesce(r.participant_ids, '{}')) or r.creator_id = p_profile) as in_game
        from public.reservations r
        where r.status::text = 'active' and r.type in ('Play', 'Aula', 'Campeonato')
          and (r.date + (case when r.end_time = time '00:00' then time '23:59:59' else r.end_time end)) > v_now
          and r.date <= conv_private.today() + 60
          and (r.date <= conv_private.today() + 4 or r.creator_id = p_profile or p_profile = any (coalesce(r.participant_ids, '{}')))
        order by r.date, r.start_time limit 40) x
    ) y), '[]'::jsonb);
end $$;
revoke all on function conv_private.ai_agenda(uuid), conv_private.game_people(uuid) from public, anon, authenticated;

-- Regras de mexer nos atletas (espelho da Agenda). Devolve ok + `change` ou o motivo.
create function conv_private.participants_check(p_reservation uuid, p_profile uuid, p_add uuid[], p_remove uuid[], p_add_guest text, p_remove_guest boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations%rowtype; v_p public.profiles%rowtype; v_admin boolean; v_in uuid[]; v_add uuid[]; v_rem uuid[]; v_all uuid[]; v_after uuid[];
  v_now timestamp := now() at time zone 'America/Fortaleza'; v_guest_old text; v_guest_new text; v_n integer; v_self_only boolean; v_cancel boolean;
  v_game jsonb; v_names jsonb; v_add_names jsonb; v_rem_names jsonb;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or r.status::text <> 'active' then return conv_private.vfail('RESERVATION_NOT_FOUND', 'Essa reserva não está mais ativa.'); end if;
  if r.type <> 'Play' then return conv_private.vfail('NOT_PLAY', 'Só dá para mexer nos atletas de reservas de Play.'); end if;
  select * into v_p from public.profiles where id = p_profile;
  if not found or coalesce(v_p.is_active, true) = false or v_p.role::text not in ('socio', 'admin') then
    return conv_private.vfail('REQUESTER_NOT_MEMBER', 'Só sócios ativos mexem nos atletas por aqui.');
  end if;
  v_admin := v_p.role::text = 'admin';
  v_in := array_cat(array[r.creator_id], coalesce(r.participant_ids, '{}'));
  select coalesce(array_agg(distinct x), '{}') into v_add from unnest(coalesce(p_add, '{}')) x where not (x = any (v_in));
  select coalesce(array_agg(distinct x), '{}') into v_rem from unnest(coalesce(p_remove, '{}')) x;
  v_guest_old := nullif(trim(coalesce(r.guest_name, '')), '');
  if cardinality(v_add) + cardinality(v_rem) = 0 and nullif(trim(coalesce(p_add_guest, '')), '') is null and not coalesce(p_remove_guest, false) then
    return conv_private.vfail('NOTHING_TO_DO', 'Não há nada para alterar nessa reserva.');
  end if;
  if exists (select 1 from unnest(v_rem) x where not (x = any (v_in))) then
    return conv_private.vfail('NOT_IN_RESERVATION', 'Essa pessoa não está nessa reserva.');
  end if;
  if (select count(*) from public.profiles q where q.id = any (v_add) and coalesce(q.is_active, true) and q.role::text in ('socio', 'admin')) <> cardinality(v_add) then
    return conv_private.vfail('PARTICIPANT_NOT_MEMBER', 'Algum participante não está ativo como sócio.');
  end if;
  if (r.date + (case when r.end_time = time '00:00' then time '23:59:59' else r.end_time end)) <= v_now then
    return conv_private.vfail('IN_PAST', 'Esse jogo já terminou.');
  end if;
  v_self_only := cardinality(v_add) = 0 and nullif(trim(coalesce(p_add_guest, '')), '') is null and not coalesce(p_remove_guest, false) and v_rem = array[p_profile];
  if (r.date + r.start_time) <= v_now and not v_self_only then
    return conv_private.vfail('RESERVATION_STARTED', 'Esse jogo já começou: agora só dá para sair dele.');
  end if;
  if r.creator_id = any (v_rem) and r.creator_id <> p_profile and not v_admin then
    return conv_private.vfail('CREATOR_PROTECTED', 'Só o criador da reserva ou um administrador pode retirar o criador.');
  end if;
  -- convidado: a reserva guarda um só
  v_guest_new := v_guest_old;
  if coalesce(p_remove_guest, false) then v_guest_new := null; end if;
  if nullif(trim(coalesce(p_add_guest, '')), '') is not null then
    if length(trim(p_add_guest)) not between 2 and 80 then return conv_private.vfail('INVALID_GUEST', 'Informe o nome do convidado.'); end if;
    if v_guest_new is not null then return conv_private.vfail('GUEST_ALREADY', 'Esse jogo já tem um convidado.'); end if;
    v_guest_new := trim(p_add_guest);
  end if;
  -- quem fica
  select coalesce(array_agg(x order by o), '{}') into v_all from (
    select x, min(o) o from unnest(v_in || v_add) with ordinality t(x, o) where x is not null group by x) a;
  select coalesce(array_agg(x order by o), '{}') into v_after from unnest(v_all) with ordinality t(x, o) where not (x = any (v_rem));
  v_n := cardinality(v_after) + case when v_guest_new is null then 0 else 1 end;
  if v_n > 8 then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_SPOTS', 'message', 'Não há vagas suficientes neste jogo.',
      'spots_left', greatest(8 - (cardinality(array(select distinct x from unnest(v_in) x where x is not null)) + case when v_guest_old is null then 0 else 1 end), 0),
      'wanted', cardinality(v_add) + case when nullif(trim(coalesce(p_add_guest, '')), '') is null then 0 else 1 end);
  end if;
  v_cancel := cardinality(v_after) = 0 and v_guest_new is null;
  v_game := conv_private.game_summary(r.id);
  select coalesce(jsonb_agg(q.name::text order by array_position(v_after, q.id)), '[]'::jsonb) into v_names from public.profiles q where q.id = any (v_after);
  if v_guest_new is not null then v_names := v_names || to_jsonb(v_guest_new || ' (convidado)'); end if;
  select coalesce(jsonb_agg(q.name::text order by array_position(v_add, q.id)), '[]'::jsonb) into v_add_names from public.profiles q where q.id = any (v_add);
  select coalesce(jsonb_agg(q.name::text order by array_position(v_rem, q.id)), '[]'::jsonb) into v_rem_names from public.profiles q where q.id = any (v_rem);
  return jsonb_build_object('ok', true, 'change', v_game || jsonb_build_object(
    'reservation_id', r.id, 'add_ids', to_jsonb(v_add), 'add_names', v_add_names, 'remove_ids', to_jsonb(v_rem), 'remove_names', v_rem_names,
    'add_guest', nullif(trim(coalesce(p_add_guest, '')), ''), 'remove_guest', coalesce(p_remove_guest, false), 'guest_after', v_guest_new,
    'after_names', v_names, 'cancel_all', v_cancel, 'self_leaving', p_profile = any (v_rem)));
end $$;
revoke all on function conv_private.participants_check(uuid, uuid, uuid[], uuid[], text, boolean) from public, anon, authenticated;

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
    'transcript', v_transcript, 'older_messages', v_older, 'prior_summary', v_prior,
    'agenda', conv_private.ai_agenda(v_prof_id));
end $$;

create or replace function conv_private.ai_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; c public.conv_contacts%rowtype; s public.conv_ai_settings%rowtype;
  v_action text := coalesce(p->>'action', 'create'); v_in jsonb; v_val jsonb; v_old public.reservations%rowtype;
  v_payload jsonb; v_id uuid; v_req uuid; v_is_admin boolean; v_party uuid[];
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  select * into c from public.conv_contacts where id = sess.requester_contact_id;
  if c.profile_id is null or c.link_status not in ('linked', 'manual') then
    return conv_private.vfail('REQUESTER_NOT_IDENTIFIED', 'Não consegui identificar seu cadastro de sócio por este telefone.');
  end if;
  v_req := c.profile_id;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  select p2.role::text = 'admin' into v_is_admin from public.profiles p2 where p2.id = v_req;
  if v_action not in ('create', 'cancel', 'reschedule', 'join', 'participants') then return conv_private.vfail('INVALID_ACTION', 'Ação inválida.'); end if;

  -- Entrar num jogo que já ocupa o horário (mesma regra do botão "Entrar no Jogo" do app). Só o solicitante entra.
  -- Mexer nos atletas de uma reserva de Play (sair, retirar, adicionar, convidado): mesmas regras da Agenda.
  if v_action = 'participants' then
    v_val := conv_private.participants_check(nullif(p->>'reservation_id', '')::uuid, v_req,
      array(select x::uuid from jsonb_array_elements_text(coalesce(p->'add_ids', '[]'::jsonb)) x),
      array(select x::uuid from jsonb_array_elements_text(coalesce(p->'remove_ids', '[]'::jsonb)) x),
      nullif(trim(coalesce(p->>'add_guest', '')), ''), coalesce((p->>'remove_guest')::boolean, false));
    if not (v_val->>'ok')::boolean then return v_val; end if;
    update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
    insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
    values (sess.conversation_id, p_session, c.id, v_req, 'participants', v_val->'change', now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'participants', 'summary', v_val->'change');
  end if;

  if v_action = 'join' then
    -- Entra o solicitante e as pessoas que ele disse que jogam com ele (`participant_ids`, já resolvidas no cadastro) e/ou um convidado.
    select coalesce(array_agg(distinct x::uuid), '{}') into v_party from jsonb_array_elements_text(coalesce(p->'participant_ids', '[]'::jsonb)) x;
    v_val := conv_private.join_party_check(nullif(p->>'reservation_id', '')::uuid, v_req, v_party, nullif(trim(coalesce(p->>'guest_name', '')), ''));
    if not (v_val->>'ok')::boolean then return v_val; end if;
    update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
    insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
    values (sess.conversation_id, p_session, c.id, v_req, 'join', v_val->'game', now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
    returning id into v_id;
    return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'join', 'summary', v_val->'game');
  end if;

  if v_action in ('cancel', 'reschedule') then
    select * into v_old from public.reservations where id = nullif(p->>'reservation_id', '')::uuid;
    if not found or v_old.status::text <> 'active' then return conv_private.vfail('RESERVATION_NOT_FOUND', 'Não achei essa reserva ativa.'); end if;
    if v_old.creator_id is distinct from v_req and not coalesce(v_is_admin, false) then
      return conv_private.vfail('NOT_YOUR_RESERVATION', 'Só quem criou a reserva (ou um administrador) pode cancelar ou remarcar.');
    end if;
    if v_old.type not in ('Play', 'Aula') then return conv_private.vfail('NEEDS_HUMAN', 'Esse tipo de reserva só a equipe altera.'); end if;
    if v_old.date < conv_private.today() or (v_old.date = conv_private.today() and v_old.start_time <= (now() at time zone 'America/Fortaleza')::time) then
      return conv_private.vfail('IN_PAST', 'Essa reserva já começou ou passou.');
    end if;
    if v_action = 'cancel' then
      v_payload := jsonb_build_object('reservation_id', v_old.id, 'type', v_old.type, 'date', v_old.date,
        'start', to_char(v_old.start_time, 'HH24:MI'), 'end', to_char(v_old.end_time, 'HH24:MI'),
        'court_name', (select name from public.courts where id = v_old.court_id));
    end if;
  end if;

  if v_action in ('create', 'reschedule') then
    v_in := p - 'action' - 'reservation_id' || jsonb_build_object('requester_profile_id', v_req);
    if v_action = 'reschedule' then
      -- Remarcar mantém o tipo, os participantes e a quadra, salvo o que a pessoa mudou.
      v_in := jsonb_build_object('type', v_old.type, 'participant_ids', to_jsonb(coalesce(v_old.participant_ids, '{}')),
        'guest_name', v_old.guest_name, 'professor_id', v_old.professor_id,
        'non_socio_student_ids', to_jsonb(coalesce(v_old.non_socio_student_ids, '{}')), 'court_id', v_old.court_id,
        'duration', (extract(epoch from (case when v_old.end_time = time '00:00' then time '23:59:59' else v_old.end_time end - v_old.start_time)) / 60)::int)
        || (v_in - 'type') || jsonb_build_object('exclude_reservation_id', v_old.id);
    end if;
    v_val := conv_private.validate_reservation(v_in);
    if not (v_val->>'ok')::boolean then return v_val; end if;
    v_payload := coalesce(v_payload, '{}'::jsonb) || (v_val->'normalized');
    if v_action = 'reschedule' then v_payload := v_payload || jsonb_build_object('reservation_id', v_old.id); end if;
  end if;

  -- Uma proposta aberta por sessão: a nova substitui a anterior.
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, c.id, v_req, v_action, v_payload, now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload);
end $$;

create or replace function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; sender_admin boolean := false;
  v_val jsonb; n jsonb; v_res uuid; v_old public.reservations%rowtype; v_in jsonb; v_student_type text; v_obs text;
  v_socio uuid[]; v_students uuid[]; v_court uuid; v_date date; v_conv public.conv_conversations%rowtype;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found then return conv_private.vfail('PROPOSAL_NOT_FOUND', 'Proposta não encontrada.'); end if;
  if bp.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'replayed', true, 'reservation_id', coalesce(bp.reservation_id, nullif(bp.payload->>'reservation_id', '')::uuid), 'action', bp.action, 'summary', bp.payload);
  end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;

  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, bp.action = 'cancel' or coalesce((bp.payload->>'cancel_all')::boolean, false))) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  select exists (select 1 from public.conv_contacts c join public.profiles p on p.id = c.profile_id
    where c.id = m.sender_contact_id and p.role::text = 'admin' and c.link_status in ('linked', 'manual')) into sender_admin;
  if m.sender_contact_id is distinct from bp.requester_contact_id and not sender_admin then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só quem pediu a reserva (ou um administrador) pode confirmar.');
  end if;
  select * into v_conv from public.conv_conversations where id = bp.conversation_id;

  -- Mexer nos atletas: trava a reserva, revalida tudo e aplica (sair/retirar/adicionar/convidado; último atleta = cancela a reserva).
  if bp.action = 'participants' then
    select * into v_old from public.reservations where id = (bp.payload->>'reservation_id')::uuid for update;
    v_val := conv_private.participants_check((bp.payload->>'reservation_id')::uuid, bp.requester_profile_id,
      array(select x::uuid from jsonb_array_elements_text(coalesce(bp.payload->'add_ids', '[]'::jsonb)) x),
      array(select x::uuid from jsonb_array_elements_text(coalesce(bp.payload->'remove_ids', '[]'::jsonb)) x),
      nullif(trim(coalesce(bp.payload->>'add_guest', '')), ''), coalesce((bp.payload->>'remove_guest')::boolean, false));
    if not (v_val->>'ok')::boolean then
      update public.conv_booking_proposals set status = 'failed', failure_code = v_val->>'code' where id = bp.id;
      return v_val;
    end if;
    n := v_val->'change';
    update public.reservations set
      participant_ids = array(select x from unnest(coalesce(participant_ids, '{}')) with ordinality t(x, o)
                              where not (x::text in (select jsonb_array_elements_text(n->'remove_ids'))) order by o)
                        || array(select jsonb_array_elements_text(n->'add_ids')::uuid),
      guest_name = case when (n->>'guest_after') is null then null else n->>'guest_after' end,
      guest_responsible_id = case when (n->>'guest_after') is null then null
                                  when (n->>'guest_after') is distinct from nullif(trim(coalesce(guest_name, '')), '') then bp.requester_profile_id
                                  else guest_responsible_id end,
      status = case when coalesce((n->>'cancel_all')::boolean, false) then 'cancelled' else status end,
      updated_at = now()
      where id = v_old.id;
    update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
      confirmed_by_contact_id = m.sender_contact_id, payload = n where id = bp.id;
    perform conv_private.audit(case when coalesce((n->>'cancel_all')::boolean, false) then 'ai_reservation_canceled' else 'ai_reservation_participants_changed' end,
      'reservations', v_old.id::text,
      jsonb_build_object('participants', coalesce(cardinality(v_old.participant_ids), 0)),
      jsonb_build_object('added', jsonb_array_length(n->'add_ids'), 'removed', jsonb_array_length(n->'remove_ids'), 'cancel_all', coalesce((n->>'cancel_all')::boolean, false)),
      jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'group_id', v_conv.group_id,
        'requester_profile_id', bp.requester_profile_id, 'proposal_id', bp.id,
        'confirmed_by_admin', sender_admin and m.sender_contact_id is distinct from bp.requester_contact_id),
      bp.requester_profile_id);
    return jsonb_build_object('ok', true, 'action', 'participants', 'reservation_id', v_old.id, 'summary', n);
  end if;

  -- Entrar no jogo: trava a reserva, revalida (vaga, jogo ativo, sócio, ainda não participa) e acrescenta o solicitante.
  -- A proposta NÃO grava reservation_id (o índice único da tabela vale para uma reserva criada, e vários sócios podem entrar no mesmo jogo).
  if bp.action = 'join' then
    select * into v_old from public.reservations where id = (bp.payload->>'reservation_id')::uuid for update;
    v_val := conv_private.join_party_check((bp.payload->>'reservation_id')::uuid, bp.requester_profile_id,
      array(select x::uuid from jsonb_array_elements_text(coalesce(bp.payload->'add_ids', '[]'::jsonb)) x where x::uuid <> bp.requester_profile_id),
      nullif(trim(coalesce(bp.payload->>'guest_name', '')), ''));
    if not (v_val->>'ok')::boolean then
      update public.conv_booking_proposals set status = 'failed', failure_code = v_val->>'code' where id = bp.id;
      return v_val;
    end if;
    update public.reservations set
      participant_ids = coalesce(participant_ids, '{}') || array(select x::uuid from jsonb_array_elements_text(v_val->'game'->'add_ids') x),
      guest_name = coalesce(guest_name, nullif(v_val->'game'->>'guest_name', '')),
      guest_responsible_id = case when nullif(v_val->'game'->>'guest_name', '') is not null then bp.requester_profile_id else guest_responsible_id end,
      updated_at = now()
      where id = v_old.id;
    n := conv_private.game_summary(v_old.id) || jsonb_build_object('added', (v_val->'game'->>'adding')::int);
    update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
      confirmed_by_contact_id = m.sender_contact_id, payload = n where id = bp.id;
    perform conv_private.audit('ai_reservation_joined', 'reservations', v_old.id::text,
      jsonb_build_object('participants', coalesce(cardinality(v_old.participant_ids), 0)),
      jsonb_build_object('participants', coalesce(cardinality(v_old.participant_ids), 0) + (v_val->'game'->>'adding')::int),
      jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'group_id', v_conv.group_id,
        'requester_profile_id', bp.requester_profile_id, 'proposal_id', bp.id,
        'confirmed_by_admin', sender_admin and m.sender_contact_id is distinct from bp.requester_contact_id),
      bp.requester_profile_id);
    return jsonb_build_object('ok', true, 'action', 'join', 'reservation_id', v_old.id, 'summary', n);
  end if;

  if bp.action = 'cancel' then
    select * into v_old from public.reservations where id = (bp.payload->>'reservation_id')::uuid for update;
    if not found or v_old.status::text <> 'active' then
      update public.conv_booking_proposals set status = 'failed', failure_code = 'RESERVATION_NOT_FOUND' where id = bp.id;
      return conv_private.vfail('RESERVATION_NOT_FOUND', 'Não achei essa reserva ativa.');
    end if;
    update public.reservations set status = 'cancelled', updated_at = now() where id = v_old.id;
    update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
      confirmed_by_contact_id = m.sender_contact_id, reservation_id = v_old.id where id = bp.id;
    perform conv_private.audit('ai_reservation_canceled', 'reservations', v_old.id::text, null,
      jsonb_build_object('status', 'cancelled'),
      jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'group_id', v_conv.group_id,
        'requester_profile_id', bp.requester_profile_id, 'proposal_id', bp.id), bp.requester_profile_id);
    return jsonb_build_object('ok', true, 'action', 'cancel', 'reservation_id', v_old.id, 'summary', bp.payload);
  end if;

  n := bp.payload;
  v_court := (n->>'court_id')::uuid; v_date := (n->>'date')::date;
  -- Trava por quadra e dia: serializa gravações concorrentes.
  perform pg_advisory_xact_lock(hashtextextended('conv_res:' || v_court::text || ':' || v_date::text, 0));

  v_in := n || jsonb_build_object('start', n->>'start', 'requester_profile_id', bp.requester_profile_id,
    'exclude_reservation_id', case when bp.action = 'reschedule' then n->>'reservation_id' else null end);
  v_val := conv_private.validate_reservation(v_in);
  if not (v_val->>'ok')::boolean then
    update public.conv_booking_proposals set status = 'failed', failure_code = v_val->>'code' where id = bp.id;
    return v_val;
  end if;
  n := v_val->'normalized';

  select coalesce(array_agg(x::uuid), '{}') into v_socio from jsonb_array_elements_text(n->'participant_ids') x;
  select coalesce(array_agg(x::uuid), '{}') into v_students from jsonb_array_elements_text(n->'non_socio_student_ids') x;
  v_student_type := case when n->>'type' = 'Aula' then
    case when cardinality(v_socio) > 0 and cardinality(v_students) = 0 then 'socio'
         when cardinality(v_socio) = 0 and cardinality(v_students) > 0 then 'non-socio' else null end else null end;
  v_obs := 'Reserva via WhatsApp (IA)';

  -- Mesmo efeito do app: sócio que vira aluno ganha o perfil de aluno ativo.
  if n->>'type' = 'Aula' and cardinality(v_socio) > 0 then
    insert into public.student_profiles(profile_id, professor_id, student_status)
    select x, nullif(n->>'professor_id', '')::uuid, 'active' from unnest(v_socio) x
    on conflict (profile_id) do nothing;
  end if;

  insert into public.reservations(type, date, start_time, end_time, court_id, creator_id, participant_ids, guest_name,
    guest_responsible_id, professor_id, student_type, non_socio_student_id, non_socio_student_ids, observation, status)
  values (n->>'type', v_date, (n->>'start')::time, (n->>'end')::time, v_court, bp.requester_profile_id, v_socio,
    n->>'guest_name', case when nullif(n->>'guest_name', '') is null then null else bp.requester_profile_id end,
    nullif(n->>'professor_id', '')::uuid, v_student_type,
    case when cardinality(v_students) = 1 then v_students[1] else null end, v_students, v_obs, 'active')
  returning id into v_res;

  if bp.action = 'reschedule' then
    update public.reservations set status = 'cancelled', updated_at = now() where id = (bp.payload->>'reservation_id')::uuid and status::text = 'active';
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, reservation_id = v_res where id = bp.id;
  perform conv_private.audit('ai_reservation_created', 'reservations', v_res::text, null,
    jsonb_build_object('type', n->>'type', 'date', n->>'date', 'start', n->>'start', 'court', n->>'court_name'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'group_id', v_conv.group_id,
      'requester_profile_id', bp.requester_profile_id, 'proposal_id', bp.id, 'action', bp.action,
      'confirmed_by_admin', sender_admin and m.sender_contact_id is distinct from bp.requester_contact_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'reservation_id', v_res, 'summary', n);
end $$;
