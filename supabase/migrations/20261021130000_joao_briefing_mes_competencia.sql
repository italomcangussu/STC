-- Resumo da manhã do João: o resultado do mês passa a ser o MESMO do painel financeiro (ClubOverview).
-- Antes o resumo somava o mês pelo caixa (`fin_cash_flow`, do dia 1 até hoje), enquanto o painel mostra
-- receita, despesas e resultado por competência (`fin_dre_lines` do mês inteiro, `composeDre`). Mesmo dado,
-- bases diferentes: os números nunca batiam. `month_dre` repete a conta de `composeDre`
-- (receita líquida = receita − deduções; despesas = demais linhas; resultado = receita líquida − despesas).
-- `month` (caixa) continua no retorno para quem ainda o lê.
create or replace function conv_private.admin_briefing_data_base(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev_claims text; v_prev_sub text; v_err text; v_out jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_month_from date := date_trunc('month', v_today)::date;
  v_month_to date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
begin
  if not exists (select 1 from conv_private.admin_briefing_targets() t where t.profile_id = p_profile) then
    return conv_private.vfail('NOT_A_RECIPIENT', 'Esse administrador não recebe o resumo.');
  end if;
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  begin
    select jsonb_build_object(
      'today', v_today,
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'balance_cents', b.balance_cents) order by b.name)
                            from public.fin_account_balances(v_today) b where b.active), '[]'::jsonb),
      'total_cents', coalesce((select sum(b.balance_cents) from public.fin_account_balances(v_today) b where b.active), 0),
      'yesterday', (select jsonb_build_object('inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0))
                    from public.fin_cash_flow(v_today - 1, v_today - 1, 'day', null)),
      'month', (select jsonb_build_object('inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0), 'net_cents', coalesce(sum(net_cents), 0))
                from public.fin_cash_flow(v_month_from, v_today, 'month', null)),
      'month_dre', (select jsonb_build_object('revenue_cents', x.net_revenue, 'expenses_cents', x.expenses, 'result_cents', x.net_revenue - x.expenses)
                    from (select coalesce(sum(l.amount_cents) filter (where l.line = 'revenue'), 0)
                                 - coalesce(sum(l.amount_cents) filter (where l.line = 'deduction'), 0) as net_revenue,
                                 coalesce(sum(l.amount_cents) filter (where l.line in ('variable_cost', 'operational', 'administrative', 'commercial', 'financial')), 0) as expenses
                          from public.fin_dre_lines(v_month_from, v_month_to) l where l.period = 'current') x),
      'receivables', (select to_jsonb(r) from public.fin_receivables_summary(v_today) r),
      'payables', (select to_jsonb(p) from public.fin_payables_summary(v_today) p),
      'receipts', (select jsonb_build_object('total', coalesce(max(total_count), 0), 'oldest_at', min(created_at)) from public.fin_receipt_queue('pending', 100, 0)),
      'access', (select jsonb_build_object('total', count(*)) from public.access_requests where status = 'pending'),
      'signatures', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'recipients', recipients, 'signed', signed, 'due_at', due_at) order by published_at desc)
                              from public.sig_documents_overview where status = 'published' and signed < recipients), '[]'::jsonb),
      'reservations', (select jsonb_build_object('total', coalesce(sum(n), 0), 'by_type', coalesce(jsonb_object_agg(t, n) filter (where t is not null), '{}'::jsonb))
                       from (select r.type t, count(*) n from public.reservations r
                             where r.date = v_today and coalesce(r.status::text, 'active') = 'active' group by r.type) x))
    into v_out;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null then return conv_private.vfail('BRIEFING_FAILED', 'Não consegui montar o resumo agora.'); end if;
  return jsonb_build_object('ok', true, 'data', v_out);
end $$;

revoke all on function conv_private.admin_briefing_data_base(uuid) from public, anon, authenticated;
