-- Conversas · assessor de professor (delegado)
--
-- O professor pode ter um assessor (outro agente de IA, ou uma pessoa) com WhatsApp próprio. A diretoria cadastra o telefone
-- do assessor em `conv_contact_delegates`, ligado ao cadastro do professor. A partir daí, quando esse contato fala com o João,
-- ele é tratado COMO O PROFESSOR: marca, remarca e cancela aula e o Play dele, vê a agenda e os alunos dele.
-- Nunca herda poder de administrador (mesmo que o professor seja admin) e o telefone NÃO é vinculado ao cadastro do professor
-- (`conv_contacts.profile_id` segue vazio): assim avisos, cobranças e automações do professor nunca vão para o assessor.
-- A delegação só vale enquanto o professor estiver ativo (cadastro e `professors`); desativar a linha corta na hora.
--
-- Recria `ai_context` e `ai_propose` a partir das versões do remoto, trocando só a identificação de quem fala.
-- Rollback: `update conv_contact_delegates set active = false` (efeito imediato) e, se quiser, voltar as duas funções às
-- versões anteriores (pg_get_functiondef no remoto antes desta migration).

create table if not exists public.conv_contact_delegates (
  contact_id uuid primary key references public.conv_contacts(id),
  principal_profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'professor_assistant' check (kind in ('professor_assistant')),
  active boolean not null default true,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conv_contact_delegates_principal_idx on public.conv_contact_delegates(principal_profile_id);
alter table public.conv_contact_delegates enable row level security;
revoke all on public.conv_contact_delegates from anon, authenticated;
grant select on public.conv_contact_delegates to authenticated;
drop policy if exists conv_contact_delegates_admin_read on public.conv_contact_delegates;
create policy conv_contact_delegates_admin_read on public.conv_contact_delegates for select to authenticated using (public.is_admin());

-- Delegação válida do contato (null se não houver): o contato não tem cadastro próprio vinculado e o professor está ativo.
create or replace function conv_private.contact_delegation(p_contact uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', d.kind, 'principal_profile_id', p.id, 'principal_name', p.name, 'professor_id', pf.id)
  from public.conv_contact_delegates d
  join public.conv_contacts c on c.id = d.contact_id
  join public.profiles p on p.id = d.principal_profile_id
  join lateral (select x.id from public.professors x where x.user_id = p.id and coalesce(x.is_active, true) limit 1) pf on true
  where d.contact_id = p_contact and d.active and coalesce(p.is_active, true)
    and not (c.profile_id is not null and c.link_status in ('linked', 'manual'))
$$;

-- Cadastro em nome de quem o contato fala: o próprio (vinculado) ou o do professor que ele assessora.
create or replace function conv_private.acting_profile_id(p_contact uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.profile_id from public.conv_contacts c where c.id = p_contact and c.profile_id is not null and c.link_status in ('linked', 'manual')),
    (conv_private.contact_delegation(p_contact)->>'principal_profile_id')::uuid)
$$;
revoke all on function conv_private.contact_delegation(uuid) from public, anon, authenticated;
revoke all on function conv_private.acting_profile_id(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION conv_private.ai_context(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess public.conv_ai_sessions%rowtype; cv public.conv_conversations%rowtype; c public.conv_contacts%rowtype;
  pr public.profiles%rowtype; s public.conv_ai_settings%rowtype; ch public.conv_channel%rowtype; v_transcript jsonb;
  v_prof_json jsonb := null; v_prof_id uuid; v_since timestamptz; v_cutoff timestamptz; v_older integer; v_prior text;
  v_acting jsonb; v_req_id uuid;
begin
  select * into sess from public.conv_ai_sessions where id = p_session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select * into cv from public.conv_conversations where id = sess.conversation_id;
  select * into c from public.conv_contacts where id = sess.requester_contact_id;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  select * into ch from public.conv_channel where id;
  v_since := coalesce(cv.handoff_at, '-infinity'::timestamptz);

  -- Quem fala: o cadastro do próprio telefone ou, no assessor de um professor, o professor (nunca com poder de administrador).
  v_acting := conv_private.contact_delegation(c.id);
  v_req_id := conv_private.acting_profile_id(c.id);
  if v_req_id is not null then
    select * into pr from public.profiles where id = v_req_id;
    v_prof_json := jsonb_build_object('id', pr.id, 'name', pr.name, 'is_admin', pr.role::text = 'admin' and v_acting is null,
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
    'requester', jsonb_build_object('contact_name', c.name, 'link_status', c.link_status, 'profile', v_prof_json, 'acting_for', v_acting),
    'courts', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'type', x.type::text) order by x.name), '[]'::jsonb)
               from public.courts x where coalesce(x.is_active, true)),
    'my_reservations', case when v_prof_id is null then '[]'::jsonb else conv_private.ai_my_reservations(v_prof_id) end,
    'open_proposal', (select jsonb_build_object('id', bp.id, 'action', bp.action, 'payload', bp.payload, 'expires_at', bp.expires_at)
                      from public.conv_booking_proposals bp where bp.session_id = p_session and bp.status = 'open' and bp.expires_at > now()
                      order by bp.created_at desc limit 1),
    'transcript', v_transcript, 'older_messages', v_older, 'prior_summary', v_prior,
    'agenda', conv_private.ai_agenda(v_prof_id));
end $function$;

CREATE OR REPLACE FUNCTION conv_private.ai_propose(p_session uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sess public.conv_ai_sessions%rowtype; c public.conv_contacts%rowtype; s public.conv_ai_settings%rowtype;
  v_action text := coalesce(p->>'action', 'create'); v_in jsonb; v_val jsonb; v_old public.reservations%rowtype;
  v_payload jsonb; v_id uuid; v_req uuid; v_is_admin boolean; v_party uuid[];
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  select * into c from public.conv_contacts where id = sess.requester_contact_id;
  v_req := conv_private.acting_profile_id(c.id);
  if v_req is null then
    return conv_private.vfail('REQUESTER_NOT_IDENTIFIED', 'Não consegui identificar seu cadastro de sócio por este telefone.');
  end if;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  -- O assessor age como o professor, mas nunca herda poder de administrador.
  select p2.role::text = 'admin' and conv_private.contact_delegation(c.id) is null into v_is_admin from public.profiles p2 where p2.id = v_req;
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
end $function$;


-- O assessor do Prof. Diego Memória ("João (Assessor Memória)", 55 88 99310-8230). Só onde o contato e o professor existem.
insert into public.conv_contact_delegates (contact_id, principal_profile_id, note)
select c.id, pf.user_id, 'Assessor do Prof. Diego Memória (agente de IA)'
from public.conv_contacts c
join public.professors pf on pf.name = 'Diego Memória' and coalesce(pf.is_active, true) and pf.user_id is not null
where c.phone = '558893108230' and c.merged_into is null
on conflict (contact_id) do nothing;
