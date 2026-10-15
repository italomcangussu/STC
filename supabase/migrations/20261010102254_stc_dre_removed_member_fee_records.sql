-- Multas e juros de cobranças excluídas não geram receitas/estornos fictícios no DRE.
CREATE OR REPLACE FUNCTION fin_private.dre_rows(p_from date, p_to date)
 RETURNS TABLE(category_id uuid, amount_cents bigint, source_type text, source_id text, occurred_on date, description text, profile_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where c.status <> 'canceled' and c.charge_type = 'membership'
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
  -- Pendências manuais do sócio entram na competência escolhida e na categoria de receita escolhida.
  select c.category_id, (c.original_amount_cents + coalesce(adj.inc,0))::bigint,
    'member_pendency', c.id::text, c.competence_month, c.description, c.profile_id
  from public.fin_member_charges c
  left join adj on adj.charge_id=c.id
  where c.charge_type='member_pendency' and c.status<>'canceled'
    and c.competence_month between p_from and p_to
  union all
  select fin_private.category_id('discounts'), -coalesce(adj.disc,0)::bigint,
    'member_pendency_discount', c.id::text, c.competence_month, 'Desconto — '||c.description, c.profile_id
  from public.fin_member_charges c
  join adj on adj.charge_id=c.id
  where c.charge_type='member_pendency' and c.status<>'canceled' and adj.disc>0
    and c.competence_month between p_from and p_to
  union all
  -- 2. Multas e juros recebidos: reconhecidos no dia do pagamento; o estorno devolve na data do estorno.
  select fin_private.category_id('late_fees'), (p.fine_cents + p.interest_cents)::bigint, 'member_fee_payment', p.id::text, p.paid_on,
    'Multa e juros de mora', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'payment' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
    and not exists (select 1 from fin_private.cash_removed cr where cr.source_type='member_payment' and cr.source_id=p.id::text)
  union all
  select fin_private.category_id('refunds'), -(p.fine_cents + p.interest_cents)::bigint, 'member_fee_reversal', p.id::text, p.paid_on,
    'Estorno de multa e juros', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'reversal' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
    and not exists (select 1 from fin_private.cash_removed cr where cr.source_type='member_reversal' and cr.source_id=p.id::text)
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
end $function$
