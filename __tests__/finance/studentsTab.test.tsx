import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayCardRow, FinSettings } from '../../lib/finance/types';
import type { StudentPaymentRow } from '../../lib/finance/studentFees';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const api = vi.hoisted(() => ({ dayCardRows: vi.fn(), newRequestId: () => 'k' }));
vi.mock('../../lib/finance/financeApi', () => api);
const fees = vi.hoisted(() => ({ listStudentPayments: vi.fn(), deleteStudentPayment: vi.fn(), exemptDayCard: vi.fn(), chargeDayCardAgain: vi.fn() }));
vi.mock('../../lib/finance/studentFees', async (original) => ({ ...(await original<object>()), ...fees }));

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import StudentsTab from '../../components/finance/tabs/StudentsTab';
import { fortalezaDate, studentFeeTotals, toStudentPaymentRow } from '../../lib/finance/studentFees';

const settings = { day_card_price_cents: 5000 } as FinSettings;
const guest = (id: string, over: Partial<DayCardRow> = {}): DayCardRow => ({
  reservation_id: id, occurred_on: '2026-10-04', guest_name: `Convidado ${id}`, booked_by: 'Ana', exempt: false, charged_cents: 5000, ...over,
});
const payment = (id: string, over: Partial<StudentPaymentRow> = {}): StudentPaymentRow => ({
  id, studentName: `Aluno ${id}`, amountCents: 20000, paidOn: '2026-10-03', canceled: false, canceledReason: null, ...over,
});

const mount = () => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [], categories: [], settings, reload: vi.fn(), go: vi.fn() }}><StudentsTab /></FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.dayCardRows.mockResolvedValue([guest('g1'), guest('g2', { exempt: true, charged_cents: 0 })]);
  fees.listStudentPayments.mockResolvedValue([payment('p1'), payment('p2', { canceled: true, canceledReason: 'Convertido para Card Mensal' })]);
  fees.exemptDayCard.mockResolvedValue(undefined);
  fees.chargeDayCardAgain.mockResolvedValue(undefined);
  fees.deleteStudentPayment.mockResolvedValue(undefined);
});

describe('Alunos e Day Card — uma tela, um período', () => {
  it('totais: só Day Card cobrado e pagamento ativo contam', async () => {
    mount();
    expect(await screen.findByText('Day Card dos convidados')).toBeInTheDocument();
    expect(screen.getByText(/1 cobrado\(s\) a R\$\s50,00 · 1 isento\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 pagamento\(s\) · 1 estornado\(s\)/)).toBeInTheDocument();
    expect(api.dayCardRows).toHaveBeenCalledTimes(1);
    expect(fees.listStudentPayments).toHaveBeenCalledWith(api.dayCardRows.mock.calls[0][0], api.dayCardRows.mock.calls[0][1]);
  });

  it('isentar um Day Card cobrado e voltar a cobrar um isento (antes o isento sumia e não dava para desfazer)', async () => {
    mount();
    const charged = (await screen.findByText('Convidado g1')).closest('div.rounded-2xl') as HTMLElement;
    fireEvent.click(within(charged).getByRole('button', { name: 'Isentar' }));
    await waitFor(() => expect(fees.exemptDayCard).toHaveBeenCalledWith('g1'));

    const exempt = screen.getByText('Convidado g2').closest('div.rounded-2xl') as HTMLElement;
    fireEvent.click(within(exempt).getByRole('button', { name: 'Voltar a cobrar' }));
    await waitFor(() => expect(fees.chargeDayCardAgain).toHaveBeenCalledWith('g2'));
  });

  it('excluir pagamento pede confirmação e não oferece excluir o estornado', async () => {
    mount();
    await screen.findByText('Aluno p1');
    expect(screen.queryByRole('button', { name: 'Excluir pagamento de Aluno p2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pagamento de Aluno p1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir pagamento' }));
    await waitFor(() => expect(fees.deleteStudentPayment).toHaveBeenCalledWith('p1'));
  });
});

describe('studentFees — regras puras', () => {
  it('a data do pagamento é o dia em Fortaleza, como na DRE (00:30 UTC do dia 4 = dia 3)', () => {
    expect(fortalezaDate('2026-10-04T00:30:00Z')).toBe('2026-10-03');
    expect(fortalezaDate('2026-10-04T03:00:00Z')).toBe('2026-10-04');
  });

  it('valor NUMERIC em reais vira centavos inteiros e aluno apagado tem nome', () => {
    const row = toStudentPaymentRow({ id: 'x', amount: '199.9', payment_date: '2026-10-04T12:00:00Z', status: 'active', cancelled_reason: null, student: null });
    expect(row).toMatchObject({ amountCents: 19990, studentName: 'Aluno excluído', canceled: false, paidOn: '2026-10-04' });
  });

  it('estornado não soma; isento conta como isento', () => {
    expect(studentFeeTotals([guest('a'), guest('b', { exempt: true, charged_cents: 0 })], [payment('1'), payment('2', { canceled: true })]))
      .toEqual({ dayCardCents: 5000, dayCardCharged: 1, dayCardExempt: 1, paymentsCents: 20000, paymentsCount: 1, canceledCount: 1 });
  });
});
