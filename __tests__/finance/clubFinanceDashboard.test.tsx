import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { monthlyEquivalentCents, totalMonthlyEquivalentCents } from '../../lib/finance/fixedExpenses';

const api = vi.hoisted(() => ({
  dreLines: vi.fn(), accountBalances: vi.fn(), receivablesSummary: vi.fn(), payablesSummary: vi.fn(), monthlyTrend: vi.fn(), clubFixedExpenses: vi.fn(), receiptQueue: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nil = () => null;
  return { ResponsiveContainer: Pass, BarChart: Pass, Bar: Nil, XAxis: Nil, YAxis: Nil, Tooltip: Nil, Legend: Nil, CartesianGrid: Nil };
});

import { ClubFinanceDashboard } from '../../components/finance/ClubFinanceDashboard';

const fixed = (description: string, amount_cents: number, frequency: 'monthly' | 'quarterly' | 'yearly') => ({
  id: description, description, supplier: null, category_name: 'Despesas', amount_cents, frequency, due_day: 10, start_month: '2026-01-01', end_month: null,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.dreLines.mockResolvedValue([]);
  api.accountBalances.mockResolvedValue([{ id: 'a1', name: 'Banco do clube', kind: 'bank', active: true, is_default_receipts: true, balance_cents: 250000 }]);
  api.receivablesSummary.mockResolvedValue({ open_count: 0, open_cents: 0, overdue_count: 0, overdue_cents: 0, due_7d_cents: 0, due_30d_cents: 0, forecast_cents: 0, fees_configured: true, overdue_members: 0 });
  api.payablesSummary.mockResolvedValue({ payable_open_cents: 0, payable_overdue_count: 0, payable_overdue_cents: 0, payable_due_7d_cents: 0, payable_due_30d_cents: 0, receivable_open_cents: 0 });
  api.monthlyTrend.mockResolvedValue([]);
  api.clubFixedExpenses.mockResolvedValue([fixed('Aluguel', 300000, 'monthly'), fixed('Seguro', 120000, 'yearly')]);
});

describe('saídas fixas — peso mensal', () => {
  it('divide trimestral por 3 e anual por 12', () => {
    expect(monthlyEquivalentCents({ amount_cents: 90000, frequency: 'quarterly' })).toBe(30000);
    expect(totalMonthlyEquivalentCents([{ amount_cents: 300000, frequency: 'monthly' }, { amount_cents: 120000, frequency: 'yearly' }])).toBe(310000);
  });
});

describe('Financeiro do clube (Dashboard do sócio)', () => {
  it('mostra a posição do clube e as saídas fixas com o total por mês', async () => {
    render(<ClubFinanceDashboard />);
    expect(await screen.findByText('Aluguel')).toBeInTheDocument();
    expect(screen.getByText('Seguro')).toBeInTheDocument();
    expect(screen.getByText('R$ 3.100,00 por mês')).toBeInTheDocument();
    expect(await screen.findByText('Soma de 1 conta(s)')).toBeInTheDocument();
  });

  it('é só leitura: nenhum botão de edição nem leitura restrita ao admin', async () => {
    render(<ClubFinanceDashboard />);
    await screen.findByText('Aluguel');
    await screen.findByText('Soma de 1 conta(s)');
    const labels = screen.queryAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.some((l) => /nova|editar|excluir|gerar|ver saldos|resolver/i.test(l))).toBe(false);
    expect(api.receiptQueue).not.toHaveBeenCalled();
  });

  it('avisa quando o clube ainda não cadastrou saídas fixas', async () => {
    api.clubFixedExpenses.mockResolvedValue([]);
    render(<ClubFinanceDashboard />);
    expect(await screen.findByText('Nenhuma saída fixa cadastrada')).toBeInTheDocument();
  });
});
