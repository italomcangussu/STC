import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinAccount, FinCategory, FinSettings, MemberPendencyMeta } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  saveSettings: vi.fn(), listCharges: vi.fn(), listPendencyMeta: vi.fn(), listActiveMembers: vi.fn(), createMemberPendency: vi.fn(),
  sendPendencyNow: vi.fn(), setPendencyCollection: vi.fn(), registerPayment: vi.fn(), cancelCharge: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import PendencyRulesSection from '../../components/finance/tabs/PendencyRulesSection';
import PendenciesTab from '../../components/finance/tabs/PendenciesTab';

const account: FinAccount = { id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1 };
const categories = [
  { id: 'cat-day', system_key: 'day_card', name: 'Day Card' },
  { id: 'cat-pend', system_key: 'member_pendency', name: 'Pendência de sócio' },
] as unknown as FinCategory[];

const settings = (over: Partial<FinSettings> = {}): FinSettings => ({
  id: true, due_day: 5, due_month_offset: 0, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: null, interest_daily_fixed_cents: null, interest_daily_percent_bps: null, late_fee_confirmed_at: null,
  late_fee_confirmed_by: null, day_card_price_cents: 5000, day_card_in_cash: false, payee_names: [],
  pix_key: '52.393.541/0001-20', pendency_automation_enabled: true, pendency_reminder_days: [0, 3, 7, 14, 21], pendency_grace_days: 0,
  pendency_fine_fixed_cents: 0, pendency_fine_percent_bps: 0, pendency_interest_daily_fixed_cents: 0, pendency_interest_daily_percent_bps: 0,
  version: 3, updated_at: '2026-10-01T00:00:00Z', ...over,
});

const stmt = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: null, profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-10-01', period_months: 1, due_date: '2026-10-07',
  original_amount_cents: 5000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 5000, principal_paid_cents: 0,
  principal_remaining_cents: 5000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 5000, fees_configured: true, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});
const meta = (over: Partial<MemberPendencyMeta> = {}): MemberPendencyMeta => ({
  id: 'c1', profile_id: 'u1', charge_type: 'member_pendency', description: 'Day Card do convidado Carlos', pendency_kind: 'day_card', category_id: 'cat-day',
  guest_name: 'Carlos', guest_date: '2026-10-05', collection_enabled: true, competence_month: '2026-10-01', due_date: '2026-10-07',
  original_amount_cents: 5000, status: 'open', version: 1, ...over,
});

const mount = (ui: React.ReactElement, s: FinSettings = settings()) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [account], categories, settings: s, reload: vi.fn(), go: vi.fn() }}>{ui}</FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.saveSettings.mockResolvedValue({});
  api.listCharges.mockResolvedValue([stmt(), stmt({ charge_id: 'c2', profile_id: 'u2', profile_name: 'Beto Sócio', total_due_cents: 1200, display_status: 'overdue', overdue: true })]);
  api.listPendencyMeta.mockResolvedValue([meta(), meta({ id: 'c2', profile_id: 'u2', description: 'Consumo do bar', pendency_kind: 'consumo', guest_name: null, guest_date: null, collection_enabled: false })]);
  api.listActiveMembers.mockResolvedValue([{ id: 'u1', name: 'Ana Sócia', phone: null }, { id: 'u2', name: 'Beto Sócio', phone: null }]);
  api.createMemberPendency.mockResolvedValue({ id: 'new', status: 'open' });
  api.sendPendencyNow.mockResolvedValue({});
  api.setPendencyCollection.mockResolvedValue({});
});

describe('Régua de pendências (configurações)', () => {
  it('salva dias normalizados (sem repetição, em ordem) e percentual na escala de bps (2% = 200)', async () => {
    mount(<PendencyRulesSection s={settings()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Dias da régua/), { target: { value: '7, 0, 3, 7' } });
    fireEvent.change(screen.getByLabelText(/^Multa da pendência \(%\)/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Juros por dia da pendência \(%\)/), { target: { value: '0,03' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar pendências e automação/ }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const [version, data] = api.saveSettings.mock.calls[0];
    expect(version).toBe(3);
    expect(data).toMatchObject({ pendency_reminder_days: [0, 3, 7], pendency_fine_percent_bps: 200, pendency_interest_daily_percent_bps: 3, pix_key: '52.393.541/0001-20' });
  });

  it('mostra o percentual salvo como o administrador digitou (200 bps → 2)', () => {
    mount(<PendencyRulesSection s={settings({ pendency_fine_percent_bps: 200 })} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/^Multa da pendência \(%\)/)).toHaveValue('2');
  });

  it('dias inválidos ou PIX vazio impedem salvar', () => {
    mount(<PendencyRulesSection s={settings()} onSaved={vi.fn()} />);
    const salvar = screen.getByRole('button', { name: /Salvar pendências e automação/ });
    fireEvent.change(screen.getByLabelText(/^Dias da régua/), { target: { value: '3, abc' } });
    expect(screen.getByText(/números de 0 a 365/)).toBeInTheDocument();
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Dias da régua/), { target: { value: '0, 3' } });
    fireEvent.change(screen.getByLabelText(/^Chave PIX do clube/), { target: { value: '  ' } });
    expect(salvar).toBeDisabled();
  });
});

describe('Pendências (contas a receber)', () => {
  it('lista com saldo em aberto, vencido e busca por convidado', async () => {
    mount(<PendenciesTab />);
    await screen.findByText('Day Card do convidado Carlos');
    expect(api.listCharges).toHaveBeenCalledWith({ chargeType: 'member_pendency', status: '' }, 1000);
    expect(screen.getByText('Consumo do bar')).toBeInTheDocument();
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Buscar pendência/i), { target: { value: 'carlos' } });
    expect(screen.queryByText('Consumo do bar')).not.toBeInTheDocument();
  });

  it('nova pendência de Day Card: valor padrão do clube, categoria Day Card e convidado', async () => {
    mount(<PendenciesTab />);
    await screen.findByText('Day Card do convidado Carlos');
    fireEvent.click(screen.getByRole('button', { name: /Nova pendência/ }));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByRole('option', { name: 'Beto Sócio' });
    expect(within(sheet).getByLabelText('Valor da pendência')).toHaveValue('50,00');
    const criar = within(sheet).getByRole('button', { name: 'Criar pendência' });
    expect(criar).toBeDisabled();

    fireEvent.change(within(sheet).getByLabelText(/^Sócio/), { target: { value: 'u2' } });
    fireEvent.change(within(sheet).getByLabelText(/^Descrição/), { target: { value: 'Day Card do convidado Pedro' } });
    fireEvent.change(within(sheet).getByLabelText(/^Convidado/), { target: { value: ' Pedro ' } });
    fireEvent.click(within(sheet).getByLabelText(/Enviar cobrança agora/));
    fireEvent.click(criar);
    await waitFor(() => expect(api.createMemberPendency).toHaveBeenCalled());
    expect(api.createMemberPendency.mock.calls[0][0]).toMatchObject({
      profileId: 'u2', amountCents: 5000, pendencyKind: 'day_card', categoryId: 'cat-day', guestName: 'Pedro', sendNow: true, alreadyPaid: false, accountId: null,
    });
  });

  it('"já foi pago" registra a entrada e nunca dispara cobrança', async () => {
    mount(<PendenciesTab />);
    await screen.findByText('Day Card do convidado Carlos');
    fireEvent.click(screen.getByRole('button', { name: /Nova pendência/ }));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByRole('option', { name: 'Beto Sócio' });
    fireEvent.change(within(sheet).getByLabelText(/^Sócio/), { target: { value: 'u2' } });
    fireEvent.change(within(sheet).getByLabelText(/^Motivo/), { target: { value: 'consumo' } });
    fireEvent.change(within(sheet).getByLabelText(/^Descrição/), { target: { value: 'Consumo do bar' } });
    fireEvent.click(within(sheet).getByLabelText(/Enviar cobrança agora/));
    fireEvent.click(within(sheet).getByLabelText(/Já foi pago/));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Criar pendência' }));
    await waitFor(() => expect(api.createMemberPendency).toHaveBeenCalled());
    expect(api.createMemberPendency.mock.calls[0][0]).toMatchObject({ categoryId: 'cat-pend', alreadyPaid: true, sendNow: false, accountId: 'a1', method: 'pix', guestName: null });
  });

  it('cobrança pausada esconde "Cobrar agora"; reativar chama a régua', async () => {
    mount(<PendenciesTab />);
    fireEvent.click(await screen.findByText('Consumo do bar'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: /Cobrar agora/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Reativar cobrança/ }));
    await waitFor(() => expect(api.setPendencyCollection).toHaveBeenCalledWith('c2', true, expect.any(String)));
  });

  it('cobrar agora numa pendência ativa', async () => {
    mount(<PendenciesTab />);
    fireEvent.click(await screen.findByText('Day Card do convidado Carlos'));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Cobrar agora/ }));
    await waitFor(() => expect(api.sendPendencyNow).toHaveBeenCalledWith('c1', expect.any(String)));
  });
});
