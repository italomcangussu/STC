import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinSettings, MemberCreditRow } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  adjustCharge: vi.fn(), cancelCharge: vi.fn(), chargeHistory: vi.fn(), createPlan: vi.fn(), endPlan: vi.fn(), generateCharges: vi.fn(),
  listCharges: vi.fn(), listCredits: vi.fn(), listPendencyMeta: vi.fn(), listHolidays: vi.fn(), listMembersWithoutPlan: vi.fn(), listPlanPrices: vi.fn(), listPlans: vi.fn(),
  profileNames: vi.fn(), registerPayment: vi.fn(), resolveCredit: vi.fn(), reversePayment: vi.fn(), setPlanPrice: vi.fn(), updatePlan: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import MembersTab from '../../components/finance/tabs/MembersTab';

const settings = { id: true, due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, version: 1 } as FinSettings;

const charge = (id: string, profileId: string, over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: id, plan_id: `p-${id}`, profile_id: profileId, profile_name: 'Nome na cobrança', competence_month: '2026-03-01', period_months: 1, due_date: '2026-04-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15000, fees_configured: false, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});

const credit: MemberCreditRow = {
  id: 'k1', profile_id: 'u9', reason: 'excess', amount_cents: 12000, remaining_cents: 12000, status: 'open', resolution_note: null, created_at: '2026-10-01T10:00:00Z',
};

const mount = () => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [], categories: [], settings, reload: vi.fn(), go: vi.fn() }}><MembersTab /></FinanceProvider>
  </ConfirmProvider>,
);

const openCredits = async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Resolver créditos/ }));
  await screen.findByText('Créditos de sócios');
};

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listCharges.mockResolvedValue([]);
  api.listPendencyMeta.mockResolvedValue([]);
  api.listPlans.mockResolvedValue([]);
  api.listPlanPrices.mockResolvedValue([]);
  api.listHolidays.mockResolvedValue([]);
  api.listMembersWithoutPlan.mockResolvedValue([]);
  api.listCredits.mockResolvedValue([credit]);
  api.profileNames.mockResolvedValue({ u9: 'Carla Antiga' });
});

describe('Créditos de sócios — leituras sem corte', () => {
  it('mostra o nome de quem tem crédito buscando só esses sócios, não as cobranças do clube todo', async () => {
    await openCredits();

    expect(await screen.findByText('Carla Antiga')).toBeInTheDocument();
    expect(api.profileNames).toHaveBeenCalledWith(['u9']);
    expect(api.listCharges.mock.calls.some(([, limit]) => limit === 500)).toBe(false);
  });

  it('ao escolher um crédito, carrega as cobranças só desse sócio (a antiga não depende de estar entre as mais recentes do clube)', async () => {
    api.listCharges.mockImplementation(async (filters: { profileId?: string }) => (filters.profileId === 'u9' ? [charge('old', 'u9')] : []));
    await openCredits();

    fireEvent.click(await screen.findByText('Carla Antiga'));

    expect(await screen.findByRole('option', { name: /150,00/ })).toBeInTheDocument();
    expect(api.listCharges).toHaveBeenCalledWith({ profileId: 'u9', chargeType: 'membership' }, 1000);
  });

  it('só oferece cobranças em aberto: quitada e cancelada ficam de fora', async () => {
    api.listCharges.mockImplementation(async (filters: { profileId?: string }) => (filters.profileId === 'u9' ? [
      charge('aberta', 'u9', { total_due_cents: 15000 }),
      charge('quitada', 'u9', { total_due_cents: 0, stored_status: 'paid', display_status: 'paid', competence_month: '2026-02-01' }),
      charge('cancelada', 'u9', { total_due_cents: 9900, stored_status: 'canceled', display_status: 'canceled', competence_month: '2026-01-01' }),
    ] : []));
    await openCredits();

    fireEvent.click(await screen.findByText('Carla Antiga'));
    await screen.findByRole('option', { name: /150,00/ });

    await waitFor(() => expect(screen.getAllByRole('option').filter((o) => /R\$/.test(o.textContent ?? ''))).toHaveLength(1));
  });

  it('sem nenhum crédito em aberto não mostra aviso nem pede o nome de ninguém', async () => {
    api.listCredits.mockResolvedValue([]);
    mount();

    await waitFor(() => expect(api.listCredits).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Resolver créditos/ })).toBeNull();
    expect(api.profileNames.mock.calls.every(([ids]) => ids.length === 0)).toBe(true);
  });
});
