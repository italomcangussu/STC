-- Todas as visões de caixa, saldos, dashboard, exportação devem ler este motor único.
CREATE OR REPLACE FUNCTION fin_private.cash_rows(p_from date, p_to date)
 RETURNS TABLE(source_type text, source_id text, leg text, occurred_on date, flow text, description text, category_id uuid, account_id uuid, amount_cents bigint, is_transfer boolean, origin text, profile_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.fin_settings%rowtype; v_default uuid;
begin
  select * into s from public.fin_settings;
  select id into v_default from public.fin_accounts where is_default_receipts and active limit 1;
  return query
  with u as (
    -- Mensalidade: principal / encargos / excedente, no dia do pagamento, na conta escolhida.
    -- Pagamento por crédito do sócio NÃO é entrada de dinheiro (o dinheiro entrou antes).
    select 'member_payment'::text st, p.id::text sid, 'principal'::text leg, p.paid_on d, 'receipt'::text flow,
      case when c.charge_type='member_pendency' then c.description else 'Mensalidade' end::text descr,
      coalesce(c.category_id, fin_private.category_id('member_fees')) cat,
      p.account_id acct, p.principal_cents amt, false tr, 'auto'::text org, c.profile_id prof
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
    select 'member_reversal', p.id::text, 'reversal', p.paid_on, 'refund',
      case when c.charge_type='member_pendency' then 'Estorno — '||c.description else 'Estorno de pagamento de mensalidade' end,
      fin_private.category_id('refunds'),
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
  where (a.id is null or u.d >= a.opening_date)
    and not exists (
      select 1 from fin_private.cash_removed d
      where d.source_type=u.st and d.source_id=u.sid
    );
end $function$

