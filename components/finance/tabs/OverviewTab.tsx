import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { accountBalances, dreLines, monthlyTrend, payablesSummary, receivablesSummary, receiptQueue } from '../../../lib/finance/financeApi';
import { cashForecast30d, composeDre, delinquencyRate, pctChange, resolvePeriod, type Period } from '../../../lib/finance/reports';
import { formatBRL } from '../../../lib/finance/money';
import { monthShort } from '../../../lib/finance/dates';
import { useAsync, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import type { AccountBalance, FinAccount, FinSettings, MonthlyTrendRow, PayablesSummary, ReceivablesSummary } from '../../../lib/finance/types';
import type { DreSummary } from '../../../lib/finance/reports';
import { Card, ErrorBlock, Notice, PeriodBar, Spinner, StatCard, btnGhost } from '../ui';


type Alert = { text: string; tab: string; tone: 'warn' | 'bad' };
type Data = { recv: ReceivablesSummary; pay: PayablesSummary; balances: AccountBalance[]; trend: MonthlyTrendRow[]; pending: number };
type Model = { cur: DreSummary; prev: DreSummary; balance: number; delinq: ReturnType<typeof delinquencyRate>; fc: ReturnType<typeof cashForecast30d> };

/** O que precisa da mão do administrador antes de os números valerem. */
function setupAlerts(settings: FinSettings | null, accounts: FinAccount[], pending: number): Alert[] {
  const alerts: Alert[] = [];
  if (settings && !settings.late_fee_confirmed_at) alerts.push({ text: 'Os encargos de atraso ainda não foram configurados: mensalidades vencidas não recebem multa nem juros.', tab: 'settings', tone: 'warn' });
  if (accounts.length === 0) alerts.push({ text: 'Cadastre ao menos uma conta (Caixa, Banco…) para registrar recebimentos e pagamentos.', tab: 'accounts', tone: 'bad' });
  else if (!accounts.some((a) => a.is_default_receipts)) alerts.push({ text: 'Defina a conta padrão de recebimentos: sem ela, os pagamentos de Card Mensal/Day Card aparecem como "sem conta" no caixa.', tab: 'accounts', tone: 'warn' });
  if (pending > 0) alerts.push({ text: `${pending} comprovante(s) aguardando análise.`, tab: 'receipts', tone: 'warn' });
  return alerts;
}

const Alerts: React.FC<{ alerts: Alert[]; go: (tab: string) => void }> = ({ alerts, go }) => (
  <>
    {alerts.map((a) => (
      <div key={a.text} className="flex items-start gap-2">
        <div className="flex-1"><Notice tone={a.tone}><span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{a.text}</span></Notice></div>
        <button className={btnGhost} onClick={() => go(a.tab)} aria-label="Resolver"><ArrowRight size={16} /></button>
      </div>
    ))}
  </>
);

const SectionTitle: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="px-1"><h3 className="text-sm font-black text-stone-800">{title}</h3><p className="text-xs text-stone-500">{hint}</p></div>
);

/** Posição de hoje: não depende do período escolhido. */
const PositionCards: React.FC<{ data: Data; model: Model; go: (tab: string) => void }> = ({ data, model, go }) => (
  <section className="space-y-2">
    <SectionTitle title="Hoje" hint="Posição agora, qualquer que seja o período." />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard indicator="balance" value={formatBRL(model.balance)} tone={model.balance < 0 ? 'bad' : 'neutral'}
        sub={<button className="font-bold text-saibro-700 underline-offset-2 hover:underline" onClick={() => go('accounts')}>{data.balances.length} conta(s) · ver saldos</button>} />
      <StatCard indicator="forecast" value={formatBRL(model.fc.projectedBalanceCents)} sub={`+ ${formatBRL(model.fc.expectedInCents)} a receber · − ${formatBRL(model.fc.expectedOutCents)} a pagar`} tone={model.fc.projectedBalanceCents < 0 ? 'bad' : 'neutral'} />
      <StatCard indicator="delinquency" value={model.delinq.byValuePct === null ? '—' : `${model.delinq.byValuePct.toLocaleString('pt-BR')}%`}
        sub={`${formatBRL(data.recv.overdue_cents)} vencidos · ${data.recv.overdue_members} sócio(s)`} tone={(model.delinq.byValuePct ?? 0) > 0 ? 'bad' : 'neutral'} />
      <StatCard indicator="overdue_payables" value={formatBRL(data.pay.payable_overdue_cents)} sub={`${data.pay.payable_overdue_count} conta(s) · ${formatBRL(data.pay.payable_due_7d_cents)} vencem em 7 dias`} tone={data.pay.payable_overdue_cents > 0 ? 'bad' : 'neutral'} />
    </div>
  </section>
);

const deltaText = (cur: number, prev: number) => {
  const p = pctChange(cur, prev);
  return p === null ? 'sem base de comparação' : `${p > 0 ? '+' : ''}${p.toLocaleString('pt-BR')}% vs período anterior`;
};

/** Resultado do período, por competência (o mesmo número da DRE). */
const ResultCards: React.FC<{ model: Model; period: Period; onPeriod: (p: Period) => void; today: string }> = ({ model, period, onPeriod, today }) => (
  <section className="space-y-2">
    <SectionTitle title="Resultado do período" hint="Por competência, como na DRE. Não é o caixa." />
    <Card><PeriodBar value={period} onChange={onPeriod} today={today} /></Card>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard indicator="revenue" value={formatBRL(model.cur.netRevenue)} sub={deltaText(model.cur.netRevenue, model.prev.netRevenue)} />
      <StatCard indicator="expenses" value={formatBRL(model.cur.totalExpenses)} sub={deltaText(model.cur.totalExpenses, model.prev.totalExpenses)} />
      <StatCard indicator="result" value={formatBRL(model.cur.operatingResult)} sub={deltaText(model.cur.operatingResult, model.prev.operatingResult)} tone={model.cur.operatingResult < 0 ? 'bad' : 'good'} />
    </div>
  </section>
);

const TrendChart: React.FC<{ trend: MonthlyTrendRow[] }> = ({ trend }) => (
  <Card title="Últimos 6 meses" subtitle="Receita líquida e despesas por competência">
    <div className="h-64" role="img" aria-label="Gráfico de receitas e despesas dos últimos seis meses">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={trend.map((t) => ({ mes: monthShort(t.month_start), Receita: t.revenue_cents / 100, Despesas: t.expense_cents / 100 }))}>
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
);

/**
 * Painel: o que pede ação, a posição de hoje e o resultado do período, em blocos separados para
 * não misturar as bases (posição ≠ competência). Saldo por conta mora em Cadastros › Contas e
 * entradas/saídas no Fluxo de caixa: aqui não se repetem.
 */
const OverviewTab: React.FC = () => {
  const today = useToday();
  const { settings, accounts, go } = useFinance();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));

  const data = useAsync(async () => {
    const [lines, balances, recv, pay, trend, pending] = await Promise.all([
      dreLines(period.from, period.to), accountBalances(), receivablesSummary(), payablesSummary(), monthlyTrend(6), receiptQueue('pending', 100, 0),
    ]);
    return { lines, balances, recv, pay, trend, pending: pending.length };
  }, [period.from, period.to]);

  const model = useMemo((): Model | null => {
    if (!data.data) return null;
    const { lines, balances, recv, pay } = data.data;
    const balance = balances.reduce((s, b) => s + b.balance_cents, 0);
    return {
      cur: composeDre(lines.filter((l) => l.period === 'current')),
      prev: composeDre(lines.filter((l) => l.period === 'previous')),
      balance,
      delinq: delinquencyRate({ overdueCents: recv.overdue_cents, openCents: recv.open_cents, overdueCount: recv.overdue_count, openCount: recv.open_count }),
      fc: cashForecast30d({ balanceCents: balance, receivableDue30dCents: recv.due_30d_cents, payableOverdueCents: pay.payable_overdue_cents, payableDue30dCents: pay.payable_due_30d_cents }),
    };
  }, [data.data]);

  if (data.error) return <ErrorBlock error={data.error} onRetry={data.reload} />;
  if (!model || !data.data) return <Spinner />;
  return (
    <div className="space-y-5">
      <Alerts alerts={setupAlerts(settings, accounts, data.data.pending)} go={go} />
      <PositionCards data={data.data} model={model} go={go} />
      <ResultCards model={model} period={period} onPeriod={setPeriod} today={today} />
      <TrendChart trend={data.data.trend} />
    </div>
  );
};

export default OverviewTab;
