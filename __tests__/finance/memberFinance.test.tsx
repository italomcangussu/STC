import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, MemberCreditRow, PublicSettings } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  myCharges: vi.fn(), myReceipts: vi.fn(), listCredits: vi.fn(), getPublicSettings: vi.fn(), chargeHistory: vi.fn(),
  chargeStatementsByIds: vi.fn(), submitReceipt: vi.fn(), getMemberPaymentSettings: vi.fn(), listPendencyMeta: vi.fn(),
  // Nada que quite cobrança existe para o sócio: se a tela tentasse, o teste falharia por função inexistente.
  newRequestId: () => globalThis.crypto.randomUUID(),
}));
vi.mock('../../lib/finance/financeApi', () => api);
vi.mock('../../lib/finance/ocr', () => ({ readReceipt: vi.fn(async () => ({ status: 'unreadable' })) }));

import { MemberFinance } from '../../components/finance/MemberFinance';

const user = { id: 'u1', name: 'Ana Sócia', role: 'socio' } as never;

const charge = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'overdue', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 10, fine_due_cents: 300, interest_due_cents: 150, fees_due_cents: 450, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15450, fees_configured: true, overdue: true, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});

const settings = (over: Partial<PublicSettings> = {}): PublicSettings => ({
  due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, late_fee_confirmed: true, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: 200, interest_daily_fixed_cents: null, interest_daily_percent_bps: 3, ...over,
});

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])], 'comprovante.png', { type: 'image/png' });

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.myCharges.mockResolvedValue([charge()]);
  api.myReceipts.mockResolvedValue([]);
  api.getMemberPaymentSettings.mockResolvedValue({ pix_key: '52.393.541/0001-20', pendency_automation_enabled: true, pendency_reminder_days: [0, 3, 7, 14, 21],
    pendency_grace_days: 0, pendency_fine_fixed_cents: 0, pendency_fine_percent_bps: 0, pendency_interest_daily_fixed_cents: 0, pendency_interest_daily_percent_bps: 0 });
  api.listPendencyMeta.mockResolvedValue([]);
  api.listCredits.mockResolvedValue([]);
  api.getPublicSettings.mockResolvedValue(settings());
  api.chargeHistory.mockResolvedValue({ payments: [], adjustments: [] });
  api.chargeStatementsByIds.mockResolvedValue([]);
});

describe('MemberFinance — extrato do sócio', () => {
  it('mostra valor original, dias de atraso, multa e juros separados e o total atualizado', async () => {
    render(<MemberFinance currentUser={user} />);
    await screen.findByText(/Mensalidade de agosto/i);
    expect(screen.getByText('Valor original').nextSibling).toHaveTextContent('R$ 150,00');
    expect(screen.getByText('Dias de atraso').nextSibling).toHaveTextContent('10');
    expect(screen.getByText('Multa').nextSibling).toHaveTextContent('R$ 3,00');
    expect(screen.getByText('Juros').nextSibling).toHaveTextContent('R$ 1,50');
    expect(screen.getByText('Total atualizado hoje').nextSibling).toHaveTextContent('R$ 154,50');
  });

  it('sem política de encargos confirmada não inventa multa nem juros', async () => {
    api.myCharges.mockResolvedValue([charge({ fees_configured: false, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, total_due_cents: 15000 })]);
    api.getPublicSettings.mockResolvedValue(settings({ late_fee_confirmed: false, fine_percent_bps: null, interest_daily_percent_bps: null }));
    render(<MemberFinance currentUser={user} />);
    await screen.findByText(/Encargos de atraso ainda não definidos pelo clube/i);
    expect(screen.queryByText('Multa')).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não foram definidos pelo clube/i)).toBeInTheDocument();
  });

  it('explica a regra de vencimento e de encargos em linguagem do sócio (juros simples)', async () => {
    render(<MemberFinance currentUser={user} />);
    expect(await screen.findByText(/Vence no dia 5 do mês seguinte/i)).toBeInTheDocument();
    expect(screen.getByText(/Juros simples — encargos não geram novos juros/i)).toBeInTheDocument();
  });

  it('avisa do crédito (pagamento a mais ou repetido) sem prometer devolução automática', async () => {
    const credit: MemberCreditRow = { id: 'k1', profile_id: 'u1', reason: 'duplicate', amount_cents: 15000, remaining_cents: 15000, status: 'open', resolution_note: null, created_at: '2026-09-10T10:00:00Z' };
    api.listCredits.mockResolvedValue([credit]);
    render(<MemberFinance currentUser={user} />);
    expect(await screen.findByText(/Você tem R\$ 150,00 de crédito/)).toBeInTheDocument();
  });

  it('mostra o status e o próximo passo de cada comprovante enviado', async () => {
    api.myReceipts.mockResolvedValue([
      { id: 'r1', profile_id: 'u1', status: 'rejected', file_name: 'a.png', content_type: 'image/png', size_bytes: 10, declared_amount_cents: 15450, declared_paid_on: '2026-09-17', declared_reference: null, member_note: null, ocr_status: 'ok', ocr: null, possible_duplicate: false, decision_reason: 'Valor não confere', reviewed_at: '2026-09-18T12:00:00Z', created_at: '2026-09-17T12:00:00Z', charge_ids: ['c1'] },
      { id: 'r2', profile_id: 'u1', status: 'approved', file_name: 'b.png', content_type: 'image/png', size_bytes: 10, declared_amount_cents: 15000, declared_paid_on: '2026-08-05', declared_reference: null, member_note: null, ocr_status: 'ok', ocr: null, possible_duplicate: false, decision_reason: null, reviewed_at: '2026-08-06T12:00:00Z', created_at: '2026-08-05T12:00:00Z', charge_ids: [] },
    ]);
    render(<MemberFinance currentUser={user} />);
    expect(await screen.findByText(/Motivo: Valor não confere/)).toBeInTheDocument();
    expect(screen.getByText('Recusado')).toBeInTheDocument();
    expect(screen.getByText('Aprovado')).toBeInTheDocument();
    expect(screen.getByText(/A cobrança continua em aberto/)).toBeInTheDocument();
  });
});

describe('MemberFinance — envio de comprovante', () => {
  it('envia o arquivo e os dados declarados; enviar NÃO quita (o clube confere)', async () => {
    api.submitReceipt.mockResolvedValue({ id: 's1', possible_duplicate: false });
    render(<MemberFinance currentUser={user} />);
    await screen.findByText(/Mensalidade de agosto/i);

    fireEvent.click(screen.getByRole('button', { name: /Enviar comprovante/i }));
    const sheet = await screen.findByRole('dialog');
    // Mensalidade continua indo para a conferência do clube; só pendência pode baixar sozinha (OCR + regras).
    expect(within(sheet).getByText(/qualquer dúvida vai para análise/i)).toBeInTheDocument();

    fireEvent.click(within(sheet).getAllByRole('checkbox')[0]);
    const input = sheet.querySelector('input[type="file"][accept="image/*,application/pdf"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await within(sheet).findByText(/Não conseguimos ler o comprovante/i);

    fireEvent.change(within(sheet).getByLabelText('Valor pago'), { target: { value: '154,50' } });
    fireEvent.change(within(sheet).getByLabelText('Data do pagamento'), { target: { value: '2026-09-17' } });
    const send = within(sheet).getByRole('button', { name: /Enviar comprovante/i });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);

    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(1));
    const arg = api.submitReceipt.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 'u1', chargeIds: ['c1'], declaredAmountCents: 15450, declaredPaidOn: '2026-09-17', type: 'image/png', ocrStatus: 'unreadable' });
    expect(arg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.safeName).toMatch(/\.png$/);
  });

  it('recusa arquivo de tipo falso (executável renomeado) sem enviar nada', async () => {
    render(<MemberFinance currentUser={user} />);
    await screen.findByText(/Mensalidade de agosto/i);
    fireEvent.click(screen.getByRole('button', { name: /Enviar comprovante/i }));
    const sheet = await screen.findByRole('dialog');
    const fake = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0])], 'virus.png', { type: 'image/png' });
    fireEvent.change(sheet.querySelector('input[type="file"][accept="image/*,application/pdf"]') as HTMLInputElement, { target: { files: [fake] } });
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/Formato não aceito/i);
    expect(api.submitReceipt).not.toHaveBeenCalled();
  });

  it('só quem tem cobrança em aberto consegue abrir o envio', async () => {
    api.myCharges.mockResolvedValue([]);
    render(<MemberFinance currentUser={user} />);
    await screen.findByText(/não tem cobranças financeiras cadastradas/i);
    expect(screen.getByRole('button', { name: /Enviar comprovante/i })).toBeDisabled();
  });
});
