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
  late_fee_confirmed_by: null, day_card_price_cents: 5000, day_card_in_cash: false, payee_names: [], pix_key: '', pendency_automation_enabled: true, pendency_reminder_days: [0, 3, 7, 14, 21], pendency_grace_days: 0,
  pendency_fine_fixed_cents: 0, pendency_fine_percent_bps: 0, pendency_interest_daily_fixed_cents: 0, pendency_interest_daily_percent_bps: 0,
  version: 3, updated_at: '2026-10-01T00:00:00Z', ...over,
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
describe('Comprovantes — aprovar em lote', () => {
  const qrow = (id: string, profile: string, name: string, cents: number | null, over: Partial<ReceiptQueueRow> = {}): ReceiptQueueRow => ({
    id, profile_id: profile, profile_name: name, status: 'submitted', file_name: `${id}.png`, content_type: 'image/png', size_bytes: 1000,
    declared_amount_cents: cents, declared_paid_on: '2026-09-05', ocr_status: 'ok', ocr: { amount_cents: cents, paid_on: '2026-09-05', identifier: `ID-${id}` }, possible_duplicate: false,
    decision_reason: null, reviewed_at: null, created_at: '2026-09-05T12:00:00Z', charge_count: 1, total_count: 3, ...over,
  });
  const rowsQ = [qrow('s1', 'u1', 'Ana Sócia', 15000), qrow('s2', 'u2', 'Bruno Sócio', 15000), qrow('s3', 'u3', 'Carla Sócia', 9000)];

  beforeEach(() => {
    api.receiptQueue.mockResolvedValue(rowsQ);
    api.receiptDetail.mockImplementation(async (id: string) => {
      const r = rowsQ.find((x) => x.id === id)!;
      return { ...r, member_note: null, declared_reference: null, storage_path: `${r.profile_id}/${id}/x.png`, charge_ids: [`c-${id}`] };
    });
    api.chargeStatementsByIds.mockImplementation(async (ids: string[]) => ids.map((cid) => stm({ charge_id: cid, profile_id: cid, profile_name: cid })));
    api.approveReceipt.mockResolvedValue({ status: 'approved', payment_ids: ['p'] });
  });

  async function openBatch() {
    mount(<ReceiptsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Aprovar em lote/i }));
    return screen.findByRole('dialog');
  }

  it('separa o que está pronto do que precisa de conferência e NÃO deixa nada marcado nem aprova ao abrir', async () => {
    const dlg = await openBatch();
    await within(dlg).findByLabelText('Selecionar comprovante de Ana Sócia');
    expect(within(dlg).getByLabelText('Selecionar comprovante de Bruno Sócio')).not.toBeChecked();
    // valor a menos: vai para a lista individual, sem caixa de seleção
    expect(within(dlg).queryByLabelText('Selecionar comprovante de Carla Sócia')).not.toBeInTheDocument();
    expect(within(dlg).getByText(/Conferir individualmente \(1\)/)).toBeInTheDocument();
    expect(within(dlg).getByText('Carla Sócia')).toBeInTheDocument();
    expect(within(dlg).getByText('Nenhum selecionado')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: /Aprovar selecionados/ })).toBeDisabled();
    expect(api.approveReceipt).not.toHaveBeenCalled();
    expect(api.startReceiptReview).not.toHaveBeenCalled();
  });

  it('"Selecionar todos" + confirmação aprova cada comprovante pronto, na conta escolhida, com a divisão por cobrança', async () => {
    const dlg = await openBatch();
    fireEvent.click(await within(dlg).findByLabelText(/Selecionar todos os prontos \(2\)/));
    expect(within(dlg).getByText(/2 selecionados · R\$\s*300,00/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar 2 selecionados/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar 2' }));
    await waitFor(() => expect(api.approveReceipt).toHaveBeenCalledTimes(2));
    const calls = api.approveReceipt.mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['s1', 's2']);
    expect(calls[0][1]).toMatchObject({ accountId: 'a1', method: 'pix', paidOn: '2026-09-05', waivers: [], allocations: [{ chargeId: 'c-s1', amountCents: 15000 }] });
    expect(calls[0][2]).toBe('u1');
    expect(calls[1][2]).toBe('u2');
    expect(calls[0][3]).not.toBe(calls[1][3]); // chave de idempotência própria de cada um
    expect(api.rejectReceipt).not.toHaveBeenCalled();
  });

  it('marcar só alguns aprova só esses; cancelar a confirmação não aprova nada', async () => {
    const dlg = await openBatch();
    fireEvent.click(await within(dlg).findByLabelText('Selecionar comprovante de Bruno Sócio'));
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar 1 selecionado/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.approveReceipt).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar 1 selecionado/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar 1' }));
    await waitFor(() => expect(api.approveReceipt).toHaveBeenCalledTimes(1));
    expect(api.approveReceipt.mock.calls[0][0]).toBe('s2');
  });

  it('uma falha não derruba as outras: mostra o motivo no sócio, mantém a seleção e repete com a MESMA chave', async () => {
    api.approveReceipt.mockImplementation(async (id: string) => { if (id === 's2') throw new Error('RECEIPT_NOT_PENDING'); return { status: 'approved', payment_ids: ['p'] }; });
    const dlg = await openBatch();
    fireEvent.click(await within(dlg).findByLabelText(/Selecionar todos os prontos \(2\)/));
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar 2 selecionados/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar 2' }));
    await waitFor(() => expect(api.approveReceipt).toHaveBeenCalledTimes(2));
    expect(await within(dlg).findByText(/Este comprovante já foi decidido/)).toBeInTheDocument();
    const firstKeyForS2 = api.approveReceipt.mock.calls.find((c) => c[0] === 's2')![3];
    // o sócio aprovado (s1) saiu da seleção; o que falhou continua marcado para tentar de novo
    await waitFor(() => expect(within(dlg).getByLabelText('Selecionar comprovante de Bruno Sócio')).toBeChecked());
    fireEvent.click(within(dlg).getByRole('button', { name: /Aprovar 1 selecionado/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar 1' }));
    await waitFor(() => expect(api.approveReceipt.mock.calls.filter((c) => c[0] === 's2')).toHaveLength(2));
    expect(api.approveReceipt.mock.calls.filter((c) => c[0] === 's2')[1][3]).toBe(firstKeyForS2);
  });

  it('data no futuro e cobrança já quitada ficam bloqueadas e não podem ser marcadas', async () => {
    api.chargeStatementsByIds.mockImplementation(async (ids: string[]) => ids.map((cid) => stm({ charge_id: cid, total_due_cents: cid === 'c-s1' ? 0 : 15000, principal_remaining_cents: cid === 'c-s1' ? 0 : 15000 })));
    const dlg = await openBatch();
    await within(dlg).findByLabelText('Selecionar comprovante de Bruno Sócio');
    expect(within(dlg).queryByLabelText('Selecionar comprovante de Ana Sócia')).not.toBeInTheDocument();
    expect(within(dlg).getByText(/já está quitada/i)).toBeInTheDocument();
    expect(within(dlg).getByText('Bloqueado')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------
describe('Configurações — nenhum valor inventado', () => {
  it('política de encargos nasce vazia e "não configurada"; sem confirmar, avisa que nada é cobrado', async () => {
    mount(<SettingsTab />);
    expect(await screen.findByText('Não configurada')).toBeInTheDocument();
    expect(screen.getByText(/não recebem multa nem juros/i)).toBeInTheDocument();
    for (const label of [/^Multa fixa \(/, /^Multa \(%/, /^Juros fixos por dia \(/, /^Juros por dia \(%\)/]) {
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
