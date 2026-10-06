import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinAccount, FinSettings, ReceiptQueueRow } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  RECEIPTS_BUCKET: 'fin-receipts', DOCS_BUCKET: 'fin-docs',
  newRequestId: () => globalThis.crypto.randomUUID(),
  receiptQueue: vi.fn(), receiptDetail: vi.fn(), startReceiptReview: vi.fn(), chargeStatementsByIds: vi.fn(), approveReceipt: vi.fn(), rejectReceipt: vi.fn(),
  signedUrl: vi.fn(), saveSettings: vi.fn(), listHolidays: vi.fn(), saveHoliday: vi.fn(), seedHolidays: vi.fn(), listAudit: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import ReceiptsTab from '../../components/finance/tabs/ReceiptsTab';
import SettingsTab from '../../components/finance/tabs/SettingsTab';

const account = (over: Partial<FinAccount> = {}): FinAccount => ({ id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1, ...over });

const baseSettings = (over: Partial<FinSettings> = {}): FinSettings => ({
  id: true, due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: null, interest_daily_fixed_cents: null, interest_daily_percent_bps: null, late_fee_confirmed_at: null,
  late_fee_confirmed_by: null, day_card_price_cents: 5000, day_card_in_cash: false, payee_names: [], version: 3, updated_at: '2026-10-01T00:00:00Z', ...over,
});

const stm = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07', original_amount_cents: 15000,
  stored_status: 'open', display_status: 'overdue', in_review: true, principal_base_cents: 15000, principal_paid_cents: 0, principal_remaining_cents: 15000, days_late: 0,
  fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0, total_due_cents: 15000, fees_configured: false, overdue: false,
  last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});

const mount = (ui: React.ReactElement, settings: FinSettings | null = baseSettings(), accounts: FinAccount[] = [account()]) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts, categories: [], settings, reload: vi.fn(), go: vi.fn() }}>{ui}</FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.startReceiptReview.mockResolvedValue({});
  api.listHolidays.mockResolvedValue([]);
  api.listAudit.mockResolvedValue([]);
});

// ------------------------------------------------------------------
describe('Comprovantes — a leitura sugere, o administrador decide', () => {
  const queueRow: ReceiptQueueRow = {
    id: 's1', profile_id: 'u1', profile_name: 'Ana Sócia', status: 'submitted', file_name: 'pix.png', content_type: 'image/png', size_bytes: 1000,
    declared_amount_cents: 15000, declared_paid_on: '2026-09-05', ocr_status: 'ok', ocr: { amount_cents: 15000, paid_on: '2026-09-05', identifier: 'E123' }, possible_duplicate: false,
    decision_reason: null, reviewed_at: null, created_at: '2026-09-05T12:00:00Z', charge_count: 1, total_count: 1,
  };
  const detail = { ...queueRow, member_note: null, declared_reference: 'E123', storage_path: 'u1/s1/pix.png', charge_ids: ['c1'] };

  beforeEach(() => {
    api.receiptQueue.mockResolvedValue([queueRow]);
    api.receiptDetail.mockResolvedValue(detail);
    api.chargeStatementsByIds.mockResolvedValue([stm()]);
    api.approveReceipt.mockResolvedValue({ status: 'approved', payment_ids: ['p1'] });
    api.rejectReceipt.mockResolvedValue({ status: 'rejected' });
  });

  async function openReview() {
    mount(<ReceiptsTab />);
    fireEvent.click(await screen.findByText('Ana Sócia'));
    return screen.findByRole('dialog');
  }

  it('abrir e conferir NÃO aprova nada, mesmo com a leitura automática batendo com o valor devido', async () => {
    const dlg = await openReview();
    await within(dlg).findByText(/O valor confere com o total devido/i);
    expect(api.approveReceipt).not.toHaveBeenCalled();
    expect(api.rejectReceipt).not.toHaveBeenCalled();
    expect(api.startReceiptReview).toHaveBeenCalledWith('s1');
  });

  it('aprovar exige a ação explícita + confirmação e manda a divisão por cobrança', async () => {
    const dlg = await openReview();
    await within(dlg).findByText(/O valor confere/i);
    await waitFor(() => expect(within(dlg).getByRole('button', { name: /Aprovar e registrar pagamento/i })).toBeEnabled());
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar e registrar pagamento/i }));
    // diálogo de confirmação
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar pagamento' }));
    await waitFor(() => expect(api.approveReceipt).toHaveBeenCalledTimes(1));
    const [id, input, profileId] = api.approveReceipt.mock.calls[0];
    expect(id).toBe('s1');
    expect(profileId).toBe('u1');
    expect(input).toMatchObject({ accountId: 'a1', method: 'pix', paidOn: '2026-09-05', allocations: [{ chargeId: 'c1', amountCents: 15000 }], waivers: [] });
  });

  it('data no futuro e cobrança já quitada bloqueiam com aviso (não aprovam sozinhos)', async () => {
    api.chargeStatementsByIds.mockResolvedValue([stm({ total_due_cents: 0, principal_remaining_cents: 0 })]);
    const dlg = await openReview();
    expect(await within(dlg).findByText(/já está quitada/i)).toBeInTheDocument();
    expect(api.approveReceipt).not.toHaveBeenCalled();
  });

  it('recusar exige motivo (mínimo de 5 caracteres) e avisa o sócio pelo id do perfil', async () => {
    const dlg = await openReview();
    await within(dlg).findByText(/O valor confere/i);
    fireEvent.click(within(dlg).getByRole('button', { name: /Recusar…/ }));
    const confirmBtn = within(dlg).getByRole('button', { name: 'Recusar comprovante' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/Motivo da recusa/i), { target: { value: 'ruim' } });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/Motivo da recusa/i), { target: { value: 'Valor não confere com o extrato' } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api.rejectReceipt).toHaveBeenCalledWith('s1', 'Valor não confere com o extrato', 'u1', expect.any(String)));
  });
});

// ------------------------------------------------------------------
describe('Configurações — nenhum valor inventado', () => {
  it('política de encargos nasce vazia e "não configurada"; sem confirmar, avisa que nada é cobrado', async () => {
    mount(<SettingsTab />);
    expect(await screen.findByText('Não configurada')).toBeInTheDocument();
    expect(screen.getByText(/não recebem multa nem juros/i)).toBeInTheDocument();
    for (const label of [/^Multa fixa/, /^Multa \(%/, /^Juros fixos por dia/, /^Juros por dia \(%\)/]) {
      expect(screen.getByLabelText(label)).toHaveValue('');
    }
  });

  it('confirmar "sem encargos" é uma decisão explícita, com confirmação e valores nulos', async () => {
    api.saveSettings.mockResolvedValue({ version: 4 });
    mount(<SettingsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar: sem encargos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar sem encargos' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    const [version, data] = api.saveSettings.mock.calls[0];
    expect(version).toBe(3);
    expect(data).toMatchObject({ late_fee_confirmed: true, fine_fixed_cents: null, fine_percent_bps: null, interest_daily_fixed_cents: null, interest_daily_percent_bps: null });
  });

  it('o simulador calcula multa e juros simples com o que o administrador digitou, sem gravar', async () => {
    mount(<SettingsTab />);
    const fine = await screen.findByLabelText(/^Multa \(%/);
    fireEvent.change(fine, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Juros por dia \(%\)/), { target: { value: '0,1' } });
    fireEvent.change(screen.getByLabelText(/^Mensalidade \(R\$\)/), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/^Dias além da carência/), { target: { value: '10' } });
    // multa 2% de 150,00 = 3,00; juros 0,1% a.d. × 10 dias sobre 150,00 = 1,50 (simples) → total 154,50
    const result = await screen.findByText((_, el) => el?.tagName === 'P' && /Multa.*total a pagar/.test(el.textContent ?? ''));
    expect(result).toHaveTextContent(/R\$\s*3,00.*R\$\s*1,50.*R\$\s*154,50/);
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('com política já confirmada, mudar encargo exige justificativa', async () => {
    api.saveSettings.mockResolvedValue({ version: 5 });
    mount(<SettingsTab />, baseSettings({ late_fee_confirmed_at: '2026-09-01T00:00:00Z', fine_percent_bps: 200 }));
    expect(await screen.findByText('Confirmada')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Multa \(%/), { target: { value: '3' } });
    const save = screen.getByRole('button', { name: 'Salvar alteração' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Justificativa da mudança/i), { target: { value: 'Decisão da diretoria' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(3, expect.objectContaining({ fine_percent_bps: 300, reason: 'Decisão da diretoria' }), expect.any(String)));
  });
});

describe('Configurações — Day Card', () => {
  it('o valor do Day Card é o do convidado e não há opção de Card Mensal cobrindo "aula" (aula de aluno não gera cobrança)', async () => {
    api.saveSettings.mockResolvedValue({ version: 4 });
    mount(<SettingsTab />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Day Card e comprovantes' }));
    expect(await screen.findByLabelText(/^Valor do Day Card/)).toHaveValue('50,00');
    expect(screen.getByText(/Taxa do convidado de um sócio/i)).toBeInTheDocument();
    expect(screen.queryByText(/Card Mensal válido na data da aula/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Valor do Day Card/), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(3, expect.objectContaining({ day_card_price_cents: 6500, day_card_in_cash: false }), expect.any(String)));
  });
});
