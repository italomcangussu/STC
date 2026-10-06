import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinSettings } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  adjustCharge: vi.fn(), cancelCharge: vi.fn(), chargeHistory: vi.fn(), createPlan: vi.fn(), endPlan: vi.fn(), generateCharges: vi.fn(),
  listCharges: vi.fn(), listCredits: vi.fn(), listHolidays: vi.fn(), listMembersWithoutPlan: vi.fn(), listPlanPrices: vi.fn(), listPlans: vi.fn(),
  registerPayment: vi.fn(), resolveCredit: vi.fn(), reversePayment: vi.fn(), setPlanPrice: vi.fn(), updatePlan: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import MembersTab from '../../components/finance/tabs/MembersTab';

const settings = { id: true, due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, version: 1 } as FinSettings;

const charge = (id: string, name: string, over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: id, plan_id: `p-${id}`, profile_id: `u-${id}`, profile_name: name, competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15000, fees_configured: false, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 3, ...over,
});

const plan = { id: 'pl1', profile_id: 'u1', start_on: '2026-01-10', ended_on: null, status: 'active', period_months: 1, version: 1, end_reason: null, profile: { name: 'João da Silva', avatar_url: null, is_active: true } };

const mount = (s: FinSettings = settings) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [], categories: [], settings: s, reload: vi.fn(), go: vi.fn() }}><MembersTab /></FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listCharges.mockResolvedValue([charge('1', 'João da Silva'), charge('2', 'Maria Conceição'), charge('3', 'Ana Sócia')]);
  api.listPlans.mockResolvedValue([plan]);
  api.listPlanPrices.mockResolvedValue([{ id: 'pr1', plan_id: 'pl1', effective_from: '2026-01-01', amount_cents: 15000, reason: null }]);
  api.listCredits.mockResolvedValue([]);
  api.listHolidays.mockResolvedValue([]);
  api.listMembersWithoutPlan.mockResolvedValue([]);
});

const rowNames = () => ['João da Silva', 'Maria Conceição', 'Ana Sócia'].filter((n) => screen.queryByText(n));

describe('Cobranças — busca por sócio', () => {
  it('"joao" acha "João da Silva" (sem acento, sem maiúsculas)', async () => {
    mount();
    await screen.findByText('Maria Conceição');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar sócio' }), { target: { value: 'joao' } });
    await waitFor(() => expect(rowNames()).toEqual(['João da Silva']));
  });

  it('"CONCEICAO " (maiúsculas, sem cedilha, espaço no fim) acha "Maria Conceição"', async () => {
    mount();
    await screen.findByText('Ana Sócia');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar sócio' }), { target: { value: 'CONCEICAO ' } });
    await waitFor(() => expect(rowNames()).toEqual(['Maria Conceição']));
  });

  it('o nome não vai ao banco (lá a comparação é sensível a acento) e digitar mais letras não refaz a consulta', async () => {
    mount();
    await screen.findByText('Ana Sócia');
    const box = screen.getByRole('searchbox', { name: 'Buscar sócio' });
    fireEvent.change(box, { target: { value: 'j' } });
    await waitFor(() => expect(api.listCharges).toHaveBeenCalledTimes(2));
    fireEvent.change(box, { target: { value: 'jo' } });
    fireEvent.change(box, { target: { value: 'joa' } });
    fireEvent.change(box, { target: { value: 'joao' } });
    await waitFor(() => expect(rowNames()).toEqual(['João da Silva']));
    expect(api.listCharges).toHaveBeenCalledTimes(2);
    for (const call of api.listCharges.mock.calls) expect(call[0]).not.toHaveProperty('search');
    // sem busca: 300 linhas; com busca: o máximo que o banco entrega
    expect(api.listCharges.mock.calls[0][1]).toBe(300);
    expect(api.listCharges.mock.calls[1][1]).toBe(1000);
  });

  it('sem resultado, diz o que foi procurado; limpar a busca traz tudo de volta', async () => {
    mount();
    await screen.findByText('Ana Sócia');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar sócio' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nenhuma cobrança de “zzz”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
  });

  it('avisa quando o banco tem mais cobranças do que a busca conseguiu olhar', async () => {
    api.listCharges.mockResolvedValue([charge('1', 'João da Silva', { total_count: 1500 }), charge('2', 'Maria Conceição', { total_count: 1500 })]);
    mount();
    await screen.findByText('Maria Conceição');
    expect(screen.queryByText(/A busca olhou/)).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar sócio' }), { target: { value: 'maria' } });
    expect(await screen.findByText(/A busca olhou as 2 cobranças mais recentes de 1\.500/)).toBeInTheDocument();
  });
});

describe('Sócios e valores — carregamento', () => {
  it('lista as mensalidades cadastradas', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Sócios e valores' }));
    expect(await screen.findByText('João da Silva')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('se a consulta falhar mostra "Tentar de novo", e tentar de novo carrega', async () => {
    api.listPlans.mockRejectedValueOnce(new Error('falhou'));
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Sócios e valores' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    expect(api.listPlans).toHaveBeenCalledTimes(2);
  });
});

describe('Nova mensalidade — formulário', () => {
  // Vencimento no mês cobrado (padrão do clube). "Hoje" fixo: 06/10/2026, 12:00 em Fortaleza.
  const noMesCobrado = { ...settings, due_month_offset: 0 } as FinSettings;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const abrir = async (s: FinSettings = noMesCobrado) => {
    mount(s);
    fireEvent.click(await screen.findByRole('tab', { name: 'Sócios e valores' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
    return screen.findByLabelText('Valor da mensalidade') as Promise<HTMLInputElement>;
  };
  const digitarValor = (box: HTMLInputElement, t: string) => fireEvent.change(box, { target: { value: t } });
  const iniciar = (iso: string) => fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: iso } });

  it('digitar o valor não reescreve o campo nem leva o cursor ao fim', async () => {
    const box = await abrir();
    for (const t of ['1', '15', '150', '150,', '150,5']) { digitarValor(box, t); expect(box.value).toBe(t); }
  });

  it('vínculo em 01/09 com vencimento no mês cobrado: a 1ª cobrança vence em setembro e as já vencidas são avisadas', async () => {
    const box = await abrir();
    digitarValor(box, '150');
    iniciar('2026-09-01');
    // set, out e nov (horizonte de 1 mês): vencem 07/09 (5 é sábado → segunda; feriado não conta), 05/10 e 05/11
    expect(await screen.findByText('Serão geradas 3 cobrança(s)')).toBeInTheDocument();
    expect(screen.getByText(/a primeira vence em 07\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 já estão vencidas hoje/)).toBeInTheDocument();
  });

  it('feriado só pesa se o clube o ativou: ativo em 07/09, a 1ª cobrança vai para 08/09', async () => {
    api.listHolidays.mockResolvedValue([{ id: 'h1', holiday_date: '2026-09-07', name: 'Independência', scope: 'national', kind: 'holiday', active: true }]);
    const box = await abrir();
    digitarValor(box, '150');
    iniciar('2026-09-01');
    expect(await screen.findByText(/a primeira vence em 08\/09\/2026/)).toBeInTheDocument();
  });

  it('feriado desativado não conta', async () => {
    api.listHolidays.mockResolvedValue([{ id: 'h1', holiday_date: '2026-09-07', name: 'Independência', scope: 'national', kind: 'holiday', active: false }]);
    const box = await abrir();
    digitarValor(box, '150');
    iniciar('2026-09-01');
    expect(await screen.findByText(/a primeira vence em 07\/09\/2026/)).toBeInTheDocument();
  });

  it('vínculo deste mês, ainda no prazo: nenhum aviso de vencida', async () => {
    const box = await abrir();
    digitarValor(box, '150');
    iniciar('2026-11-01');
    await screen.findByText(/Serão geradas/);
    expect(screen.queryByText(/vencidas? hoje|vencida hoje/)).toBeNull();
  });

  it('a regra "mês seguinte" continua valendo quando o clube a escolhe', async () => {
    const box = await abrir({ ...settings, due_month_offset: 1 } as FinSettings);
    digitarValor(box, '150');
    iniciar('2026-11-01');
    expect(await screen.findByText(/a primeira vence em 07\/12\/2026/)).toBeInTheDocument(); // 5/12 é sábado
  });
});
