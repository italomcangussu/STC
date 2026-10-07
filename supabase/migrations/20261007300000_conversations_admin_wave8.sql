-- Onda 8 do assessor administrativo: retornos (follow-up) e bloqueio de horário de quadra (N1), preferências do administrador
-- (memória: resumo da manhã liga/desliga e estilo, alertas, saldo mínimo, dias de atraso, conta padrão) e alertas por regra
-- (cobrança vencida há N dias, comprovante parado, conta a pagar vencida, caixa abaixo do mínimo). Mesmo protocolo das
-- ondas anteriores: proposta com resumo → "sim" → grava como o administrador, com auditoria.

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_followup_create', 'adm_followup_done', 'adm_court_block', 'adm_pref_set'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- ---------------------------------------------------------------------------------------------- preferências e alertas
create table if not exists public.conv_admin_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  briefing_enabled boolean not null default true,
  briefing_style text not null default 'completo' check (briefing_style in ('completo', 'curto')),
  alerts_enabled boolean not null default true,
  min_balance_cents bigint check (min_balance_cents is null or min_balance_cents >= 0),
  overdue_days integer not null default 7 check (overdue_days between 1 and 90),
  default_account_id uuid references public.fin_accounts(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.conv_admin_prefs enable row level security;
revoke all on public.conv_admin_prefs from public, anon, authenticated;
grant all on public.conv_admin_prefs to service_role;

create table if not exists public.conv_admin_alert_log (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rule text not null,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, rule, day)
);
alter table public.conv_admin_alert_log enable row level security;
revoke all on public.conv_admin_alert_log from public, anon, authenticated;
grant all on public.conv_admin_alert_log to service_role;

create function conv_private.admin_prefs_json(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'briefing_enabled', coalesce(p.briefing_enabled, true), 'briefing_style', coalesce(p.briefing_style, 'completo'),
    'alerts_enabled', coalesce(p.alerts_enabled, true), 'min_balance_cents', p.min_balance_cents,
    'overdue_days', coalesce(p.overdue_days, 7), 'default_account', a.name)
  from (select 1) d left join public.conv_admin_prefs p on p.profile_id = p_profile left join public.fin_accounts a on a.id = p.default_account_id $$;

create function conv_private.ai_admin_prefs(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_admin uuid := conv_private.ai_admin_requester(p_session);
begin
  if v_admin is null then return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.'); end if;
  return jsonb_build_object('ok', true, 'prefs', conv_private.admin_prefs_json(v_admin));
end $$;
create function public.conv_svc_ai_admin_prefs(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select conv_private.ai_admin_prefs(p_session) $$;

-- Quem não quer o resumo da manhã sai da lista (a preferência vale sobre a tabela de destinatários).
create or replace function conv_private.admin_briefing_targets() returns table(profile_id uuid, name text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.profile_id, p.name, cv.id
  from public.conv_admin_briefing_recipients r
  join public.profiles p on p.id = r.profile_id and p.role::text = 'admin' and coalesce(p.is_active, true)
  join public.conv_contacts c on c.profile_id = r.profile_id and c.merged_into is null and c.link_status in ('linked', 'manual') and not c.opt_out
  join lateral (select v.id from public.conv_conversations v where v.contact_id = c.id and v.kind = 'direct' and v.merged_into is null
                order by v.last_message_at desc nulls last limit 1) cv on true
  left join public.conv_admin_prefs pr on pr.profile_id = r.profile_id
  where r.enabled and coalesce(pr.briefing_enabled, true)
$$;

-- O estilo do resumo (completo/curto) acompanha os dados.
alter function conv_private.admin_briefing_data(uuid) rename to admin_briefing_data_base;
create function conv_private.admin_briefing_data(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb := conv_private.admin_briefing_data_base(p_profile);
begin
  if coalesce((v->>'ok')::boolean, false) then
    v := jsonb_set(v, '{data}', (v->'data') || jsonb_build_object('style', conv_private.admin_prefs_json(p_profile)->>'briefing_style'));
  end if;
  return v;
end $$;

create function conv_private.admin_alert_targets() returns table(profile_id uuid, name text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.profile_id, p.name, cv.id
  from public.conv_admin_briefing_recipients r
  join public.profiles p on p.id = r.profile_id and p.role::text = 'admin' and coalesce(p.is_active, true)
  join public.conv_contacts c on c.profile_id = r.profile_id and c.merged_into is null and c.link_status in ('linked', 'manual') and not c.opt_out
  join lateral (select v.id from public.conv_conversations v where v.contact_id = c.id and v.kind = 'direct' and v.merged_into is null
                order by v.last_message_at desc nulls last limit 1) cv on true
  left join public.conv_admin_prefs pr on pr.profile_id = r.profile_id
  where r.enabled and coalesce(pr.alerts_enabled, true)
$$;
create function public.conv_svc_admin_alert_targets() returns table(profile_id uuid, name text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$ select * from conv_private.admin_alert_targets() $$;

-- Dados dos alertas, lidos como o administrador. Os limites vêm das preferências dele.
create function conv_private.admin_alert_data(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev_claims text; v_prev_sub text; v_err text; v_out jsonb; v_prefs jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date; v_days int;
begin
  if not exists (select 1 from conv_private.admin_alert_targets() t where t.profile_id = p_profile) then
    return conv_private.vfail('NOT_A_RECIPIENT', 'Esse administrador não recebe alertas.');
  end if;
  v_prefs := conv_private.admin_prefs_json(p_profile);
  v_days := (v_prefs->>'overdue_days')::int;
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  begin
    select jsonb_build_object(
      'today', v_today, 'overdue_days', v_days, 'min_balance_cents', v_prefs->'min_balance_cents',
      'total_cents', coalesce((select sum(b.balance_cents) from public.fin_account_balances(v_today) b where b.active), 0),
      'overdue', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(st.total_due), 0), 'members', count(distinct c.profile_id))
                  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, v_today) st
                  where c.status in ('open', 'partial') and c.due_date <= v_today - v_days and st.total_due > 0),
      'receipts_waiting', (select jsonb_build_object('count', count(*)) from public.fin_receipt_submissions r
                           where r.status in ('submitted', 'in_review') and r.created_at < now() - interval '24 hours'),
      'payables', (select jsonb_build_object('overdue_cents', coalesce(p.payable_overdue_cents, 0), 'overdue_count', coalesce(p.payable_overdue_count, 0))
                   from public.fin_payables_summary(v_today) p))
    into v_out;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null then return conv_private.vfail('ALERTS_FAILED', 'Não consegui checar os alertas agora.'); end if;
  return jsonb_build_object('ok', true, 'data', v_out);
end $$;
create function public.conv_svc_admin_alert_data(p_profile uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.admin_alert_data(p_profile) $$;

-- Cada regra avisa no máximo uma vez por dia por administrador.
create function public.conv_svc_admin_alert_claim(p_profile uuid, p_rule text, p_day date) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.conv_admin_alert_log(profile_id, rule, day) values (p_profile, p_rule, p_day) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
create function public.conv_svc_admin_alert_release(p_profile uuid, p_rule text, p_day date) returns void
language sql security definer set search_path = '' as $$ delete from public.conv_admin_alert_log where profile_id = p_profile and rule = p_rule and day = p_day $$;

-- ---------------------------------------------------------------------------------------------- proposta
create function conv_private.ai_admin_wave8_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_action text := p->>'action';
  v_id uuid; v_payload jsonb; v_now timestamp := now() at time zone 'America/Fortaleza';
  v_prof record; v_n int; v_list text; v_conv uuid; v_name text; v_date date; v_time time; v_due timestamptz; v_note text; v_send text;
  v_fu record; v_court record; v_start int; v_dur int; v_end int; v_pref text := p->>'pref'; v_val text := nullif(trim(coalesce(p->>'value', '')), '');
  v_active boolean; v_amount bigint; v_acc record; v_who text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  v_active := case when p ? 'active' and jsonb_typeof(p->'active') = 'boolean' then (p->>'active')::boolean end;

  if v_action in ('adm_followup_create', 'adm_followup_done') then
    -- Sem nome vale a própria conversa do administrador (lembrete para si).
    if nullif(trim(coalesce(p->>'member_name', '')), '') is null then
      v_conv := sess.conversation_id; v_name := null;
    else
      select count(*) into v_n from public.profiles pr where coalesce(pr.is_active, true) and fin_private.fold_text(pr.name) like '%' || fin_private.fold_text(p->>'member_name') || '%';
      if v_n = 0 then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei "' || (p->>'member_name') || '" entre os cadastros.'); end if;
      if v_n > 1 then
        select string_agg(x.name, ', ') into v_list from (select pr.name from public.profiles pr where coalesce(pr.is_active, true)
          and fin_private.fold_text(pr.name) like '%' || fin_private.fold_text(p->>'member_name') || '%' order by pr.name limit 8) x;
        return conv_private.vfail('MEMBER_AMBIGUOUS', 'Tenho mais de um "' || (p->>'member_name') || '": ' || v_list || '. Qual deles?');
      end if;
      select pr.id, pr.name into v_prof from public.profiles pr where coalesce(pr.is_active, true) and fin_private.fold_text(pr.name) like '%' || fin_private.fold_text(p->>'member_name') || '%';
      v_name := v_prof.name;
      select cv.id into v_conv from public.conv_contacts c join public.conv_conversations cv on cv.contact_id = c.id and cv.kind = 'direct' and cv.merged_into is null
      where c.profile_id = v_prof.id and c.merged_into is null order by cv.last_message_at desc nulls last limit 1;
      if v_conv is null then return conv_private.vfail('NO_CONVERSATION', v_name || ' ainda não tem conversa comigo, então não dá para ligar um retorno a ela.'); end if;
    end if;
    v_who := coalesce(v_name, 'você');

    if v_action = 'adm_followup_create' then
      v_note := nullif(trim(coalesce(p->>'note', '')), '');
      v_send := nullif(trim(coalesce(p->>'send_body', '')), '');
      if v_note is null and v_send is null then return conv_private.vfail('FOLLOWUP_EMPTY', 'O que é para lembrar? Me diga a anotação do retorno.'); end if;
      v_date := nullif(p->>'date', '')::date;
      if v_date is null then return conv_private.vfail('INVALID_DATA', 'Para quando? Me diga o dia (e a hora, se quiser; senão uso 09h).'); end if;
      v_time := coalesce(nullif(p->>'start', '')::time, time '09:00');
      v_due := ((v_date::text || ' ' || v_time::text || '-03')::timestamptz);
      if v_due <= now() then return conv_private.vfail('INVALID_DUE_DATE', 'Esse horário já passou. Para quando então?'); end if;
      if v_name is null and v_send is null then v_send := 'Lembrete: ' || v_note; end if;
      v_payload := jsonb_strip_nulls(jsonb_build_object('conversation_id', v_conv, 'member_name', v_name, 'due_at', v_due, 'note', v_note, 'send_body', v_send, 'self', v_name is null));
    else
      select count(*) into v_n from public.conv_followups f where f.conversation_id = v_conv and f.status = 'pending'
        and (nullif(p->>'date', '') is null or (f.due_at at time zone 'America/Fortaleza')::date = (p->>'date')::date);
      if v_n = 0 then return conv_private.vfail('FOLLOWUP_NOT_FOUND', 'Não achei retorno pendente' || case when v_name is null then ' seu.' else ' de ' || v_name || '.' end); end if;
      if v_n > 1 then
        select string_agg(to_char(x.due_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI') || coalesce(' (' || x.note || ')', ''), '; ' order by x.due_at) into v_list
        from (select f.due_at, f.note from public.conv_followups f where f.conversation_id = v_conv and f.status = 'pending' order by f.due_at limit 6) x;
        return conv_private.vfail('FOLLOWUP_AMBIGUOUS', 'Há ' || v_n || ' retornos pendentes: ' || v_list || '. De qual dia é o que você quer?');
      end if;
      select f.id, f.note, f.due_at into v_fu from public.conv_followups f where f.conversation_id = v_conv and f.status = 'pending'
        and (nullif(p->>'date', '') is null or (f.due_at at time zone 'America/Fortaleza')::date = (p->>'date')::date);
      v_payload := jsonb_strip_nulls(jsonb_build_object('followup_id', v_fu.id, 'member_name', v_name, 'note', v_fu.note, 'due_at', v_fu.due_at,
        'new_status', case when v_active is false then 'canceled' else 'done' end));
    end if;

  elsif v_action = 'adm_court_block' then
    if nullif(trim(coalesce(p->>'court_label', '')), '') is null then return conv_private.vfail('COURT_REQUIRED', 'Qual quadra?'); end if;
    select count(*) into v_n from public.courts c where coalesce(c.is_active, true) and fin_private.fold_text(c.name) like '%' || fin_private.fold_text(p->>'court_label') || '%';
    if v_n = 0 then return conv_private.vfail('COURT_NOT_FOUND', 'Não achei a quadra "' || (p->>'court_label') || '".'); end if;
    if v_n > 1 then
      select string_agg(c.name, ', ' order by c.name) into v_list from public.courts c where coalesce(c.is_active, true) and fin_private.fold_text(c.name) like '%' || fin_private.fold_text(p->>'court_label') || '%';
      return conv_private.vfail('COURT_AMBIGUOUS', 'Qual destas quadras: ' || v_list || '?');
    end if;
    select c.id, c.name into v_court from public.courts c where coalesce(c.is_active, true) and fin_private.fold_text(c.name) like '%' || fin_private.fold_text(p->>'court_label') || '%';
    v_date := nullif(p->>'date', '')::date; v_time := nullif(p->>'start', '')::time;
    if v_date is null or v_time is null then return conv_private.vfail('INVALID_DATA', 'Qual o dia e o horário de início do bloqueio?'); end if;
    v_dur := nullif(p->>'duration', '')::int;
    if v_dur is null or v_dur < 30 or v_dur > 720 or v_dur % 30 <> 0 then return conv_private.vfail('INVALID_DURATION', 'Por quanto tempo? (de 30 em 30 minutos, até 12 horas)'); end if;
    v_start := extract(hour from v_time)::int * 60 + extract(minute from v_time)::int; v_end := v_start + v_dur;
    if v_end > 1440 then return conv_private.vfail('INVALID_DURATION', 'O bloqueio passa da meia-noite. Faça até 24h e outro no dia seguinte.'); end if;
    if (v_date::timestamp + make_interval(mins => v_end)) <= v_now then return conv_private.vfail('INVALID_DATA', 'Esse horário já passou.'); end if;
    if conv_private.court_busy(v_court.id, v_date, v_start, v_end) then
      select string_agg(to_char(r.start_time, 'HH24:MI') || '-' || to_char(r.end_time, 'HH24:MI') || ' ' || r.type || ' (' || coalesce(pr.name, r.guest_name, 'sem nome') || ')', '; ' order by r.start_time) into v_list
      from public.reservations r left join public.profiles pr on pr.id = r.creator_id
      where r.court_id = v_court.id and r.date = v_date and r.status::text <> 'cancelled'
        and (extract(hour from r.start_time)::int * 60 + extract(minute from r.start_time)::int) < v_end
        and (case when r.end_time = time '00:00' then 1440 else extract(hour from r.end_time)::int * 60 + extract(minute from r.end_time)::int end) > v_start;
      return conv_private.vfail('SLOT_TAKEN', 'Já há reserva nesse horário: ' || v_list || '. Cancele antes (posso fazer) e depois bloqueio.');
    end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object('court_id', v_court.id, 'court', v_court.name, 'date', v_date, 'start', to_char(v_time, 'HH24:MI'),
      'end', conv_private.min_to_hhmm(v_end), 'duration', v_dur, 'reason', nullif(trim(coalesce(p->>'reason', '')), '')));

  elsif v_action = 'adm_pref_set' then
    if v_pref not in ('resumo', 'estilo', 'alertas', 'saldo_minimo', 'dias_atraso', 'conta_padrao') then
      return conv_private.vfail('INVALID_PREF', 'Posso ajustar: resumo da manhã (liga/desliga), estilo do resumo (curto ou completo), alertas, saldo mínimo, dias de atraso ou conta padrão.');
    end if;
    if v_pref in ('resumo', 'alertas') then
      if v_active is null then return conv_private.vfail('INVALID_PREF', 'É para ligar ou desligar?'); end if;
      v_payload := jsonb_build_object('pref', v_pref, 'active', v_active);
    elsif v_pref = 'estilo' then
      if v_val not in ('curto', 'completo') then return conv_private.vfail('INVALID_PREF', 'O resumo pode ser "curto" ou "completo". Qual?'); end if;
      v_payload := jsonb_build_object('pref', v_pref, 'value', v_val);
    elsif v_pref = 'saldo_minimo' then
      if v_active is false then v_payload := jsonb_build_object('pref', v_pref, 'cents', null, 'active', false);
      else
        v_amount := nullif(p->>'amount_cents', '')::bigint;
        if v_amount is null or v_amount <= 0 or v_amount > 100000000000 then return conv_private.vfail('INVALID_AMOUNT', 'Abaixo de quanto devo avisar do caixa?'); end if;
        v_payload := jsonb_build_object('pref', v_pref, 'cents', v_amount);
      end if;
    elsif v_pref = 'dias_atraso' then
      if v_val is null or v_val !~ '^\d{1,2}$' or v_val::int not between 1 and 90 then return conv_private.vfail('INVALID_PREF', 'Avisar a partir de quantos dias de atraso? (de 1 a 90)'); end if;
      v_payload := jsonb_build_object('pref', v_pref, 'value', v_val::int);
    else
      if v_active is false then v_payload := jsonb_build_object('pref', v_pref, 'active', false);
      else
        select count(*), min(a.id::text)::uuid into v_n, v_id from public.fin_accounts a where a.active and fin_private.fold_text(a.name) like '%' || fin_private.fold_text(coalesce(p->>'account_name', '')) || '%'
          and nullif(trim(coalesce(p->>'account_name', '')), '') is not null;
        if v_n <> 1 then
          select string_agg(a.name, ', ' order by a.position, a.name) into v_list from public.fin_accounts a where a.active;
          return conv_private.vfail('ACCOUNT_REQUIRED', 'Qual conta fica como padrão? Contas: ' || coalesce(v_list, '(nenhuma ativa)') || '.');
        end if;
        select a.id, a.name into v_acc from public.fin_accounts a where a.id = v_id;
        v_payload := jsonb_build_object('pref', v_pref, 'account_id', v_acc.id, 'account_name', v_acc.name);
      end if;
    end if;
  else
    return conv_private.vfail('INVALID_ACTION', 'Ação inválida.');
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, v_action, v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data, hora ou valor).');
end $$;
create function public.conv_svc_ai_admin_wave8_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_wave8_propose(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- confirmação
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_wave7_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb := '{}'::jsonb; v_err text; v_code text; v_id uuid; v_pref text; v_n int;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('adm_followup_create', 'adm_followup_done', 'adm_court_block', 'adm_pref_set') then
    return conv_private.ai_confirm_wave7_step(p_proposal, p_message);
  end if;
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

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'adm_followup_create' then
      v_id := public.conv_add_followup((bp.payload->>'conversation_id')::uuid, (bp.payload->>'due_at')::timestamptz, bp.payload->>'note', bp.payload->>'send_body');
      v_res := jsonb_build_object('id', v_id);
    elsif bp.action = 'adm_followup_done' then
      perform public.conv_update_followup((bp.payload->>'followup_id')::uuid, bp.payload->>'new_status');
      v_res := jsonb_build_object('id', bp.payload->>'followup_id');
    elsif bp.action = 'adm_court_block' then
      if conv_private.court_busy((bp.payload->>'court_id')::uuid, (bp.payload->>'date')::date,
           extract(hour from (bp.payload->>'start')::time)::int * 60 + extract(minute from (bp.payload->>'start')::time)::int,
           extract(hour from (bp.payload->>'start')::time)::int * 60 + extract(minute from (bp.payload->>'start')::time)::int + (bp.payload->>'duration')::int) then
        raise exception 'SLOT_TAKEN';
      end if;
      insert into public.reservations(type, date, start_time, end_time, court_id, creator_id, participant_ids, observation, status)
      values ('Play', (bp.payload->>'date')::date, (bp.payload->>'start')::time, (bp.payload->>'end')::time, (bp.payload->>'court_id')::uuid, v_admin, '{}',
        'Bloqueio' || coalesce(': ' || (bp.payload->>'reason'), ''), 'active')
      returning id into v_id;
      v_res := jsonb_build_object('id', v_id);
    else
      v_pref := bp.payload->>'pref';
      insert into public.conv_admin_prefs(profile_id) values (v_admin) on conflict do nothing;
      if v_pref = 'resumo' then update public.conv_admin_prefs set briefing_enabled = (bp.payload->>'active')::boolean, updated_at = now() where profile_id = v_admin;
      elsif v_pref = 'alertas' then update public.conv_admin_prefs set alerts_enabled = (bp.payload->>'active')::boolean, updated_at = now() where profile_id = v_admin;
      elsif v_pref = 'estilo' then update public.conv_admin_prefs set briefing_style = bp.payload->>'value', updated_at = now() where profile_id = v_admin;
      elsif v_pref = 'saldo_minimo' then update public.conv_admin_prefs set min_balance_cents = nullif(bp.payload->>'cents', '')::bigint, updated_at = now() where profile_id = v_admin;
      elsif v_pref = 'dias_atraso' then update public.conv_admin_prefs set overdue_days = (bp.payload->>'value')::int, updated_at = now() where profile_id = v_admin;
      else update public.conv_admin_prefs set default_account_id = nullif(bp.payload->>'account_id', '')::uuid, updated_at = now() where profile_id = v_admin;
      end if;
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'Não consegui concluir: ' || v_code || '.');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_booking_proposals', bp.id::text, null,
    jsonb_build_object('action', bp.action, 'target', coalesce(v_res->>'id', bp.payload->>'pref')),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.admin_prefs_json(uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_prefs(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_prefs(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_prefs(uuid) to service_role;
revoke all on function conv_private.admin_briefing_targets() from public, anon, authenticated;
revoke all on function conv_private.admin_briefing_data_base(uuid) from public, anon, authenticated;
revoke all on function conv_private.admin_briefing_data(uuid) from public, anon, authenticated;
revoke all on function conv_private.admin_alert_targets() from public, anon, authenticated;
revoke all on function public.conv_svc_admin_alert_targets() from public, anon, authenticated;
grant execute on function public.conv_svc_admin_alert_targets() to service_role;
revoke all on function conv_private.admin_alert_data(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_admin_alert_data(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_admin_alert_data(uuid) to service_role;
revoke all on function public.conv_svc_admin_alert_claim(uuid, text, date) from public, anon, authenticated;
grant execute on function public.conv_svc_admin_alert_claim(uuid, text, date) to service_role;
revoke all on function public.conv_svc_admin_alert_release(uuid, text, date) from public, anon, authenticated;
grant execute on function public.conv_svc_admin_alert_release(uuid, text, date) to service_role;
revoke all on function conv_private.ai_admin_wave8_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_wave8_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_wave8_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_wave7_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------- leituras (acrescenta followups e preferencias)
-- Onda 1 do assessor administrativo: consultas (só leitura) sob demanda, por domínio.
-- Rodam COMO o administrador (mesmas funções e regras do painel) e só na conversa privada com administrador.
-- Domínios: caixa, receber_pagar, dre, receita_alunos, comprovantes, acessos, assinaturas, ocupacao.
create or replace function conv_private.ai_admin_read(p_session uuid, p_domain text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_prev_claims text; v_prev_sub text; v_err text; v_out jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_from date; v_to date; v_day date;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  begin
    v_from := coalesce(nullif(p_args->>'from', '')::date, date_trunc('month', v_today)::date);
    v_to := coalesce(nullif(p_args->>'to', '')::date, v_today);
    v_day := coalesce(nullif(p_args->>'date', '')::date, v_today);
  exception when others then
    return conv_private.vfail('INVALID_DATA', 'Não entendi o período. Pode dizer as datas?');
  end;
  if v_to < v_from or v_to - v_from > 731 then
    return conv_private.vfail('INVALID_DATA', 'Esse período não vale (início depois do fim, ou mais de 2 anos).');
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if p_domain = 'caixa' then
      select jsonb_build_object('from', v_from, 'to', v_to,
        'opening_cents', (array_agg(opening_cents order by bucket_start))[1],
        'inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0),
        'net_cents', coalesce(sum(net_cents), 0),
        'closing_cents', (array_agg(closing_cents order by bucket_start desc))[1])
      into v_out from public.fin_cash_flow(v_from, v_to, 'month', null);
    elsif p_domain = 'receber_pagar' then
      select jsonb_build_object('receivables', (select to_jsonb(r) from public.fin_receivables_summary(v_today) r),
                                'payables', (select to_jsonb(p) from public.fin_payables_summary(v_today) p))
      into v_out;
    elsif p_domain = 'dre' then
      -- fin_dre_lines devolve o período pedido ('current') e o anterior de mesma duração ('previous'); valores sempre positivos.
      select jsonb_build_object('from', v_from, 'to', v_to,
        'by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'current' group by line) x), '[]'::jsonb),
        'previous_by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'previous' group by line) w), '[]'::jsonb),
        'top', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'name', name, 'amount_cents', amt) order by amt desc)
                         from (select line, name, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to)
                               where period = 'current' group by line, name having sum(amount_cents) <> 0 order by sum(amount_cents) desc limit 12) y), '[]'::jsonb))
      into v_out;
    elsif p_domain = 'comparativo' then
      -- Período pedido x anterior de mesma duração (fin_dre_lines), por categoria, para explicar o que mudou.
      select jsonb_build_object('from', v_from, 'to', v_to,
        'by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'current' group by line) x), '[]'::jsonb),
        'previous_by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'previous' group by line) w), '[]'::jsonb),
        'changes', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'name', name, 'current_cents', cur, 'previous_cents', prev, 'delta_cents', cur - prev) order by abs(cur - prev) desc)
                             from (select line, name,
                                          coalesce(sum(amount_cents) filter (where period = 'current'), 0)::bigint cur,
                                          coalesce(sum(amount_cents) filter (where period = 'previous'), 0)::bigint prev
                                   from public.fin_dre_lines(v_from, v_to) group by line, name
                                   having coalesce(sum(amount_cents) filter (where period = 'current'), 0) <> coalesce(sum(amount_cents) filter (where period = 'previous'), 0)
                                   order by abs(coalesce(sum(amount_cents) filter (where period = 'current'), 0) - coalesce(sum(amount_cents) filter (where period = 'previous'), 0)) desc limit 10) c), '[]'::jsonb))
      into v_out;
    elsif p_domain = 'followups' then
      select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('who', x.who, 'note', x.note, 'due_at', x.due_at, 'sends', x.sends) order by x.due_at), '[]'::jsonb))
      into v_out from (
        select coalesce(pr.name, g.name, ct.name, 'Conversa') who, f.note, f.due_at, f.send_body is not null sends
        from public.conv_followups f join public.conv_conversations cv on cv.id = f.conversation_id
        left join public.conv_contacts ct on ct.id = cv.contact_id left join public.profiles pr on pr.id = ct.profile_id
        left join public.conv_groups g on g.id = cv.group_id
        where f.status = 'pending' order by f.due_at limit 15) x;
    elsif p_domain = 'preferencias' then
      v_out := conv_private.admin_prefs_json(v_admin);
    elsif p_domain = 'receita_alunos' then
      select jsonb_build_object('from', v_from, 'to', v_to, 'count', count(*), 'total_cents', coalesce(sum(amount_cents), 0),
        'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(category_name, 'Sem categoria'), 'amount_cents', amt) order by amt desc)
                                 from (select category_name, sum(amount_cents)::bigint amt from public.fin_student_revenue(v_from, v_to) group by category_name) z), '[]'::jsonb))
      into v_out from public.fin_student_revenue(v_from, v_to);
    elsif p_domain = 'comprovantes' then
      select jsonb_build_object('total', coalesce(max(total_count), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('member', profile_name, 'status', status, 'declared_amount_cents', declared_amount_cents,
          'declared_paid_on', declared_paid_on, 'possible_duplicate', possible_duplicate, 'created_at', created_at) order by created_at), '[]'::jsonb))
      into v_out from public.fin_receipt_queue('pending', 15, 0);
    elsif p_domain = 'acessos' then
      select jsonb_build_object('total', count(*),
        'items', coalesce(jsonb_agg(jsonb_build_object('name', name, 'created_at', created_at) order by created_at) filter (where rn <= 15), '[]'::jsonb))
      into v_out from (select name, created_at, row_number() over (order by created_at) rn from public.access_requests where status = 'pending') a;
    elsif p_domain = 'assinaturas' then
      select jsonb_build_object('documents', coalesce(jsonb_agg(jsonb_build_object('title', title, 'version', version, 'due_at', due_at,
        'recipients', recipients, 'signed', signed, 'notifications_failed', notifications_failed, 'no_phone', no_phone) order by published_at desc), '[]'::jsonb))
      into v_out from public.sig_documents_overview where status = 'published';
    elsif p_domain = 'ocupacao' then
      select jsonb_build_object('date', v_day, 'items', coalesce(jsonb_agg(jsonb_build_object('court', c.name, 'start', to_char(r.start_time, 'HH24:MI'),
        'end', to_char(r.end_time, 'HH24:MI'), 'type', r.type, 'by', coalesce(p.name, r.guest_name)) order by c.name, r.start_time), '[]'::jsonb))
      into v_out from public.reservations r join public.courts c on c.id = r.court_id left join public.profiles p on p.id = r.creator_id
      where r.date = v_day and coalesce(r.status::text, 'active') = 'active';
    else
      v_err := 'UNKNOWN_DOMAIN';
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    return conv_private.vfail(case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'READ_FAILED' end,
      'Não consegui consultar isso agora.');
  end if;
  perform conv_private.audit('ai_admin_read', 'conv_ai_sessions', p_session::text, null,
    jsonb_build_object('domain', p_domain, 'from', v_from, 'to', v_to),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'requester_profile_id', v_admin), v_admin);
  return jsonb_build_object('ok', true, 'domain', p_domain, 'data', v_out);
end $$;

create or replace function public.conv_svc_ai_admin_read(p_session uuid, p_domain text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_read(p_session, p_domain, coalesce(p_args, '{}'::jsonb)) $$;

revoke all on function conv_private.ai_admin_read(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_read(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_read(uuid, text, jsonb) to service_role;
