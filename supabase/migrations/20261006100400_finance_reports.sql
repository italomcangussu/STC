-- Financeiro do clube — relatórios: DRE, caixa, saldos, a receber/pagar (5/5).
--
-- Regra central (a mesma do North Jato): o que o sistema já sabe é LIDO NA
-- ORIGEM — mensalidades (`fin_member_charges`), pagamentos (`fin_charge_payments`),
-- `student_payments` (Card Mensal e Aula avulsa dos alunos), reservas com convidado
-- (Day Card, via `fin_private.day_card_rows`) e lançamentos.
-- Nada é replicado em tabela de resultado: um fato aparece uma vez porque existe uma vez.
-- Professor NÃO tem linha aqui: o professor é pago pelo aluno, fora do financeiro do clube.
--
--  * DRE  = COMPETÊNCIA (`dre_rows`): mensalidade pelo mês cobrado (entra o mês cujo dia 1 está no período); Card Mensal
--    e Aula avulsa pela data do pagamento registrado; Day Card (convidado) pela data da reserva; conta/receita
--    manual pela `competence_date`.
--  * CAIXA = data REAL em que o dinheiro entrou/saiu (`fin_cash_rows`).
--
-- Aporte, retirada, devolução a sócio e transferência não entram no DRE.
-- Transferência nem entra nas entradas/saídas consolidadas: só muda o dinheiro de conta.

-- ------------------------------------------------------------------
-- 1. DRE — linhas por competência
-- ------------------------------------------------------------------
-- Sinal econômico: + receita; − dedução/custo/despesa.
-- source_type/source_id permitem "ver os lançamentos que formam o valor".
create function fin_private.dre_rows(p_from date, p_to date)
returns table(category_id uuid, amount_cents bigint, source_type text, source_id text, occurred_on date, description text, profile_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare s public.fin_settings%rowtype;
begin
  select * into s from public.fin_settings;
  return query
  -- 1. Mensalidades de sócios: o valor do período é rateado nos meses de competência
  --    (resto dos centavos no primeiro mês); entra o mês cujo dia 1 está no período.
  with m as (
    select c.id, c.profile_id, c.period_months n, c.original_amount_cents o, gs.i,
      (c.competence_month + make_interval(months => gs.i))::date as month_start
    from public.fin_member_charges c cross join lateral generate_series(0, c.period_months - 1) as gs(i)
    where c.status <> 'canceled'
  ), adj as (
    select a.charge_id,
      coalesce(sum(a.amount_cents) filter (where a.kind = 'discount'), 0)::bigint disc,
      coalesce(sum(a.amount_cents) filter (where a.kind = 'increase'), 0)::bigint inc
    from public.fin_charge_adjustments a group by a.charge_id
  )
  select fin_private.category_id('member_fees'),
    (((m.o + coalesce(adj.inc, 0)) / m.n) + case when m.i = 0 then (m.o + coalesce(adj.inc, 0)) - ((m.o + coalesce(adj.inc, 0)) / m.n) * m.n else 0 end)::bigint,
    'member_charge', m.id::text, m.month_start, 'Mensalidade ' || to_char(m.month_start, 'MM/YYYY'), m.profile_id
  from m left join adj on adj.charge_id = m.id where m.month_start between p_from and p_to
  union all
  select fin_private.category_id('discounts'),
    -(((coalesce(adj.disc, 0)) / m.n) + case when m.i = 0 then coalesce(adj.disc, 0) - (coalesce(adj.disc, 0) / m.n) * m.n else 0 end)::bigint,
    'member_discount', m.id::text, m.month_start, 'Desconto na mensalidade ' || to_char(m.month_start, 'MM/YYYY'), m.profile_id
  from m join adj on adj.charge_id = m.id where adj.disc > 0 and m.month_start between p_from and p_to
  union all
  -- 2. Multas e juros recebidos: reconhecidos no dia do pagamento; o estorno devolve na data do estorno.
  select fin_private.category_id('late_fees'), (p.fine_cents + p.interest_cents)::bigint, 'member_fee_payment', p.id::text, p.paid_on,
    'Multa e juros de mora', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'payment' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
  union all
  select fin_private.category_id('refunds'), -(p.fine_cents + p.interest_cents)::bigint, 'member_fee_reversal', p.id::text, p.paid_on,
    'Estorno de multa e juros', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'reversal' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
  union all
  -- 3. Card Mensal e Aula avulsa dos alunos não-sócios: o que foi PAGO e registrado em `student_payments`
  --    (ATIVOS, pela data do pagamento). Validade além do dia = Card Mensal; no próprio dia = Aula avulsa
  --    (no app, o plano "Day Card" do aluno). Cancelados/estornados não são receita. A aula em si não gera
  --    receita derivada: o dinheiro já está no pagamento (ou coberto pelo Card Mensal).
  select fin_private.category_id(case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date
      then 'card_mensal' else 'aula_avulsa' end),
    round(sp.amount * 100)::bigint, 'student_payment', sp.id::text, (sp.payment_date at time zone 'America/Fortaleza')::date,
    case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'Card Mensal' else 'Aula avulsa' end
      || ' — ' || coalesce(st.name, 'aluno'), null::uuid
  from public.student_payments sp left join public.non_socio_students st on st.id = sp.student_id
  where sp.status = 'active' and (sp.payment_date at time zone 'America/Fortaleza')::date between p_from and p_to
  union all
  -- 4. Day Card do convidado, derivado da reserva com convidado (isentas valem R$ 0 e ficam de fora).
  select fin_private.category_id('day_card'), d.charged_cents, 'day_card', d.reservation_id::text,
    d.occurred_on, 'Day Card — ' || d.guest_name, null::uuid
  from fin_private.day_card_rows(p_from, p_to) d where d.charged_cents > 0
  union all
  -- 5. Contas e receitas manuais pela competência (pagas ou não — regime de competência).
  select e.category_id, case when e.kind = 'expense' then -e.amount_cents else e.amount_cents end, 'entry', e.id::text, e.competence_date,
    e.description, null::uuid
  from public.fin_entries e where e.status <> 'canceled' and e.kind in ('expense', 'revenue') and e.competence_date between p_from and p_to
  union all
  -- 6. Pagou diferente do documento: a diferença é juros/multa (ou desconto obtido) na data da quitação.
  select fin_private.category_id('interest'), case when e.kind = 'expense' then -e.adjustment_cents else e.adjustment_cents end, 'entry_adjustment',
    e.id::text, e.settled_on, 'Diferença no pagamento — ' || e.description, null::uuid
  from public.fin_entries e where e.status = 'paid' and e.kind in ('expense', 'revenue') and e.adjustment_cents <> 0 and e.settled_on between p_from and p_to;
end $$;

-- Uma linha por categoria com valor no período, no sentido da linha do DRE
-- (receita positiva; dedução, custo e despesa POSITIVOS = reduzem o resultado).
create function fin_private.dre_lines(p_from date, p_to date)
returns table(line text, category_id uuid, name text, parent_name text, amount_cents bigint)
language sql stable security definer set search_path = '' as $$
  select c.dre_line, c.id, c.name, g.name,
    (case when c.dre_line = 'revenue' then 1 else -1 end * sum(x.amount_cents))::bigint
  from fin_private.dre_rows(p_from, p_to) x
  join public.fin_categories c on c.id = x.category_id
  left join public.fin_categories g on g.id = c.parent_id
  where c.dre_line <> 'none'
  group by c.dre_line, c.id, c.name, g.name
  having sum(x.amount_cents) <> 0
$$;

create function fin_private.check_period(p_from date, p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'INVALID_PERIOD'; end if;
end $$;

-- Período pedido e o imediatamente anterior, de mesmo tamanho, para comparação.
-- Os totais (receita líquida, margem, resultado) são compostos em TypeScript
-- (`lib/finance/reports.ts`) a partir destas linhas.
create function public.fin_dre_lines(p_from date, p_to date)
returns table(period text, line text, category_id uuid, name text, parent_name text, amount_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_len integer;
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  v_len := p_to - p_from + 1;
  return query
    select 'current'::text, l.line, l.category_id, l.name, l.parent_name, l.amount_cents from fin_private.dre_lines(p_from, p_to) l
    union all
    select 'previous'::text, l.line, l.category_id, l.name, l.parent_name, l.amount_cents from fin_private.dre_lines(p_from - v_len, p_from - 1) l;
end $$;

-- Aporte e retirada por competência (memo do DRE: fora do resultado).
create function public.fin_dre_memo(p_from date, p_to date)
returns table(contributions_cents bigint, withdrawals_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  return query select
    coalesce(sum(e.amount_cents) filter (where e.kind = 'contribution'), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where e.kind = 'withdrawal'), 0)::bigint
  from public.fin_entries e where e.status <> 'canceled' and e.competence_date between p_from and p_to;
end $$;

-- Lançamentos que formam cada valor do DRE (detalhe/"consultar origem").
create function public.fin_dre_detail(p_from date, p_to date, p_category uuid default null)
returns table(category_id uuid, category_name text, source_type text, source_id text, occurred_on date, description text, amount_cents bigint, profile_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  return query
  select x.category_id, c.name, x.source_type, x.source_id, x.occurred_on, x.description, x.amount_cents, x.profile_id
  from fin_private.dre_rows(p_from, p_to) x join public.fin_categories c on c.id = x.category_id
  where c.dre_line <> 'none' and (p_category is null or x.category_id = p_category)
  order by x.occurred_on, x.description, x.source_id;
end $$;

-- ------------------------------------------------------------------
-- 2. Fluxo de caixa — data real de entrada/saída
-- ------------------------------------------------------------------
-- amount_cents: sinal do dinheiro NA conta (+ entra, − sai).
-- flow: receipt | fee | credit | refund | expense | revenue | contribution | withdrawal | transfer |
--       member_refund | day_card | opening
create function fin_private.cash_rows(p_from date, p_to date)
returns table(source_type text, source_id text, leg text, occurred_on date, flow text, description text, category_id uuid,
  account_id uuid, amount_cents bigint, is_transfer boolean, origin text, profile_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare s public.fin_settings%rowtype; v_default uuid;
begin
  select * into s from public.fin_settings;
  select id into v_default from public.fin_accounts where is_default_receipts and active limit 1;
  return query
  with u as (
    -- Mensalidade: principal / encargos / excedente, no dia do pagamento, na conta escolhida.
    -- Pagamento por crédito do sócio NÃO é entrada de dinheiro (o dinheiro entrou antes).
    select 'member_payment'::text st, p.id::text sid, 'principal'::text leg, p.paid_on d, 'receipt'::text flow, 'Mensalidade'::text descr,
      fin_private.category_id('member_fees') cat, p.account_id acct, p.principal_cents amt, false tr, 'auto'::text org, c.profile_id prof
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.principal_cents > 0 and p.paid_on between p_from and p_to
    union all
    select 'member_payment', p.id::text, 'fees', p.paid_on, 'fee', 'Multa e juros de mora', fin_private.category_id('late_fees'), p.account_id,
      (p.fine_cents + p.interest_cents), false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
    union all
    select 'member_payment', p.id::text, 'excess', p.paid_on, 'credit', 'Crédito do sócio (excedente/duplicado)', null::uuid, p.account_id,
      p.excess_cents, false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.excess_cents > 0 and p.paid_on between p_from and p_to
    union all
    -- Estorno de pagamento: sai o mesmo dinheiro, no dia do estorno.
    select 'member_reversal', p.id::text, 'reversal', p.paid_on, 'refund', 'Estorno de pagamento de mensalidade', fin_private.category_id('refunds'),
      p.account_id, -(p.principal_cents + p.fine_cents + p.interest_cents + p.excess_cents), false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'reversal' and p.method <> 'credit' and p.paid_on between p_from and p_to
    union all
    -- Card Mensal / Aula avulsa dos alunos (student_payments ativos) — conta padrão de recebimentos.
    select 'student_payment', sp.id::text, 'main', (sp.payment_date at time zone 'America/Fortaleza')::date, 'receipt',
      case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'Card Mensal' else 'Aula avulsa' end
        || ' — ' || coalesce(st.name, 'aluno'),
      fin_private.category_id(case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'card_mensal' else 'aula_avulsa' end),
      v_default, round(sp.amount * 100)::bigint, false, 'auto', null::uuid
    from public.student_payments sp left join public.non_socio_students st on st.id = sp.student_id
    where sp.status = 'active' and (sp.payment_date at time zone 'America/Fortaleza')::date between p_from and p_to
    union all
    -- Day Card do convidado (derivado da reserva): só entra no caixa se o clube disser que recebe na hora (padrão: não).
    select 'day_card', d.reservation_id::text, 'main', d.occurred_on, 'day_card',
      'Day Card — ' || d.guest_name, fin_private.category_id('day_card'), v_default, d.charged_cents, false, 'derived', null::uuid
    from fin_private.day_card_rows(p_from, p_to) d where s.day_card_in_cash and d.charged_cents > 0
    union all
    -- Lançamentos (pagamentos/recebimentos de contas, aportes, retiradas, devoluções).
    select 'entry_payment', x.id::text, case when e.kind = 'transfer' then 'out' else 'main' end, x.paid_on,
      case e.kind when 'expense' then 'expense' when 'revenue' then 'revenue' when 'contribution' then 'contribution'
        when 'withdrawal' then 'withdrawal' when 'transfer' then 'transfer' else 'member_refund' end,
      e.description, e.category_id, x.account_id,
      (case when e.kind in ('expense', 'withdrawal', 'transfer', 'member_refund') then -1 else 1 end * case when x.kind = 'payment' then 1 else -1 end * x.amount_cents)::bigint,
      e.kind = 'transfer', 'manual', null::uuid
    from public.fin_entry_payments x join public.fin_entries e on e.id = x.entry_id where x.paid_on between p_from and p_to
    union all
    select 'entry_payment', x.id::text, 'in', x.paid_on, 'transfer', e.description, null::uuid, e.counter_account_id,
      (case when x.kind = 'payment' then 1 else -1 end * x.amount_cents)::bigint, true, 'manual', null::uuid
    from public.fin_entry_payments x join public.fin_entries e on e.id = x.entry_id
    where e.kind = 'transfer' and x.paid_on between p_from and p_to
    union all
    select 'opening', a.id::text, 'main', a.opening_date, 'opening', 'Saldo inicial — ' || a.name, null::uuid, a.id, a.opening_balance_cents,
      false, 'manual', null::uuid
    from public.fin_accounts a where a.opening_balance_cents <> 0 and a.opening_date between p_from and p_to
  )
  -- Antes da data de saldo inicial de uma conta o movimento já está dentro do saldo informado.
  select u.st, u.sid, u.leg, u.d, u.flow, u.descr, u.cat, u.acct, u.amt, u.tr, u.org, u.prof
  from u left join public.fin_accounts a on a.id = u.acct
  where a.id is null or u.d >= a.opening_date;
end $$;

-- Saldo por conta numa data (inclui o que não tem conta definida, para o total fechar).
create function fin_private.account_balances(p_at date)
returns table(id uuid, name text, kind text, active boolean, is_default_receipts boolean, balance_cents bigint)
language sql stable security definer set search_path = '' as $$
  with s as (select account_id, sum(amount_cents)::bigint amt from fin_private.cash_rows('1900-01-01'::date, p_at) group by 1)
  select a.id, a.name, a.kind, a.active, a.is_default_receipts, coalesce(s.amt, 0)::bigint
  from public.fin_accounts a left join s on s.account_id = a.id
  where a.active or coalesce(s.amt, 0) <> 0
  union all
  select null::uuid, 'Sem conta definida', 'other', true, false, s.amt from s where s.account_id is null and s.amt <> 0
  order by 2
$$;

create function public.fin_account_balances(p_at date default null)
returns table(id uuid, name text, kind text, active boolean, is_default_receipts boolean, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  return query select * from fin_private.account_balances(coalesce(p_at, fin_private.today()));
end $$;

-- Movimentos de caixa do período, com filtros (conta, fluxo, categoria, origem, busca).
-- A exportação e a tela usam ESTA mesma função: o que se vê é o que se exporta.
create function public.fin_movements(p_from date, p_to date, p_filters jsonb default '{}'::jsonb, p_limit integer default 500, p_offset integer default 0)
returns table(source_type text, source_id text, leg text, occurred_on date, flow text, description text, category_id uuid, category_name text,
  account_id uuid, account_name text, amount_cents bigint, is_transfer boolean, origin text, profile_id uuid, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_flows text[];
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  v_flows := case when p_filters ? 'flows' then array(select jsonb_array_elements_text(p_filters->'flows')) end;
  return query
  select m.source_type, m.source_id, m.leg, m.occurred_on, m.flow, m.description, m.category_id, c.name, m.account_id,
    coalesce(a.name, 'Sem conta definida'), m.amount_cents, m.is_transfer, m.origin, m.profile_id, count(*) over()
  from fin_private.cash_rows(p_from, p_to) m
  left join public.fin_categories c on c.id = m.category_id
  left join public.fin_accounts a on a.id = m.account_id
  where (v_flows is null or m.flow = any(v_flows))
    and (nullif(p_filters->>'account_id', '') is null or m.account_id = (p_filters->>'account_id')::uuid)
    and (nullif(p_filters->>'category_id', '') is null or m.category_id = (p_filters->>'category_id')::uuid)
    and (nullif(p_filters->>'origin', '') is null or m.origin = p_filters->>'origin')
    and (nullif(trim(coalesce(p_filters->>'search', '')), '') is null or m.description ilike '%' || trim(p_filters->>'search') || '%')
  order by m.occurred_on desc, m.description, m.source_id, m.leg
  limit least(greatest(p_limit, 0), 5000) offset greatest(p_offset, 0);
end $$;

-- Fluxo por dia/semana/mês: saldo inicial, entradas, saídas, saldo final.
-- Consolidado, a transferência interna some; por conta, aparece.
create function public.fin_cash_flow(p_from date, p_to date, p_granularity text default 'day', p_account uuid default null)
returns table(bucket_start date, bucket_end date, opening_cents bigint, inflow_cents bigint, outflow_cents bigint, net_cents bigint, closing_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_step text;
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  if p_granularity not in ('day', 'week', 'month') then raise exception 'INVALID_PERIOD'; end if;
  v_step := case p_granularity when 'day' then '1 day' when 'week' then '1 week' else '1 month' end;
  return query
  with cr as (
    select r.occurred_on d, r.amount_cents amt, r.flow from fin_private.cash_rows('1900-01-01'::date, p_to) r
    where (p_account is null and not r.is_transfer) or (p_account is not null and r.account_id = p_account)
  ), b as (
    select gs::date bs, least((gs + v_step::interval - interval '1 day')::date, p_to) be
    from generate_series(case p_granularity when 'week' then date_trunc('week', p_from::timestamp) when 'month' then date_trunc('month', p_from::timestamp) else p_from::timestamp end,
      p_to::timestamp, v_step::interval) gs
  )
  select b.bs, b.be,
    coalesce((select sum(amt) from cr where d < greatest(b.bs, p_from)), 0)::bigint,
    coalesce((select sum(amt) from cr where d between greatest(b.bs, p_from) and b.be and amt > 0 and flow <> 'opening'), 0)::bigint,
    coalesce((select sum(-amt) from cr where d between greatest(b.bs, p_from) and b.be and amt < 0 and flow <> 'opening'), 0)::bigint,
    coalesce((select sum(amt) from cr where d between greatest(b.bs, p_from) and b.be and flow <> 'opening'), 0)::bigint,
    coalesce((select sum(amt) from cr where d <= b.be), 0)::bigint
  from b order by b.bs;
end $$;

-- ------------------------------------------------------------------
-- 3. A receber, a pagar, inadimplência e previsão (dashboard)
-- ------------------------------------------------------------------
-- Mensalidades: aberto, vencido e previsto na data (principal + encargos já calculados).
create function public.fin_receivables_summary(p_as_of date default null)
returns table(open_count bigint, open_cents bigint, overdue_count bigint, overdue_cents bigint, due_7d_cents bigint, due_30d_cents bigint,
  forecast_cents bigint, fees_configured boolean, overdue_members bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_as_of, fin_private.today());
begin
  perform fin_private.require_admin();
  return query
  with r as (select * from fin_private.charge_rows(null, null, '{}'::jsonb, v_asof, 100000, 0) where stored_status in ('open', 'partial'))
  select count(*), coalesce(sum(total_due_cents), 0)::bigint,
    count(*) filter (where overdue), coalesce(sum(total_due_cents) filter (where overdue), 0)::bigint,
    coalesce(sum(total_due_cents) filter (where not overdue and due_date <= v_asof + 7), 0)::bigint,
    coalesce(sum(total_due_cents) filter (where not overdue and due_date <= v_asof + 30), 0)::bigint,
    coalesce(sum(total_due_cents) filter (where display_status = 'forecast'), 0)::bigint,
    coalesce(bool_and(r.fees_configured), (select late_fee_confirmed_at is not null from public.fin_settings)),
    count(distinct profile_id) filter (where overdue)
  from r;
end $$;

-- Contas a pagar/receber manuais: em aberto, vencidas e próximas.
create function public.fin_payables_summary(p_as_of date default null)
returns table(payable_open_cents bigint, payable_overdue_count bigint, payable_overdue_cents bigint, payable_due_7d_cents bigint, payable_due_30d_cents bigint,
  receivable_open_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_as_of, fin_private.today());
begin
  perform fin_private.require_admin();
  return query
  select coalesce(sum(remaining_cents) filter (where kind = 'expense'), 0)::bigint,
    count(*) filter (where kind = 'expense' and due_date < v_asof),
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date < v_asof), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date >= v_asof and due_date <= v_asof + 7), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date >= v_asof and due_date <= v_asof + 30), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'revenue'), 0)::bigint
  from public.fin_entries_v where status in ('pending', 'partial');
end $$;

-- Tendência: DRE-resumo e caixa mês a mês (últimos N meses) para o gráfico do dashboard.
create function public.fin_monthly_trend(p_to date default null, p_months integer default 6)
returns table(month_start date, revenue_cents bigint, expense_cents bigint, cash_in_cents bigint, cash_out_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := date_trunc('month', coalesce(p_to, fin_private.today())::timestamp)::date; v_from date;
begin
  perform fin_private.require_admin();
  if p_months < 1 or p_months > 36 then raise exception 'INVALID_PERIOD'; end if;
  v_from := (v_to - make_interval(months => p_months - 1))::date;
  return query
  with ms as (select gs::date m from generate_series(v_from::timestamp, v_to::timestamp, interval '1 month') gs),
  d as (select date_trunc('month', x.occurred_on::timestamp)::date m, x.amount_cents amt, c.dre_line
        from fin_private.dre_rows(v_from, (v_to + interval '1 month - 1 day')::date) x join public.fin_categories c on c.id = x.category_id
        where c.dre_line <> 'none'),
  k as (select date_trunc('month', r.occurred_on::timestamp)::date m, r.amount_cents amt
        from fin_private.cash_rows(v_from, (v_to + interval '1 month - 1 day')::date) r where not r.is_transfer and r.flow <> 'opening')
  select ms.m,
    coalesce((select sum(amt) from d where d.m = ms.m and dre_line in ('revenue', 'deduction') ), 0)::bigint,
    coalesce((select -sum(amt) from d where d.m = ms.m and dre_line not in ('revenue', 'deduction')), 0)::bigint,
    coalesce((select sum(amt) from k where k.m = ms.m and amt > 0), 0)::bigint,
    coalesce((select -sum(amt) from k where k.m = ms.m and amt < 0), 0)::bigint
  from ms order by ms.m;
end $$;

-- Receita dos não-sócios no período: pagamentos de alunos (Card Mensal e Aula avulsa) e Day Card dos
-- convidados, para a aba "Alunos e convidados".
create function public.fin_student_revenue(p_from date, p_to date)
returns table(source_type text, source_id text, occurred_on date, description text, amount_cents bigint, category_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  perform fin_private.check_period(p_from, p_to);
  return query
  select x.source_type, x.source_id, x.occurred_on, x.description, x.amount_cents, c.name
  from fin_private.dre_rows(p_from, p_to) x join public.fin_categories c on c.id = x.category_id
  where x.source_type in ('student_payment', 'day_card') order by x.occurred_on, x.description;
end $$;

-- ------------------------------------------------------------------
-- 4. Permissões
-- ------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
