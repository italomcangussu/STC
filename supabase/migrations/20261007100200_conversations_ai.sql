-- Conversas e WhatsApp — IA e reserva por conversa (3/4).
--
-- A IA é uma capacidade de Conversas: suas mensagens entram em `conv_messages`
-- (`origin = 'ai'`), na MESMA conversa; não há chat nem histórico próprios.
-- Padrão do North Jato (`ai_attendant`): dois agentes sem ferramentas, o
-- servidor injeta contexto e executa o que o JSON deles pede, e "agendar" só
-- existe por PROPOSTA + CONFIRMAÇÃO explícita.
--
-- O que o STC tem de diferente e esta migration resolve:
--   * a reserva do STC é um INSERT direto feito pelo navegador; as regras vivem
--     em `components/Agenda.tsx`. Aqui elas são ESPELHADAS em
--     `conv_private.validate_reservation` — a IA só grava o que esta função
--     aprova, revalidada dentro da transação de gravação. O conflito de quadra
--     que no app é um aviso ignorável é, para a IA, bloqueio duro;
--   * grupo: a IA só entra por menção DIRETA verificada (sessão por
--     grupo+solicitante com prazo), e vê só as mensagens do solicitante.
--
-- A IA nunca altera pagamento, comprovante, placar ou resultado: nenhuma função
-- daqui toca `fin_*`, `student_payments` nem `matches`.

-- ------------------------------------------------------------------
-- 1. Configuração (versionada: cada decisão guarda a versão que a produziu)
-- ------------------------------------------------------------------
create table public.conv_ai_settings (
  version integer primary key check (version > 0),
  active boolean not null default false,
  persona_name text not null default 'Assistente do STC' check (length(trim(persona_name)) between 1 and 40),
  -- Vazio = nenhum modelo escolhido: a IA não responde (transfere) até alguém configurar.
  model text not null default '' check (length(model) <= 120),
  instructions text not null default '' check (length(instructions) <= 6000),
  business_context text not null default '' check (length(business_context) <= 6000),
  buffer_seconds integer not null default 6 check (buffer_seconds between 0 and 60),
  max_turns integer not null default 12 check (max_turns between 1 and 100),
  handoff_keywords text[] not null default array['atendente','humano','pessoa','falar com alguém','reclamação','reclamar'],
  -- Teto de custo: turnos de IA por dia (todas as conversas). Estourou = transfere.
  daily_turn_budget integer not null default 300 check (daily_turn_budget between 1 and 5000),
  proposal_ttl_minutes integer not null default 20 check (proposal_ttl_minutes between 2 and 120),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint conv_ai_active_needs_model check (not active or length(trim(model)) > 0)
);
insert into public.conv_ai_settings(version, active) values (1, false);

-- ------------------------------------------------------------------
-- 2. Sessões (uma por conversa direta ou por grupo+solicitante), propostas, decisões
-- ------------------------------------------------------------------
create table public.conv_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conv_conversations(id),
  requester_contact_id uuid not null references public.conv_contacts(id),
  trigger_message_id uuid references public.conv_messages(id),
  status text not null default 'open' check (status in ('open', 'done', 'expired', 'handoff')),
  -- A última fala da IA espera resposta (pergunta ou proposta): só então a
  -- mensagem seguinte do MESMO solicitante, sem menção, continua o atendimento.
  awaiting boolean not null default false,
  memory jsonb not null default '{}'::jsonb,
  turns integer not null default 0,
  started_at timestamptz not null default now(),
  last_turn_at timestamptz,
  expires_at timestamptz not null
);
create unique index conv_ai_sessions_one_open on public.conv_ai_sessions(conversation_id, requester_contact_id) where status = 'open';
create index conv_ai_sessions_conversation_idx on public.conv_ai_sessions(conversation_id, status);
alter table public.conv_messages add constraint conv_messages_ai_session_fk
  foreign key (ai_session_id) references public.conv_ai_sessions(id);

-- Proposta de reserva/cancelamento/remarcação. A confirmação do solicitante é a
-- prova; `request_key` único + `reservation_id` gravado na mesma transação
-- impedem reserva em dobro (webhook repetido, retry, "sim" duplicado).
create table public.conv_booking_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conv_conversations(id),
  session_id uuid not null references public.conv_ai_sessions(id),
  requester_contact_id uuid not null references public.conv_contacts(id),
  requester_profile_id uuid not null references public.profiles(id),
  action text not null default 'create' check (action in ('create', 'cancel', 'reschedule')),
  payload jsonb not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'failed', 'expired', 'canceled')),
  request_key uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null,
  confirmed_message_id uuid references public.conv_messages(id),
  confirmed_by_contact_id uuid references public.conv_contacts(id),
  confirmed_at timestamptz,
  reservation_id uuid references public.reservations(id) on delete set null,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint conv_proposal_confirmed_consistent check (status <> 'confirmed' or confirmed_at is not null)
);
create unique index conv_proposals_one_open on public.conv_booking_proposals(session_id) where status = 'open';
create index conv_proposals_conversation_idx on public.conv_booking_proposals(conversation_id, created_at desc);
create unique index conv_proposals_reservation_uidx on public.conv_booking_proposals(reservation_id) where reservation_id is not null and action <> 'cancel';

create table public.conv_ai_decisions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conv_conversations(id),
  session_id uuid references public.conv_ai_sessions(id),
  settings_version integer references public.conv_ai_settings(version),
  decision text not null check (length(decision) <= 60),
  tool_name text check (tool_name is null or length(tool_name) <= 60),
  -- Resultado da ferramenta sem dado pessoal (ids, códigos, contagens).
  tool_result jsonb,
  created_at timestamptz not null default now()
);
create index conv_ai_decisions_day_idx on public.conv_ai_decisions(created_at desc);
create index conv_ai_decisions_conversation_idx on public.conv_ai_decisions(conversation_id, created_at desc);

do $rls$
declare t text;
begin
  foreach t in array array['conv_ai_settings', 'conv_ai_sessions', 'conv_booking_proposals', 'conv_ai_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$rls$;

-- ------------------------------------------------------------------
-- 3. Texto de confirmação (autoridade no servidor)
-- ------------------------------------------------------------------
-- "Sim" inequívoco: só vocabulário de aceitação, sem pergunta, negação ou
-- pedido de mudança. Qualquer palavra fora da lista = não é confirmação.
create function conv_private.is_confirmation(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare t text; w text; n integer := 0; v_ok boolean := false;
  allowed text[] := array['sim','pode','ser','confirmar','confirmo','confirmado','confirma','marcar','reservar','marca','reserva','fechado',
    'isso','mesmo','ok','okay','perfeito','certo','combinado','beleza','claro','positivo','por','favor','pf','pfv','obrigado','obrigada',
    'valeu','vamos','bora','la','esse','essa','horario','quadra','e','a','o','s','uhum','aham','exato','exatamente'];
  yes_first text[] := array['sim','pode','confirmo','confirmado','confirma','fechado','isso','ok','okay','perfeito','certo','combinado',
    'beleza','claro','positivo','s','uhum','aham','exato','exatamente','marca','reserva','vamos','bora'];
begin
  if p is null or length(p) > 80 or position('?' in p) > 0 then return false; end if;
  t := conv_private.fold(p);
  t := replace(t, '👍', ' sim ');
  t := regexp_replace(t, '[^a-z ]', ' ', 'g');
  for w in select x from regexp_split_to_table(btrim(t), '\s+') x where x <> '' loop
    n := n + 1;
    if n > 8 or not (w = any (allowed)) then return false; end if;
    if n = 1 then v_ok := w = any (yes_first); end if;
  end loop;
  return n > 0 and v_ok;
end $$;

-- ------------------------------------------------------------------
-- 4. Regras de reserva (espelho de components/Agenda.tsx) e disponibilidade
-- ------------------------------------------------------------------
create function conv_private.hhmm_to_min(p text) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if p !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  return substr(p, 1, 2)::int * 60 + substr(p, 4, 2)::int;
end $$;

create function conv_private.min_to_hhmm(p integer) returns text
language sql immutable set search_path = '' as $$
  select lpad((p / 60)::text, 2, '0') || ':' || lpad((p % 60)::text, 2, '0') $$;

-- Há reserva ativa que se sobrepõe na mesma quadra? (fim 00:00 = 24:00)
create function conv_private.court_busy(p_court uuid, p_date date, p_start_min integer, p_end_min integer, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.reservations r
    where r.court_id = p_court and r.date = p_date and r.status::text <> 'cancelled'
      and (p_exclude is null or r.id <> p_exclude)
      and (extract(hour from r.start_time)::int * 60 + extract(minute from r.start_time)::int) < p_end_min
      and (case when r.end_time = time '00:00' then 1440
                else extract(hour from r.end_time)::int * 60 + extract(minute from r.end_time)::int end) > p_start_min);
$$;

-- Horários de início livres para uma duração (grade de 30 min, 05:00–22:30, fim ≤ 23:00).
create function conv_private.available_slots(p_date date, p_court uuid, p_duration integer) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_now timestamp := now() at time zone 'America/Fortaleza'; m integer; v_out text[] := '{}';
begin
  if p_date is null or p_date < v_now::date or p_duration not in (30, 60, 90, 120) then return v_out; end if;
  for m in select g from generate_series(300, 1350, 30) g loop
    continue when m + p_duration > 1380;
    continue when p_date = v_now::date and m <= extract(hour from v_now)::int * 60 + extract(minute from v_now)::int;
    continue when conv_private.court_busy(p_court, p_date, m, m + p_duration);
    v_out := v_out || conv_private.min_to_hhmm(m);
  end loop;
  return v_out;
end $$;

create function conv_private.vfail(p_code text, p_message text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) $$;

-- Valida e normaliza um pedido de reserva. Não grava nada.
-- Entrada: type (Play|Aula), date, start (HH:MM), duration, court_id,
-- requester_profile_id, participant_ids[], guest_name, professor_id (Aula),
-- non_socio_student_ids[] (Aula), exclude_reservation_id (remarcação).
create function conv_private.validate_reservation(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text := p->>'type'; v_date date; v_smin integer; v_dur integer; v_emin integer;
  v_court public.courts%rowtype; v_req public.profiles%rowtype;
  v_parts uuid[]; v_students uuid[]; v_guest text := nullif(trim(coalesce(p->>'guest_name', '')), '');
  v_prof uuid := nullif(p->>'professor_id', '')::uuid; v_ex uuid := nullif(p->>'exclude_reservation_id', '')::uuid;
  v_now timestamp := now() at time zone 'America/Fortaleza'; v_n integer; v_bad text; v_s record; v_socio_count integer;
  v_restrict boolean := false; v_student_status text;
begin
  select * into v_req from public.profiles where id = nullif(p->>'requester_profile_id', '')::uuid;
  if not found or coalesce(v_req.is_active, true) = false or v_req.role::text not in ('socio', 'admin') then
    return conv_private.vfail('REQUESTER_NOT_MEMBER', 'Só sócios ativos podem fazer reservas por aqui.');
  end if;
  if v_type not in ('Play', 'Aula') then return conv_private.vfail('INVALID_TYPE', 'Tipo de reserva inválido.'); end if;

  begin v_date := (p->>'date')::date; exception when others then return conv_private.vfail('INVALID_DATE', 'Data inválida.'); end;
  v_smin := conv_private.hhmm_to_min(p->>'start');
  begin v_dur := nullif(p->>'duration', '')::integer; exception when others then v_dur := null; end;
  if v_date is null then return conv_private.vfail('INVALID_DATE', 'Data inválida.'); end if;
  if v_smin is null or v_smin < 300 or v_smin > 1350 or v_smin % 30 <> 0 then
    return conv_private.vfail('INVALID_START', 'O horário de início precisa ser entre 05:00 e 22:30, de 30 em 30 minutos.');
  end if;
  if v_type = 'Play' and (v_dur is null or v_dur not in (60, 90, 120)) then return conv_private.vfail('INVALID_DURATION', 'Reserva de Play tem 60, 90 ou 120 minutos.'); end if;
  if v_type = 'Aula' and v_dur is distinct from 30 then return conv_private.vfail('INVALID_DURATION', 'Aula tem 30 minutos.'); end if;
  v_emin := v_smin + v_dur;
  if v_emin > 1380 then return conv_private.vfail('AFTER_CLOSING', 'A reserva terminaria depois das 23:00, quando o clube fecha.'); end if;
  if v_date < v_now::date or (v_date = v_now::date and v_smin <= extract(hour from v_now)::int * 60 + extract(minute from v_now)::int) then
    return conv_private.vfail('IN_PAST', 'Esse horário já passou.');
  end if;

  select * into v_court from public.courts where id = nullif(p->>'court_id', '')::uuid and coalesce(is_active, true);
  if not found then return conv_private.vfail('COURT_NOT_FOUND', 'Quadra não encontrada ou inativa.'); end if;
  if v_type = 'Aula' and conv_private.fold(v_court.type::text) not like 'r%pida' then
    return conv_private.vfail('AULA_ONLY_FAST_COURT', 'Aulas são permitidas apenas na Quadra Rápida.');
  end if;

  select coalesce(array_agg(distinct x::uuid), '{}') into v_parts from jsonb_array_elements_text(coalesce(p->'participant_ids', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_students from jsonb_array_elements_text(coalesce(p->'non_socio_student_ids', '[]'::jsonb)) x;

  if v_type = 'Play' then
    -- Quem pede participa (o app já começa com o usuário na lista).
    if not (v_req.id = any (v_parts)) then v_parts := v_parts || v_req.id; end if;
    if v_guest is not null and length(v_guest) not between 2 and 80 then return conv_private.vfail('INVALID_GUEST', 'Informe o nome do convidado.'); end if;
    v_n := cardinality(v_parts);
    if v_guest is not null then v_n := v_n + 1; end if;
    if v_n > 8 then
      return conv_private.vfail('TOO_MANY_PARTICIPANTS', 'Uma reserva tem no máximo 8 participantes.');
    end if;
    v_students := '{}';
  else
    v_guest := null;
    if v_req.role::text <> 'admin' and not exists (select 1 from public.professors pr where pr.user_id = v_req.id and coalesce(pr.is_active, true)) then
      return conv_private.vfail('NOT_ALLOWED_AULA', 'Só administrador ou professor marca aula.');
    end if;
    if v_req.role::text <> 'admin' then
      select pr.id into v_prof from public.professors pr where pr.user_id = v_req.id and coalesce(pr.is_active, true) limit 1;
    elsif v_prof is null or not exists (select 1 from public.professors pr where pr.id = v_prof and coalesce(pr.is_active, true)) then
      return conv_private.vfail('PROFESSOR_REQUIRED', 'Informe o professor da aula.');
    end if;
    if cardinality(v_parts) + cardinality(v_students) = 0 then return conv_private.vfail('STUDENT_REQUIRED', 'Informe ao menos um aluno.'); end if;
    if cardinality(v_parts) + cardinality(v_students) > 8 then return conv_private.vfail('TOO_MANY_PARTICIPANTS', 'Uma reserva tem no máximo 8 participantes.'); end if;
  end if;

  -- Sócios: cadastro ativo.
  select count(*) into v_n from public.profiles where id = any (v_parts) and coalesce(is_active, true) and role::text in ('socio', 'admin');
  if v_n <> cardinality(v_parts) then return conv_private.vfail('PARTICIPANT_NOT_MEMBER', 'Algum participante não é sócio ativo.'); end if;

  if v_type = 'Aula' then
    -- Aluno sócio pausado/encerrado bloqueia.
    select p2.name into v_bad from public.student_profiles sp join public.profiles p2 on p2.id = sp.profile_id
      where sp.profile_id = any (v_parts) and sp.student_status <> 'active' limit 1;
    if v_bad is not null then return conv_private.vfail('STUDENT_PAUSED', v_bad || ' está pausado. Reative o aluno antes de marcar a aula.'); end if;
    -- Não-sócios e dependentes.
    select count(*) into v_n from public.non_socio_students where id = any (v_students);
    if v_n <> cardinality(v_students) then return conv_private.vfail('STUDENT_NOT_FOUND', 'Aluno não encontrado.'); end if;
    for v_s in select s.* from public.non_socio_students s where s.id = any (v_students) loop
      select sp.student_status into v_student_status from public.student_profiles sp where sp.non_socio_student_id = v_s.id;
      v_student_status := coalesce(v_student_status, case when coalesce(v_s.is_active, true) then 'active' else 'paused' end);
      if v_student_status <> 'active' or coalesce(v_s.is_active, true) = false then
        return conv_private.vfail('STUDENT_PAUSED', v_s.name || ' está pausado. Reative o aluno antes de marcar a aula.');
      end if;
      if coalesce(v_s.student_type, 'regular') = 'dependent' then continue; end if;
      -- A conversão do Day Card Experimental na 2ª aula é regra do app: não replicamos aqui.
      if v_s.plan_type = 'Day Card Experimental' then
        return conv_private.vfail('NEEDS_HUMAN', v_s.name || ' tem Day Card Experimental; a equipe precisa conferir antes.');
      end if;
      if coalesce(v_s.plan_status, 'inactive') <> 'active' then
        return conv_private.vfail('CARD_INVALID', v_s.name || ' está sem pagamento válido do clube para esta aula.');
      end if;
      if v_s.plan_type = 'Card Mensal' and (v_s.master_expiration_date is null or v_s.master_expiration_date < v_date) then
        return conv_private.vfail('CARD_INVALID', 'O Card Mensal de ' || v_s.name || ' está vencido.');
      end if;
    end loop;
    -- Só não-sócios/dependentes: manhã (5h–12h) ou noite (20h+), exceto domingo.
    v_socio_count := cardinality(v_parts);
    v_restrict := v_socio_count = 0 and cardinality(v_students) > 0 and extract(dow from v_date) <> 0;
    if v_restrict and not (v_smin < 720 or v_smin >= 1200) then
      return conv_private.vfail('NON_MEMBER_HOURS', 'Aula só com não-sócios ou dependentes: de manhã (5h–12h) ou à noite (20h+).');
    end if;
  end if;

  if conv_private.court_busy(v_court.id, v_date, v_smin, v_emin, v_ex) then
    return conv_private.vfail('SLOT_TAKEN', 'Esse horário já está reservado nessa quadra.');
  end if;

  return jsonb_build_object('ok', true, 'normalized', jsonb_build_object(
    'type', v_type, 'date', v_date, 'start', conv_private.min_to_hhmm(v_smin), 'end', conv_private.min_to_hhmm(v_emin),
    'duration', v_dur, 'court_id', v_court.id, 'court_name', v_court.name, 'court_type', v_court.type::text,
    'requester_profile_id', v_req.id, 'participant_ids', to_jsonb(v_parts), 'guest_name', v_guest,
    'professor_id', v_prof, 'non_socio_student_ids', to_jsonb(v_students), 'exclude_reservation_id', v_ex));
end $$;

-- ------------------------------------------------------------------
-- 5. Consultas da IA (só leitura, mínimo necessário)
-- ------------------------------------------------------------------
-- Quadras ativas que casam com "saibro", "rápida" ou o nome da quadra.
create function conv_private.ai_find_courts(p_label text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type::text) order by c.name), '[]'::jsonb)
  from public.courts c
  where coalesce(c.is_active, true)
    and (nullif(trim(coalesce(p_label, '')), '') is null
         or conv_private.fold(c.type::text) like '%' || conv_private.fold(replace(trim(p_label), 'á', 'a')) || '%'
         or conv_private.fold(c.name) like '%' || conv_private.fold(trim(p_label)) || '%') $$;

-- Quem é essa pessoa no cadastro? Nunca escolhe por aproximação: devolve
-- único / ambíguo / nenhum, só com nome e rótulo (sem telefone nem e-mail).
-- `p_scope`: member (sócio ativo) | student (aluno ativo: sócio com perfil de aluno ou não-sócio) | professor.
create function conv_private.ai_resolve_people(p_names text[], p_scope text default 'member') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb := '[]'::jsonb; v_name text; v_q text; v_match jsonb; v_n integer;
begin
  if p_scope not in ('member', 'student', 'professor') then raise exception 'INVALID_SCOPE'; end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_q := conv_private.fold(trim(v_name));
    continue when length(v_q) < 2;
    with pool as (
      select p.id, p.name::text as name, 'member'::text as kind, p.category::text as hint, 'member'::text as sc
        from public.profiles p where coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select p.id, p.name::text, 'socio', p.category::text, 'student'
        from public.profiles p join public.student_profiles sp on sp.profile_id = p.id
        where sp.student_status = 'active' and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select s.id, s.name::text, 'non_socio', s.plan_type::text, 'student'
        from public.non_socio_students s where coalesce(s.is_active, true)
      union all
      select pf.id, pf.name::text, 'professor', null, 'professor' from public.professors pf where coalesce(pf.is_active, true)
    ), exact as (
      select * from pool where sc = p_scope and conv_private.fold(name) = v_q order by name limit 6
    ), partial as (
      select * from pool where sc = p_scope
        and not exists (select 1 from regexp_split_to_table(v_q, '\s+') w where w <> '' and conv_private.fold(name) not like '%' || w || '%')
      order by name limit 6
    ), chosen as (
      select * from exact union all select * from partial where not exists (select 1 from exact)
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'hint', c.hint) order by c.name), '[]'::jsonb), count(*)
      into v_match, v_n from chosen c;
    v_out := v_out || jsonb_build_array(jsonb_build_object('query', v_name,
      'status', case when v_n = 1 then 'unique' when v_n = 0 then 'none' else 'ambiguous' end, 'matches', v_match));
  end loop;
  return v_out;
end $$;

-- A pessoa desistiu da proposta aberta ("não", "deixa pra lá").
create function conv_private.ai_cancel_proposal(p_session uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open' $$;

-- Reservas futuras do solicitante (para consultar, cancelar ou remarcar).
create function conv_private.ai_my_reservations(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'type', r.type, 'date', r.date,
    'start', to_char(r.start_time, 'HH24:MI'), 'end', to_char(r.end_time, 'HH24:MI'), 'court', c.name,
    'is_creator', r.creator_id = p_profile) order by r.date, r.start_time), '[]'::jsonb)
  from (select * from public.reservations x
        where x.status::text = 'active' and x.type in ('Play', 'Aula')
          and (x.creator_id = p_profile or p_profile = any (coalesce(x.participant_ids, '{}')))
          and (x.date > conv_private.today() or (x.date = conv_private.today() and x.end_time > (now() at time zone 'America/Fortaleza')::time))
        order by x.date, x.start_time limit 6) r
  left join public.courts c on c.id = r.court_id $$;

-- ------------------------------------------------------------------
-- 6. Gatilho da IA: quando uma mensagem merece o modelo
-- ------------------------------------------------------------------
create function conv_private.ai_active_settings() returns public.conv_ai_settings
language sql stable security definer set search_path = '' as $$
  select s from public.conv_ai_settings s where s.active order by s.version desc limit 1 $$;

-- Decide, SEM chamar o modelo, se esta mensagem de entrada inicia ou continua
-- um atendimento. Grupo só com: IA de grupo ligada, menção verificada, grupo com
-- IA, e (a) menção DIRETA, (b) resposta do mesmo solicitante a uma pergunta da IA
-- ainda aberta, ou (c) resposta (citando a mensagem da IA) de administrador.
create function conv_private.ai_trigger(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.conv_messages%rowtype; cv public.conv_conversations%rowtype; ch public.conv_channel%rowtype;
  s public.conv_ai_settings%rowtype; g public.conv_groups%rowtype; v_sess public.conv_ai_sessions%rowtype;
  v_reason text; v_admin boolean := false; v_ai_msg public.conv_messages%rowtype; v_requester uuid; v_budget integer;
begin
  select * into m from public.conv_messages where id = p_message and direction = 'inbound';
  if not found then return jsonb_build_object('run', false, 'reason', 'not_inbound'); end if;
  select * into cv from public.conv_conversations where id = m.conversation_id;
  if cv.status <> 'open' then return jsonb_build_object('run', false, 'reason', 'conversation_closed'); end if;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  if not found then return jsonb_build_object('run', false, 'reason', 'ai_inactive'); end if;
  select * into ch from public.conv_channel where id;
  if cv.ai_status <> 'ai' then return jsonb_build_object('run', false, 'reason', 'not_ai_conversation'); end if;
  -- Pedido de descadastro não é conversa com a IA.
  if cv.kind = 'direct' and m.kind = 'text' and conv_private.is_opt_out(m.body) then return jsonb_build_object('run', false, 'reason', 'opt_out'); end if;
  select count(*) into v_budget from public.conv_ai_decisions where created_at >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
  if v_budget >= s.daily_turn_budget then return jsonb_build_object('run', false, 'reason', 'budget_exhausted'); end if;

  if cv.kind = 'direct' then
    if not ch.ai_direct_enabled then return jsonb_build_object('run', false, 'reason', 'direct_ai_off'); end if;
    v_requester := cv.contact_id; v_reason := 'direct_message';
    select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester and status = 'open' for update;
    if found and v_sess.expires_at <= now() then
      update public.conv_ai_sessions set status = 'expired' where id = v_sess.id;
      v_sess := null;
    end if;
    if v_sess.id is null then
      insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
      values (cv.id, v_requester, m.id, now() + interval '24 hours') returning * into v_sess;
    else
      update public.conv_ai_sessions set expires_at = now() + interval '24 hours' where id = v_sess.id;
    end if;
  else
    select * into g from public.conv_groups where id = cv.group_id;
    if not (ch.ai_group_enabled and ch.mention_verified_at is not null and g.ai_enabled and g.status = 'allowed') then
      return jsonb_build_object('run', false, 'reason', 'group_ai_off');
    end if;
    if m.sender_contact_id is null then return jsonb_build_object('run', false, 'reason', 'no_sender'); end if;
    v_requester := m.sender_contact_id;
    if m.mention_direct then
      v_reason := 'direct_mention';
      select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester and status = 'open' for update;
      if found and v_sess.expires_at <= now() then
        update public.conv_ai_sessions set status = 'expired' where id = v_sess.id; v_sess := null;
      end if;
      if v_sess.id is null then
        insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
        values (cv.id, v_requester, m.id, now() + make_interval(mins => ch.group_session_minutes)) returning * into v_sess;
      else
        update public.conv_ai_sessions set expires_at = now() + make_interval(mins => ch.group_session_minutes) where id = v_sess.id;
      end if;
    else
      -- (b) continuação: mesmo solicitante, sessão aberta, a IA estava esperando resposta.
      select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester
        and status = 'open' and awaiting and expires_at > now() for update;
      if found then
        v_reason := 'session_followup';
        update public.conv_ai_sessions set expires_at = now() + make_interval(mins => ch.group_session_minutes) where id = v_sess.id;
      else
        -- (b') rajada: o solicitante manda o pedido em duas mensagens seguidas (a 2ª sem menção) antes de a IA falar.
        select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester
          and status = 'open' and turns = 0 and started_at > now() - interval '90 seconds' and expires_at > now() for update;
        if found then v_reason := 'burst'; end if;
      end if;
      if v_reason is not null then
        null;   -- continuação já decidida acima
      elsif m.reply_to_provider_id is not null then
        -- (c) resposta citando uma fala da IA de sessão aberta.
        select * into v_ai_msg from public.conv_messages where provider_message_id = m.reply_to_provider_id and origin = 'ai'
          and conversation_id = cv.id and ai_session_id is not null;
        if not found then return jsonb_build_object('run', false, 'reason', 'no_trigger'); end if;
        select * into v_sess from public.conv_ai_sessions where id = v_ai_msg.ai_session_id and status = 'open' and expires_at > now() for update;
        if not found then return jsonb_build_object('run', false, 'reason', 'session_closed'); end if;
        select exists (select 1 from public.conv_contacts c join public.profiles p on p.id = c.profile_id
          where c.id = v_requester and p.role::text = 'admin' and c.link_status in ('linked', 'manual')) into v_admin;
        if v_sess.requester_contact_id <> v_requester and not v_admin then
          return jsonb_build_object('run', false, 'reason', 'other_sender');
        end if;
        v_reason := 'reply_to_ai';
      else
        return jsonb_build_object('run', false, 'reason', 'no_trigger');
      end if;
    end if;
  end if;

  update public.conv_messages set ai_session_id = v_sess.id where id = m.id;
  return jsonb_build_object('run', true, 'reason', v_reason, 'session_id', v_sess.id, 'conversation_id', cv.id,
    'sender_contact_id', m.sender_contact_id, 'is_group', cv.kind = 'group', 'acting_admin', v_admin);
end $$;

-- A mensagem ainda é a última do solicitante? (só a última responde; as anteriores
-- que chegaram durante o buffer são lidas juntas.)
create function conv_private.ai_is_latest(p_message uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.conv_messages m join public.conv_messages n on n.conversation_id = m.conversation_id
    where m.id = p_message and n.direction = 'inbound' and n.created_at > m.created_at
      and n.sender_contact_id is not distinct from m.sender_contact_id)
  and exists (select 1 from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
              where m.id = p_message and cv.status = 'open' and cv.ai_status = 'ai') $$;

-- Contexto do turno. Em grupo: SÓ o solicitante e a IA, nesta sessão (nada dos
-- outros participantes). Sem telefone, e-mail, CPF nem dados financeiros.
create function conv_private.ai_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; cv public.conv_conversations%rowtype; c public.conv_contacts%rowtype;
  pr public.profiles%rowtype; s public.conv_ai_settings%rowtype; ch public.conv_channel%rowtype; v_transcript jsonb;
  v_prof_json jsonb := null; v_prof_id uuid; v_since timestamptz;
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

  if cv.kind = 'group' then
    select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb) into v_transcript from (
      select m.id, m.created_at, m.direction, m.origin, m.kind, left(coalesce(m.body, ''), 1000) as body
      from public.conv_messages m where m.ai_session_id = p_session and m.deleted_at is null
      order by m.created_at desc limit 30) t;
  else
    select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb) into v_transcript from (
      select m.id, m.created_at, m.direction, m.origin, m.kind, left(coalesce(m.body, ''), 1000) as body
      from public.conv_messages m where m.conversation_id = cv.id and m.deleted_at is null and m.created_at > v_since
      order by m.created_at desc limit 30) t;
  end if;

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
    'transcript', v_transcript);
end $$;

-- ------------------------------------------------------------------
-- 7. Proposta e confirmação de reserva
-- ------------------------------------------------------------------
-- Cria uma proposta (create | cancel | reschedule) DEPOIS de validar tudo.
-- `p`: action, e os campos de `validate_reservation`; para cancel/reschedule,
-- `reservation_id`.
create function conv_private.ai_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; c public.conv_contacts%rowtype; s public.conv_ai_settings%rowtype;
  v_action text := coalesce(p->>'action', 'create'); v_in jsonb; v_val jsonb; v_old public.reservations%rowtype;
  v_payload jsonb; v_id uuid; v_req uuid; v_is_admin boolean;
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
  if v_action not in ('create', 'cancel', 'reschedule') then return conv_private.vfail('INVALID_ACTION', 'Ação inválida.'); end if;

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

-- Confirmação: prova = mensagem inequívoca do solicitante (ou de um administrador)
-- DEPOIS da proposta. Revalida tudo dentro da transação de gravação, com trava
-- por quadra+dia (dois pedidos simultâneos não ocupam o mesmo horário). Idempotente.
create function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; sender_admin boolean := false;
  v_val jsonb; n jsonb; v_res uuid; v_old public.reservations%rowtype; v_in jsonb; v_student_type text; v_obs text;
  v_socio uuid[]; v_students uuid[]; v_court uuid; v_date date; v_conv public.conv_conversations%rowtype;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found then return conv_private.vfail('PROPOSAL_NOT_FOUND', 'Proposta não encontrada.'); end if;
  if bp.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'replayed', true, 'reservation_id', bp.reservation_id, 'action', bp.action, 'summary', bp.payload);
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

-- ------------------------------------------------------------------
-- 8. Fechamento do turno, transferência, estado da sessão
-- ------------------------------------------------------------------
-- Fecha o turno: memória nova, contador, decisão registrada.
create function conv_private.ai_save_turn(p_session uuid, p_memory jsonb, p_decision text, p_payload jsonb, p_awaiting boolean, p_close boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_conv uuid;
begin
  select version into v_version from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_ai_sessions set memory = coalesce(p_memory, memory), turns = turns + 1, last_turn_at = now(),
    awaiting = coalesce(p_awaiting, false) and not coalesce(p_close, false),
    status = case when coalesce(p_close, false) then 'done' else status end
  where id = p_session returning conversation_id into v_conv;
  if v_conv is null then raise exception 'SESSION_NOT_FOUND'; end if;
  update public.conv_conversations set ai_turns = ai_turns + 1, ai_last_turn_at = now() where id = v_conv;
  if v_version is not null then
    insert into public.conv_ai_decisions(conversation_id, session_id, settings_version, decision, tool_name, tool_result)
    values (v_conv, p_session, v_version, left(coalesce(p_decision, 'reply'), 60), left(p_payload->>'action', 60), p_payload);
  end if;
end $$;

-- Transferência para a equipe. Em conversa direta, `hard` entrega a conversa ao
-- humano. Em grupo, só a sessão fecha e a conversa fica marcada para a equipe:
-- a IA do grupo inteiro não é desligada por causa de um pedido.
create function conv_private.ai_handoff(p_session uuid, p_kind text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; cv public.conv_conversations%rowtype;
begin
  if p_kind not in ('soft', 'hard') then raise exception 'INVALID_HANDOFF'; end if;
  select * into sess from public.conv_ai_sessions where id = p_session for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select * into cv from public.conv_conversations where id = sess.conversation_id for update;
  update public.conv_conversations set
    ai_status = case when p_kind = 'hard' and kind = 'direct' then 'human' else ai_status end,
    handoff_kind = p_kind, handoff_note = left(p_note, 1000), handoff_at = now(),
    staff_read_at = case when p_kind = 'hard' then least(coalesce(staff_read_at, now()), now() - interval '1 second') else staff_read_at end
  where id = cv.id;
  if p_kind = 'hard' then
    update public.conv_ai_sessions set status = 'handoff', awaiting = false where id = p_session;
    update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  end if;
  perform conv_private.audit('ai_handoff', 'conv_conversations', cv.id::text, null,
    jsonb_build_object('kind', p_kind, 'note', left(coalesce(p_note, ''), 300)), jsonb_build_object('actor', 'ai', 'session_id', p_session));
end $$;

-- Fecha sessões vencidas (chamada pelo dispatch).
create function conv_private.ai_expire_sessions() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.conv_ai_sessions set status = 'expired', awaiting = false where status = 'open' and expires_at <= now();
  get diagnostics v_n = row_count;
  update public.conv_booking_proposals set status = 'expired' where status = 'open' and expires_at <= now();
  return v_n;
end $$;

-- ------------------------------------------------------------------
-- 9. Administrador: configuração da IA
-- ------------------------------------------------------------------
create function public.conv_get_ai_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  return (select to_jsonb(s) - 'created_by' from public.conv_ai_settings s order by s.version desc limit 1);
end $$;

-- Salvar cria uma versão nova: as decisões antigas continuam apontando para a configuração que as produziu.
create function public.conv_save_ai_settings(p_request uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_old public.conv_ai_settings%rowtype; v_version integer; v_model text; v_active boolean;
begin
  perform conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'ai_settings_save');
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.conv_ai_settings order by version desc limit 1 for update;
  v_version := v_old.version + 1;
  v_model := left(coalesce(nullif(trim(p->>'model'), ''), v_old.model), 120);
  v_active := coalesce((p->>'active')::boolean, v_old.active);
  if v_active and length(trim(v_model)) = 0 then raise exception 'AI_MODEL_REQUIRED'; end if;
  update public.conv_ai_settings set active = false where active;
  insert into public.conv_ai_settings(version, active, persona_name, model, instructions, business_context, buffer_seconds, max_turns,
    handoff_keywords, daily_turn_budget, proposal_ttl_minutes, created_by)
  values (v_version, v_active,
    left(coalesce(nullif(trim(p->>'persona_name'), ''), v_old.persona_name), 40), v_model,
    left(coalesce(p->>'instructions', v_old.instructions), 6000), left(coalesce(p->>'business_context', v_old.business_context), 6000),
    least(greatest(coalesce((p->>'buffer_seconds')::int, v_old.buffer_seconds), 0), 60),
    least(greatest(coalesce((p->>'max_turns')::int, v_old.max_turns), 1), 100),
    case when jsonb_typeof(p->'handoff_keywords') = 'array'
      then array(select left(lower(trim(k)), 40) from jsonb_array_elements_text(p->'handoff_keywords') k where length(trim(k)) > 0)
      else v_old.handoff_keywords end,
    least(greatest(coalesce((p->>'daily_turn_budget')::int, v_old.daily_turn_budget), 1), 5000),
    least(greatest(coalesce((p->>'proposal_ttl_minutes')::int, v_old.proposal_ttl_minutes), 2), 120), auth.uid());
  perform conv_private.audit('ai_settings_save', 'conv_ai_settings', v_version::text,
    jsonb_build_object('active', v_old.active, 'model', v_old.model), jsonb_build_object('active', v_active, 'model', v_model),
    jsonb_build_object('actor', 'admin', 'version', v_version));
  return conv_private.finish_op(p_request, jsonb_build_object('version', v_version));
end $$;

-- ------------------------------------------------------------------
-- 10. Invólucros do `service_role` (IA, webhook)
-- ------------------------------------------------------------------
do $wrappers$
declare v record;
begin
  for v in select * from (values
    ('ai_trigger', 'p_message uuid', 'jsonb', 'p_message'),
    ('ai_is_latest', 'p_message uuid', 'boolean', 'p_message'),
    ('ai_context', 'p_session uuid', 'jsonb', 'p_session'),
    ('ai_find_courts', 'p_label text', 'jsonb', 'p_label'),
    ('ai_resolve_people', 'p_names text[], p_scope text', 'jsonb', 'p_names, p_scope'),
    ('ai_cancel_proposal', 'p_session uuid', 'void', 'p_session'),
    ('ai_propose', 'p_session uuid, p jsonb', 'jsonb', 'p_session, p'),
    ('ai_confirm', 'p_proposal uuid, p_message uuid', 'jsonb', 'p_proposal, p_message'),
    ('ai_save_turn', 'p_session uuid, p_memory jsonb, p_decision text, p_payload jsonb, p_awaiting boolean, p_close boolean', 'void',
      'p_session, p_memory, p_decision, p_payload, p_awaiting, p_close'),
    ('ai_handoff', 'p_session uuid, p_kind text, p_note text', 'void', 'p_session, p_kind, p_note'),
    ('ai_expire_sessions', '', 'integer', ''),
    ('available_slots', 'p_date date, p_court uuid, p_duration integer', 'text[]', 'p_date, p_court, p_duration')
  ) as t(nome, args, ret, chamada) loop
    execute format('revoke all on function conv_private.%I(%s) from public, anon, authenticated', v.nome, v.args);
    execute format('create function public.%I(%s) returns %s language sql security definer set search_path = '''' as $f$ select conv_private.%I(%s) $f$',
      'conv_svc_' || v.nome, v.args, v.ret, v.nome, v.chamada);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', 'conv_svc_' || v.nome, v.args);
    execute format('grant execute on function public.%I(%s) to service_role', 'conv_svc_' || v.nome, v.args);
  end loop;
end
$wrappers$;

revoke all on function conv_private.validate_reservation(jsonb), conv_private.court_busy(uuid, date, integer, integer, uuid),
  conv_private.is_confirmation(text), conv_private.ai_my_reservations(uuid), conv_private.ai_active_settings() from public, anon, authenticated;
revoke all on function public.conv_get_ai_settings(), public.conv_save_ai_settings(uuid, jsonb) from public, anon;
grant execute on function public.conv_get_ai_settings(), public.conv_save_ai_settings(uuid, jsonb) to authenticated;

-- Rollback: drop das funções conv_private.ai_*/validate_reservation/court_busy/available_slots/is_confirmation,
-- public.conv_svc_ai_* e conv_get/save_ai_settings; drop da constraint conv_messages_ai_session_fk e das tabelas
-- conv_ai_decisions, conv_booking_proposals, conv_ai_sessions, conv_ai_settings. Reservas já criadas pela IA ficam
-- (são registros operacionais) e continuam rastreáveis por `admin_audit_logs` (source = 'conversations').
