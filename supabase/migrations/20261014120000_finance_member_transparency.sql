-- Transparência financeira para os sócios: a aba "Financeiro do clube" do Dashboard mostra a todo
-- sócio ativo o mesmo Painel do admin (posição de hoje, resultado do período, tendência) e as saídas
-- fixas. Só leitura e só agregados: nada aqui expõe cobrança, pagamento ou comprovante de um sócio.

-- Admin ou sócio ativo (mesma regra de "sócio" das mensalidades: perfil socio/admin e ativo).
create function fin_private.require_member_reader() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.is_admin() or fin_private.is_active_member(auth.uid())) then
    raise exception 'FINANCE_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;
revoke all on function fin_private.require_member_reader() from public, anon;

-- As cinco leituras do Painel passam a aceitar o sócio; o corpo é o mesmo de 20261006100400.
create or replace function public.fin_dre_lines(p_from date, p_to date)
returns table(period text, line text, category_id uuid, name text, parent_name text, amount_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_len integer;
begin
  perform fin_private.require_member_reader();
  perform fin_private.check_period(p_from, p_to);
  v_len := p_to - p_from + 1;
  return query
    select 'current'::text, l.line, l.category_id, l.name, l.parent_name, l.amount_cents from fin_private.dre_lines(p_from, p_to) l
    union all
    select 'previous'::text, l.line, l.category_id, l.name, l.parent_name, l.amount_cents from fin_private.dre_lines(p_from - v_len, p_from - 1) l;
end $$;

create or replace function public.fin_account_balances(p_at date default null)
returns table(id uuid, name text, kind text, active boolean, is_default_receipts boolean, balance_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_member_reader();
  return query select * from fin_private.account_balances(coalesce(p_at, fin_private.today()));
end $$;

create or replace function public.fin_receivables_summary(p_as_of date default null)
returns table(open_count bigint, open_cents bigint, overdue_count bigint, overdue_cents bigint, due_7d_cents bigint, due_30d_cents bigint,
  forecast_cents bigint, fees_configured boolean, overdue_members bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_as_of, fin_private.today());
begin
  perform fin_private.require_member_reader();
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

create or replace function public.fin_payables_summary(p_as_of date default null)
returns table(payable_open_cents bigint, payable_overdue_count bigint, payable_overdue_cents bigint, payable_due_7d_cents bigint, payable_due_30d_cents bigint,
  receivable_open_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_as_of, fin_private.today());
begin
  perform fin_private.require_member_reader();
  return query
  select coalesce(sum(remaining_cents) filter (where kind = 'expense'), 0)::bigint,
    count(*) filter (where kind = 'expense' and due_date < v_asof),
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date < v_asof), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date >= v_asof and due_date <= v_asof + 7), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'expense' and due_date >= v_asof and due_date <= v_asof + 30), 0)::bigint,
    coalesce(sum(remaining_cents) filter (where kind = 'revenue'), 0)::bigint
  from public.fin_entries_v where status in ('pending', 'partial');
end $$;

create or replace function public.fin_monthly_trend(p_to date default null, p_months integer default 6)
returns table(month_start date, revenue_cents bigint, expense_cents bigint, cash_in_cents bigint, cash_out_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_to date := date_trunc('month', coalesce(p_to, fin_private.today())::timestamp)::date; v_from date;
begin
  perform fin_private.require_member_reader();
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

-- Saídas fixas do clube (modelos de recorrência ativos e vigentes), com o nome da categoria.
create function public.fin_club_fixed_expenses()
returns table(id uuid, description text, supplier text, category_name text, amount_cents bigint, frequency text, due_day smallint,
  start_month date, end_month date)
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', fin_private.today()::timestamp)::date;
begin
  perform fin_private.require_member_reader();
  return query
  select r.id, r.description, r.supplier, c.name, r.amount_cents, r.frequency, r.due_day, r.start_month, r.end_month
  from public.fin_recurrences r join public.fin_categories c on c.id = r.category_id
  where r.active and (r.end_month is null or r.end_month >= v_month)
  order by r.amount_cents desc, r.description, r.id;
end $$;
revoke all on function public.fin_club_fixed_expenses() from public, anon;
grant execute on function public.fin_club_fixed_expenses() to authenticated;
