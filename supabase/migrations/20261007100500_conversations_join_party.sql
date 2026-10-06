-- Conversas · IA entra no jogo com quem for junto (v2)
--
-- A entrada no jogo passa a levar TODAS as pessoas que o solicitante disse que jogam com ele (sócios ativos já resolvidos no cadastro)
-- e, se houver, um convidado: "entrar nesse jogo com a Ana e o Beto". Cabe tudo ou nada: se faltar vaga (máx. 8 contando o convidado),
-- a IA diz quantas vagas restam e a pessoa decide entrar com menos gente. Quem já está no jogo é ignorado sem erro; convidado só entra se
-- o jogo ainda não tiver um (a reserva guarda um convidado só). Só o solicitante (ou um administrador) confirma, como antes.
--
-- Recria `ai_propose` e `ai_confirm` (mesma assinatura) e acrescenta `join_party_check`. Não altera nenhuma reserva.
-- Rollback: voltar `ai_propose`/`ai_confirm` para o corpo de 20261007100400_conversations_join_game.sql e dropar conv_private.join_party_check.

-- Regras da entrada em grupo de pessoas. Devolve ok + `game` (resumo + add_ids/add_names/guest_name/adding) ou o motivo.
create function conv_private.join_party_check(p_reservation uuid, p_profile uuid, p_extra uuid[], p_guest text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reservations%rowtype; v_base jsonb; v_game jsonb; v_in uuid[]; v_new uuid[]; v_names jsonb; v_adding integer;
  v_guest text := nullif(trim(coalesce(p_guest, '')), '');
begin
  -- Regras do solicitante: Play ativo, ainda não terminou, sócio ativo, ainda não está, jogo não lotado.
  v_base := conv_private.join_check(p_reservation, p_profile);
  if not (v_base->>'ok')::boolean then return v_base; end if;
  v_game := v_base->'game';
  select * into r from public.reservations where id = p_reservation;
  v_in := array_cat(array[r.creator_id], coalesce(r.participant_ids, '{}'));
  select coalesce(array_agg(distinct x), '{}') into v_new from unnest(coalesce(p_extra, '{}')) x where x <> p_profile and not (x = any (v_in));
  if (select count(*) from public.profiles p where p.id = any (v_new) and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')) <> cardinality(v_new) then
    return conv_private.vfail('PARTICIPANT_NOT_MEMBER', 'Algum participante não está ativo como sócio.');
  end if;
  if v_guest is not null then
    if length(v_guest) not between 2 and 80 then return conv_private.vfail('INVALID_GUEST', 'Informe o nome do convidado.'); end if;
    if nullif(trim(coalesce(r.guest_name, '')), '') is not null then return conv_private.vfail('GUEST_ALREADY', 'Esse jogo já tem um convidado.'); end if;
  end if;
  v_adding := 1 + cardinality(v_new) + case when v_guest is null then 0 else 1 end;
  if (v_game->>'participants')::int + v_adding > 8 then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_SPOTS', 'message', 'Não há vagas suficientes neste jogo.',
      'spots_left', (v_game->>'spots_left')::int, 'wanted', v_adding, 'game', v_game);
  end if;
  select coalesce(jsonb_agg(p.name::text order by array_position(v_new, p.id)), '[]'::jsonb) into v_names from public.profiles p where p.id = any (v_new);
  if v_guest is not null then v_names := v_names || to_jsonb(v_guest || ' (convidado)'); end if;
  return jsonb_build_object('ok', true, 'game', v_game || jsonb_build_object(
    'add_ids', to_jsonb(array[p_profile] || v_new), 'add_names', v_names, 'guest_name', v_guest, 'adding', v_adding));
end $$;
revoke all on function conv_private.join_party_check(uuid, uuid, uuid[], text) from public, anon, authenticated;

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
  if v_action not in ('create', 'cancel', 'reschedule', 'join') then return conv_private.vfail('INVALID_ACTION', 'Ação inválida.'); end if;

  -- Entrar num jogo que já ocupa o horário (mesma regra do botão "Entrar no Jogo" do app). Só o solicitante entra.
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
  if m.kind <> 'text' or not conv_private.is_confirmation(m.body) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  select exists (select 1 from public.conv_contacts c join public.profiles p on p.id = c.profile_id
    where c.id = m.sender_contact_id and p.role::text = 'admin' and c.link_status in ('linked', 'manual')) into sender_admin;
  if m.sender_contact_id is distinct from bp.requester_contact_id and not sender_admin then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só quem pediu a reserva (ou um administrador) pode confirmar.');
  end if;
  select * into v_conv from public.conv_conversations where id = bp.conversation_id;

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
