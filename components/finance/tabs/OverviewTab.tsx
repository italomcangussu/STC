import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { accountBalances, cashFlow, dreLines, monthlyTrend, payablesSummary, receivablesSummary, receiptQueue } from '../../../lib/finance/financeApi';
import { buildDreStatement, cashForecast30d, composeDre, delinquencyRate, pctChange, resolvePeriod, type Period } from '../../../lib/finance/reports';
import { formatBRL } from '../../../lib/finance/money';
import { monthShort } from '../../../lib/finance/dates';
import { useAsync, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Card, ErrorBlock, Money, Notice, PeriodBar, Spinner, StatCard, btnGhost } from '../ui';

const deltaText = (cur: number, prev: number) => {
  const p = pctChange(cur, prev);
  return p === null ? 'sem base de comparação' : `${p > 0 ? '+' : ''}${p.toLocaleString('pt-BR')}% vs período anterior`;
};

const OverviewTab: React.FC = () => {
  const today = useToday();
  const { settings, accounts, go } = useFinance();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));

  const data = useAsync(async () => {
    const [lines, balances, recv, pay, trend, flow, pending] = await Promise.all([
      dreLines(period.from, period.to), accountBalances(), receivablesSummary(), payablesSummary(), monthlyTrend(6),
      cashFlow(period.from, period.to, 'month', null), receiptQueue('pending', 100, 0),
    ]);
    return { lines, balances, recv, pay, trend, flow, pending: pending.length };
  }, [period.from, period.to]);

  const model = useMemo(() => {
    if (!data.data) return null;
    const cur = composeDre(data.data.lines.filter((l) => l.period === 'current'));
    const prev = composeDre(data.data.lines.filter((l) => l.period === 'previous'));
    const balance = data.data.balances.reduce((s, b) => s + b.balance_cents, 0);
    const delinq = delinquencyRate({ overdueCents: data.data.recv.overdue_cents, openCents: data.data.recv.open_cents, overdueCount: data.data.recv.overdue_count, openCount: data.data.recv.open_count });
    const fc = cashForecast30d({ balanceCents: balance, receivableDue30dCents: data.data.recv.due_30d_cents, payableOverdueCents: data.data.pay.payable_overdue_cents, payableDue30dCents: data.data.pay.payable_due_30d_cents });
    const inflow = data.data.flow.reduce((s, b) => s + b.inflow_cents, 0);
    const outflow = data.data.flow.reduce((s, b) => s + b.outflow_cents, 0);
    return { cur, prev, balance, delinq, fc, inflow, outflow, statement: buildDreStatement(cur, prev) };
  }, [data.data]);

  const alerts: Array<{ text: string; tab: string; tone: 'warn' | 'bad' }> = [];
  if (settings && !settings.late_fee_confirmed_at) alerts.push({ text: 'Os encargos de atraso ainda não foram configurados: mensalidades vencidas não recebem multa nem juros.', tab: 'settings', tone: 'warn' });
  if (accounts.length === 0) alerts.push({ text: 'Cadastre ao menos uma conta (Caixa, Banco…) para registrar recebimentos e pagamentos.', tab: 'accounts', tone: 'bad' });
  else if (!accounts.some((a) => a.is_default_receipts)) alerts.push({ text: 'Defina a conta padrão de recebimentos: sem ela, os pagamentos de Card Mensal/Day Card aparecem como "sem conta" no caixa.', tab: 'accounts', tone: 'warn' });
  if (data.data && data.data.pending > 0) alerts.push({ text: `${data.data.pending} comprovante(s) aguardando análise.`, tab: 'receipts', tone: 'warn' });

  return (
    <div className="space-y-4">
      <Card title="Período" subtitle="Receitas, despesas e resultado seguem a competência; saldo, inadimplência e contas mostram a posição de hoje."><PeriodBar value={period} onChange={setPeriod} today={today} /></Card>

      {alerts.map((a) => (
        <div key={a.text} className="flex items-start gap-2">
          <div className="flex-1"><Notice tone={a.tone}><span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{a.text}</span></Notice></div>
          <button className={btnGhost} onClick={() => go(a.tab)} aria-label="Ir para a configuração"><ArrowRight size={16} /></button>
        </div>
      ))}

      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : !model || data.loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard indicator="balance" value={formatBRL(model.balance)} sub={`${data.data!.balances.length} conta(s)`} tone={model.balance < 0 ? 'bad' : 'neutral'} />
            <StatCard indicator="revenue" value={formatBRL(model.cur.netRevenue)} sub={deltaText(model.cur.netRevenue, model.prev.netRevenue)} />
            <StatCard indicator="expenses" value={formatBRL(model.cur.totalExpenses)} sub={deltaText(model.cur.totalExpenses, model.prev.totalExpenses)} />
            <StatCard indicator="result" value={formatBRL(model.cur.operatingResult)} sub={deltaText(model.cur.operatingResult, model.prev.operatingResult)} tone={model.cur.operatingResult < 0 ? 'bad' : 'good'} />
            <StatCard indicator="delinquency" value={model.delinq.byValuePct === null ? '—' : `${model.delinq.byValuePct.toLocaleString('pt-BR')}%`}
              sub={`${formatBRL(data.data!.recv.overdue_cents)} vencidos · ${data.data!.recv.overdue_members} sócio(s)`} tone={(model.delinq.byValuePct ?? 0) > 0 ? 'bad' : 'neutral'} />
            <StatCard indicator="overdue_payables" value={formatBRL(data.data!.pay.payable_overdue_cents)} sub={`${data.data!.pay.payable_overdue_count} conta(s)`} tone={data.data!.pay.payable_overdue_cents > 0 ? 'bad' : 'neutral'} />
            <StatCard indicator="upcoming_payables" value={formatBRL(data.data!.pay.payable_due_30d_cents)} sub={`${formatBRL(data.data!.pay.payable_due_7d_cents)} nos próximos 7 dias`} />
            <StatCard indicator="forecast" value={formatBRL(model.fc.projectedBalanceCents)} sub={`+ ${formatBRL(model.fc.expectedInCents)} a receber · − ${formatBRL(model.fc.expectedOutCents)} a pagar`} tone={model.fc.projectedBalanceCents < 0 ? 'bad' : 'neutral'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard indicator="cash_in" value={formatBRL(model.inflow)} sub="no período selecionado" tone="good" />
            <StatCard indicator="cash_out" value={formatBRL(model.outflow)} sub="no período selecionado" />
          </div>

          <Card title="Últimos 6 meses" subtitle="Receita líquida e despesas por competência (barras) — não é o caixa">
            <div className="h-64" role="img" aria-label="Gráfico de receitas e despesas dos últimos seis meses">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.data!.trend.map((t) => ({ mes: monthShort(t.month_start), Receita: t.revenue_cents / 100, Despesas: t.expense_cents / 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" fontSize={11} />
                  <YAxis fontSize={11} width={52} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip formatter={(v) => formatBRL(Math.round(Number(v) * 100))} />
                  <Legend />
                  <Bar dataKey="Receita" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Despesas" fill="#f97316" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Saldo por conta" subtitle="Posição de hoje, pela data em que o dinheiro entrou/saiu">
            <ul className="divide-y divide-stone-100">
              {data.data!.balances.length === 0 && <li className="py-3 text-sm text-stone-400">Nenhuma conta com saldo.</li>}
              {data.data!.balances.map((b) => (
                <li key={b.id ?? 'none'} className="flex items-center justify-between py-2.5 text-sm"><span className="font-medium text-stone-700">{b.name}</span><Money cents={b.balance_cents} className="font-black" /></li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};

export default OverviewTab;
