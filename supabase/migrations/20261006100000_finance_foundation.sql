-- Financeiro do clube — fundação (1/5).
--
-- Contas, categorias, lançamentos (a pagar/receber, pontuais e recorrentes),
-- transferências, anexos, configuração (vencimento, dia útil, encargos),
-- calendário de feriados, idempotência e auditoria.
--
-- Regra que organiza todo o módulo: **o que o sistema já sabe não é copiado.**
-- Reservas, `student_payments`, `profiles` e `non_socio_students`
-- continuam sendo a origem; as tabelas `fin_*` só guardam fatos que o STC não
-- conhecia. Padrões adaptados do North Jato (`nj_fin_*`), sem alterá-lo.
--
-- Segurança: toda escrita passa por função `SECURITY DEFINER` (autor =
-- `auth.uid()`); `anon`/`authenticated` não têm INSERT/UPDATE/DELETE direto.
-- Funções internas ficam em `fin_private` (schema não exposto pela API).
-- Nenhuma tabela existente é alterada. Não há DELETE em dado financeiro.
--
-- NÃO aplicar no remoto sem seguir docs/financeiro/OPERACAO_E_MIGRATIONS.md.

create schema if not exists fin_private;
revoke all on schema fin_private from public, anon, authenticated;
alter default privileges in schema fin_private revoke execute on functions from public;

-- ------------------------------------------------------------------
-- 1. Utilidades
-- ------------------------------------------------------------------
create function fin_private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Fortaleza')::date $$;

-- Só administrador gere o financeiro (papel já existente no STC: `is_admin()`).
create function fin_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'FINANCE_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ------------------------------------------------------------------
-- 2. Idempotência e auditoria
-- ------------------------------------------------------------------
-- A mesma chave devolve o mesmo resultado. Duas chamadas concorrentes com a
-- mesma chave: a segunda espera no índice único e então lê o resultado da
-- primeira. Chave reaproveitada para outra ação/usuário é recusada.
create table public.fin_requests (
  request_id uuid primary key,
  action text not null,
  actor_id uuid references public.profiles(id),
  result jsonb,
  created_at timestamptz not null default now()
);
create index fin_requests_actor_idx on public.fin_requests(actor_id);

create function fin_private.begin_op(p_key uuid, p_action text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_row public.fin_requests%rowtype;
begin
  if v_actor is null then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
  if p_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  insert into public.fin_requests(request_id, action, actor_id) values (p_key, p_action, v_actor)
  on conflict (request_id) do nothing;
  if not found then
    select * into v_row from public.fin_requests where request_id = p_key;
    if v_row.action <> p_action or v_row.actor_id is distinct from v_actor then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return coalesce(v_row.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  perform set_config('fin.action', p_action, true);
  perform set_config('fin.reason', coalesce(trim(p_reason), ''), true);
  perform set_config('fin.request_id', p_key::text, true);
  return null;
end $$;

create function fin_private.finish_op(p_key uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.fin_requests set result = p_result where request_id = p_key;
  return p_result;
end $$;

-- Registro de auditoria usando a trilha que o STC já tem (`admin_audit_logs`).
-- Campos sensíveis do comprovante (caminho do arquivo e dados lidos) não vão
-- para o log.
create function fin_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[]; v_target uuid; v_reason text;
  v_strip text[] := array['ocr', 'storage_path', 'content_sha256'];
  v_key text;
begin
  if tg_op = 'DELETE' then v_old := to_jsonb(old); v_row := v_old;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
    if v_old = v_new then return new; end if;
  else v_new := to_jsonb(new); v_row := v_new; end if;

  foreach v_key in array v_strip loop
    v_old := v_old - v_key; v_new := v_new - v_key;
  end loop;
  if tg_op = 'UPDATE' then v_changed := public.admin_audit_changed_fields(v_old, v_new); end if;
  v_target := public.admin_audit_try_uuid(v_row->>'profile_id');
  v_reason := nullif(current_setting('fin.reason', true), '');

  perform public.admin_audit_insert_log(
    'fin.' || coalesce(nullif(current_setting('fin.action', true), ''), lower(tg_op)),
    tg_table_name,
    coalesce(v_row->>'id', v_row->>'request_id', v_row->>'holiday_date'),
    v_target,
    case when v_target is null then '{}'::uuid[] else array[v_target] end,
    v_changed, v_old, v_new,
    jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'request_id', nullif(current_setting('fin.request_id', true), ''), 'op', lower(tg_op))),
    'finance', now());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Para tabelas LEGADAS (ex.: `student_payments`): a auditoria nunca pode
-- derrubar a operação existente — falha vira aviso.
create function fin_private.audit_row_soft() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  begin
    if tg_op = 'INSERT' then v_new := to_jsonb(new);
    elsif tg_op = 'UPDATE' then v_old := to_jsonb(old); v_new := to_jsonb(new);
    else v_old := to_jsonb(old); end if;
    perform fin_private.audit_row_dispatch(tg_op, v_old, v_new, tg_table_name);
  exception when others then
    raise warning 'fin audit (legado) falhou em %: %', tg_table_name, sqlerrm;
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create function fin_private.audit_row_dispatch(p_op text, p_old jsonb, p_new jsonb, p_table text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := coalesce(p_new, p_old); v_changed text[];
begin
  if p_op = 'UPDATE' then
    if p_old = p_new then return; end if;
    v_changed := public.admin_audit_changed_fields(p_old, p_new);
  end if;
  perform public.admin_audit_insert_log(
    'fin.' || coalesce(nullif(current_setting('fin.action', true), ''), lower(p_op)),
    p_table, v_row->>'id', null, '{}'::uuid[], v_changed,
    case when p_op = 'INSERT' then null else p_old end,
    case when p_op = 'DELETE' then null else p_new end,
    jsonb_build_object('op', lower(p_op), 'legacy_table', true), 'finance', now());
end $$;

-- Registro financeiro não se apaga: cancela, estorna, desativa ou arquiva.
create function fin_private.no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'FINANCE_NO_DELETE'; end $$;

-- ------------------------------------------------------------------
-- 3. Configuração (singleton)
-- ------------------------------------------------------------------
create table public.fin_settings (
  id boolean primary key default true check (id),
  -- Vencimento. Regra inicial informada pelo clube: dia 5 do mês seguinte ao
  -- período cobrado; dia não útil → próximo dia útil.
  due_day smallint not null default 5 check (due_day between 1 and 31),
  due_month_offset smallint not null default 1 check (due_month_offset between 0 and 2),
  non_business_rule text not null default 'next_business_day'
    check (non_business_rule in ('next_business_day', 'previous_business_day', 'keep')),
  saturday_is_business boolean not null default false,
  -- Quantos meses à frente das competências em curso as cobranças são geradas.
  horizon_months smallint not null default 1 check (horizon_months between 0 and 24),
  -- Encargos de atraso: TUDO nulo até o admin configurar E confirmar.
  late_fee_confirmed_at timestamptz,
  late_fee_confirmed_by uuid references public.profiles(id),
  grace_days smallint not null default 0 check (grace_days between 0 and 60),
  fine_fixed_cents bigint check (fine_fixed_cents is null or (fine_fixed_cents >= 0 and fine_fixed_cents <= 100000000)),
  fine_percent_bps integer check (fine_percent_bps is null or (fine_percent_bps >= 0 and fine_percent_bps <= 10000)),
  interest_daily_fixed_cents bigint check (interest_daily_fixed_cents is null or (interest_daily_fixed_cents >= 0 and interest_daily_fixed_cents <= 100000000)),
  interest_daily_percent_bps integer check (interest_daily_percent_bps is null or (interest_daily_percent_bps >= 0 and interest_daily_percent_bps <= 10000)),
  -- Day Card = taxa cobrada de convidado (não-sócio) de um sócio, para ter acesso ao
  -- clube por um dia. Nada a ver com aula. O valor é o que o app JÁ usa (constante
  -- `DAY_USE_PRICE` em FinanceiroAdmin), importado como está; passa a ser editável.
  -- (A Aula avulsa e o Card Mensal dos alunos NÃO usam este valor: valem o que foi
  -- pago e registrado em `student_payments`.)
  day_card_price_cents bigint not null default 5000 check (day_card_price_cents >= 0 and day_card_price_cents <= 100000000),
  -- O Day Card é derivado da reserva com convidado (não há registro de pagamento).
  -- Por padrão só conta na competência (DRE); no caixa só se o clube disser que recebe na hora.
  day_card_in_cash boolean not null default false,
  -- Nomes esperados do favorecido nos comprovantes (vazio = não conferir).
  payee_names text[] not null default '{}',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.fin_settings(id) values (true);

-- ------------------------------------------------------------------
-- 4. Calendário de feriados
-- ------------------------------------------------------------------
create table public.fin_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check (length(trim(name)) between 2 and 80),
  scope text not null check (scope in ('national', 'state', 'municipal', 'club')),
  kind text not null default 'holiday' check (kind in ('holiday', 'optional')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique (holiday_date, scope)
);
create index fin_holidays_active_idx on public.fin_holidays(holiday_date) where active;

-- Domingo de Páscoa (Meeus/Jones/Butcher). Espelho de `easterSunday` (lib/finance/calendar.ts).
create function fin_private.easter(p_year integer) returns date
language plpgsql immutable set search_path = '' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := p_year % 19; b := p_year / 100; c := p_year % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end $$;

-- Feriados NACIONAIS por lei (ativos) + pontos facultativos de banco (INATIVOS).
-- Nunca presume feriado estadual/municipal. Idempotente; respeita o que o admin
-- já desativou (conflito não regrava).
create function fin_private.seed_holidays(p_year integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_easter date := fin_private.easter(p_year); v_n integer;
begin
  insert into public.fin_holidays(holiday_date, name, scope, kind, active)
  select * from (values
    (make_date(p_year, 1, 1), 'Confraternização Universal', 'national', 'holiday', true),
    (v_easter - 2, 'Sexta-feira Santa', 'national', 'holiday', true),
    (make_date(p_year, 4, 21), 'Tiradentes', 'national', 'holiday', true),
    (make_date(p_year, 5, 1), 'Dia do Trabalho', 'national', 'holiday', true),
    (make_date(p_year, 9, 7), 'Independência do Brasil', 'national', 'holiday', true),
    (make_date(p_year, 10, 12), 'Nossa Senhora Aparecida', 'national', 'holiday', true),
    (make_date(p_year, 11, 2), 'Finados', 'national', 'holiday', true),
    (make_date(p_year, 11, 15), 'Proclamação da República', 'national', 'holiday', true),
    (make_date(p_year, 12, 25), 'Natal', 'national', 'holiday', true),
    (v_easter - 48, 'Carnaval (segunda-feira)', 'national', 'optional', false),
    (v_easter - 47, 'Carnaval (terça-feira)', 'national', 'optional', false),
    (v_easter + 60, 'Corpus Christi', 'national', 'optional', false)
  ) v(d, n, s, k, a)
  on conflict (holiday_date, scope) do nothing;
  get diagnostics v_n = row_count;
  if p_year >= 2024 then
    insert into public.fin_holidays(holiday_date, name, scope, kind, active)
    values (make_date(p_year, 11, 20), 'Dia da Consciência Negra', 'national', 'holiday', true)
    on conflict (holiday_date, scope) do nothing;
  end if;
  return v_n;
end $$;

do $$ declare y integer; begin
  for y in 2024..2036 loop perform fin_private.seed_holidays(y); end loop;
end $$;

create function fin_private.is_business_day(p_date date) returns boolean
language sql stable set search_path = '' as $$
  select case extract(dow from p_date)::int
           when 0 then false
           when 6 then coalesce((select saturday_is_business from public.fin_settings), false)
           else true end
     and not exists (select 1 from public.fin_holidays h where h.holiday_date = p_date and h.active)
$$;

create function fin_private.adjust_business_day(p_date date, p_rule text) returns date
language plpgsql stable set search_path = '' as $$
declare d date := p_date; v_step integer; i integer := 0;
begin
  if p_rule = 'keep' or fin_private.is_business_day(d) then return d; end if;
  v_step := case when p_rule = 'previous_business_day' then -1 else 1 end;
  while i < 366 loop
    d := d + v_step; i := i + 1;
    if fin_private.is_business_day(d) then return d; end if;
  end loop;
  raise exception 'NO_BUSINESS_DAY';
end $$;

-- Vencimento: dia `p_due_day` do mês (fim do período + offset), ajustado ao dia
-- útil. Espelho de `computeDueDate` (lib/finance/calendar.ts).
create function fin_private.due_date(p_competence date, p_period_months integer, p_due_day integer, p_offset integer, p_rule text)
returns date language plpgsql stable set search_path = '' as $$
declare v_target date; v_last integer; v_nominal date;
begin
  v_target := (date_trunc('month', p_competence::timestamp) + make_interval(months => p_period_months - 1 + p_offset))::date;
  v_last := extract(day from (date_trunc('month', v_target::timestamp) + interval '1 month - 1 day'))::integer;
  v_nominal := v_target + (least(greatest(p_due_day, 1), v_last) - 1);
  return fin_private.adjust_business_day(v_nominal, p_rule);
end $$;

-- Gera os feriados de um ano antes de usar o calendário nele (idempotente).
create function fin_private.ensure_holidays(p_from_year integer, p_to_year integer) returns void
language plpgsql security definer set search_path = '' as $$
declare y integer;
begin
  for y in p_from_year..p_to_year loop perform fin_private.seed_holidays(y); end loop;
end $$;

-- ------------------------------------------------------------------
-- 5. Contas, categorias, lançamentos, recorrências, anexos
-- ------------------------------------------------------------------
create table public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  kind text not null check (kind in ('cash', 'bank', 'card', 'other')),
  opening_balance_cents bigint not null default 0 check (abs(opening_balance_cents) <= 100000000000),
  opening_date date not null,
  -- Conta que recebe o dinheiro de `student_payments` (legado, sem conta/meio informados).
  is_default_receipts boolean not null default false,
  active boolean not null default true,
  position integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create unique index fin_accounts_name_key on public.fin_accounts(lower(name));
create unique index fin_accounts_one_default_receipts on public.fin_accounts(is_default_receipts) where is_default_receipts;

-- Categoria (grupo: `parent_id` nulo) e subcategoria. `dre_line` diz em que
-- linha do DRE o valor cai; `none` = só fluxo de caixa. `system_key` marca as
-- categorias que os motores usam (reservadas: não se lança nelas à mão).
create table public.fin_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.fin_categories(id),
  name text not null check (length(trim(name)) between 2 and 60),
  kind text not null check (kind in ('expense', 'revenue')),
  dre_line text not null check (dre_line in ('revenue', 'deduction', 'variable_cost', 'operational', 'administrative', 'commercial', 'financial', 'none')),
  system_key text unique,
  active boolean not null default true,
  position integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  check ((kind = 'revenue' and dre_line in ('revenue', 'deduction', 'none')) or
         (kind = 'expense' and dre_line in ('variable_cost', 'operational', 'administrative', 'commercial', 'financial', 'none'))),
  check (parent_id is null or parent_id <> id)
);
create unique index fin_categories_name_key
  on public.fin_categories(coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index fin_categories_parent_idx on public.fin_categories(parent_id);

-- Compromisso recorrente (só despesa). Não é a conta: cada competência vira um
-- lançamento próprio em `fin_entries`, com status, pagamento e histórico seus.
create table public.fin_recurrences (
  id uuid primary key default gen_random_uuid(),
  description text not null check (length(trim(description)) between 2 and 140),
  supplier text check (supplier is null or length(supplier) <= 120),
  category_id uuid not null references public.fin_categories(id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  frequency text not null check (frequency in ('monthly', 'quarterly', 'yearly')),
  due_day smallint not null check (due_day between 1 and 31),
  due_month_offset smallint not null default 0 check (due_month_offset between 0 and 2),
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  account_id uuid references public.fin_accounts(id),
  notes text check (notes is null or length(notes) <= 1000),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create index fin_recurrences_category_idx on public.fin_recurrences(category_id);
create index fin_recurrences_account_idx on public.fin_recurrences(account_id);

-- Fatos que o STC não conhecia: despesa/receita (a pagar/receber ou pontual),
-- aporte, retirada, transferência e devolução a sócio. "Vencida" não é status
-- gravado: é pendente/parcial com vencimento no passado, calculado na leitura.
create table public.fin_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('expense', 'revenue', 'contribution', 'withdrawal', 'transfer', 'member_refund')),
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid', 'canceled')),
  description text not null check (length(trim(description)) between 2 and 140),
  supplier text check (supplier is null or length(supplier) <= 120),
  category_id uuid references public.fin_categories(id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  competence_date date not null,
  due_date date,
  account_id uuid references public.fin_accounts(id),
  counter_account_id uuid references public.fin_accounts(id),
  recurrence_id uuid references public.fin_recurrences(id),
  notes text check (notes is null or length(notes) <= 1000),
  -- Pagou diferente do documento (juros/multa/desconto): diferença na quitação.
  adjustment_cents bigint not null default 0,
  settled_on date,
  request_id uuid not null unique,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  canceled_at timestamptz,
  canceled_by uuid references public.profiles(id),
  cancel_reason text,
  check ((kind in ('expense', 'revenue')) = (category_id is not null)),
  check ((kind = 'transfer') = (counter_account_id is not null)),
  check (counter_account_id is null or counter_account_id <> account_id),
  check (status <> 'canceled' or (canceled_at is not null and cancel_reason is not null)),
  check (kind in ('expense', 'revenue') or status in ('paid', 'canceled')),
  check (status <> 'paid' or settled_on is not null),
  check (status not in ('pending', 'partial') or due_date is not null),
  check (recurrence_id is null or kind = 'expense')
);
-- Uma obrigação por competência de cada recorrência: gerar duas vezes o mesmo
-- mês (botão + abertura da tela) esbarra aqui e vira nada.
create unique index fin_entries_recurrence_month on public.fin_entries(recurrence_id, competence_date)
  where recurrence_id is not null;
create index fin_entries_due_idx on public.fin_entries(due_date) where status in ('pending', 'partial');
create index fin_entries_competence_idx on public.fin_entries(competence_date);
create index fin_entries_category_idx on public.fin_entries(category_id);
create index fin_entries_account_idx on public.fin_entries(account_id);
create index fin_entries_counter_idx on public.fin_entries(counter_account_id);

-- Pagamentos/recebimentos de cada lançamento (parcial, baixa, estorno).
-- Append-only: estornar cria uma linha `reversal`, o histórico não se reescreve.
create table public.fin_entry_payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.fin_entries(id),
  kind text not null default 'payment' check (kind in ('payment', 'reversal')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_on date not null,
  account_id uuid not null references public.fin_accounts(id),
  reverses_payment_id uuid unique references public.fin_entry_payments(id),
  note text check (note is null or length(note) <= 500),
  actor_id uuid references public.profiles(id),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_payment_id is not null))
);
create index fin_entry_payments_entry_idx on public.fin_entry_payments(entry_id);
create index fin_entry_payments_paid_idx on public.fin_entry_payments(paid_on);
create index fin_entry_payments_account_idx on public.fin_entry_payments(account_id);

create table public.fin_attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.fin_entries(id),
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id)
);
create index fin_attachments_entry_idx on public.fin_attachments(entry_id);

-- ------------------------------------------------------------------
-- 6. Dados estruturais (categorias do DRE e das fontes automáticas)
--    Não são valores: sem elas nenhum fato teria linha no DRE. Editáveis,
--    exceto as com `system_key`.
-- ------------------------------------------------------------------
insert into public.fin_categories(name, kind, dre_line, system_key, position) values
  ('Receitas do clube', 'revenue', 'revenue', 'group.revenue', 1),
  ('Deduções da receita', 'revenue', 'deduction', 'group.deduction', 2),
  ('Custos variáveis', 'expense', 'variable_cost', 'group.cost', 10),
  ('Pessoal', 'expense', 'operational', 'group.people', 20),
  ('Estrutura', 'expense', 'operational', 'group.structure', 30),
  ('Divulgação e eventos', 'expense', 'commercial', 'group.marketing', 40),
  ('Administrativo', 'expense', 'administrative', 'group.admin', 50),
  ('Financeiro', 'expense', 'financial', 'group.financial', 60),
  ('Outras despesas', 'expense', 'operational', 'group.other', 70);

insert into public.fin_categories(parent_id, name, kind, dre_line, system_key, position)
select g.id, v.name, g.kind, coalesce(v.dre, g.dre_line), v.key, v.pos
from (values
  ('group.revenue', 'Mensalidades de sócios', null, 'member_fees', 1),
  ('group.revenue', 'Card Mensal (alunos)', null, 'card_mensal', 2),
  ('group.revenue', 'Aula avulsa (alunos)', null, 'aula_avulsa', 3),
  ('group.revenue', 'Day Card (convidados)', null, 'day_card', 4),
  ('group.revenue', 'Multas e juros de mora recebidos', null, 'late_fees', 5),
  ('group.revenue', 'Outras receitas', null, null, 6),
  ('group.deduction', 'Descontos concedidos', null, 'discounts', 1),
  ('group.deduction', 'Estornos e devoluções', null, 'refunds', 2),
  ('group.cost', 'Material esportivo (bolas, redes)', null, null, 1),
  ('group.people', 'Salários e encargos', null, null, 1),
  ('group.structure', 'Aluguel', null, null, 1),
  ('group.structure', 'Água', null, null, 2),
  ('group.structure', 'Energia', null, null, 3),
  ('group.structure', 'Internet', null, null, 4),
  ('group.structure', 'Manutenção das quadras', null, null, 5),
  ('group.marketing', 'Divulgação', null, null, 1),
  ('group.marketing', 'Torneios e eventos', null, null, 2),
  ('group.admin', 'Contabilidade', null, null, 1),
  ('group.admin', 'Sistemas', null, null, 2),
  ('group.financial', 'Tarifas bancárias', null, null, 1),
  ('group.financial', 'Juros, multas e descontos em pagamentos', null, 'interest', 2),
  ('group.other', 'Outras despesas', null, null, 1)
) v(grp, name, dre, key, pos)
join public.fin_categories g on g.system_key = v.grp;

create function fin_private.category_id(p_key text) returns uuid
language sql stable set search_path = '' as $$
  select id from public.fin_categories where system_key = p_key $$;

-- Categoria utilizável num lançamento manual. As de uso automático ficam de
-- fora: lançar "Mensalidades" ou "Day Card" à mão contaria o fato duas vezes.
create function fin_private.check_category(p_category uuid, p_kind text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare c public.fin_categories%rowtype;
begin
  if p_category is null then raise exception 'CATEGORY_REQUIRED'; end if;
  select * into c from public.fin_categories where id = p_category;
  if not found or not c.active or c.kind <> p_kind then raise exception 'INVALID_CATEGORY'; end if;
  if c.system_key in ('member_fees', 'card_mensal', 'aula_avulsa', 'day_card', 'late_fees', 'discounts', 'refunds', 'interest') then
    raise exception 'CATEGORY_RESERVED';
  end if;
end $$;

create function fin_private.check_account(p_account uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account is null then raise exception 'ACCOUNT_REQUIRED'; end if;
  if not exists (select 1 from public.fin_accounts where id = p_account and active) then raise exception 'INVALID_ACCOUNT'; end if;
end $$;

-- ------------------------------------------------------------------
-- 7. Gatilhos: auditoria e "não apagar"
-- ------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['fin_settings', 'fin_holidays', 'fin_accounts', 'fin_categories', 'fin_recurrences',
    'fin_entries', 'fin_entry_payments', 'fin_attachments'] loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function fin_private.audit_row()', t || '_audit', t);
  end loop;
  foreach t in array array['fin_settings', 'fin_holidays', 'fin_accounts', 'fin_categories', 'fin_recurrences',
    'fin_entries', 'fin_entry_payments', 'fin_attachments', 'fin_requests'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function fin_private.no_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- Os pagamentos de aluno que já existem passam a deixar rastro (insert/update/
-- delete). Só audita: o comportamento da tabela não muda e a falha nunca a bloqueia.
do $$ begin
  -- Sem `drop trigger`: ele pede lock exclusivo na tabela viva. O gatilho só é criado se ainda não existe.
  if to_regclass('public.student_payments') is not null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.student_payments'::regclass and tgname = 'fin_student_payments_audit') then
    execute 'create trigger fin_student_payments_audit after insert or update or delete on public.student_payments
             for each row execute function fin_private.audit_row_soft()';
  end if;
end $$;

-- ------------------------------------------------------------------
-- 8. Leitura de configuração e calendário (qualquer logado lê a regra de
--    vencimento; só admin escreve). Valores de encargos ficam visíveis ao
--    sócio porque ele precisa ver como o total é calculado.
-- ------------------------------------------------------------------
create function public.fin_public_settings() returns table(
  due_day smallint, due_month_offset smallint, non_business_rule text, saturday_is_business boolean,
  late_fee_confirmed boolean, grace_days smallint, fine_fixed_cents bigint, fine_percent_bps integer,
  interest_daily_fixed_cents bigint, interest_daily_percent_bps integer)
language sql stable security definer set search_path = '' as $$
  select s.due_day, s.due_month_offset, s.non_business_rule, s.saturday_is_business,
    (s.late_fee_confirmed_at is not null), s.grace_days,
    case when s.late_fee_confirmed_at is not null then s.fine_fixed_cents end,
    case when s.late_fee_confirmed_at is not null then s.fine_percent_bps end,
    case when s.late_fee_confirmed_at is not null then s.interest_daily_fixed_cents end,
    case when s.late_fee_confirmed_at is not null then s.interest_daily_percent_bps end
  from public.fin_settings s where auth.uid() is not null $$;

-- ------------------------------------------------------------------
-- 9. RPCs de configuração (administrador)
-- ------------------------------------------------------------------
create function public.fin_save_settings(p_request_id uuid, p_expected_version integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_settings%rowtype; n public.fin_settings%rowtype; v_confirm boolean;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'settings_save', p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_settings for update;
  if s.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  n := s;
  if p_data ? 'due_day' then n.due_day := (p_data->>'due_day')::smallint; end if;
  if p_data ? 'due_month_offset' then n.due_month_offset := (p_data->>'due_month_offset')::smallint; end if;
  if p_data ? 'non_business_rule' then n.non_business_rule := p_data->>'non_business_rule'; end if;
  if p_data ? 'saturday_is_business' then n.saturday_is_business := (p_data->>'saturday_is_business')::boolean; end if;
  if p_data ? 'horizon_months' then n.horizon_months := (p_data->>'horizon_months')::smallint; end if;
  if p_data ? 'grace_days' then n.grace_days := (p_data->>'grace_days')::smallint; end if;
  if p_data ? 'fine_fixed_cents' then n.fine_fixed_cents := (p_data->>'fine_fixed_cents')::bigint; end if;
  if p_data ? 'fine_percent_bps' then n.fine_percent_bps := (p_data->>'fine_percent_bps')::integer; end if;
  if p_data ? 'interest_daily_fixed_cents' then n.interest_daily_fixed_cents := (p_data->>'interest_daily_fixed_cents')::bigint; end if;
  if p_data ? 'interest_daily_percent_bps' then n.interest_daily_percent_bps := (p_data->>'interest_daily_percent_bps')::integer; end if;
  if p_data ? 'day_card_price_cents' then n.day_card_price_cents := (p_data->>'day_card_price_cents')::bigint; end if;
  if p_data ? 'day_card_in_cash' then n.day_card_in_cash := (p_data->>'day_card_in_cash')::boolean; end if;
  if p_data ? 'payee_names' then
    n.payee_names := coalesce(array(select trim(x) from jsonb_array_elements_text(p_data->'payee_names') x where length(trim(x)) > 0), '{}');
  end if;
  -- Confirmar a política de encargos é uma decisão explícita ("sem encargos" também vale).
  if p_data ? 'late_fee_confirmed' then
    v_confirm := (p_data->>'late_fee_confirmed')::boolean;
    if v_confirm and s.late_fee_confirmed_at is null then n.late_fee_confirmed_at := now(); n.late_fee_confirmed_by := v_actor;
    elsif not v_confirm then n.late_fee_confirmed_at := null; n.late_fee_confirmed_by := null; end if;
  end if;
  -- Mudar encargo de política já confirmada exige motivo (muda o que o sócio deve).
  if s.late_fee_confirmed_at is not null and (
      n.grace_days is distinct from s.grace_days or n.fine_fixed_cents is distinct from s.fine_fixed_cents
      or n.fine_percent_bps is distinct from s.fine_percent_bps
      or n.interest_daily_fixed_cents is distinct from s.interest_daily_fixed_cents
      or n.interest_daily_percent_bps is distinct from s.interest_daily_percent_bps)
     and (p_data->>'reason' is null or length(trim(p_data->>'reason')) < 5) then
    raise exception 'REASON_REQUIRED';
  end if;
  update public.fin_settings set due_day = n.due_day, due_month_offset = n.due_month_offset,
    non_business_rule = n.non_business_rule, saturday_is_business = n.saturday_is_business,
    horizon_months = n.horizon_months, grace_days = n.grace_days, fine_fixed_cents = n.fine_fixed_cents,
    fine_percent_bps = n.fine_percent_bps, interest_daily_fixed_cents = n.interest_daily_fixed_cents,
    interest_daily_percent_bps = n.interest_daily_percent_bps, day_card_price_cents = n.day_card_price_cents,
    day_card_in_cash = n.day_card_in_cash,
    payee_names = n.payee_names, late_fee_confirmed_at = n.late_fee_confirmed_at,
    late_fee_confirmed_by = n.late_fee_confirmed_by, version = version + 1, updated_at = now(), updated_by = v_actor
  where id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('version', s.version + 1));
end $$;

create function public.fin_save_holiday(p_request_id uuid, p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; h public.fin_holidays%rowtype; v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, case when p_id is null then 'holiday_create' else 'holiday_update' end);
  if v_replay is not null then return v_replay; end if;
  if p_id is null then
    h.holiday_date := (p_data->>'holiday_date')::date; h.name := trim(p_data->>'name');
    h.scope := coalesce(p_data->>'scope', 'municipal'); h.kind := 'holiday'; h.active := coalesce((p_data->>'active')::boolean, true);
    if h.scope = 'national' then raise exception 'INVALID_HOLIDAY'; end if; -- nacionais vêm da semeadura por lei
    begin
      insert into public.fin_holidays(holiday_date, name, scope, kind, active, created_by, updated_by)
      values (h.holiday_date, h.name, h.scope, h.kind, h.active, v_actor, v_actor) returning id into v_id;
    exception when unique_violation then raise exception 'HOLIDAY_EXISTS';
    end;
  else
    select * into h from public.fin_holidays where id = p_id for update;
    if not found then raise exception 'HOLIDAY_NOT_FOUND'; end if;
    if p_data ? 'active' then h.active := (p_data->>'active')::boolean; end if;
    if p_data ? 'name' and h.scope <> 'national' then h.name := trim(p_data->>'name'); end if;
    update public.fin_holidays set active = h.active, name = h.name, updated_at = now(), updated_by = v_actor where id = p_id;
    v_id := p_id;
  end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id));
end $$;

create function public.fin_seed_holidays(p_request_id uuid, p_year integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_n integer;
begin
  perform fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'holidays_seed');
  if v_replay is not null then return v_replay; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'INVALID_PERIOD'; end if;
  v_n := fin_private.seed_holidays(p_year);
  return fin_private.finish_op(p_request_id, jsonb_build_object('year', p_year, 'inserted', v_n));
end $$;

create function public.fin_save_category(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; c public.fin_categories%rowtype; n public.fin_categories%rowtype;
  v_parent public.fin_categories%rowtype; v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, case when p_id is null then 'category_create' else 'category_update' end);
  if v_replay is not null then return v_replay; end if;
  if p_id is null then
    n.kind := p_data->>'kind'; n.parent_id := (p_data->>'parent_id')::uuid; n.active := true; n.position := 0;
    if n.kind not in ('expense', 'revenue') then raise exception 'INVALID_CATEGORY'; end if;
    if n.parent_id is not null then
      select * into v_parent from public.fin_categories where id = n.parent_id;
      if not found or v_parent.parent_id is not null or v_parent.kind <> n.kind or not v_parent.active then raise exception 'INVALID_CATEGORY'; end if;
      n.dre_line := v_parent.dre_line;
    end if;
  else
    select * into c from public.fin_categories where id = p_id for update;
    if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
    if c.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
    n := c;
  end if;
  if p_data ? 'name' then n.name := trim(p_data->>'name'); end if;
  if p_data ? 'position' then n.position := (p_data->>'position')::integer; end if;
  if p_data ? 'dre_line' then
    if c.system_key is not null and p_data->>'dre_line' <> c.dre_line then raise exception 'CATEGORY_SYSTEM'; end if;
    n.dre_line := p_data->>'dre_line';
  end if;
  if p_data ? 'active' then n.active := (p_data->>'active')::boolean; end if;
  if n.name is null or length(n.name) < 2 or length(n.name) > 60 then raise exception 'INVALID_CATEGORY'; end if;
  if n.dre_line is null or not ((n.kind = 'revenue' and n.dre_line in ('revenue', 'deduction', 'none')) or
      (n.kind = 'expense' and n.dre_line in ('variable_cost', 'operational', 'administrative', 'commercial', 'financial', 'none')))
    then raise exception 'INVALID_CATEGORY'; end if;
  if p_id is not null and not n.active and c.active then
    if c.system_key is not null then raise exception 'CATEGORY_SYSTEM'; end if;
    if exists (select 1 from public.fin_categories where parent_id = p_id and active) then raise exception 'CATEGORY_HAS_ACTIVE_CHILDREN'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.fin_categories(parent_id, name, kind, dre_line, position, created_by, updated_by)
      values (n.parent_id, n.name, n.kind, n.dre_line, coalesce(n.position, 0), v_actor, v_actor) returning id into v_id;
    else
      update public.fin_categories set name = n.name, dre_line = n.dre_line, active = n.active, position = n.position,
        version = version + 1, updated_at = now(), updated_by = v_actor where id = p_id;
      v_id := p_id;
    end if;
  exception when unique_violation then raise exception 'CATEGORY_NAME_TAKEN';
  end;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id, 'version', coalesce(c.version, 0) + 1));
end $$;

create function public.fin_save_account(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; a public.fin_accounts%rowtype; n public.fin_accounts%rowtype; v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, case when p_id is null then 'account_create' else 'account_update' end);
  if v_replay is not null then return v_replay; end if;
  if p_id is null then
    n.active := true; n.position := 0; n.is_default_receipts := false; n.opening_balance_cents := 0;
    n.opening_date := fin_private.today();
  else
    select * into a from public.fin_accounts where id = p_id for update;
    if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
    if a.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
    n := a;
  end if;
  if p_data ? 'name' then n.name := trim(p_data->>'name'); end if;
  if p_data ? 'kind' then n.kind := p_data->>'kind'; end if;
  if p_data ? 'opening_balance_cents' then n.opening_balance_cents := (p_data->>'opening_balance_cents')::bigint; end if;
  if p_data ? 'opening_date' then n.opening_date := (p_data->>'opening_date')::date; end if;
  if p_data ? 'position' then n.position := (p_data->>'position')::integer; end if;
  if p_data ? 'active' then n.active := (p_data->>'active')::boolean; end if;
  if p_data ? 'is_default_receipts' then n.is_default_receipts := (p_data->>'is_default_receipts')::boolean; end if;
  if n.name is null or length(n.name) < 2 or length(n.name) > 60 or n.kind not in ('cash', 'bank', 'card', 'other')
     or n.opening_date is null or abs(n.opening_balance_cents) > 100000000000 then raise exception 'INVALID_ACCOUNT'; end if;
  if not n.active and n.is_default_receipts then raise exception 'ACCOUNT_LINKED'; end if;
  if n.is_default_receipts then
    update public.fin_accounts set is_default_receipts = false, version = version + 1, updated_at = now(), updated_by = v_actor
    where is_default_receipts and id is distinct from p_id;
  end if;
  begin
    if p_id is null then
      insert into public.fin_accounts(name, kind, opening_balance_cents, opening_date, is_default_receipts, active, position, created_by, updated_by)
      values (n.name, n.kind, n.opening_balance_cents, n.opening_date, n.is_default_receipts, n.active, coalesce(n.position, 0), v_actor, v_actor)
      returning id into v_id;
    else
      update public.fin_accounts set name = n.name, kind = n.kind, opening_balance_cents = n.opening_balance_cents,
        opening_date = n.opening_date, is_default_receipts = n.is_default_receipts, active = n.active, position = n.position,
        version = version + 1, updated_at = now(), updated_by = v_actor where id = p_id;
      v_id := p_id;
    end if;
  exception when unique_violation then raise exception 'ACCOUNT_NAME_TAKEN';
  end;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id, 'version', coalesce(a.version, 0) + 1));
end $$;

-- ------------------------------------------------------------------
-- 10. Lançamentos
-- ------------------------------------------------------------------
-- Estado do lançamento a partir dos pagamentos efetivos. Funciona para
-- criação, pagamento parcial, baixa e estorno.
create function fin_private.entry_paid_cents(p_entry uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0)::bigint
  from public.fin_entry_payments where entry_id = p_entry $$;

create function fin_private.add_entry_payment(p_entry uuid, p_amount bigint, p_paid_on date, p_account uuid, p_note text,
  p_settle boolean, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.fin_entries%rowtype; v_paid bigint; v_actor uuid := auth.uid();
begin
  select * into e from public.fin_entries where id = p_entry for update;
  perform fin_private.check_account(p_account);
  if p_paid_on is null or p_paid_on > fin_private.today() then raise exception 'INVALID_DATE'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.fin_entry_payments(entry_id, kind, amount_cents, paid_on, account_id, note, actor_id, request_id)
  values (p_entry, 'payment', p_amount, p_paid_on, p_account, nullif(trim(p_note), ''), v_actor, p_request);
  v_paid := fin_private.entry_paid_cents(p_entry);
  if e.kind in ('expense', 'revenue') then
    if v_paid >= e.amount_cents or p_settle then
      if v_paid > e.amount_cents and not p_settle then raise exception 'PAYMENT_EXCEEDS_ENTRY'; end if;
      update public.fin_entries set status = 'paid', settled_on = p_paid_on, adjustment_cents = v_paid - e.amount_cents,
        account_id = coalesce(account_id, p_account), version = version + 1, updated_at = now(), updated_by = v_actor where id = p_entry;
    else
      update public.fin_entries set status = 'partial', version = version + 1, updated_at = now(), updated_by = v_actor where id = p_entry;
    end if;
  else
    update public.fin_entries set status = 'paid', settled_on = p_paid_on, version = version + 1, updated_at = now(), updated_by = v_actor where id = p_entry;
  end if;
end $$;

create function public.fin_create_entry(p_request_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; v_kind text := p_data->>'kind'; v_status text; v_id uuid; v_amount bigint;
  v_due date; v_comp date; v_paid_on date; v_account uuid; v_counter uuid; v_category uuid; v_desc text := trim(p_data->>'description');
  v_paid_amount bigint;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'entry_create');
  if v_replay is not null then return v_replay; end if;
  if v_kind not in ('expense', 'revenue', 'contribution', 'withdrawal', 'transfer') then raise exception 'INVALID_ENTRY'; end if;
  if v_desc is null or length(v_desc) < 2 or length(v_desc) > 140 then raise exception 'INVALID_ENTRY'; end if;
  v_amount := (p_data->>'amount_cents')::bigint;
  if v_amount is null or v_amount <= 0 or v_amount > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  v_status := coalesce(p_data->>'status', 'paid');
  if v_status not in ('pending', 'paid') or (v_kind not in ('expense', 'revenue') and v_status <> 'paid') then raise exception 'INVALID_ENTRY'; end if;
  v_due := (p_data->>'due_date')::date;
  v_paid_on := case when v_status = 'paid' then coalesce((p_data->>'paid_on')::date, fin_private.today()) end;
  v_comp := coalesce((p_data->>'competence_date')::date, v_paid_on, v_due, fin_private.today());
  v_account := (p_data->>'account_id')::uuid;
  v_counter := (p_data->>'counter_account_id')::uuid;
  v_category := (p_data->>'category_id')::uuid;
  if v_kind in ('expense', 'revenue') then perform fin_private.check_category(v_category, v_kind); else v_category := null; end if;
  if v_kind = 'transfer' then
    perform fin_private.check_account(v_counter);
    perform fin_private.check_account(v_account);
    if v_counter = v_account then raise exception 'SAME_ACCOUNT'; end if;
  else v_counter := null; end if;
  if v_status = 'pending' then
    if v_due is null then raise exception 'DUE_DATE_REQUIRED'; end if;
    if v_account is not null then perform fin_private.check_account(v_account); end if;
  end if;

  -- Despesa/receita quitada na hora nasce pendente (com vencimento = data do pagamento)
  -- e o pagamento a quita; aporte/retirada/transferência já nascem pagos.
  insert into public.fin_entries(kind, status, description, supplier, category_id, amount_cents, competence_date, due_date,
    account_id, counter_account_id, notes, request_id, settled_on, created_by, updated_by)
  values (v_kind, case when v_kind in ('expense', 'revenue') then 'pending' else 'paid' end, v_desc,
    nullif(trim(p_data->>'supplier'), ''), v_category, v_amount, v_comp, case when v_status = 'paid' then coalesce(v_due, v_paid_on) else v_due end,
    v_account, v_counter, nullif(trim(p_data->>'notes'), ''), p_request_id,
    case when v_kind in ('expense', 'revenue') then null else v_paid_on end, v_actor, v_actor)
  returning id into v_id;
  if v_status = 'paid' then
    v_paid_amount := coalesce((p_data->>'paid_amount_cents')::bigint, v_amount);
    if v_kind = 'transfer' then v_paid_amount := v_amount; end if;
    perform fin_private.add_entry_payment(v_id, v_paid_amount, v_paid_on, v_account, p_data->>'payment_note', true, gen_random_uuid());
  end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id));
end $$;

create function public.fin_update_entry(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; e public.fin_entries%rowtype; n public.fin_entries%rowtype; v_paid bigint;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'entry_update', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into e from public.fin_entries where id = p_id for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if e.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if e.status = 'canceled' then raise exception 'ENTRY_CANCELED'; end if;
  v_paid := fin_private.entry_paid_cents(p_id);
  if v_paid > 0 and (p_reason is null or length(trim(p_reason)) < 3) then raise exception 'ENTRY_REASON_REQUIRED'; end if;
  n := e;
  if p_data ? 'description' then n.description := trim(p_data->>'description'); end if;
  if p_data ? 'supplier' then n.supplier := nullif(trim(p_data->>'supplier'), ''); end if;
  if p_data ? 'notes' then n.notes := nullif(trim(p_data->>'notes'), ''); end if;
  if p_data ? 'competence_date' then n.competence_date := coalesce((p_data->>'competence_date')::date, e.competence_date); end if;
  if p_data ? 'due_date' then n.due_date := (p_data->>'due_date')::date; end if;
  if p_data ? 'category_id' and e.kind in ('expense', 'revenue') then
    n.category_id := (p_data->>'category_id')::uuid;
    if n.category_id is distinct from e.category_id then perform fin_private.check_category(n.category_id, e.kind); end if;
  end if;
  if p_data ? 'amount_cents' then
    if v_paid > 0 then raise exception 'ENTRY_HAS_PAYMENTS'; end if; -- valor de documento com pagamento: estorne antes
    n.amount_cents := (p_data->>'amount_cents')::bigint;
  end if;
  if p_data ? 'account_id' and e.status in ('pending', 'partial') then
    n.account_id := (p_data->>'account_id')::uuid;
    if n.account_id is not null then perform fin_private.check_account(n.account_id); end if;
  end if;
  if n.description is null or length(n.description) < 2 or length(n.description) > 140 then raise exception 'INVALID_ENTRY'; end if;
  if n.amount_cents is null or n.amount_cents <= 0 or n.amount_cents > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if e.status in ('pending', 'partial') and n.due_date is null then raise exception 'DUE_DATE_REQUIRED'; end if;
  update public.fin_entries set description = n.description, supplier = n.supplier, notes = n.notes,
    amount_cents = n.amount_cents, competence_date = n.competence_date, due_date = n.due_date, category_id = n.category_id,
    account_id = n.account_id, version = version + 1, updated_at = now(), updated_by = v_actor where id = p_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id, 'version', e.version + 1));
end $$;

-- Pagar/receber (parcial ou total). `settle` fecha o lançamento mesmo que o
-- somado difira do documento; a diferença vira juros/multa (ou desconto) no DRE.
create function public.fin_pay_entry(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; e public.fin_entries%rowtype;
begin
  perform fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'entry_pay', p_data->>'note');
  if v_replay is not null then return v_replay; end if;
  select * into e from public.fin_entries where id = p_id for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if e.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if e.kind not in ('expense', 'revenue') then raise exception 'INVALID_ENTRY'; end if;
  if e.status not in ('pending', 'partial') then raise exception 'ENTRY_NOT_PENDING'; end if;
  perform fin_private.add_entry_payment(p_id, (p_data->>'amount_cents')::bigint, (p_data->>'paid_on')::date,
    (p_data->>'account_id')::uuid, p_data->>'note', coalesce((p_data->>'settle')::boolean, false), p_request_id);
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id, 'paid_cents', fin_private.entry_paid_cents(p_id)));
end $$;

-- Estorno de um pagamento: nova linha `reversal`; o histórico fica.
create function public.fin_reverse_entry_payment(p_request_id uuid, p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; p public.fin_entry_payments%rowtype; e public.fin_entries%rowtype; v_paid bigint;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'entry_payment_reverse', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into p from public.fin_entry_payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if p.kind <> 'payment' then raise exception 'PAYMENT_NOT_FOUND'; end if;
  select * into e from public.fin_entries where id = p.entry_id for update;
  if exists (select 1 from public.fin_entry_payments where reverses_payment_id = p_payment_id) then raise exception 'PAYMENT_ALREADY_REVERSED'; end if;
  insert into public.fin_entry_payments(entry_id, kind, amount_cents, paid_on, account_id, reverses_payment_id, note, actor_id, request_id)
  values (p.entry_id, 'reversal', p.amount_cents, fin_private.today(), p.account_id, p.id, trim(p_reason), v_actor, p_request_id);
  v_paid := fin_private.entry_paid_cents(p.entry_id);
  if e.kind in ('expense', 'revenue') then
    update public.fin_entries set status = case when v_paid <= 0 then 'pending' when v_paid >= amount_cents then 'paid' else 'partial' end,
      settled_on = case when v_paid >= amount_cents then settled_on end,
      adjustment_cents = case when v_paid >= amount_cents then adjustment_cents else 0 end,
      version = version + 1, updated_at = now(), updated_by = v_actor where id = p.entry_id;
  else
    update public.fin_entries set status = 'canceled', canceled_at = now(), canceled_by = v_actor, cancel_reason = trim(p_reason),
      version = version + 1, updated_at = now(), updated_by = v_actor where id = p.entry_id;
  end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p.entry_id));
end $$;

-- Cancelar só quando não há dinheiro movimentado: com pagamento, estorne antes
-- (assim o caixa nunca perde uma saída que de fato aconteceu).
create function public.fin_cancel_entry(p_request_id uuid, p_id uuid, p_expected_version integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; e public.fin_entries%rowtype;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'entry_cancel', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into e from public.fin_entries where id = p_id for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if e.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if e.status = 'canceled' then raise exception 'ENTRY_CANCELED'; end if;
  if fin_private.entry_paid_cents(p_id) <> 0 then raise exception 'ENTRY_HAS_PAYMENTS'; end if;
  update public.fin_entries set status = 'canceled', canceled_at = now(), canceled_by = v_actor, cancel_reason = trim(p_reason),
    version = version + 1, updated_at = now(), updated_by = v_actor where id = p_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id, 'version', e.version + 1));
end $$;

-- ------------------------------------------------------------------
-- 11. Recorrências
-- ------------------------------------------------------------------
create function fin_private.recurrence_due_date(p_competence date, p_day integer, p_offset integer) returns date
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_competence::timestamp) + make_interval(months => p_offset)
    + make_interval(days => least(p_day, extract(day from (date_trunc('month', p_competence::timestamp)
      + make_interval(months => p_offset + 1) - interval '1 day'))::integer) - 1))::date
$$;

-- Gera as competências que faltam até o fim do mês seguinte. Idempotente pelo
-- índice único (recorrência, competência): rodar duas vezes gera zero.
create function fin_private.generate_recurrences(p_recurrence uuid, p_until date) returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.fin_recurrences%rowtype; v_month date; v_step integer; v_until date; v_count integer := 0; v_n integer;
begin
  v_until := date_trunc('month', coalesce(p_until, (fin_private.today() + interval '1 month')::date)::timestamp)::date;
  for r in select * from public.fin_recurrences where active and (p_recurrence is null or id = p_recurrence) loop
    v_step := case r.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
    v_month := r.start_month;
    while v_month <= least(v_until, coalesce(r.end_month, v_until)) loop
      insert into public.fin_entries(kind, status, description, supplier, category_id, amount_cents, competence_date, due_date,
        account_id, recurrence_id, notes, request_id, created_by, updated_by)
      values ('expense', 'pending', r.description, r.supplier, r.category_id, r.amount_cents, v_month,
        fin_private.recurrence_due_date(v_month, r.due_day, r.due_month_offset), r.account_id, r.id, r.notes,
        gen_random_uuid(), auth.uid(), auth.uid())
      on conflict (recurrence_id, competence_date) where recurrence_id is not null do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
      v_month := (v_month + make_interval(months => v_step))::date;
    end loop;
  end loop;
  return v_count;
end $$;

create function public.fin_generate_recurrences(p_request_id uuid, p_until date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_n integer;
begin
  perform fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'recurrence_generate');
  if v_replay is not null then return v_replay; end if;
  v_n := fin_private.generate_recurrences(null, p_until);
  return fin_private.finish_op(p_request_id, jsonb_build_object('created', v_n));
end $$;

-- Criar ou alterar. Alteração vale a partir de `p_apply_from` (padrão: mês
-- atual) e só para competências ainda pendentes e sem pagamento: o que já foi
-- pago ou ficou para trás não muda. Pausar/encerrar cancela só o futuro pendente.
create function public.fin_save_recurrence(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb, p_apply_from date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; r public.fin_recurrences%rowtype; n public.fin_recurrences%rowtype; v_from date; v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, case when p_id is null then 'recurrence_create' else 'recurrence_update' end, p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  if p_id is not null then
    select * into r from public.fin_recurrences where id = p_id for update;
    if not found then raise exception 'RECURRENCE_NOT_FOUND'; end if;
    if r.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
    n := r;
  else
    n.frequency := 'monthly'; n.due_month_offset := 0; n.active := true;
  end if;
  if p_data ? 'description' then n.description := trim(p_data->>'description'); end if;
  if p_data ? 'supplier' then n.supplier := nullif(trim(p_data->>'supplier'), ''); end if;
  if p_data ? 'notes' then n.notes := nullif(trim(p_data->>'notes'), ''); end if;
  if p_data ? 'category_id' then n.category_id := (p_data->>'category_id')::uuid; end if;
  if p_data ? 'amount_cents' then n.amount_cents := (p_data->>'amount_cents')::bigint; end if;
  if p_data ? 'frequency' then n.frequency := p_data->>'frequency'; end if;
  if p_data ? 'due_day' then n.due_day := (p_data->>'due_day')::smallint; end if;
  if p_data ? 'due_month_offset' then n.due_month_offset := (p_data->>'due_month_offset')::smallint; end if;
  if p_data ? 'start_month' and p_id is null then n.start_month := date_trunc('month', (p_data->>'start_month')::date::timestamp)::date; end if;
  if p_data ? 'end_month' then n.end_month := date_trunc('month', (p_data->>'end_month')::date::timestamp)::date; end if;
  if p_data ? 'account_id' then n.account_id := (p_data->>'account_id')::uuid; end if;
  if p_data ? 'active' then n.active := (p_data->>'active')::boolean; end if;
  if n.description is null or length(n.description) < 2 or length(n.description) > 140 then raise exception 'INVALID_RECURRENCE'; end if;
  if n.amount_cents is null or n.amount_cents <= 0 or n.amount_cents > 1000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if n.frequency not in ('monthly', 'quarterly', 'yearly') or n.due_day is null or n.due_day not between 1 and 31
     or n.due_month_offset not between 0 and 2 or n.start_month is null
     or (n.end_month is not null and n.end_month < n.start_month) then raise exception 'INVALID_RECURRENCE'; end if;
  if p_id is null or n.category_id is distinct from r.category_id then perform fin_private.check_category(n.category_id, 'expense'); end if;
  if n.account_id is not null and (p_id is null or n.account_id is distinct from r.account_id) then perform fin_private.check_account(n.account_id); end if;

  if p_id is null then
    insert into public.fin_recurrences(description, supplier, category_id, amount_cents, frequency, due_day, due_month_offset,
      start_month, end_month, account_id, notes, active, created_by, updated_by)
    values (n.description, n.supplier, n.category_id, n.amount_cents, n.frequency, n.due_day, n.due_month_offset,
      n.start_month, n.end_month, n.account_id, n.notes, n.active, v_actor, v_actor) returning id into v_id;
    perform fin_private.generate_recurrences(v_id, null);
    return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id, 'version', 1));
  end if;

  v_from := date_trunc('month', coalesce(p_apply_from, fin_private.today())::timestamp)::date;
  update public.fin_recurrences set description = n.description, supplier = n.supplier, notes = n.notes, category_id = n.category_id,
    amount_cents = n.amount_cents, frequency = n.frequency, due_day = n.due_day, due_month_offset = n.due_month_offset,
    end_month = n.end_month, account_id = n.account_id, active = n.active, version = version + 1, updated_at = now(), updated_by = v_actor
  where id = p_id;
  -- Só competências a partir de `v_from`, ainda pendentes e sem pagamento.
  update public.fin_entries set description = n.description, supplier = n.supplier, category_id = n.category_id,
    amount_cents = n.amount_cents, account_id = n.account_id, notes = n.notes,
    due_date = fin_private.recurrence_due_date(competence_date, n.due_day, n.due_month_offset),
    version = version + 1, updated_at = now(), updated_by = v_actor
  where recurrence_id = p_id and status = 'pending' and competence_date >= v_from
    and fin_private.entry_paid_cents(id) = 0;
  -- Encerrada ou pausada: o pendente que ficaria fora é cancelado, nunca apagado.
  update public.fin_entries set status = 'canceled', canceled_at = now(), canceled_by = v_actor,
    cancel_reason = 'Recorrência encerrada ou pausada', version = version + 1, updated_at = now(), updated_by = v_actor
  where recurrence_id = p_id and status = 'pending' and fin_private.entry_paid_cents(id) = 0
    and ((n.end_month is not null and competence_date > n.end_month) or (not n.active and competence_date >= v_from));
  if n.active then perform fin_private.generate_recurrences(p_id, null); end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id, 'version', r.version + 1));
end $$;

-- ------------------------------------------------------------------
-- 12. Anexos (comprovantes de despesa; bucket privado só do admin)
-- ------------------------------------------------------------------
insert into storage.buckets(id, name, public) values ('fin-docs', 'fin-docs', false) on conflict (id) do nothing;
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'fin-docs';

create policy fin_docs_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'fin-docs' and public.is_admin());
create policy fin_docs_admin_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-docs' and public.is_admin() and name ~ '^[0-9a-f-]{36}/[^/]+$'
    and exists (select 1 from public.fin_entries e where e.id = split_part(name, '/', 1)::uuid));
-- Sem policy de UPDATE/DELETE: comprovante enviado não se troca nem se apaga (arquiva-se).

create function public.fin_attach_file(p_request_id uuid, p_entry uuid, p_path text, p_name text, p_content_type text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'attachment_add');
  if v_replay is not null then return v_replay; end if;
  if not exists (select 1 from public.fin_entries where id = p_entry) then raise exception 'ENTRY_NOT_FOUND'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_entry::text then raise exception 'INVALID_ATTACHMENT'; end if;
  insert into public.fin_attachments(entry_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
  values (p_entry, p_path, p_name, p_content_type, p_size, v_actor) returning id into v_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id));
end $$;

create function public.fin_remove_attachment(p_request_id uuid, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'attachment_remove', p_reason);
  if v_replay is not null then return v_replay; end if;
  update public.fin_attachments set removed_at = now(), removed_by = v_actor where id = p_id and removed_at is null;
  if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id));
end $$;

-- ------------------------------------------------------------------
-- 13. Visões de leitura
-- ------------------------------------------------------------------
-- Lançamentos com o que já foi pago e a situação derivada (vencida é derivada).
create view public.fin_entries_v with (security_invoker = true) as
select e.*,
  coalesce(p.paid_cents, 0)::bigint as paid_cents,
  greatest(e.amount_cents - coalesce(p.paid_cents, 0), 0)::bigint as remaining_cents,
  case
    when e.status = 'canceled' then 'canceled'
    when e.status = 'paid' then 'paid'
    when e.due_date < (now() at time zone 'America/Fortaleza')::date then 'overdue'
    else e.status
  end as display_status
from public.fin_entries e
left join lateral (
  select sum(case when x.kind = 'payment' then x.amount_cents else -x.amount_cents end) as paid_cents
  from public.fin_entry_payments x where x.entry_id = e.id) p on true;

-- ------------------------------------------------------------------
-- 14. RLS e permissões
-- ------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['fin_requests', 'fin_settings', 'fin_holidays', 'fin_accounts', 'fin_categories', 'fin_recurrences',
    'fin_entries', 'fin_entry_payments', 'fin_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  -- Leitura: administrador. (Calendário e regra de vencimento chegam ao sócio
  -- pelas funções de leitura, não pela tabela.)
  foreach t in array array['fin_settings', 'fin_holidays', 'fin_accounts', 'fin_categories', 'fin_recurrences',
    'fin_entries', 'fin_entry_payments', 'fin_attachments'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;
  -- Escrita direta negada de forma explícita: tudo passa pelas funções.
  foreach t in array array['fin_requests', 'fin_settings', 'fin_holidays', 'fin_accounts', 'fin_categories', 'fin_recurrences',
    'fin_entries', 'fin_entry_payments', 'fin_attachments'] loop
    execute format('create policy %I on public.%I for insert to authenticated, anon with check (false)', t || '_no_insert', t);
    execute format('create policy %I on public.%I for update to authenticated, anon using (false) with check (false)', t || '_no_update', t);
    execute format('create policy %I on public.%I for delete to authenticated, anon using (false)', t || '_no_delete_policy', t);
  end loop;
end $$;
-- O Supabase concede privilégios a `anon`/`authenticated` em objetos novos: a visão só é lida por logado
-- (e, sendo `security_invoker`, o RLS das tabelas de base só deixa o administrador ver linhas).
revoke all on public.fin_entries_v from public, anon, authenticated;
grant select on public.fin_entries_v to authenticated;

-- Funções públicas: só `authenticated` executa (o padrão do Supabase libera
-- `anon`; aqui é revogado explicitamente).
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
