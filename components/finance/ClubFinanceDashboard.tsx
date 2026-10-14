import React from 'react';
import { Repeat } from 'lucide-react';
import { clubFixedExpenses } from '../../lib/finance/financeApi';
import { FREQUENCY_LABEL, totalMonthlyEquivalentCents, type FixedExpenseRow } from '../../lib/finance/fixedExpenses';
import { formatBRL } from '../../lib/finance/money';
import { monthLabel } from '../../lib/finance/dates';
import { useAsync } from './hooks';
import { ClubOverview, SectionTitle } from './ClubOverview';
import { Card, Empty, ErrorBlock, Spinner } from './ui';

const FixedExpenseItem: React.FC<{ row: FixedExpenseRow }> = ({ row }) => (
  <li className="flex items-start justify-between gap-3 py-3">
    <div className="min-w-0">
      <p className="truncate text-sm font-black text-stone-800">{row.description}</p>
      <p className="text-xs text-stone-500">{FREQUENCY_LABEL[row.frequency]} · vence dia {row.due_day} · {row.category_name}</p>
      <p className="text-xs text-stone-400">{row.supplier ? `${row.supplier} · ` : ''}desde {monthLabel(row.start_month)}{row.end_month ? ` até ${monthLabel(row.end_month)}` : ''}</p>
    </div>
    <p className="shrink-0 text-sm font-black tabular-nums text-stone-800">{formatBRL(row.amount_cents)}</p>
  </li>
);

const fixedExpensesSubtitle = (rows: FixedExpenseRow[]) =>
  rows.some((row) => row.frequency !== 'monthly') ? `${rows.length} saída(s) · trimestrais e anuais divididas pelos meses` : `${rows.length} saída(s) mensais`;

const FixedExpensesList: React.FC = () => {
  const data = useAsync(clubFixedExpenses, []);
  const rows = data.data ?? [];

  const content = () => {
    if (data.error) return <ErrorBlock error={data.error} onRetry={data.reload} />;
    if (data.loading) return <Spinner />;
    if (rows.length === 0) return <Empty icon={<Repeat size={28} />} title="Nenhuma saída fixa cadastrada" hint="Quando o clube cadastrar aluguel, folha, energia e outras despesas recorrentes, elas aparecem aqui." />;
    return <ul className="divide-y divide-stone-100">{rows.map((row) => <FixedExpenseItem key={row.id} row={row} />)}</ul>;
  };

  return (
    <section className="space-y-2">
      <SectionTitle title="Saídas fixas" hint="Despesas recorrentes do clube, da maior para a menor." />
      <Card
        title={rows.length > 0 ? `${formatBRL(totalMonthlyEquivalentCents(rows))} por mês` : undefined}
        subtitle={rows.length > 0 ? fixedExpensesSubtitle(rows) : undefined}
      >
        {content()}
      </Card>
    </section>
  );
};

/** Aba "Financeiro do clube" do Dashboard: a mesma visão do Painel do admin e as saídas fixas, só leitura. */
export const ClubFinanceDashboard: React.FC = () => (
  <div className="space-y-6">
    <ClubOverview />
    <FixedExpensesList />
  </div>
);
