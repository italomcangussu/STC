-- Financeiro do clube — mensalidades dos sócios (2/5).
--
-- Plano individual por sócio, histórico de preço, cobranças por competência
-- (geração idempotente), descontos/acréscimos/dispensa de encargos com
-- justificativa, pagamentos (parcial, excedente, duplicado), estorno, crédito do
-- sócio e as tabelas de comprovantes (as funções de comprovante ficam na 3/5).
--
-- Regras de cálculo (espelhadas em lib/finance/lateFees.ts e comparadas em
-- __tests__/finance/sql): multa única no 1º dia de atraso; juros simples sobre o
-- saldo principal em aberto no início de cada dia; encargos nunca entram na
-- base; imputação multa → juros → principal; sobra vira crédito.
-- Nenhum percentual ou valor de encargo é presumido: `fin_settings` nasce sem
-- política confirmada e, sem confirmação, nenhum encargo é calculado.

-- ------------------------------------------------------------------
-- 1. Tabelas
-- ------------------------------------------------------------------
create table public.fin_member_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  start_on date not null,
  ended_on date,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  period_months smallint not null default 1 check (period_months in (1, 3, 6, 12)),
  due_day smallint check (due_day between 1 and 31),
  due_month_offset smallint check (due_month_offset between 0 and 2),
  notes text check (notes is null or length(notes) <= 1000),
  end_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  check (ended_on is null or ended_on >= start_on),
  check ((status = 'ended') = (ended_on is not null))
);
-- Um plano vivo por sócio; os encerrados ficam como histórico (sair e voltar = plano novo).
create unique index fin_member_plans_one_live on public.fin_member_plans(profile_id) where status <> 'ended';
create index fin_member_plans_profile_idx on public.fin_member_plans(profile_id);

-- Histórico de preço (append-only): reajuste vale da competência em diante.
create table public.fin_member_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fin_member_plans(id),
  effective_from date not null check (extract(day from effective_from) = 1),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (plan_id, effective_from)
);

-- Cobrança por período. `original_amount_cents` e `due_date` são o retrato do
-- momento da geração: reajustar o plano não reescreve competências passadas.
create table public.fin_member_charges (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.fin_member_plans(id),
  profile_id uuid not null references public.profiles(id),
  competence_month date not null check (extract(day from competence_month) = 1),
  period_months smallint not null check (period_months in (1, 3, 6, 12)),
  due_date date not null,
  original_amount_cents bigint not null check (original_amount_cents > 0 and original_amount_cents <= 1000000000),
  -- Gravado: open/partial/paid/canceled. "Prevista", "vencida" e "em análise" são derivadas na leitura.
  status text not null default 'open' check (status in ('open', 'partial', 'paid', 'canceled')),
  cancel_reason text,
  canceled_at timestamptz,
  canceled_by uuid references public.profiles(id),
  source text not null default 'generated' check (source in ('generated', 'manual')),
  notes text check (notes is null or length(notes) <= 1000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  unique (plan_id, competence_month),
  check (status <> 'canceled' or (canceled_at is not null and cancel_reason is not null))
);
create index fin_member_charges_profile_idx on public.fin_member_charges(profile_id, competence_month desc);
create index fin_member_charges_due_idx on public.fin_member_charges(due_date) where status in ('open', 'partial');
create index fin_member_charges_status_idx on public.fin_member_charges(status);

-- Desconto, acréscimo e dispensa de encargos: sempre com valor, justificativa,
-- autor e o extrato de antes/depois. Append-only.
create table public.fin_charge_adjustments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.fin_member_charges(id),
  kind text not null check (kind in ('discount', 'increase', 'fee_waiver')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 1000000000),
  reason text not null check (length(trim(reason)) >= 5),
  before_data jsonb,
  after_data jsonb,
  actor_id uuid references public.profiles(id),
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index fin_charge_adjustments_charge_idx on public.fin_charge_adjustments(charge_id);

-- Comprovantes enviados pelo sócio (as funções ficam na migração 3/5).
create table public.fin_receipt_submissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'approved', 'rejected', 'superseded')),
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- O que o sócio declarou/corrigiu antes de enviar.
  declared_amount_cents bigint check (declared_amount_cents is null or (declared_amount_cents > 0 and declared_amount_cents <= 1000000000)),
  declared_paid_on date,
  declared_reference text check (declared_reference is null or length(declared_reference) <= 120),
  member_note text check (member_note is null or length(member_note) <= 500),
  -- Só campos estruturados da leitura automática (nunca o texto bruto do comprovante).
  ocr_status text not null default 'not_run' check (ocr_status in ('not_run', 'ok', 'unreadable', 'failed')),
  ocr jsonb,
  possible_duplicate boolean not null default false,
  duplicate_of uuid references public.fin_receipt_submissions(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 1000),
  approved_payment_ids uuid[] not null default '{}',
  superseded_by uuid references public.fin_receipt_submissions(id),
  request_id uuid not null unique,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'rejected' or (decision_reason is not null and length(trim(decision_reason)) >= 5))
);
create index fin_receipt_submissions_profile_idx on public.fin_receipt_submissions(profile_id, created_at desc);
create index fin_receipt_submissions_pending_idx on public.fin_receipt_submissions(created_at) where status in ('submitted', 'in_review');
create index fin_receipt_submissions_hash_idx on public.fin_receipt_submissions(content_sha256);

create table public.fin_receipt_charges (
  submission_id uuid not null references public.fin_receipt_submissions(id),
  charge_id uuid not null references public.fin_member_charges(id),
  primary key (submission_id, charge_id)
);
create index fin_receipt_charges_charge_idx on public.fin_receipt_charges(charge_id);

-- Pagamentos e estornos de cobrança (append-only). Dividido em multa/juros/
-- principal/excedente no momento do pagamento.
create table public.fin_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.fin_member_charges(id),
  kind text not null default 'payment' check (kind in ('payment', 'reversal')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_on date not null,
  fine_cents bigint not null default 0 check (fine_cents >= 0),
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  principal_cents bigint not null default 0 check (principal_cents >= 0),
  excess_cents bigint not null default 0 check (excess_cents >= 0),
  method text not null check (method in ('pix', 'transfer', 'cash', 'card', 'other', 'credit')),
  account_id uuid references public.fin_accounts(id),
  submission_id uuid references public.fin_receipt_submissions(id),
  credit_id uuid,
  reverses_payment_id uuid unique references public.fin_charge_payments(id),
  note text check (note is null or length(note) <= 500),
  actor_id uuid references public.profiles(id),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_payment_id is not null)),
  check (kind = 'reversal' or amount_cents = fine_cents + interest_cents + principal_cents + excess_cents),
  check (method = 'credit' or account_id is not null)
);
create index fin_charge_payments_charge_idx on public.fin_charge_payments(charge_id);
create index fin_charge_payments_paid_idx on public.fin_charge_payments(paid_on);
create index fin_charge_payments_submission_idx on public.fin_charge_payments(submission_id) where submission_id is not null;

-- Excedente e pagamento duplicado NUNCA são descartados: viram crédito do sócio,
-- que o admin aplica numa cobrança, devolve ou baixa com justificativa.
create table public.fin_member_credits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  source_payment_id uuid not null references public.fin_charge_payments(id),
  reason text not null check (reason in ('excess', 'duplicate')),
  amount_cents bigint not null check (amount_cents > 0),
  remaining_cents bigint not null check (remaining_cents >= 0),
  status text not null default 'open' check (status in ('open', 'applied', 'refunded', 'void')),
  refund_entry_id uuid references public.fin_entries(id),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (remaining_cents <= amount_cents)
);
create index fin_member_credits_profile_idx on public.fin_member_credits(profile_id);
create index fin_member_credits_open_idx on public.fin_member_credits(profile_id) where status = 'open';
alter table public.fin_charge_payments add constraint fin_charge_payments_credit_fk
  foreign key (credit_id) references public.fin_member_credits(id);

-- ------------------------------------------------------------------
-- 2. Extrato de uma cobrança (encargos e saldo em qualquer data)
-- ------------------------------------------------------------------
-- Pagamentos EFETIVOS = pagamentos sem estorno. Estornar desfaz o pagamento no extrato.
create view fin_private.charge_payments_effective as
select p.* from public.fin_charge_payments p
where p.kind = 'payment'
  and not exists (select 1 from public.fin_charge_payments r where r.reverses_payment_id = p.id);

create function fin_private.charge_statement(p_charge uuid, p_as_of date)
returns table(principal_base bigint, principal_paid bigint, principal_remaining bigint, grace_until date, days_late integer,
  fine_accrued bigint, interest_accrued bigint, fees_paid bigint, fees_waived bigint, fine_due bigint, interest_due bigint,
  fees_due bigint, total_due bigint, fees_configured boolean, overdue boolean, settled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.fin_member_charges%rowtype; s public.fin_settings%rowtype;
  v_disc bigint; v_inc bigint; v_waived bigint; v_base bigint; v_paid bigint; v_feespaid bigint;
  v_grace date; v_days integer; v_fine bigint := 0; v_int bigint := 0; v_first date; v_cursor date; v_b bigint; v_seg integer;
  pd date[]; pp bigint[]; i integer; n integer; v_red bigint; v_fine_due bigint; v_int_due bigint; v_principal_rem bigint;
begin
  select * into c from public.fin_member_charges where id = p_charge;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  select * into s from public.fin_settings;
  select coalesce(sum(amount_cents) filter (where kind = 'discount'), 0), coalesce(sum(amount_cents) filter (where kind = 'increase'), 0),
         coalesce(sum(amount_cents) filter (where kind = 'fee_waiver'), 0)
    into v_disc, v_inc, v_waived from public.fin_charge_adjustments where charge_id = p_charge;
  select coalesce(array_agg(paid_on order by paid_on, created_at, id), '{}'), coalesce(array_agg(principal_cents order by paid_on, created_at, id), '{}'),
         coalesce(sum(principal_cents), 0), coalesce(sum(fine_cents + interest_cents), 0)
    into pd, pp, v_paid, v_feespaid
  from fin_private.charge_payments_effective where charge_id = p_charge and paid_on <= p_as_of;

  v_base := greatest(c.original_amount_cents - v_disc + v_inc, 0);
  v_principal_rem := case when c.status = 'canceled' then 0 else greatest(v_base - v_paid, 0) end;
  v_grace := c.due_date + greatest(s.grace_days, 0);
  v_days := greatest(p_as_of - v_grace, 0);
  n := coalesce(array_length(pd, 1), 0);

  if s.late_fee_confirmed_at is not null and c.status <> 'canceled' and v_days > 0 then
    v_first := v_grace + 1;
    v_b := v_base;
    for i in 1..n loop if pd[i] < v_first then v_b := v_b - pp[i]; end if; end loop;
    v_b := greatest(v_b, 0);
    if v_b > 0 then
      v_fine := coalesce(s.fine_fixed_cents, 0) + round(v_b::numeric * coalesce(s.fine_percent_bps, 0) / 10000)::bigint;
    end if;
    v_cursor := v_first;
    for i in 1..n loop
      if pd[i] >= v_first and pd[i] < p_as_of then
        v_seg := pd[i] - v_cursor + 1;
        if v_seg > 0 and v_b > 0 then
          v_int := v_int + coalesce(s.interest_daily_fixed_cents, 0) * v_seg
            + round(v_b::numeric * v_seg * coalesce(s.interest_daily_percent_bps, 0) / 10000)::bigint;
        end if;
        v_b := greatest(v_b - pp[i], 0);
        v_cursor := pd[i] + 1;
      end if;
    end loop;
    v_seg := p_as_of - v_cursor + 1;
    if v_seg > 0 and v_b > 0 then
      v_int := v_int + coalesce(s.interest_daily_fixed_cents, 0) * v_seg
        + round(v_b::numeric * v_seg * coalesce(s.interest_daily_percent_bps, 0) / 10000)::bigint;
    end if;
  end if;

  v_red := v_feespaid + v_waived;
  v_fine_due := greatest(v_fine - v_red, 0);
  v_int_due := greatest(v_fine + v_int - v_red - v_fine_due, 0);

  return query select v_base, v_paid, v_principal_rem, v_grace, v_days, v_fine, v_int, v_feespaid, v_waived, v_fine_due, v_int_due,
    v_fine_due + v_int_due, v_principal_rem + v_fine_due + v_int_due, (s.late_fee_confirmed_at is not null),
    (c.status <> 'canceled' and v_principal_rem + v_fine_due + v_int_due > 0 and p_as_of > c.due_date),
    (c.status = 'canceled' or v_principal_rem + v_fine_due + v_int_due = 0);
end $$;

-- Status gravado depois de pagar, estornar ou ajustar.
create function fin_private.refresh_charge_status(p_charge uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.fin_member_charges%rowtype; st record; v_has boolean; v_status text; v_asof date; v_last date;
begin
  select * into c from public.fin_member_charges where id = p_charge for update;
  if c.status = 'canceled' then return 'canceled'; end if;
  select max(paid_on) into v_last from fin_private.charge_payments_effective where charge_id = p_charge;
  v_asof := greatest(fin_private.today(), coalesce(v_last, fin_private.today()));
  select * into st from fin_private.charge_statement(p_charge, v_asof);
  v_has := v_last is not null;
  v_status := case when st.settled then 'paid' when v_has then 'partial' else 'open' end;
  if v_status <> c.status then
    update public.fin_member_charges set status = v_status, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_charge;
  end if;
  return v_status;
end $$;

-- Núcleo do pagamento: divide (multa → juros → principal → excedente), grava,
-- cria o crédito do excedente e atualiza o status. Usado pelo pagamento manual,
-- pela aprovação de comprovante e pela aplicação de crédito.
create function fin_private.apply_payment(p_charge uuid, p_amount bigint, p_paid_on date, p_method text, p_account uuid,
  p_submission uuid, p_credit uuid, p_note text, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.fin_member_charges%rowtype; s record; v_fine bigint; v_int bigint; v_prin bigint; v_exc bigint; v_pid uuid;
  v_last date; v_credit uuid; v_status text; v_dup boolean;
begin
  select * into c from public.fin_member_charges where id = p_charge for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if c.status = 'canceled' then raise exception 'CHARGE_CANCELED'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_paid_on is null or p_paid_on > fin_private.today() then raise exception 'INVALID_DATE'; end if;
  if p_method not in ('pix', 'transfer', 'cash', 'card', 'other', 'credit') then raise exception 'INVALID_METHOD'; end if;
  if p_method <> 'credit' then perform fin_private.check_account(p_account); end if;
  select max(paid_on) into v_last from fin_private.charge_payments_effective where charge_id = p_charge;
  if v_last is not null and p_paid_on < v_last then raise exception 'PAYMENT_DATE_BEFORE_LAST'; end if;

  select * into s from fin_private.charge_statement(p_charge, p_paid_on);
  v_fine := least(p_amount, s.fine_due);
  v_int := least(p_amount - v_fine, s.interest_due);
  v_prin := least(p_amount - v_fine - v_int, s.principal_remaining);
  v_exc := p_amount - v_fine - v_int - v_prin;
  v_dup := s.settled and v_exc = p_amount;
  if p_method = 'credit' and v_exc > 0 then raise exception 'CREDIT_EXCEEDS_DUE'; end if;

  insert into public.fin_charge_payments(charge_id, kind, amount_cents, paid_on, fine_cents, interest_cents, principal_cents,
    excess_cents, method, account_id, submission_id, credit_id, note, actor_id, request_id)
  values (p_charge, 'payment', p_amount, p_paid_on, v_fine, v_int, v_prin, v_exc, p_method,
    case when p_method = 'credit' then null else p_account end, p_submission, p_credit, nullif(trim(p_note), ''), auth.uid(), p_request)
  returning id into v_pid;
  if v_exc > 0 then
    insert into public.fin_member_credits(profile_id, source_payment_id, reason, amount_cents, remaining_cents)
    values (c.profile_id, v_pid, case when v_dup then 'duplicate' else 'excess' end, v_exc, v_exc) returning id into v_credit;
  end if;
  v_status := fin_private.refresh_charge_status(p_charge);
  return jsonb_build_object('payment_id', v_pid, 'fine_cents', v_fine, 'interest_cents', v_int, 'principal_cents', v_prin,
    'excess_cents', v_exc, 'duplicate', v_dup, 'credit_id', v_credit, 'charge_status', v_status);
end $$;

-- ------------------------------------------------------------------
-- 3. Planos, preço e geração de cobranças
-- ------------------------------------------------------------------
create function fin_private.is_active_member(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and p.role::text in ('socio', 'admin') and coalesce(p.is_active, true)) $$;

create function public.fin_create_member_plan(p_request_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; v_profile uuid := (p_data->>'profile_id')::uuid; v_start date := (p_data->>'start_on')::date;
  v_amount bigint := (p_data->>'amount_cents')::bigint; v_period integer := coalesce((p_data->>'period_months')::integer, 1); v_id uuid;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'member_plan_create');
  if v_replay is not null then return v_replay; end if;
  if v_profile is null or v_start is null then raise exception 'INVALID_PLAN'; end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000 then raise exception 'INVALID_AMOUNT'; end if;
  if v_period not in (1, 3, 6, 12) then raise exception 'INVALID_PLAN'; end if;
  -- Sócio ≠ aluno ≠ dependente ≠ usuário do app: só perfil de sócio (role socio/admin) e ativo tem plano.
  if not fin_private.is_active_member(v_profile) then raise exception 'NOT_A_MEMBER'; end if;
  if exists (select 1 from public.fin_member_plans where profile_id = v_profile and status <> 'ended') then raise exception 'PLAN_EXISTS'; end if;
  insert into public.fin_member_plans(profile_id, start_on, period_months, due_day, due_month_offset, notes, created_by, updated_by)
  values (v_profile, v_start, v_period::smallint, (p_data->>'due_day')::smallint, (p_data->>'due_month_offset')::smallint,
    nullif(trim(p_data->>'notes'), ''), v_actor, v_actor) returning id into v_id;
  insert into public.fin_member_plan_prices(plan_id, effective_from, amount_cents, reason, created_by)
  values (v_id, date_trunc('month', v_start::timestamp)::date, v_amount, 'Valor inicial', v_actor);
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id));
end $$;

-- Reajuste: nova versão de preço (nunca regrava as antigas). Só as cobranças
-- ainda intocadas (abertas, sem pagamento nem ajuste) a partir da vigência
-- passam a valer o novo preço; o passado fica como foi cobrado.
create function public.fin_set_plan_price(p_request_id uuid, p_plan_id uuid, p_effective_from date, p_amount_cents bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; v_from date; v_n integer;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'member_price_set', p_reason);
  if v_replay is not null then return v_replay; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 1000000000 then raise exception 'INVALID_AMOUNT'; end if;
  perform 1 from public.fin_member_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  v_from := date_trunc('month', p_effective_from::timestamp)::date;
  begin
    insert into public.fin_member_plan_prices(plan_id, effective_from, amount_cents, reason, created_by)
    values (p_plan_id, v_from, p_amount_cents, trim(p_reason), v_actor);
  exception when unique_violation then raise exception 'PRICE_EXISTS';
  end;
  update public.fin_member_charges c set original_amount_cents = p_amount_cents, version = version + 1, updated_at = now(), updated_by = v_actor
  where c.plan_id = p_plan_id and c.competence_month >= v_from and c.status = 'open'
    and not exists (select 1 from fin_private.charge_payments_effective p where p.charge_id = c.id)
    and not exists (select 1 from public.fin_charge_adjustments a where a.charge_id = c.id)
    and (select amount_cents from public.fin_member_plan_prices x where x.plan_id = c.plan_id and x.effective_from <= c.competence_month
         order by x.effective_from desc limit 1) = p_amount_cents;
  get diagnostics v_n = row_count;
  return fin_private.finish_op(p_request_id, jsonb_build_object('plan_id', p_plan_id, 'repriced_charges', v_n));
end $$;

create function public.fin_update_member_plan(p_request_id uuid, p_plan_id uuid, p_expected_version integer, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; pl public.fin_member_plans%rowtype; n public.fin_member_plans%rowtype;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'member_plan_update', p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  select * into pl from public.fin_member_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if pl.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if pl.status = 'ended' then raise exception 'PLAN_ENDED'; end if;
  n := pl;
  if p_data ? 'status' then n.status := p_data->>'status'; end if;
  if n.status not in ('active', 'paused') then raise exception 'INVALID_PLAN'; end if;
  if p_data ? 'due_day' then n.due_day := (p_data->>'due_day')::smallint; end if;
  if p_data ? 'due_month_offset' then n.due_month_offset := (p_data->>'due_month_offset')::smallint; end if;
  if p_data ? 'notes' then n.notes := nullif(trim(p_data->>'notes'), ''); end if;
  update public.fin_member_plans set status = n.status, due_day = n.due_day, due_month_offset = n.due_month_offset, notes = n.notes,
    version = version + 1, updated_at = now(), updated_by = v_actor where id = p_plan_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_plan_id, 'version', pl.version + 1));
end $$;

-- Gera as cobranças que faltam (até o mês atual + horizonte). Idempotente:
-- `unique(plan_id, competence_month)`; repetir não cria duplicata. Competência
-- sem preço não gera cobrança (nada é inventado) e é devolvida em `missing_price`.
create function fin_private.generate_charges(p_plan uuid, p_today date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.fin_settings%rowtype; pl public.fin_member_plans%rowtype; v_until date; v_cursor date; v_amount bigint;
  v_due date; v_n integer; v_created integer := 0; v_existing integer := 0; v_missing integer := 0;
begin
  select * into s from public.fin_settings;
  v_until := (date_trunc('month', p_today::timestamp) + make_interval(months => s.horizon_months))::date;
  for pl in select * from public.fin_member_plans where status = 'active' and (p_plan is null or id = p_plan) order by created_at loop
    perform fin_private.ensure_holidays(extract(year from pl.start_on)::integer, extract(year from v_until)::integer + 1);
    v_cursor := date_trunc('month', pl.start_on::timestamp)::date;
    while v_cursor <= v_until and (pl.ended_on is null or v_cursor <= pl.ended_on) loop
      select amount_cents into v_amount from public.fin_member_plan_prices
      where plan_id = pl.id and effective_from <= v_cursor order by effective_from desc limit 1;
      if not found then
        v_missing := v_missing + 1;
      else
        v_due := fin_private.due_date(v_cursor, pl.period_months, coalesce(pl.due_day, s.due_day),
          coalesce(pl.due_month_offset, s.due_month_offset), s.non_business_rule);
        insert into public.fin_member_charges(plan_id, profile_id, competence_month, period_months, due_date, original_amount_cents, created_by, updated_by)
        values (pl.id, pl.profile_id, v_cursor, pl.period_months, v_due, v_amount, auth.uid(), auth.uid())
        on conflict (plan_id, competence_month) do nothing;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
      end if;
      v_cursor := (v_cursor + make_interval(months => pl.period_months))::date;
    end loop;
  end loop;
  return jsonb_build_object('created', v_created, 'existing', v_existing, 'missing_price', v_missing);
end $$;

create function public.fin_generate_member_charges(p_request_id uuid, p_plan_id uuid default null, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_res jsonb;
begin
  perform fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'member_charges_generate');
  if v_replay is not null then return v_replay; end if;
  v_res := fin_private.generate_charges(p_plan_id, coalesce(p_today, fin_private.today()));
  return fin_private.finish_op(p_request_id, v_res);
end $$;

-- Fim do vínculo: cancela só as cobranças FUTURAS (período que começa depois do
-- fim) e SEM pagamento. Passadas, pagas e parciais — e todos os pagamentos — ficam.
create function fin_private.end_plan(p_plan uuid, p_ended_on date, p_reason text, p_auto boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pl public.fin_member_plans%rowtype; v_end date; v_n integer;
begin
  select * into pl from public.fin_member_plans where id = p_plan for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if pl.status = 'ended' then return jsonb_build_object('id', p_plan, 'canceled_charges', 0, 'already_ended', true); end if;
  v_end := greatest(p_ended_on, pl.start_on);
  perform set_config('fin.action', case when p_auto then 'plan_end_auto' else 'plan_end' end, true);
  perform set_config('fin.reason', coalesce(p_reason, ''), true);
  update public.fin_member_plans set status = 'ended', ended_on = v_end, end_reason = p_reason,
    version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_plan;
  update public.fin_member_charges c set status = 'canceled', canceled_at = now(), canceled_by = auth.uid(),
    cancel_reason = 'Vínculo encerrado em ' || to_char(v_end, 'DD/MM/YYYY') || ' — cobrança futura cancelada',
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where c.plan_id = p_plan and c.status = 'open' and c.competence_month > v_end
    and not exists (select 1 from fin_private.charge_payments_effective p where p.charge_id = c.id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('id', p_plan, 'ended_on', v_end, 'canceled_charges', v_n);
end $$;

create function public.fin_end_member_plan(p_request_id uuid, p_plan_id uuid, p_ended_on date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_res jsonb;
begin
  perform fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'member_plan_end', p_reason);
  if v_replay is not null then return v_replay; end if;
  if p_ended_on is null then raise exception 'INVALID_DATE'; end if;
  v_res := fin_private.end_plan(p_plan_id, p_ended_on, trim(p_reason), false);
  return fin_private.finish_op(p_request_id, v_res);
end $$;

-- Quando o sócio sai (perfil inativado ou deixa de ser sócio) o plano acaba sozinho.
-- A falha daqui NUNCA bloqueia a edição do perfil: vira aviso.
create function fin_private.on_profile_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid;
begin
  begin
    if (old.role::text in ('socio', 'admin') and coalesce(old.is_active, true))
       and (new.role::text not in ('socio', 'admin') or not coalesce(new.is_active, true)) then
      for v_plan in select id from public.fin_member_plans where profile_id = new.id and status <> 'ended' loop
        perform fin_private.end_plan(v_plan, fin_private.today(), 'Vínculo encerrado automaticamente (perfil inativado ou deixou de ser sócio)', true);
      end loop;
    end if;
  exception when others then
    raise warning 'fin: não foi possível encerrar o plano do sócio %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger fin_profile_membership_end after update of is_active, role on public.profiles
  for each row when (old.is_active is distinct from new.is_active or old.role is distinct from new.role)
  execute function fin_private.on_profile_membership_change();

-- ------------------------------------------------------------------
-- 4. Descontos, acréscimos, dispensa de encargos, pagamentos, estornos, créditos
-- ------------------------------------------------------------------
create function fin_private.statement_json(p_charge uuid, p_as_of date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) from fin_private.charge_statement(p_charge, p_as_of) s $$;

-- Toda isenção, desconto, ajuste ou dispensa: valor + justificativa + autor +
-- extrato antes/depois. Dispensa de encargos só vale sobre encargo existente.
create function public.fin_adjust_charge(p_request_id uuid, p_charge uuid, p_kind text, p_amount_cents bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; c public.fin_member_charges%rowtype; st record; v_today date := fin_private.today(); v_id uuid;
  v_before jsonb; v_status text;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'charge_adjust_' || coalesce(p_kind, ''), p_reason);
  if v_replay is not null then return v_replay; end if;
  if p_kind not in ('discount', 'increase', 'fee_waiver') then raise exception 'INVALID_ADJUSTMENT'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 1000000000 then raise exception 'INVALID_AMOUNT'; end if;
  select * into c from public.fin_member_charges where id = p_charge for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if c.status = 'canceled' then raise exception 'CHARGE_CANCELED'; end if;
  select * into st from fin_private.charge_statement(p_charge, v_today);
  v_before := fin_private.statement_json(p_charge, v_today);
  if p_kind = 'discount' and p_amount_cents > st.principal_remaining then raise exception 'DISCOUNT_EXCEEDS_BALANCE'; end if;
  if p_kind = 'fee_waiver' and p_amount_cents > st.fees_due then raise exception 'WAIVER_EXCEEDS_FEES'; end if;
  insert into public.fin_charge_adjustments(charge_id, kind, amount_cents, reason, before_data, actor_id, request_id)
  values (p_charge, p_kind, p_amount_cents, trim(p_reason), v_before, v_actor, p_request_id) returning id into v_id;
  update public.fin_charge_adjustments set after_data = fin_private.statement_json(p_charge, v_today) where id = v_id;
  v_status := fin_private.refresh_charge_status(p_charge);
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', v_id, 'charge_status', v_status));
end $$;

create function public.fin_register_payment(p_request_id uuid, p_charge uuid, p_amount_cents bigint, p_paid_on date,
  p_method text, p_account uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_replay jsonb; v_res jsonb;
begin
  perform fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'charge_payment', p_note);
  if v_replay is not null then return v_replay; end if;
  v_res := fin_private.apply_payment(p_charge, p_amount_cents, p_paid_on, p_method, p_account, null, null, p_note, p_request_id);
  return fin_private.finish_op(p_request_id, v_res);
end $$;

-- Estorno: só do pagamento mais recente da cobrança (o extrato de pagamentos
-- posteriores depende dele). Cria uma linha `reversal`; nada é apagado.
create function public.fin_reverse_payment(p_request_id uuid, p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; p public.fin_charge_payments%rowtype; v_latest uuid; v_credit public.fin_member_credits%rowtype; v_status text;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'charge_payment_reverse', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into p from public.fin_charge_payments where id = p_payment_id and kind = 'payment';
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.fin_member_charges where id = p.charge_id for update;
  if exists (select 1 from public.fin_charge_payments where reverses_payment_id = p_payment_id) then raise exception 'PAYMENT_ALREADY_REVERSED'; end if;
  select id into v_latest from fin_private.charge_payments_effective where charge_id = p.charge_id order by paid_on desc, created_at desc, id desc limit 1;
  if v_latest <> p_payment_id then raise exception 'ONLY_LAST_PAYMENT_REVERSIBLE'; end if;
  -- O excedente deste pagamento só some se ainda não foi usado.
  select * into v_credit from public.fin_member_credits where source_payment_id = p_payment_id for update;
  if found then
    if v_credit.status <> 'open' or v_credit.remaining_cents <> v_credit.amount_cents then raise exception 'CREDIT_ALREADY_USED'; end if;
    update public.fin_member_credits set status = 'void', remaining_cents = 0, resolution_note = 'Pagamento de origem estornado',
      resolved_at = now(), resolved_by = v_actor where id = v_credit.id;
  end if;
  -- Estornar uma aplicação de crédito devolve o valor ao crédito.
  if p.method = 'credit' and p.credit_id is not null then
    update public.fin_member_credits set remaining_cents = remaining_cents + p.amount_cents, status = 'open',
      resolved_at = null, resolved_by = null where id = p.credit_id;
  end if;
  insert into public.fin_charge_payments(charge_id, kind, amount_cents, paid_on, fine_cents, interest_cents, principal_cents, excess_cents,
    method, account_id, credit_id, reverses_payment_id, note, actor_id, request_id)
  values (p.charge_id, 'reversal', p.amount_cents, fin_private.today(), p.fine_cents, p.interest_cents, p.principal_cents, p.excess_cents,
    p.method, p.account_id, p.credit_id, p.id, trim(p_reason), v_actor, p_request_id);
  v_status := fin_private.refresh_charge_status(p.charge_id);
  return fin_private.finish_op(p_request_id, jsonb_build_object('charge_id', p.charge_id, 'charge_status', v_status));
end $$;

-- Cancelar a cobrança só se não houver pagamento efetivo (com pagamento, estorne antes).
create function public.fin_cancel_charge(p_request_id uuid, p_charge uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; c public.fin_member_charges%rowtype;
begin
  v_actor := fin_private.require_admin();
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'charge_cancel', p_reason);
  if v_replay is not null then return v_replay; end if;
  select * into c from public.fin_member_charges where id = p_charge for update;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  if c.status = 'canceled' then raise exception 'CHARGE_CANCELED'; end if;
  if exists (select 1 from fin_private.charge_payments_effective where charge_id = p_charge) then raise exception 'CHARGE_HAS_PAYMENTS'; end if;
  update public.fin_member_charges set status = 'canceled', canceled_at = now(), canceled_by = v_actor, cancel_reason = trim(p_reason),
    version = version + 1, updated_at = now(), updated_by = v_actor where id = p_charge;
  -- Comprovantes ainda em análise para uma cobrança cancelada continuam rastreáveis; o admin decide.
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_charge));
end $$;

-- Crédito do sócio (excedente/duplicado): aplicar numa cobrança, devolver ou baixar.
create function public.fin_resolve_credit(p_request_id uuid, p_credit uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; cr public.fin_member_credits%rowtype; ch public.fin_member_charges%rowtype; st record;
  v_amount bigint; v_res jsonb; v_entry uuid; v_name text; v_today date := fin_private.today();
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'credit_' || coalesce(p_action, ''), p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  select * into cr from public.fin_member_credits where id = p_credit for update;
  if not found then raise exception 'CREDIT_NOT_FOUND'; end if;
  if cr.status <> 'open' or cr.remaining_cents <= 0 then raise exception 'CREDIT_NOT_OPEN'; end if;
  if p_action = 'apply' then
    select * into ch from public.fin_member_charges where id = (p_data->>'charge_id')::uuid for update;
    if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
    if ch.profile_id <> cr.profile_id then raise exception 'CREDIT_OWNER_MISMATCH'; end if;
    select * into st from fin_private.charge_statement(ch.id, v_today);
    v_amount := least(coalesce((p_data->>'amount_cents')::bigint, cr.remaining_cents), cr.remaining_cents, st.total_due);
    if v_amount <= 0 then raise exception 'NOTHING_TO_APPLY'; end if;
    v_res := fin_private.apply_payment(ch.id, v_amount, v_today, 'credit', null, null, cr.id, 'Aplicação de crédito do sócio', p_request_id);
    update public.fin_member_credits set remaining_cents = remaining_cents - v_amount,
      status = case when remaining_cents - v_amount = 0 then 'applied' else 'open' end,
      resolved_at = case when remaining_cents - v_amount = 0 then now() end, resolved_by = case when remaining_cents - v_amount = 0 then v_actor end
    where id = cr.id;
  elsif p_action = 'refund' then
    if p_data->>'reason' is null or length(trim(p_data->>'reason')) < 3 then raise exception 'REASON_REQUIRED'; end if;
    select name into v_name from public.profiles where id = cr.profile_id;
    insert into public.fin_entries(kind, status, description, amount_cents, competence_date, settled_on, request_id, created_by, updated_by)
    values ('member_refund', 'paid', left('Devolução de crédito — ' || coalesce(v_name, 'sócio'), 140), cr.remaining_cents, v_today, v_today,
      gen_random_uuid(), v_actor, v_actor) returning id into v_entry;
    perform fin_private.add_entry_payment(v_entry, cr.remaining_cents, coalesce((p_data->>'paid_on')::date, v_today),
      (p_data->>'account_id')::uuid, p_data->>'reason', true, gen_random_uuid());
    update public.fin_member_credits set remaining_cents = 0, status = 'refunded', refund_entry_id = v_entry,
      resolution_note = trim(p_data->>'reason'), resolved_at = now(), resolved_by = v_actor where id = cr.id;
    v_res := jsonb_build_object('entry_id', v_entry);
  elsif p_action = 'void' then
    if p_data->>'reason' is null or length(trim(p_data->>'reason')) < 5 then raise exception 'REASON_REQUIRED'; end if;
    update public.fin_member_credits set remaining_cents = 0, status = 'void', resolution_note = trim(p_data->>'reason'),
      resolved_at = now(), resolved_by = v_actor where id = cr.id;
    v_res := '{}'::jsonb;
  else
    raise exception 'INVALID_ACTION';
  end if;
  return fin_private.finish_op(p_request_id, jsonb_build_object('credit_id', p_credit, 'result', v_res));
end $$;

-- ------------------------------------------------------------------
-- 5. Leitura: extratos das cobranças (admin, sócio e por ids)
-- ------------------------------------------------------------------
create function fin_private.charge_rows(p_profile uuid, p_ids uuid[], p_filters jsonb, p_as_of date, p_limit integer, p_offset integer)
returns table(charge_id uuid, plan_id uuid, profile_id uuid, profile_name text, competence_month date, period_months smallint,
  due_date date, original_amount_cents bigint, stored_status text, display_status text, in_review boolean,
  principal_base_cents bigint, principal_paid_cents bigint, principal_remaining_cents bigint, days_late integer,
  fine_due_cents bigint, interest_due_cents bigint, fees_due_cents bigint, fees_paid_cents bigint, fees_waived_cents bigint,
  total_due_cents bigint, fees_configured boolean, overdue boolean, last_payment_on date, cancel_reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(trim(coalesce(p_filters->>'search', '')), '');
begin
  return query
  with x as (
    select c.id, c.plan_id, c.profile_id, pr.name pname, c.competence_month, c.period_months, c.due_date, c.original_amount_cents,
      c.status, c.cancel_reason,
      exists (select 1 from public.fin_receipt_charges rc join public.fin_receipt_submissions rs on rs.id = rc.submission_id
              where rc.charge_id = c.id and rs.status in ('submitted', 'in_review')) as rev,
      st.*,
      (select max(e.paid_on) from fin_private.charge_payments_effective e where e.charge_id = c.id) as last_pay
    from public.fin_member_charges c
    join public.profiles pr on pr.id = c.profile_id
    cross join lateral fin_private.charge_statement(c.id, p_as_of) st
    where (p_profile is null or c.profile_id = p_profile)
      and (p_ids is null or c.id = any(p_ids))
      and (v_search is null or pr.name ilike '%' || v_search || '%')
      and (nullif(p_filters->>'profile_id', '') is null or c.profile_id = (p_filters->>'profile_id')::uuid)
      and (nullif(p_filters->>'plan_id', '') is null or c.plan_id = (p_filters->>'plan_id')::uuid)
      and (nullif(p_filters->>'competence_from', '') is null or c.competence_month >= (p_filters->>'competence_from')::date)
      and (nullif(p_filters->>'competence_to', '') is null or c.competence_month <= (p_filters->>'competence_to')::date)
      and (nullif(p_filters->>'due_from', '') is null or c.due_date >= (p_filters->>'due_from')::date)
      and (nullif(p_filters->>'due_to', '') is null or c.due_date <= (p_filters->>'due_to')::date)
  ), y as (
    select x.*, case
      when x.status = 'canceled' then 'canceled'
      when x.status = 'paid' then 'paid'
      when x.rev then 'in_review'
      when x.status = 'partial' then 'partial'
      when p_as_of > x.due_date then 'overdue'
      when p_as_of <= ((x.competence_month + make_interval(months => x.period_months::integer))::date - 1) then 'forecast'
      else 'open' end as dstatus
    from x
  )
  select y.id, y.plan_id, y.profile_id, y.pname, y.competence_month, y.period_months, y.due_date, y.original_amount_cents,
    y.status, y.dstatus, y.rev, y.principal_base, y.principal_paid, y.principal_remaining, y.days_late, y.fine_due, y.interest_due,
    y.fees_due, y.fees_paid, y.fees_waived, y.total_due, y.fees_configured, y.overdue, y.last_pay, y.cancel_reason,
    count(*) over() as total_count
  from y
  where (nullif(p_filters->>'status', '') is null or y.dstatus = (p_filters->>'status'))
  order by y.due_date desc, y.pname, y.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $$;

create function public.fin_charge_statements(p_filters jsonb default '{}'::jsonb, p_as_of date default null,
  p_limit integer default 100, p_offset integer default 0)
returns table(charge_id uuid, plan_id uuid, profile_id uuid, profile_name text, competence_month date, period_months smallint,
  due_date date, original_amount_cents bigint, stored_status text, display_status text, in_review boolean,
  principal_base_cents bigint, principal_paid_cents bigint, principal_remaining_cents bigint, days_late integer,
  fine_due_cents bigint, interest_due_cents bigint, fees_due_cents bigint, fees_paid_cents bigint, fees_waived_cents bigint,
  total_due_cents bigint, fees_configured boolean, overdue boolean, last_payment_on date, cancel_reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  return query select * from fin_private.charge_rows(null, null, coalesce(p_filters, '{}'::jsonb), coalesce(p_as_of, fin_private.today()),
    least(coalesce(p_limit, 100), 1000), coalesce(p_offset, 0));
end $$;

-- O sócio vê só as próprias cobranças (inclusive encargos e total atualizado).
create function public.fin_my_charges(p_as_of date default null)
returns table(charge_id uuid, plan_id uuid, profile_id uuid, profile_name text, competence_month date, period_months smallint,
  due_date date, original_amount_cents bigint, stored_status text, display_status text, in_review boolean,
  principal_base_cents bigint, principal_paid_cents bigint, principal_remaining_cents bigint, days_late integer,
  fine_due_cents bigint, interest_due_cents bigint, fees_due_cents bigint, fees_paid_cents bigint, fees_waived_cents bigint,
  total_due_cents bigint, fees_configured boolean, overdue boolean, last_payment_on date, cancel_reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
  return query select * from fin_private.charge_rows(auth.uid(), null, '{}'::jsonb, coalesce(p_as_of, fin_private.today()), 500, 0);
end $$;

-- Extratos de cobranças específicas numa data (revisão de comprovante). Admin,
-- ou o dono de TODAS as cobranças pedidas.
create function public.fin_charge_statements_by_ids(p_ids uuid[], p_as_of date default null)
returns table(charge_id uuid, plan_id uuid, profile_id uuid, profile_name text, competence_month date, period_months smallint,
  due_date date, original_amount_cents bigint, stored_status text, display_status text, in_review boolean,
  principal_base_cents bigint, principal_paid_cents bigint, principal_remaining_cents bigint, days_late integer,
  fine_due_cents bigint, interest_due_cents bigint, fees_due_cents bigint, fees_paid_cents bigint, fees_waived_cents bigint,
  total_due_cents bigint, fees_configured boolean, overdue boolean, last_payment_on date, cancel_reason text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
  if not public.is_admin() and exists (select 1 from public.fin_member_charges c where c.id = any(p_ids) and c.profile_id <> auth.uid()) then
    raise exception 'FINANCE_FORBIDDEN' using errcode = '42501';
  end if;
  return query select * from fin_private.charge_rows(null, p_ids, '{}'::jsonb, coalesce(p_as_of, fin_private.today()), 1000, 0);
end $$;

-- Para o sócio: o que o clube pede dele (regra pública) sem expor a tabela de configuração.
-- (fin_public_settings já existe na migração 1/5.)

-- ------------------------------------------------------------------
-- 6. RLS, gatilhos e permissões
-- ------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['fin_member_plans', 'fin_member_plan_prices', 'fin_member_charges', 'fin_charge_adjustments',
    'fin_charge_payments', 'fin_member_credits', 'fin_receipt_submissions', 'fin_receipt_charges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated, anon with check (false)', t || '_no_insert', t);
    execute format('create policy %I on public.%I for update to authenticated, anon using (false) with check (false)', t || '_no_update', t);
    execute format('create policy %I on public.%I for delete to authenticated, anon using (false)', t || '_no_delete_policy', t);
    execute format('create trigger %I before delete on public.%I for each row execute function fin_private.no_delete()', t || '_no_delete', t);
  end loop;
  foreach t in array array['fin_member_plans', 'fin_member_plan_prices', 'fin_member_charges', 'fin_charge_adjustments',
    'fin_charge_payments', 'fin_member_credits', 'fin_receipt_submissions'] loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function fin_private.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Leitura: administrador vê tudo; sócio vê só o que é seu (por `auth.uid()`).
create policy fin_member_plans_read on public.fin_member_plans for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
create policy fin_member_plan_prices_read on public.fin_member_plan_prices for select to authenticated
  using (public.is_admin() or exists (select 1 from public.fin_member_plans p where p.id = plan_id and p.profile_id = (select auth.uid())));
create policy fin_member_charges_read on public.fin_member_charges for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
create policy fin_charge_adjustments_read on public.fin_charge_adjustments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.fin_member_charges c where c.id = charge_id and c.profile_id = (select auth.uid())));
create policy fin_charge_payments_read on public.fin_charge_payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.fin_member_charges c where c.id = charge_id and c.profile_id = (select auth.uid())));
create policy fin_member_credits_read on public.fin_member_credits for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
create policy fin_receipt_submissions_read on public.fin_receipt_submissions for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
create policy fin_receipt_charges_read on public.fin_receipt_charges for select to authenticated
  using (public.is_admin() or exists (select 1 from public.fin_receipt_submissions s where s.id = submission_id and s.profile_id = (select auth.uid())));

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
