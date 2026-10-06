-- Conversas e WhatsApp — automações (4/4).
--
-- Mensagens programadas ou condicionais que usam o que o STC já sabe:
-- mensalidade (`fin_*`), campeonato (`matches`, `championship_*`) e Card
-- Mensal (`non_socio_students`). Nada é copiado: cada disparo lê a fonte da
-- verdade NO MOMENTO e revalida de novo na hora de enviar.
--
-- Padrões do North Jato (`nj_automation_*`): fila com `for update skip locked`,
-- idempotência (job → mensagem pela chave), revalidação no envio, janela de
-- horário, teto por contato, opt-out, tentativas finitas. O motor de fluxo
-- multi-etapa do NJ (cliente de lava-jato) NÃO foi portado: aqui cada disparo é
-- uma mensagem, por pessoa e finalidade.
--
-- Tipos: scheduled (data/recorrência), conditional (a cada varredura, quem
-- passou a atender a condição), event (evento real e confirmado) e manual
-- (público preparado, REVISADO por um administrador antes de enviar).
--
-- A automação nunca altera cobrança, pagamento, comprovante, placar nem
-- classificação: só lê e envia mensagem.

-- ------------------------------------------------------------------
-- 1. Regras gerais e tabelas
-- ------------------------------------------------------------------
create table public.conv_automation_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  window_start time not null default '08:00',
  window_end time not null default '20:00',
  days integer[] not null default array[1,2,3,4,5,6],
  -- Anti-spam por contato, somando TODAS as automações.
  min_hours_between integer not null default 12 check (min_hours_between between 0 and 720),
  daily_cap integer not null default 2 check (daily_cap between 1 and 10),
  weekly_cap integer not null default 6 check (weekly_cap between 1 and 30),
  opt_out_keywords text[] not null default array['parar','pare','sair','stop','descadastrar','nao quero receber','nao mande mais','remover'],
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint conv_automation_settings_window check (window_start < window_end),
  constraint conv_automation_settings_days check (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6])
);
insert into public.conv_automation_settings(id) values (true);

create table public.conv_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 80),
  description text not null default '' check (length(description) <= 500),
  objective text not null default '' check (length(objective) <= 300),
  source text not null check (source in ('finance_charge', 'championship_notice', 'championship_result',
    'championship_advance', 'card_mensal', 'audience')),
  trigger_type text not null check (trigger_type in ('scheduled', 'conditional', 'event', 'manual')),
  -- Parâmetros do construtor guiado (nada de expressão livre): estágio, dias,
  -- campeonato, público. Validados por `conv_private.automation_problems`.
  definition jsonb not null default '{}'::jsonb,
  -- {"time":"09:00","weekdays":[1,3],"dates":["2026-10-20"],"end_date":"2026-12-31"}
  schedule jsonb not null default '{}'::jsonb,
  message_body text not null default '' check (length(message_body) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  version integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  ended_at timestamptz,
  constraint conv_automation_combo check (
    (source in ('finance_charge', 'card_mensal') and trigger_type in ('scheduled', 'conditional', 'manual'))
    or (source in ('championship_notice', 'audience') and trigger_type in ('scheduled', 'manual'))
    or (source in ('championship_result', 'championship_advance') and trigger_type = 'event'))
);

-- A definição que cada versão seguiu (editar não reescreve o passado).
create table public.conv_automation_versions (
  automation_id uuid not null references public.conv_automations(id),
  version integer not null,
  definition jsonb not null,
  schedule jsonb not null,
  message_body text not null,
  trigger_type text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (automation_id, version)
);

create table public.conv_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.conv_automations(id),
  version integer not null,
  kind text not null check (kind in ('scheduled', 'conditional', 'event', 'manual')),
  -- Agendada: o horário combinado. Condicional/evento: o dia. Manual: o instante.
  planned_for timestamptz not null,
  -- review: público preparado, aguardando aprovação do administrador (manual).
  status text not null default 'running' check (status in ('review', 'running', 'done', 'canceled')),
  created_by uuid references public.profiles(id),
  request_key uuid unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (automation_id, planned_for)
);
create index conv_automation_runs_automation_idx on public.conv_automation_runs(automation_id, created_at desc);

create table public.conv_automation_recipients (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.conv_automation_runs(id),
  automation_id uuid not null references public.conv_automations(id),
  -- Finalidade + chave da pessoa/fato/janela: a mesma pessoa não recebe duas vezes o mesmo aviso,
  -- mesmo que apareça em vários públicos ou em duas automações da mesma finalidade.
  purpose_key text not null,
  dedupe_key text not null,
  profile_id uuid references public.profiles(id),
  student_id uuid references public.non_socio_students(id),
  contact_id uuid references public.conv_contacts(id),
  phone text check (phone is null or phone ~ '^[1-9][0-9]{9,14}$'),
  display_name text check (display_name is null or length(display_name) <= 200),
  -- Fatos que motivaram o envio (ids e valores), não o telefone nem texto livre.
  subject jsonb not null default '{}'::jsonb,
  body text check (body is null or length(body) <= 1000),
  status text not null default 'pending'
    check (status in ('review', 'pending', 'processing', 'sent', 'failed', 'skipped', 'canceled')),
  skip_reason text check (skip_reason is null or length(skip_reason) <= 120),
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  message_id uuid references public.conv_messages(id),
  last_error text check (last_error is null or length(last_error) <= 300),
  created_at timestamptz not null default now()
);
create unique index conv_automation_recipients_dedupe on public.conv_automation_recipients(purpose_key, dedupe_key) where status <> 'canceled';
create index conv_automation_recipients_due_idx on public.conv_automation_recipients(due_at) where status in ('pending', 'processing');
create index conv_automation_recipients_run_idx on public.conv_automation_recipients(run_id, status);
create index conv_automation_recipients_contact_idx on public.conv_automation_recipients(contact_id) where contact_id is not null;
alter table public.conv_messages add constraint conv_messages_recipient_fk
  foreign key (automation_recipient_id) references public.conv_automation_recipients(id);

create function conv_private.immutable_row() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'CONV_IMMUTABLE: % é histórico e não se altera.', tg_table_name using errcode = '42501'; end $$;
create trigger conv_automation_versions_immutable before update or delete on public.conv_automation_versions
  for each row execute function conv_private.immutable_row();
create trigger conv_automations_no_delete before delete on public.conv_automations
  for each row execute function conv_private.no_delete();
create trigger conv_automation_recipients_no_delete before delete on public.conv_automation_recipients
  for each row execute function conv_private.no_delete();

do $rls$
declare t text;
begin
  foreach t in array array['conv_automation_settings', 'conv_automations', 'conv_automation_versions', 'conv_automation_runs',
    'conv_automation_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$rls$;

-- ------------------------------------------------------------------
-- 2. Opt-out e janela de envio
-- ------------------------------------------------------------------
-- "parar", "pare de mandar", "não quero receber mais": mensagem curta que COMEÇA pela
-- palavra-chave. "Posso parar o carro aí?" não é.
create function conv_private.is_opt_out(p_body text) returns boolean
language sql stable set search_path = '' as $$
  with t as (select btrim(regexp_replace(conv_private.fold(coalesce(p_body, '')), '[^a-z0-9 ]', ' ', 'g')) x)
  select exists (
    select 1 from t, public.conv_automation_settings s, unnest(s.opt_out_keywords) k
    where s.id and t.x <> '' and array_length(regexp_split_to_array(t.x, '\s+'), 1) <= 6
      and (t.x = conv_private.fold(k) or t.x like conv_private.fold(k) || ' %')) $$;

-- Mensagem de entrada com pedido de descadastro: marca o contato e cancela o que estava pendente,
-- na mesma transação da gravação.
create function conv_private.on_inbound_opt_out() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid;
begin
  if new.direction <> 'inbound' or new.kind <> 'text' or new.sender_contact_id is null then return new; end if;
  if not exists (select 1 from public.conv_conversations c where c.id = new.conversation_id and c.kind = 'direct') then return new; end if;
  if not conv_private.is_opt_out(new.body) then return new; end if;
  v_contact := new.sender_contact_id;
  update public.conv_contacts set opt_out = true, opt_out_at = now(), updated_at = now() where id = v_contact and not opt_out;
  if found then
    update public.conv_automation_recipients set status = 'canceled', skip_reason = 'OPT_OUT'
      where contact_id = v_contact and status in ('pending', 'review');
    perform conv_private.audit('opt_out', 'conv_contacts', v_contact::text, null, jsonb_build_object('opt_out', true),
      jsonb_build_object('actor', 'system', 'via', 'inbound_message'));
  end if;
  return new;
end $$;
create trigger conv_messages_opt_out after insert on public.conv_messages
  for each row execute function conv_private.on_inbound_opt_out();

-- Próximo instante permitido (dias e janela de horário, fuso de Fortaleza).
create function conv_private.automation_next_allowed(p_at timestamptz) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare s public.conv_automation_settings%rowtype; v_local timestamp; v_day date; i integer;
begin
  select * into s from public.conv_automation_settings where id;
  if not found then return p_at; end if;
  v_local := p_at at time zone 'America/Fortaleza';
  v_day := v_local::date;
  for i in 0..14 loop
    if extract(dow from v_day)::integer = any (s.days) then
      if i = 0 and v_local::time >= s.window_start and v_local::time < s.window_end then return p_at; end if;
      if i > 0 or v_local::time < s.window_start then return (v_day + s.window_start) at time zone 'America/Fortaleza'; end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return p_at;
end $$;

-- Anti-spam: a partir de quando este contato pode receber outra mensagem automática.
create function conv_private.automation_cap_until(p_contact uuid) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare s public.conv_automation_settings%rowtype; v_last timestamptz; v_today integer; v_week integer; v_until timestamptz := '-infinity';
  v_midnight timestamptz; v_edge timestamptz;
begin
  select * into s from public.conv_automation_settings where id;
  select max(m.sent_at) into v_last from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
    where cv.contact_id = p_contact and m.origin = 'automation' and m.status in ('sent', 'delivered', 'read');
  if v_last is null then return null; end if;
  if s.min_hours_between > 0 then v_until := v_last + make_interval(hours => s.min_hours_between); end if;
  v_midnight := date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
  select count(*) filter (where m.sent_at >= v_midnight), count(*) into v_today, v_week
    from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
    where cv.contact_id = p_contact and m.origin = 'automation' and m.status in ('sent', 'delivered', 'read') and m.sent_at > now() - interval '7 days';
  if v_today >= s.daily_cap then v_until := greatest(v_until, v_midnight + interval '1 day'); end if;
  if v_week >= s.weekly_cap then
    select m.sent_at + interval '7 days' into v_edge from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
      where cv.contact_id = p_contact and m.origin = 'automation' and m.status in ('sent', 'delivered', 'read') and m.sent_at > now() - interval '7 days'
      order by m.sent_at desc offset s.weekly_cap - 1 limit 1;
    v_until := greatest(v_until, coalesce(v_edge, now()));
  end if;
  return case when v_until > now() then v_until end;
end $$;

-- ------------------------------------------------------------------
-- 3. Variáveis e mensagem
-- ------------------------------------------------------------------
-- Variáveis permitidas por origem: só as que têm fonte confirmada.
create function conv_private.automation_vars(p_source text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_source
    when 'finance_charge' then array['nome', 'clube', 'competencia', 'vencimento', 'valor', 'total', 'dias_atraso', 'encargos']
    when 'card_mensal' then array['nome', 'clube', 'vencimento', 'dias_para_vencer', 'dias_vencido']
    when 'championship_notice' then array['nome', 'clube', 'campeonato', 'classe']
    when 'championship_result' then array['nome', 'clube', 'campeonato', 'fase', 'adversario', 'placar', 'resultado']
    when 'championship_advance' then array['nome', 'clube', 'campeonato', 'fase', 'adversario']
    when 'audience' then array['nome', 'clube']
    else array[]::text[] end $$;

create function conv_private.template_vars(p_body text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(coalesce(p_body, ''), '\{\{\s*([a-z_]+)\s*\}\}', 'g') m $$;

-- Substitui {{variavel}}. Variável sem valor => devolve NULL (a mensagem não sai):
-- nunca se envia texto financeiro com lacuna ou valor inventado.
create function conv_private.render_template(p_body text, p_ctx jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := coalesce(p_body, ''); k text;
begin
  foreach k in array conv_private.template_vars(p_body) loop
    if nullif(p_ctx->>k, '') is null then return null; end if;
    v := regexp_replace(v, '\{\{\s*' || k || '\s*\}\}', replace(replace(p_ctx->>k, '\', '\\'), '&', '\&'), 'g');
  end loop;
  return btrim(v, E' \t\r\n');
end $$;

create function conv_private.brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || regexp_replace(trunc(abs(p_cents) / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') || ',' || lpad((abs(p_cents) % 100)::text, 2, '0') $$;

create function conv_private.month_pt(p_date date) returns text
language sql immutable set search_path = '' as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_date)::int]
    || '/' || extract(year from p_date)::int $$;

create function conv_private.date_br(p_date date) returns text
language sql immutable set search_path = '' as $$ select to_char(p_date, 'DD/MM/YYYY') $$;

create function conv_private.first_name(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(initcap(split_part(btrim(coalesce(p, '')), ' ', 1)), '') $$;

-- Variáveis de um fato. `p_subject` guarda valores crus (centavos, datas); aqui viram texto.
create function conv_private.automation_ctx(p_source text, p_subject jsonb, p_name text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v jsonb := jsonb_build_object('nome', conv_private.first_name(p_name), 'clube', 'Sobral Tênis Clube'); v_days integer;
begin
  if p_source = 'finance_charge' then
    v := v || jsonb_build_object(
      'competencia', p_subject->>'competence_label',
      'vencimento', conv_private.date_br((p_subject->>'due_date')::date),
      'valor', conv_private.brl((p_subject->>'principal_cents')::bigint),
      'total', conv_private.brl((p_subject->>'total_cents')::bigint),
      'dias_atraso', nullif(p_subject->>'days_late', '0'),
      -- Encargos só existem se o clube configurou e confirmou a política (fin_settings).
      'encargos', case when coalesce((p_subject->>'fees_configured')::boolean, false)
                  then conv_private.brl((p_subject->>'fees_cents')::bigint) end);
  elsif p_source = 'card_mensal' then
    v_days := ((p_subject->>'expiration')::date - conv_private.today());
    v := v || jsonb_build_object('vencimento', conv_private.date_br((p_subject->>'expiration')::date),
      'dias_para_vencer', case when v_days >= 0 then v_days::text end,
      'dias_vencido', case when v_days < 0 then (-v_days)::text end);
  elsif p_source = 'championship_notice' then
    v := v || jsonb_build_object('campeonato', p_subject->>'championship', 'classe', p_subject->>'class');
  elsif p_source = 'championship_result' then
    v := v || jsonb_build_object('campeonato', p_subject->>'championship', 'fase', p_subject->>'phase',
      'adversario', p_subject->>'opponent', 'placar', p_subject->>'score', 'resultado', p_subject->>'outcome');
  elsif p_source = 'championship_advance' then
    v := v || jsonb_build_object('campeonato', p_subject->>'championship', 'fase', p_subject->>'phase',
      'adversario', coalesce(p_subject->>'opponent', 'a definir'));
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------
-- 4. Públicos (a fonte da verdade de cada um)
-- ------------------------------------------------------------------
create type conv_private.audience_row as (
  dedupe_key text, profile_id uuid, student_id uuid, phone text, display_name text, subject jsonb, included boolean, reason text);

-- Mensalidade: estados derivados de `fin_private.charge_rows` (a mesma leitura do financeiro).
-- Estágios: period_start | before_due | overdue | in_review. Uma mensagem por SÓCIO e janela.
create function conv_private.aud_finance(a public.conv_automations, p_as_of date) returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := a.definition; v_stage text := d->>'stage';
  v_days integer := coalesce(nullif(d->>'days', '')::int, case v_stage when 'period_start' then 3 when 'before_due' then 3 else 1 end);
  v_repeat integer := greatest(coalesce(nullif(d->>'repeat_days', '')::int, 7), 1);
  v_excl boolean := coalesce((d->>'exclude_in_review')::boolean, true);
  v_filters jsonb;
begin
  v_filters := case v_stage
    when 'period_start' then jsonb_build_object('competence_from', p_as_of - v_days, 'competence_to', p_as_of)
    when 'before_due' then jsonb_build_object('due_from', p_as_of, 'due_to', p_as_of + v_days)
    when 'overdue' then jsonb_build_object('due_from', p_as_of - 730, 'due_to', p_as_of - 1)
    else jsonb_build_object('competence_from', p_as_of - 730) end;
  return query
  with rows as (
    select r.* from fin_private.charge_rows(null, null, v_filters, p_as_of, 5000, 0) r
    where r.stored_status in ('open', 'partial')
      and case v_stage
        when 'period_start' then r.competence_month <= p_as_of and p_as_of - r.competence_month < v_days
        when 'before_due' then r.due_date >= p_as_of and r.due_date - p_as_of <= v_days
        when 'overdue' then p_as_of > r.due_date and r.days_late >= v_days
        when 'in_review' then r.in_review
        else false end
      and (v_stage = 'in_review' or not r.in_review or not v_excl)
  ), agg as (
    select r.profile_id, max(r.profile_name) as pname, array_agg(r.charge_id order by r.due_date, r.charge_id) as ids,
      sum(r.total_due_cents) as total, sum(r.principal_remaining_cents) as principal, sum(r.fees_due_cents) as fees,
      min(r.due_date) as due, max(r.days_late) as late, bool_and(r.fees_configured) as fees_ok,
      array_agg(distinct r.competence_month order by r.competence_month) as comps, max(r.competence_month) as last_comp
    from rows r group by r.profile_id
  )
  select
    'fin:' || v_stage || ':' || g.profile_id || ':' ||
      case v_stage when 'period_start' then to_char(g.last_comp, 'YYYY-MM')
                   when 'before_due' then g.due::text
                   when 'overdue' then (g.late / v_repeat)::text
                   else md5(array_to_string(g.ids, ',')) end,
    g.profile_id, null::uuid, pr.phone::text, g.pname,
    jsonb_build_object('charge_ids', to_jsonb(g.ids), 'total_cents', g.total, 'principal_cents', g.principal, 'fees_cents', g.fees,
      'fees_configured', g.fees_ok, 'due_date', g.due, 'days_late', g.late,
      'competence_label', (select string_agg(conv_private.month_pt(x), ' e ' order by x) from unnest(g.comps) x)),
    coalesce(pr.is_active, true),
    case when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
  from agg g join public.profiles pr on pr.id = g.profile_id;
end $$;

-- Card Mensal: validade e estado reais do aluno. Dependente e Day Card não têm renovação.
create function conv_private.aud_card(a public.conv_automations, p_as_of date) returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := a.definition; v_before integer := coalesce(nullif(d->>'days_before', '')::int, 7);
  v_after integer := coalesce(nullif(d->>'days_after', '')::int, 0);
begin
  return query
  select 'card:' || s.id || ':' || s.master_expiration_date::text, null::uuid, s.id, s.phone::text, s.name::text,
    jsonb_build_object('student_id', s.id, 'expiration', s.master_expiration_date),
    (coalesce(s.plan_status, 'inactive') = 'active' and coalesce(s.is_active, true)
      and coalesce(sp.student_status, 'active') = 'active' and coalesce(s.student_type, 'regular') = 'regular'
      and s.master_expiration_date between p_as_of - v_after and p_as_of + v_before),
    case when coalesce(s.student_type, 'regular') <> 'regular' then 'DEPENDENTE'
         when coalesce(s.plan_status, 'inactive') <> 'active' then 'CARD_INATIVO_OU_CANCELADO'
         when not coalesce(s.is_active, true) or coalesce(sp.student_status, 'active') <> 'active' then 'ALUNO_PAUSADO_OU_ENCERRADO'
         when s.master_expiration_date < p_as_of - v_after then 'VENCIDO_HA_MUITO_TEMPO'
         when s.master_expiration_date > p_as_of + v_before then 'AINDA_LONGE_DO_VENCIMENTO' end
  from public.non_socio_students s left join public.student_profiles sp on sp.non_socio_student_id = s.id
  where s.plan_type = 'Card Mensal' and s.master_expiration_date is not null;
end $$;

-- Aviso a participantes de um campeonato em andamento, ou público fixo (sócios, alunos…).
create function conv_private.aud_audience(a public.conv_automations, p_as_of date, p_bucket text) returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := a.definition; v_kind text := d->>'audience'; v_champ uuid := nullif(d->>'championship_id', '')::uuid;
  v_status text; v_cname text;
begin
  if a.source = 'championship_notice' then
    select c.status::text, c.name into v_status, v_cname from public.championships c where c.id = v_champ;
    if v_status is null then return; end if;
    return query
    select 'cn:' || p_bucket || ':' || v_champ || ':' || coalesce(r.user_id::text, r.id::text), r.user_id, null::uuid, pr.phone::text,
      coalesce(pr.name, r.guest_name), jsonb_build_object('championship', v_cname, 'class', r.class, 'registration_id', r.id),
      (r.user_id is not null and v_status in ('ongoing', 'active') and coalesce(pr.is_active, true)),
      case when v_status not in ('ongoing', 'active') then 'CAMPEONATO_NAO_ATIVO'
           when r.user_id is null then 'CONVIDADO_SEM_CADASTRO' when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
    from public.championship_registrations r left join public.profiles pr on pr.id = r.user_id
    where r.championship_id = v_champ and (d->'classes' is null or jsonb_array_length(d->'classes') = 0 or d->'classes' ? r.class);
    return;
  end if;
  if v_kind = 'members' then
    return query select 'aud:' || p_bucket || ':' || pr.id, pr.id, null::uuid, pr.phone::text, pr.name, '{}'::jsonb,
      (coalesce(pr.is_active, true)), case when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
      from public.profiles pr where pr.role::text in ('socio', 'admin');
  elsif v_kind = 'students' then
    return query
      select 'aud:' || p_bucket || ':' || pr.id, pr.id, null::uuid, pr.phone::text, pr.name, '{}'::jsonb,
        (sp.student_status = 'active' and coalesce(pr.is_active, true)),
        case when sp.student_status <> 'active' then 'ALUNO_PAUSADO_OU_ENCERRADO' when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
      from public.student_profiles sp join public.profiles pr on pr.id = sp.profile_id
      union all
      select 'aud:' || p_bucket || ':' || s.id, null::uuid, s.id, s.phone::text, s.name::text, '{}'::jsonb,
        (coalesce(sp.student_status, 'active') = 'active' and coalesce(s.is_active, true) and coalesce(s.student_type, 'regular') = 'regular'),
        case when coalesce(s.student_type, 'regular') <> 'regular' then 'DEPENDENTE'
             when coalesce(sp.student_status, 'active') <> 'active' or not coalesce(s.is_active, true) then 'ALUNO_PAUSADO_OU_ENCERRADO' end
      from public.non_socio_students s left join public.student_profiles sp on sp.non_socio_student_id = s.id;
  elsif v_kind = 'dependents' then
    -- Dependente: o aviso vai ao SÓCIO responsável (uma mensagem por responsável).
    return query
      select 'aud:' || p_bucket || ':' || pr.id, pr.id, null::uuid, pr.phone::text, pr.name, '{}'::jsonb,
        (coalesce(pr.is_active, true)), case when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
      from public.profiles pr where pr.id in (select s.responsible_socio_id from public.non_socio_students s
        where s.student_type = 'dependent' and coalesce(s.is_active, true) and s.responsible_socio_id is not null);
  elsif v_kind = 'professors' then
    return query select 'aud:' || p_bucket || ':' || pr.id, pr.id, null::uuid, pr.phone::text, pr.name, '{}'::jsonb,
      (coalesce(pf.is_active, true) and coalesce(pr.is_active, true)), case when not coalesce(pf.is_active, true) then 'PROFESSOR_INATIVO' end
      from public.professors pf join public.profiles pr on pr.id = pf.user_id;
  elsif v_kind = 'card_holders' then
    return query select 'aud:' || p_bucket || ':' || s.id, null::uuid, s.id, s.phone::text, s.name::text, '{}'::jsonb,
      (coalesce(s.plan_status, 'inactive') = 'active' and coalesce(s.is_active, true)),
      case when coalesce(s.plan_status, 'inactive') <> 'active' then 'CARD_INATIVO_OU_CANCELADO' when not coalesce(s.is_active, true) then 'ALUNO_PAUSADO_OU_ENCERRADO' end
      from public.non_socio_students s where s.plan_type = 'Card Mensal' and coalesce(s.student_type, 'regular') = 'regular';
  elsif v_kind = 'championship_participants' then
    select c.status::text, c.name into v_status, v_cname from public.championships c where c.id = v_champ;
    if v_status is null then return; end if;
    return query select 'aud:' || p_bucket || ':' || r.user_id, r.user_id, null::uuid, pr.phone::text, pr.name,
      jsonb_build_object('championship', v_cname, 'class', r.class),
      (v_status in ('ongoing', 'active') and coalesce(pr.is_active, true)), case when v_status not in ('ongoing', 'active') then 'CAMPEONATO_NAO_ATIVO' end
      from public.championship_registrations r join public.profiles pr on pr.id = r.user_id where r.championship_id = v_champ;
  end if;
end $$;

-- Resultado de jogo CONFIRMADO: partida encerrada E com resultado registrado por alguém (`result_set_at`, que as telas
-- de administração do app gravam), com vencedor (ou W.O./empate técnico) e placar completo, e que não mudou nos últimos
-- minutos (edição pendente). Partida encerrada pelo marcador ao vivo, sem `result_set_at`, NÃO dispara: não há como
-- saber se alguém conferiu. Nada é inferido de placar parcial.
create function conv_private.aud_result(a public.conv_automations, p_as_of date) returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := a.definition; v_champ uuid := nullif(d->>'championship_id', '')::uuid;
  v_settle integer := coalesce(nullif(d->>'settle_minutes', '')::int, 10);
begin
  return query
  with m as (
    select mt.*, c.name as cname, ra.user_id as ra_user, rb.user_id as rb_user,
      coalesce(mt.walkover_winner_registration_id, mt.winner_registration_id) as win_reg,
      coalesce(mt.player_a_id, ra.user_id) as a_user, coalesce(mt.player_b_id, rb.user_id) as b_user,
      coalesce(pa.name, ra.guest_name) as a_name, coalesce(pb.name, rb.guest_name) as b_name
    from public.matches mt join public.championships c on c.id = mt.championship_id
    left join public.championship_registrations ra on ra.id = mt.registration_a_id
    left join public.championship_registrations rb on rb.id = mt.registration_b_id
    left join public.profiles pa on pa.id = coalesce(mt.player_a_id, ra.user_id)
    left join public.profiles pb on pb.id = coalesce(mt.player_b_id, rb.user_id)
    where mt.status::text = 'finished' and c.status::text in ('ongoing', 'active')
      and (v_champ is null or mt.championship_id = v_champ)
      and mt.result_set_at is not null and mt.result_set_at >= coalesce(a.activated_at, now())
      and mt.result_set_at <= now() - make_interval(mins => v_settle)
  ), side as (
    select m.*, 'a' as side, m.a_user as uid, m.a_name as who, m.b_name as opp, m.registration_a_id as reg from m
    union all
    select m.*, 'b', m.b_user, m.b_name, m.a_name, m.registration_b_id from m
  )
  select 'res:' || s.id || ':' || coalesce(s.uid::text, '-'), s.uid, null::uuid, pr.phone::text, s.who,
    jsonb_build_object('match_id', s.id, 'championship', s.cname, 'phase', s.phase, 'opponent', s.opp,
      'score', (select string_agg(case when s.side = 'a' then (s.score_a)[i]::text || '-' || (s.score_b)[i]::text
                                       else (s.score_b)[i]::text || '-' || (s.score_a)[i]::text end, ' ' order by i)
                from generate_subscripts(s.score_a, 1) i where (s.score_b)[i] is not null),
      'outcome', case
        when s.result_type = 'technical_draw' then 'empate técnico'
        when (s.win_reg is not null and s.win_reg = s.reg) or (s.win_reg is null and coalesce(s.walkover_winner_id, s.winner_id) = s.uid)
          then case when coalesce(s.is_walkover, false) or s.result_type = 'walkover' then 'vitória por W.O.' else 'vitória' end
        else case when coalesce(s.is_walkover, false) or s.result_type = 'walkover' then 'derrota por W.O.' else 'derrota' end end,
      'winner_ref', coalesce(s.win_reg::text, coalesce(s.walkover_winner_id, s.winner_id)::text)),
    (s.uid is not null and coalesce(pr.is_active, true)
      and (s.result_type = 'technical_draw' or s.win_reg is not null or coalesce(s.walkover_winner_id, s.winner_id) is not null)
      and (s.result_type in ('walkover', 'technical_draw') or coalesce(s.is_walkover, false) or cardinality(coalesce(s.score_a, '{}')) > 0)),
    case when s.uid is null then 'CONVIDADO_SEM_CADASTRO'
         when not (s.result_type = 'technical_draw' or s.win_reg is not null or coalesce(s.walkover_winner_id, s.winner_id) is not null) then 'RESULTADO_INCOMPLETO'
         when not (s.result_type in ('walkover', 'technical_draw') or coalesce(s.is_walkover, false) or cardinality(coalesce(s.score_a, '{}')) > 0) then 'PLACAR_INCOMPLETO'
         when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
  from side s left join public.profiles pr on pr.id = s.uid;
end $$;

-- Avanço de fase CONFIRMADO pelo motor de campeonato: o vencedor da partida já ocupa a vaga
-- da partida seguinte (feito por `propagate_bracket_winner`). Classificação de grupos não é inferida.
create function conv_private.aud_advance(a public.conv_automations, p_as_of date) returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := a.definition; v_champ uuid := nullif(d->>'championship_id', '')::uuid;
  v_settle integer := coalesce(nullif(d->>'settle_minutes', '')::int, 10);
begin
  return query
  with nxt as (
    select src.id as src_id, nx.id as next_id, nx.phase as next_phase, c.name as cname,
      case when nx.player_a_source_match_id = src.id then nx.registration_a_id else nx.registration_b_id end as adv_reg,
      case when nx.player_a_source_match_id = src.id then nx.registration_b_id else nx.registration_a_id end as other_reg,
      coalesce(src.walkover_winner_registration_id, src.winner_registration_id) as win_reg, nx.status::text as next_status
    from public.matches src join public.championships c on c.id = src.championship_id
    join public.matches nx on (nx.player_a_source_match_id = src.id or nx.player_b_source_match_id = src.id)
    where src.status::text = 'finished' and c.status::text in ('ongoing', 'active')
      and (v_champ is null or src.championship_id = v_champ)
      and src.result_set_at is not null and src.result_set_at >= coalesce(a.activated_at, now())
      and src.result_set_at <= now() - make_interval(mins => v_settle)
  )
  select 'adv:' || n.next_id || ':' || coalesce(n.adv_reg::text, '-'), r.user_id, null::uuid, pr.phone::text, pr.name,
    jsonb_build_object('match_id', n.src_id, 'next_match_id', n.next_id, 'championship', n.cname, 'phase', n.next_phase,
      'opponent', (select coalesce(p2.name, r2.guest_name) from public.championship_registrations r2 left join public.profiles p2 on p2.id = r2.user_id
                   where r2.id = n.other_reg), 'registration_id', n.adv_reg),
    (r.user_id is not null and coalesce(pr.is_active, true) and n.next_status = 'pending' and n.adv_reg is not null and n.adv_reg = n.win_reg),
    case when n.adv_reg is null or n.adv_reg is distinct from n.win_reg then 'AVANCO_NAO_CONFIRMADO_PELO_MOTOR'
         when r.user_id is null then 'CONVIDADO_SEM_CADASTRO' when n.next_status <> 'pending' then 'PARTIDA_SEGUINTE_JA_INICIADA'
         when not coalesce(pr.is_active, true) then 'SOCIO_INATIVO' end
  from nxt n left join public.championship_registrations r on r.id = n.adv_reg left join public.profiles pr on pr.id = r.user_id;
end $$;

-- Despachante: aplica a fonte e, por cima, telefone válido e opt-out. Só a fonte da automação é lida.
create function conv_private.audience(a public.conv_automations, p_as_of date, p_bucket text default null)
returns setof conv_private.audience_row
language plpgsql stable security definer set search_path = '' as $$
declare v_bucket text := coalesce(p_bucket, p_as_of::text); v_rows conv_private.audience_row[];
begin
  if a.source = 'finance_charge' then
    select array_agg(t) into v_rows from conv_private.aud_finance(a, p_as_of) t;
  elsif a.source = 'card_mensal' then
    select array_agg(t) into v_rows from conv_private.aud_card(a, p_as_of) t;
  elsif a.source in ('championship_notice', 'audience') then
    select array_agg(t) into v_rows from conv_private.aud_audience(a, p_as_of, v_bucket) t;
  elsif a.source = 'championship_result' then
    select array_agg(t) into v_rows from conv_private.aud_result(a, p_as_of) t;
  elsif a.source = 'championship_advance' then
    select array_agg(t) into v_rows from conv_private.aud_advance(a, p_as_of) t;
  end if;
  return query
  select x.dedupe_key, x.profile_id, x.student_id, conv_private.phone_e164(x.phone), x.display_name, x.subject,
    (x.included and conv_private.phone_e164(x.phone) is not null and not coalesce(ct.opt_out, false)),
    coalesce(x.reason, case when conv_private.phone_e164(x.phone) is null then 'SEM_TELEFONE_VALIDO'
                            when coalesce(ct.opt_out, false) then 'OPT_OUT' end)
  from unnest(coalesce(v_rows, '{}'::conv_private.audience_row[])) x
  left join public.conv_contacts ct on ct.phone = conv_private.phone_e164(x.phone);
end $$;

-- ------------------------------------------------------------------
-- 5. Validação da regra (o que falta para ativar)
-- ------------------------------------------------------------------
create function conv_private.automation_problems(a public.conv_automations) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_p text[] := '{}'; d jsonb := a.definition; s jsonb := a.schedule; k text; v_allowed text[] := conv_private.automation_vars(a.source);
  v_fee_ok boolean; v_date text; v_time text := s->>'time';
begin
  if length(trim(a.message_body)) = 0 then v_p := array_append(v_p, 'MENSAGEM_VAZIA'::text); end if;
  foreach k in array conv_private.template_vars(a.message_body) loop
    if not (k = any (v_allowed)) then v_p := array_append(v_p, 'VARIAVEL_INDISPONIVEL:' || k); end if;
  end loop;
  if 'encargos' = any (conv_private.template_vars(a.message_body)) then
    select (late_fee_confirmed_at is not null) into v_fee_ok from public.fin_settings where id;
    if not coalesce(v_fee_ok, false) then v_p := array_append(v_p, 'ENCARGOS_NAO_CONFIGURADOS'::text); end if;
  end if;

  if a.source = 'finance_charge' and coalesce(d->>'stage', '') not in ('period_start', 'before_due', 'overdue', 'in_review') then v_p := array_append(v_p, 'ESTAGIO_INVALIDO'::text); end if;
  if a.source in ('championship_notice') or (a.source = 'audience' and d->>'audience' = 'championship_participants') then
    if not exists (select 1 from public.championships c where c.id = nullif(d->>'championship_id', '')::uuid) then v_p := array_append(v_p, 'CAMPEONATO_OBRIGATORIO'::text); end if;
  end if;
  if a.source = 'audience' and coalesce(d->>'audience', '') not in ('members', 'students', 'dependents', 'professors', 'card_holders', 'championship_participants') then
    v_p := array_append(v_p, 'PUBLICO_INVALIDO'::text);
  end if;
  if a.source in ('championship_result', 'championship_advance') and nullif(d->>'championship_id', '') is not null
     and not exists (select 1 from public.championships c where c.id = (d->>'championship_id')::uuid) then v_p := array_append(v_p, 'CAMPEONATO_INEXISTENTE'::text); end if;

  if a.trigger_type = 'scheduled' then
    if v_time is null or conv_private.hhmm_to_min(v_time) is null then v_p := array_append(v_p, 'HORARIO_INVALIDO'::text); end if;
    if coalesce(jsonb_typeof(s->'dates') = 'array' and jsonb_array_length(s->'dates') > 0, false) then
      for v_date in select jsonb_array_elements_text(s->'dates') loop
        begin perform v_date::date; exception when others then v_p := array_append(v_p, 'DATA_INVALIDA'::text); end;
      end loop;
    elsif not coalesce(jsonb_typeof(s->'weekdays') = 'array' and jsonb_array_length(s->'weekdays') between 1 and 7, false) then
      v_p := array_append(v_p, 'RECORRENCIA_OBRIGATORIA'::text);
    end if;
  end if;
  return v_p;
end $$;

-- ------------------------------------------------------------------
-- 6. Materialização (varredura) — só banco, sem enviar nada
-- ------------------------------------------------------------------
create function conv_private.automation_purpose(a public.conv_automations) returns text
language sql immutable set search_path = '' as $$
  select a.source || ':' || coalesce(nullif(a.definition->>'stage', ''), nullif(a.definition->>'audience', ''), 'x') ||
    case when a.source in ('championship_notice', 'audience') then ':' || a.id::text else '' end $$;

-- Grava o público de uma execução. Idempotente pela chave (finalidade + pessoa/fato/janela).
create function conv_private.automation_materialize(a public.conv_automations, p_run uuid, p_as_of date, p_bucket text, p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_purpose text := conv_private.automation_purpose(a);
begin
  insert into public.conv_automation_recipients(run_id, automation_id, purpose_key, dedupe_key, profile_id, student_id, phone,
    display_name, subject, status, due_at)
  select p_run, a.id, v_purpose, x.dedupe_key, x.profile_id, x.student_id, x.phone, x.display_name, coalesce(x.subject, '{}'::jsonb), p_status, now()
  from conv_private.audience(a, p_as_of, p_bucket) x where x.included
  on conflict (purpose_key, dedupe_key) where status <> 'canceled' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Varredura (cron a cada poucos minutos): cria execuções vencidas e grava o público.
create function conv_private.automation_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.conv_automations%rowtype; s public.conv_automation_settings%rowtype; v_local timestamp := p_now at time zone 'America/Fortaleza';
  v_today date := v_local::date; v_planned timestamptz; v_run uuid; v_n integer; v_runs integer := 0; v_recipients integer := 0;
  v_due_today boolean; v_end date; v_bucket text;
begin
  select * into s from public.conv_automation_settings where id;
  if not coalesce(s.enabled, true) then return jsonb_build_object('enabled', false); end if;
  for a in select * from public.conv_automations where status = 'active' and trigger_type in ('scheduled', 'conditional', 'event') order by created_at loop
    v_end := nullif(a.schedule->>'end_date', '')::date;
    if v_end is not null and v_today > v_end then
      update public.conv_automations set status = 'ended', ended_at = now(), updated_at = now() where id = a.id;
      update public.conv_automation_recipients set status = 'canceled', skip_reason = 'AUTOMACAO_ENCERRADA' where automation_id = a.id and status in ('pending', 'review');
      perform conv_private.audit('automation_ended', 'conv_automations', a.id::text, null, jsonb_build_object('status', 'ended', 'reason', 'end_date'),
        jsonb_build_object('actor', 'system'));
      continue;
    end if;

    if a.trigger_type = 'scheduled' then
      v_due_today := case
        when jsonb_typeof(a.schedule->'dates') = 'array' and jsonb_array_length(a.schedule->'dates') > 0 then a.schedule->'dates' ? v_today::text
        else coalesce(a.schedule->'weekdays', '[]'::jsonb) @> to_jsonb(extract(dow from v_today)::int) end;
      continue when not v_due_today;
      v_planned := (v_today + (a.schedule->>'time')::time) at time zone 'America/Fortaleza';
      continue when p_now < v_planned;
      v_bucket := v_today::text;
    else
      -- condicional e evento: uma execução por dia, que recebe quem passou a atender a condição.
      v_planned := v_today::timestamp at time zone 'America/Fortaleza';
      v_bucket := v_today::text;
    end if;

    insert into public.conv_automation_runs(automation_id, version, kind, planned_for)
    values (a.id, a.version, a.trigger_type, v_planned)
    on conflict (automation_id, planned_for) do nothing returning id into v_run;
    if v_run is null then
      if a.trigger_type = 'scheduled' then continue; end if;   -- agendada: já rodou hoje
      select id into v_run from public.conv_automation_runs where automation_id = a.id and planned_for = v_planned and status = 'running';
      continue when v_run is null;
    else v_runs := v_runs + 1; end if;

    v_n := conv_private.automation_materialize(a, v_run, v_today, v_bucket, 'pending');
    v_recipients := v_recipients + v_n;
    -- Execução sem ninguém: não deixa lixo (condicional/evento volta amanhã; agendada fica registrada como feita).
    if v_n = 0 and a.trigger_type <> 'scheduled' and not exists (select 1 from public.conv_automation_recipients where run_id = v_run) then
      delete from public.conv_automation_runs where id = v_run;
      v_runs := v_runs - 1;
    elsif v_n = 0 and not exists (select 1 from public.conv_automation_recipients where run_id = v_run and status in ('pending', 'processing')) then
      update public.conv_automation_runs set status = 'done', finished_at = now() where id = v_run;
    end if;
    v_run := null;
  end loop;
  return jsonb_build_object('enabled', true, 'runs', v_runs, 'recipients', v_recipients);
end $$;

-- ------------------------------------------------------------------
-- 7. Revalidação no envio: o que valia ao entrar pode não valer mais
-- ------------------------------------------------------------------
create function conv_private.automation_revalidate(a public.conv_automations, r public.conv_automation_recipients) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d jsonb := a.definition; v_stage text := d->>'stage'; v_ids uuid[]; v_subject jsonb; v_row record; v_as_of date := conv_private.today();
  v_total bigint := 0; v_principal bigint := 0; v_fees bigint := 0; v_due date; v_late integer := 0; v_fees_ok boolean := true; v_comps date[];
  v_repeat integer; v_c record; v_ok boolean; s record;
begin
  if a.source = 'finance_charge' then
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(r.subject->'charge_ids') x;
    v_repeat := greatest(coalesce(nullif(d->>'repeat_days', '')::int, 7), 1);
    for v_c in select * from fin_private.charge_rows(r.profile_id, v_ids, '{}'::jsonb, v_as_of, 100, 0) loop
      v_ok := v_c.stored_status in ('open', 'partial') and case v_stage
        when 'period_start' then v_c.competence_month <= v_as_of
        when 'before_due' then v_c.due_date >= v_as_of
        when 'overdue' then v_as_of > v_c.due_date
        when 'in_review' then v_c.in_review else false end
        and (v_stage = 'in_review' or not v_c.in_review or not coalesce((d->>'exclude_in_review')::boolean, true));
      continue when not v_ok;
      v_total := v_total + v_c.total_due_cents; v_principal := v_principal + v_c.principal_remaining_cents; v_fees := v_fees + v_c.fees_due_cents;
      v_due := least(coalesce(v_due, v_c.due_date), v_c.due_date); v_late := greatest(v_late, v_c.days_late);
      v_fees_ok := v_fees_ok and v_c.fees_configured; v_comps := array_append(coalesce(v_comps, '{}'), v_c.competence_month);
    end loop;
    if v_comps is null then return jsonb_build_object('ok', false, 'reason', 'COBRANCA_NAO_PENDENTE'); end if;
    v_subject := jsonb_build_object('total_cents', v_total, 'principal_cents', v_principal, 'fees_cents', v_fees, 'fees_configured', v_fees_ok,
      'due_date', v_due, 'days_late', v_late,
      'competence_label', (select string_agg(conv_private.month_pt(x), ' e ' order by x) from (select distinct unnest(v_comps) x) q));
  elsif a.source = 'card_mensal' then
    select s2.* into s from public.non_socio_students s2 where s2.id = r.student_id;
    if not found or s.plan_type <> 'Card Mensal' or coalesce(s.plan_status, 'inactive') <> 'active' or not coalesce(s.is_active, true) then
      return jsonb_build_object('ok', false, 'reason', 'CARD_INATIVO_OU_CANCELADO');
    end if;
    if s.master_expiration_date is distinct from (r.subject->>'expiration')::date then return jsonb_build_object('ok', false, 'reason', 'CARD_RENOVADO_OU_ALTERADO'); end if;
    if exists (select 1 from public.student_profiles sp where sp.non_socio_student_id = s.id and sp.student_status <> 'active') then
      return jsonb_build_object('ok', false, 'reason', 'ALUNO_PAUSADO_OU_ENCERRADO');
    end if;
    v_subject := r.subject;
  elsif a.source in ('championship_result', 'championship_advance') then
    -- Reavalia o público do evento e procura esta mesma pessoa/fato, ainda incluída.
    select x.* into v_row from conv_private.audience(a, v_as_of, null) x where x.dedupe_key = r.dedupe_key;
    if not found or not v_row.included then return jsonb_build_object('ok', false, 'reason', coalesce(v_row.reason, 'EVENTO_NAO_CONFIRMADO_AGORA')); end if;
    if a.source = 'championship_result' and (v_row.subject->>'winner_ref') is distinct from (r.subject->>'winner_ref') then
      return jsonb_build_object('ok', false, 'reason', 'RESULTADO_ALTERADO');
    end if;
    v_subject := v_row.subject;
  else
    -- Aviso/público fixo: a pessoa ainda precisa estar no público.
    select x.* into v_row from conv_private.audience(a, v_as_of, split_part(r.dedupe_key, ':', 2)) x where x.dedupe_key = r.dedupe_key;
    if not found or not v_row.included then return jsonb_build_object('ok', false, 'reason', coalesce(v_row.reason, 'FORA_DO_PUBLICO')); end if;
    v_subject := coalesce(v_row.subject, r.subject);
  end if;
  return jsonb_build_object('ok', true, 'subject', v_subject);
end $$;

-- ------------------------------------------------------------------
-- 8. Fila: claim → queue → (provedor) → finish
-- ------------------------------------------------------------------
create function conv_private.automation_claim(p_limit integer default 10)
returns table(recipient_id uuid, conversation_id uuid, body text)
language plpgsql security definer set search_path = '' as $$
declare
  r public.conv_automation_recipients%rowtype; a public.conv_automations%rowtype; s public.conv_automation_settings%rowtype;
  v_chk jsonb; v_ctx jsonb; v_body text; v_contact uuid; v_next timestamptz; v_cap timestamptz; v_taken integer := 0;
  v_max integer := greatest(least(coalesce(p_limit, 10), 50), 1); v_opt boolean; v_name text;
begin
  select * into s from public.conv_automation_settings where id;
  if not coalesce(s.enabled, true) then return; end if;
  for r in select x.* from public.conv_automation_recipients x
           where (x.status = 'pending' and x.due_at <= now()) or (x.status = 'processing' and x.claimed_at < now() - interval '10 minutes')
           order by x.due_at limit v_max * 4 for update skip locked loop
    exit when v_taken >= v_max;
    select * into a from public.conv_automations where id = r.automation_id;
    -- Pausa/encerramento interrompem o que ainda não saiu.
    if not (a.status = 'active' or (a.trigger_type = 'manual' and a.status = 'draft')) and r.status = 'pending' then
      update public.conv_automation_recipients set status = 'canceled', skip_reason = 'AUTOMACAO_' || upper(a.status) where id = r.id;
      continue;
    end if;

    v_contact := conv_private.upsert_contact(r.phone, null, r.display_name, true);
    select ct.opt_out into v_opt from public.conv_contacts ct where ct.id = v_contact;
    if coalesce(v_opt, false) then
      update public.conv_automation_recipients set status = 'skipped', skip_reason = 'OPT_OUT', contact_id = v_contact where id = r.id;
      continue;
    end if;

    v_chk := conv_private.automation_revalidate(a, r);
    if not (v_chk->>'ok')::boolean then
      update public.conv_automation_recipients set status = 'skipped', skip_reason = left(v_chk->>'reason', 120), contact_id = v_contact where id = r.id;
      continue;
    end if;
    v_name := r.display_name;
    v_ctx := conv_private.automation_ctx(a.source, v_chk->'subject', v_name);
    v_body := conv_private.render_template(a.message_body, v_ctx);
    if v_body is null then
      update public.conv_automation_recipients set status = 'skipped', contact_id = v_contact,
        skip_reason = 'VARIAVEL_SEM_VALOR' where id = r.id;
      continue;
    end if;

    -- Janela e anti-spam: reagenda, não pula.
    v_next := conv_private.automation_next_allowed(now());
    v_cap := conv_private.automation_cap_until(v_contact);
    if v_cap is not null then v_next := conv_private.automation_next_allowed(greatest(v_next, v_cap)); end if;
    if v_next > now() + interval '1 minute' then
      update public.conv_automation_recipients set due_at = v_next, status = 'pending', claimed_at = null, contact_id = v_contact where id = r.id;
      continue;
    end if;

    update public.conv_automation_recipients set status = 'processing', claimed_at = now(), attempts = attempts + 1,
      contact_id = v_contact, body = v_body, subject = coalesce(subject, '{}'::jsonb) || coalesce(v_chk->'subject', '{}'::jsonb) where id = r.id;
    v_taken := v_taken + 1;
    recipient_id := r.id; conversation_id := conv_private.open_direct(v_contact); body := v_body;
    return next;
  end loop;
end $$;

-- Grava a mensagem na conversa do contato (mesma fila de todos; chave = id do destinatário,
-- então repetir não duplica) e liga a mensagem ao destinatário.
create function conv_private.automation_queue(p_recipient uuid, p_conversation uuid, p_body text)
returns table(message_id uuid, destination text, already_sent boolean)
language plpgsql security definer set search_path = '' as $$
declare r public.conv_automation_recipients%rowtype; q record;
begin
  select * into r from public.conv_automation_recipients where id = p_recipient for update;
  if not found then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  if r.status <> 'processing' then raise exception 'RECIPIENT_NOT_PROCESSING'; end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 1000 then raise exception 'BODY_REQUIRED'; end if;
  select * into q from conv_private.queue_message(p_conversation, jsonb_build_object('kind', 'text', 'body', trim(p_body)), null, p_recipient, 'automation', null, p_recipient);
  update public.conv_automation_recipients set message_id = q.message_id, body = trim(p_body) where id = p_recipient;
  return query select q.message_id, q.destination, q.already_sent;
end $$;

-- Resultado do envio. Falha: tenta de novo (10 e 20 min); na 3ª, desiste e registra para investigação.
create function conv_private.automation_finish(p_recipient uuid, p_message uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.conv_automation_recipients%rowtype;
begin
  select * into r from public.conv_automation_recipients where id = p_recipient for update;
  if not found or r.status <> 'processing' then return; end if;   -- já tratado: idempotente
  if p_ok then
    update public.conv_automation_recipients set status = 'sent', sent_at = now(), message_id = coalesce(p_message, message_id), last_error = null where id = p_recipient;
  elsif r.attempts < 3 then
    update public.conv_automation_recipients set status = 'pending', due_at = now() + make_interval(mins => 10 * r.attempts), claimed_at = null,
      last_error = left(coalesce(p_error, 'SEND_FAILED'), 300) where id = p_recipient;
  else
    update public.conv_automation_recipients set status = 'failed', last_error = left(coalesce(p_error, 'SEND_FAILED'), 300) where id = p_recipient;
    perform conv_private.audit('automation_send_failed', 'conv_automation_recipients', p_recipient::text, null,
      jsonb_build_object('automation_id', r.automation_id, 'error', left(coalesce(p_error, 'SEND_FAILED'), 80), 'attempts', r.attempts),
      jsonb_build_object('actor', 'system'));
  end if;
  update public.conv_automation_runs run set status = 'done', finished_at = now()
    where run.id = r.run_id and run.status = 'running'
      and not exists (select 1 from public.conv_automation_recipients x where x.run_id = run.id and x.status in ('pending', 'processing'));
end $$;

-- ------------------------------------------------------------------
-- 9. Administrador: criar, editar, ativar, pausar, pré-visualizar, enviar manual
-- ------------------------------------------------------------------
create function public.conv_get_automation_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  return (select to_jsonb(s) - 'updated_by' from public.conv_automation_settings s where s.id);
end $$;

create function public.conv_save_automation_settings(p_request uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_old public.conv_automation_settings%rowtype; v_new public.conv_automation_settings%rowtype;
begin
  perform conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'automation_settings_save');
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.conv_automation_settings where id for update;
  update public.conv_automation_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    window_start = coalesce((p->>'window_start')::time, window_start), window_end = coalesce((p->>'window_end')::time, window_end),
    days = case when jsonb_typeof(p->'days') = 'array' then array(select jsonb_array_elements_text(p->'days')::int) else days end,
    min_hours_between = coalesce((p->>'min_hours_between')::int, min_hours_between),
    daily_cap = coalesce((p->>'daily_cap')::int, daily_cap), weekly_cap = coalesce((p->>'weekly_cap')::int, weekly_cap),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into v_new;
  perform conv_private.audit('automation_settings_save', 'conv_automation_settings', 'settings', to_jsonb(v_old) - 'opt_out_keywords',
    to_jsonb(v_new) - 'opt_out_keywords', jsonb_build_object('actor', 'admin'));
  return conv_private.finish_op(p_request, jsonb_build_object('ok', true));
end $$;

-- Cria ou edita (edição de regra ativa vira versão nova; o histórico fica).
create function public.conv_save_automation(p_request uuid, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; v_old public.conv_automations%rowtype; a public.conv_automations%rowtype; v_changed boolean;
begin
  v_actor := conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, case when p_id is null then 'automation_create' else 'automation_update' end);
  if v_replay is not null then return v_replay; end if;
  if p_id is null then
    insert into public.conv_automations(name, description, objective, source, trigger_type, definition, schedule, message_body, created_by, updated_by)
    values (trim(coalesce(p->>'name', '')), left(coalesce(p->>'description', ''), 500), left(coalesce(p->>'objective', ''), 300),
      p->>'source', p->>'trigger_type', coalesce(p->'definition', '{}'::jsonb), coalesce(p->'schedule', '{}'::jsonb),
      left(coalesce(p->>'message_body', ''), 1000), v_actor, v_actor) returning * into a;
    insert into public.conv_automation_versions(automation_id, version, definition, schedule, message_body, trigger_type, created_by)
    values (a.id, 1, a.definition, a.schedule, a.message_body, a.trigger_type, v_actor);
    perform conv_private.audit('automation_create', 'conv_automations', a.id::text, null,
      jsonb_build_object('name', a.name, 'source', a.source, 'trigger_type', a.trigger_type), jsonb_build_object('actor', 'admin'));
  else
    select * into v_old from public.conv_automations where id = p_id for update;
    if not found then raise exception 'AUTOMATION_NOT_FOUND'; end if;
    if v_old.status = 'ended' then raise exception 'AUTOMATION_ENDED'; end if;
    -- Origem e tipo não mudam depois de criada: seria outra automação.
    if (p ? 'source' and p->>'source' <> v_old.source) or (p ? 'trigger_type' and p->>'trigger_type' <> v_old.trigger_type) then raise exception 'AUTOMATION_KIND_FIXED'; end if;
    v_changed := (p ? 'definition' and p->'definition' <> v_old.definition) or (p ? 'schedule' and p->'schedule' <> v_old.schedule)
      or (p ? 'message_body' and p->>'message_body' <> v_old.message_body);
    update public.conv_automations set
      name = coalesce(nullif(trim(p->>'name'), ''), name), description = coalesce(left(p->>'description', 500), description),
      objective = coalesce(left(p->>'objective', 300), objective), definition = coalesce(p->'definition', definition),
      schedule = coalesce(p->'schedule', schedule), message_body = coalesce(left(p->>'message_body', 1000), message_body),
      version = version + case when v_changed then 1 else 0 end, updated_by = v_actor, updated_at = now()
    where id = p_id returning * into a;
    if v_changed then
      insert into public.conv_automation_versions(automation_id, version, definition, schedule, message_body, trigger_type, created_by)
      values (a.id, a.version, a.definition, a.schedule, a.message_body, a.trigger_type, v_actor);
    end if;
    perform conv_private.audit('automation_update', 'conv_automations', a.id::text,
      jsonb_build_object('name', v_old.name, 'definition', v_old.definition, 'schedule', v_old.schedule, 'version', v_old.version),
      jsonb_build_object('name', a.name, 'definition', a.definition, 'schedule', a.schedule, 'version', a.version), jsonb_build_object('actor', 'admin'));
  end if;
  return conv_private.finish_op(p_request, jsonb_build_object('id', a.id, 'version', a.version, 'problems', to_jsonb(conv_private.automation_problems(a))));
end $$;

-- draft|paused → active (só se não houver pendência); active → paused; qualquer → ended.
create function public.conv_automation_set_status(p_request uuid, p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; a public.conv_automations%rowtype; v_problems text[]; v_canceled integer := 0;
begin
  v_actor := conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'automation_status_' || coalesce(p_status, '?'));
  if v_replay is not null then return v_replay; end if;
  if p_status not in ('active', 'paused', 'ended') then raise exception 'INVALID_STATUS'; end if;
  select * into a from public.conv_automations where id = p_id for update;
  if not found then raise exception 'AUTOMATION_NOT_FOUND'; end if;
  if a.status = 'ended' then raise exception 'AUTOMATION_ENDED'; end if;
  if p_status = 'active' then
    v_problems := conv_private.automation_problems(a);
    if cardinality(v_problems) > 0 then raise exception 'AUTOMATION_INCOMPLETE: %', array_to_string(v_problems, ','); end if;
    update public.conv_automations set status = 'active', activated_at = coalesce(activated_at, now()), updated_by = v_actor, updated_at = now() where id = p_id;
  else
    update public.conv_automations set status = p_status, ended_at = case when p_status = 'ended' then now() else ended_at end,
      updated_by = v_actor, updated_at = now() where id = p_id;
    -- Pausar ou encerrar cancela o que ainda não saiu. O que está em envio termina.
    update public.conv_automation_recipients set status = 'canceled', skip_reason = 'AUTOMACAO_' || upper(p_status)
      where automation_id = p_id and status in ('pending', 'review');
    get diagnostics v_canceled = row_count;
    update public.conv_automation_runs set status = 'canceled', finished_at = now()
      where automation_id = p_id and status in ('review') ;
  end if;
  perform conv_private.audit('automation_' || p_status, 'conv_automations', p_id::text, jsonb_build_object('status', a.status),
    jsonb_build_object('status', p_status, 'canceled_recipients', v_canceled), jsonb_build_object('actor', 'admin', 'name', left(a.name, 80)));
  return conv_private.finish_op(p_request, jsonb_build_object('status', p_status, 'canceled', v_canceled));
end $$;

-- Pré-visualização: estimativa, amostra de incluídos, motivos de exclusão e a mensagem renderizada
-- com um caso real. Não grava nada.
create function public.conv_automation_preview(p_id uuid, p_override jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.conv_automations%rowtype; v_today date := conv_private.today(); v_inc integer; v_exc jsonb; v_sample jsonb;
  v_first_name text; v_first_subject jsonb; v_render text; v_probs text[];
begin
  perform conv_private.require_admin();
  select * into a from public.conv_automations where id = p_id;
  if not found then raise exception 'AUTOMATION_NOT_FOUND'; end if;
  if p_override is not null then
    a.definition := coalesce(p_override->'definition', a.definition); a.schedule := coalesce(p_override->'schedule', a.schedule);
    a.message_body := coalesce(p_override->>'message_body', a.message_body);
  end if;
  v_probs := conv_private.automation_problems(a);
  with x as materialized (select * from conv_private.audience(a, v_today, v_today::text))
  select
    (select count(*)::integer from x where included),
    (select coalesce(jsonb_object_agg(q.reason, q.n), '{}'::jsonb) from (select reason, count(*) n from x where not included and reason is not null group by reason) q),
    (select coalesce(jsonb_agg(q.display_name), '[]'::jsonb) from (select display_name from x where included order by display_name limit 5) q),
    (select display_name from x where included order by display_name limit 1),
    (select subject from x where included order by display_name limit 1)
  into v_inc, v_exc, v_sample, v_first_name, v_first_subject;
  if v_first_name is not null then
    v_render := conv_private.render_template(a.message_body, conv_private.automation_ctx(a.source, v_first_subject, v_first_name));
  end if;
  return jsonb_build_object('estimated_recipients', v_inc, 'excluded_by_reason', v_exc, 'sample', v_sample,
    'rendered_example', v_render, 'rendered_for', v_first_name, 'problems', to_jsonb(v_probs));
end $$;

-- Manual: prepara o público numa execução em REVISÃO. Nada sai até um administrador aprovar.
create function public.conv_automation_prepare_manual(p_request uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; a public.conv_automations%rowtype; v_run uuid; v_n integer; v_probs text[];
begin
  v_actor := conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'automation_prepare_manual');
  if v_replay is not null then return v_replay; end if;
  select * into a from public.conv_automations where id = p_id for update;
  if not found then raise exception 'AUTOMATION_NOT_FOUND'; end if;
  if a.status = 'ended' then raise exception 'AUTOMATION_ENDED'; end if;
  if a.status = 'paused' then raise exception 'AUTOMATION_PAUSED'; end if;
  if a.trigger_type <> 'manual' then raise exception 'AUTOMATION_NOT_MANUAL'; end if;
  v_probs := conv_private.automation_problems(a);
  if cardinality(v_probs) > 0 then raise exception 'AUTOMATION_INCOMPLETE: %', array_to_string(v_probs, ','); end if;
  insert into public.conv_automation_runs(automation_id, version, kind, planned_for, status, created_by, request_key)
  values (a.id, a.version, 'manual', clock_timestamp(), 'review', v_actor, p_request) returning id into v_run;
  v_n := conv_private.automation_materialize(a, v_run, conv_private.today(), v_run::text, 'review');
  return conv_private.finish_op(p_request, jsonb_build_object('run_id', v_run, 'recipients', v_n));
end $$;

create function public.conv_automation_approve_run(p_request uuid, p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; run public.conv_automation_runs%rowtype; v_n integer;
begin
  v_actor := conv_private.require_admin();
  v_replay := conv_private.begin_op(p_request, 'automation_approve_run');
  if v_replay is not null then return v_replay; end if;
  select * into run from public.conv_automation_runs where id = p_run for update;
  if not found then raise exception 'RUN_NOT_FOUND'; end if;
  if run.status <> 'review' then raise exception 'RUN_NOT_IN_REVIEW'; end if;
  update public.conv_automation_recipients set status = 'pending', due_at = now() where run_id = p_run and status = 'review';
  get diagnostics v_n = row_count;
  update public.conv_automation_runs set status = case when v_n = 0 then 'done' else 'running' end,
    finished_at = case when v_n = 0 then now() end where id = p_run;
  perform conv_private.audit('manual_dispatch', 'conv_automation_runs', p_run::text, null,
    jsonb_build_object('automation_id', run.automation_id, 'recipients', v_n), jsonb_build_object('actor', 'admin'));
  return conv_private.finish_op(p_request, jsonb_build_object('run_id', p_run, 'queued', v_n));
end $$;

create function public.conv_automation_cancel_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform conv_private.require_admin();
  update public.conv_automation_recipients set status = 'canceled', skip_reason = 'EXECUCAO_CANCELADA' where run_id = p_run and status in ('review', 'pending');
  get diagnostics v_n = row_count;
  update public.conv_automation_runs set status = 'canceled', finished_at = now() where id = p_run and status in ('review', 'running');
  perform conv_private.audit('run_canceled', 'conv_automation_runs', p_run::text, null, jsonb_build_object('canceled', v_n), jsonb_build_object('actor', 'admin'));
end $$;

-- Reenvia os que falharam de vez (zera tentativas): ação explícita do administrador.
create function public.conv_automation_retry_failed(p_run uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform conv_private.require_admin();
  update public.conv_automation_recipients set status = 'pending', attempts = 0, due_at = now(), last_error = null
    where run_id = p_run and status = 'failed' and exists (select 1 from public.conv_automations a where a.id = automation_id and a.status = 'active');
  get diagnostics v_n = row_count;
  update public.conv_automation_runs set status = 'running', finished_at = null where id = p_run and v_n > 0;
  perform conv_private.audit('run_retry', 'conv_automation_runs', p_run::text, null, jsonb_build_object('retried', v_n), jsonb_build_object('actor', 'admin'));
  return v_n;
end $$;

-- Lista para a tela: cada automação com contagens da última execução e do total.
create function public.conv_automation_list()
returns table(id uuid, name text, description text, objective text, source text, trigger_type text, definition jsonb, schedule jsonb,
  message_body text, status text, version integer, activated_at timestamptz, updated_at timestamptz, problems text[],
  sent integer, pending integer, failed integer, skipped integer, last_run_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  return query
  select a.id, a.name, a.description, a.objective, a.source, a.trigger_type, a.definition, a.schedule, a.message_body, a.status, a.version,
    a.activated_at, a.updated_at, conv_private.automation_problems(a),
    (select count(*)::integer from public.conv_automation_recipients r where r.automation_id = a.id and r.status = 'sent'),
    (select count(*)::integer from public.conv_automation_recipients r where r.automation_id = a.id and r.status in ('pending', 'processing', 'review')),
    (select count(*)::integer from public.conv_automation_recipients r where r.automation_id = a.id and r.status = 'failed'),
    (select count(*)::integer from public.conv_automation_recipients r where r.automation_id = a.id and r.status = 'skipped'),
    (select max(run.created_at) from public.conv_automation_runs run where run.automation_id = a.id)
  from public.conv_automations a order by a.status = 'ended', a.updated_at desc;
end $$;

-- Mensagem de teste para o próprio administrador (nunca para número arbitrário):
-- devolve o telefone do perfil de quem chama e a mensagem renderizada com um caso real.
create function conv_private.automation_test_payload(p_actor uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.conv_automations%rowtype; v_phone text; v_first record; v_body text;
begin
  select conv_private.phone_e164(p.phone) into v_phone from public.profiles p where p.id = p_actor and p.role::text = 'admin';
  if v_phone is null then raise exception 'ADMIN_WITHOUT_PHONE'; end if;
  select * into a from public.conv_automations where id = p_id;
  if not found then raise exception 'AUTOMATION_NOT_FOUND'; end if;
  select * into v_first from conv_private.audience(a, conv_private.today(), conv_private.today()::text) x where x.included limit 1;
  if v_first.dedupe_key is null then raise exception 'NO_SAMPLE_RECIPIENT'; end if;
  v_body := conv_private.render_template(a.message_body, conv_private.automation_ctx(a.source, v_first.subject, v_first.display_name));
  if v_body is null then raise exception 'VARIABLE_UNAVAILABLE'; end if;
  return jsonb_build_object('phone', v_phone, 'body', '[TESTE — exemplo com dados reais de um destinatário] ' || v_body);
end $$;

-- ------------------------------------------------------------------
-- 10. Invólucros do `service_role` (dispatch) e permissões
-- ------------------------------------------------------------------
create function public.conv_svc_automation_tick() returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.automation_tick() $$;
create function public.conv_svc_automation_claim(p_limit integer)
returns table(recipient_id uuid, conversation_id uuid, body text)
language sql security definer set search_path = '' as $$ select * from conv_private.automation_claim(p_limit) $$;
create function public.conv_svc_automation_queue(p_recipient uuid, p_conversation uuid, p_body text)
returns table(message_id uuid, destination text, already_sent boolean)
language sql security definer set search_path = '' as $$ select * from conv_private.automation_queue(p_recipient, p_conversation, p_body) $$;
create function public.conv_svc_automation_finish(p_recipient uuid, p_message uuid, p_ok boolean, p_error text) returns void
language sql security definer set search_path = '' as $$ select conv_private.automation_finish(p_recipient, p_message, p_ok, p_error) $$;
create function public.conv_svc_automation_test_payload(p_actor uuid, p_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.automation_test_payload(p_actor, p_id) $$;

revoke all on function public.conv_svc_automation_tick(), public.conv_svc_automation_claim(integer),
  public.conv_svc_automation_queue(uuid, uuid, text), public.conv_svc_automation_finish(uuid, uuid, boolean, text),
  public.conv_svc_automation_test_payload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_automation_tick(), public.conv_svc_automation_claim(integer),
  public.conv_svc_automation_queue(uuid, uuid, text), public.conv_svc_automation_finish(uuid, uuid, boolean, text),
  public.conv_svc_automation_test_payload(uuid, uuid) to service_role;

revoke all on function public.conv_get_automation_settings(), public.conv_save_automation_settings(uuid, jsonb),
  public.conv_save_automation(uuid, uuid, jsonb), public.conv_automation_set_status(uuid, uuid, text),
  public.conv_automation_preview(uuid, jsonb), public.conv_automation_prepare_manual(uuid, uuid),
  public.conv_automation_approve_run(uuid, uuid), public.conv_automation_cancel_run(uuid),
  public.conv_automation_retry_failed(uuid), public.conv_automation_list() from public, anon;
grant execute on function public.conv_get_automation_settings(), public.conv_save_automation_settings(uuid, jsonb),
  public.conv_save_automation(uuid, uuid, jsonb), public.conv_automation_set_status(uuid, uuid, text),
  public.conv_automation_preview(uuid, jsonb), public.conv_automation_prepare_manual(uuid, uuid),
  public.conv_automation_approve_run(uuid, uuid), public.conv_automation_cancel_run(uuid),
  public.conv_automation_retry_failed(uuid), public.conv_automation_list() to authenticated;

-- A varredura e o dispatch rodam por agendador externo (pg_cron + pg_net, Supabase Cron ou outro) chamando
-- a edge function `conversations-dispatch` com o segredo configurado. Esta migration NÃO agenda nada
-- (depende de extensões e segredos do projeto): ver docs/conversas/OPERACAO_E_MIGRATIONS.md.

-- Rollback: drop das funções conv_private.automation_*/aud_*/audience, do tipo conv_private.audience_row, dos
-- gatilhos conv_messages_opt_out e das tabelas conv_automation_recipients, _runs, _versions, conv_automations,
-- conv_automation_settings (e a FK conv_messages_recipient_fk). Mensagens já enviadas ficam em conv_messages.
