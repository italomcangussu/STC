import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, MemberPendencyMeta, PublicSettings } from '../../lib/finance/types';

// Caracteriza a tela "Meu financeiro" do sócio (cabeçalho, abas, cartões de cobrança, pendências, comprovantes e o envio)
// pela porta pública, para a divisão do arquivo não mudar nada do que o sócio vê nem o que é enviado ao banco.
const api = vi.hoisted(() => ({
  myCharges: vi.fn(), myReceipts: vi.fn(), listCredits: vi.fn(), getPublicSettings: vi.fn(), chargeHistory: vi.fn(),
  chargeStatementsByIds: vi.fn(), submitReceipt: vi.fn(), getMemberPaymentSettings: vi.fn(), listPendencyMeta: vi.fn(),
  newRequestId: () => globalThis.crypto.randomUUID(),
}));
vi.mock('../../lib/finance/financeApi', () => api);
const readReceipt = vi.hoisted(() => vi.fn());
vi.mock('../../lib/finance/ocr', () => ({ readReceipt }));

import { MemberFinance } from '../../components/finance/MemberFinance';
import { notify } from '../../lib/notifications';

const user = { id: 'u1', name: 'Ana Sócia', role: 'socio' } as never;
const KEY = expect.stringMatching(/^[0-9a-f-]{36}$/);

const charge = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'overdue', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 10, fine_due_cents: 300, interest_due_cents: 150, fees_due_cents: 450, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15450, fees_configured: true, overdue: true, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});
const open = (id: string, month: string, over: Partial<ChargeStatementRow> = {}) =>
  charge({ charge_id: id, competence_month: month, display_status: 'open', overdue: false, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, total_due_cents: 15000, ...over });

const pendency = (over: Partial<MemberPendencyMeta> = {}): MemberPendencyMeta => ({
  id: 'p-1', profile_id: 'u1', charge_type: 'member_pendency', description: 'Day Card do convidado Carlos', pendency_kind: 'day_card', category_id: 'cat',
  guest_name: 'Carlos', guest_date: '2026-10-05', collection_enabled: true, competence_month: '2026-10-01', due_date: '2026-10-07', original_amount_cents: 5000, status: 'open', version: 1, ...over,
});

const settings = (over: Partial<PublicSettings> = {}): PublicSettings => ({
  due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, late_fee_confirmed: true, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: 200, interest_daily_fixed_cents: null, interest_daily_percent_bps: 3, ...over,
});

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'r1', profile_id: 'u1', status: 'rejected', file_name: 'a.png', content_type: 'image/png', size_bytes: 10, declared_amount_cents: 15450, declared_paid_on: '2026-09-17',
  declared_reference: null, member_note: null, ocr_status: 'ok', ocr: null, possible_duplicate: false, decision_reason: 'Valor não confere', reviewed_at: '2026-09-18T12:00:00Z',
  created_at: '2026-09-17T12:00:00Z', charge_ids: ['c1'], ...over,
});

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])], 'comprovante.png', { type: 'image/png' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z')); // "hoje" no clube: 06/10/2026
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  readReceipt.mockReset();
  readReceipt.mockResolvedValue({ status: 'unreadable' });
  api.myCharges.mockResolvedValue([charge()]);
  api.myReceipts.mockResolvedValue([]);
  api.getMemberPaymentSettings.mockResolvedValue({ pix_key: '52.393.541/0001-20' });
  api.listPendencyMeta.mockResolvedValue([]);
  api.listCredits.mockResolvedValue([]);
  api.getPublicSettings.mockResolvedValue(settings());
  api.chargeHistory.mockResolvedValue({ payments: [], adjustments: [] });
  api.chargeStatementsByIds.mockResolvedValue([]);
  api.submitReceipt.mockResolvedValue({ id: 's1', possible_duplicate: false });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const mount = () => render(<MemberFinance currentUser={user} />);
const card = (title: RegExp | string) => within(screen.getByText(title).closest('div.rounded-3xl') as HTMLElement);

describe('Meu financeiro — cabeçalho', () => {
  it.each([
    [[charge()], 'Você tem 1 cobrança vencida', 'R$ 154,50'],
    [[charge(), charge({ charge_id: 'c2', competence_month: '2026-07-01' })], 'Você tem 2 cobranças vencidas', 'R$ 309,00'],
    [[open('c1', '2026-10-01')], 'Valor em aberto hoje', 'R$ 150,00'],
    [[], 'Tudo em dia', 'R$ 0,00'],
  ])('%#: mostra "%s" e o total atualizado %s', async (charges, frase, total) => {
    api.myCharges.mockResolvedValue(charges);
    mount();
    expect(await screen.findByText(frase)).toBeInTheDocument();
    expect(screen.getByText(total, { selector: 'p' })).toBeInTheDocument();
  });

  it('o total de hoje soma só o que está a pagar (não as previstas)', async () => {
    api.myCharges.mockResolvedValue([open('c1', '2026-10-01'), open('c2', '2026-11-01', { display_status: 'forecast' })]);
    mount();
    expect(await screen.findByText('Valor em aberto hoje')).toBeInTheDocument();
    expect(screen.getByText('R$ 150,00', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('Meu financeiro — abas', () => {
  const todas = () => [
    open('c1', '2026-10-01'),
    open('c2', '2026-11-01', { display_status: 'forecast' }),
    charge({ charge_id: 'c3', competence_month: '2026-06-01', display_status: 'paid', stored_status: 'paid', total_due_cents: 0, principal_paid_cents: 15000, days_late: 0 }),
    charge({ charge_id: 'c4', competence_month: '2026-05-01', display_status: 'canceled', stored_status: 'canceled', total_due_cents: 0, cancel_reason: 'Sócio afastado', days_late: 0 }),
  ];

  it('cada aba mostra o seu grupo; "A pagar" e "Previstas" levam o número de cobranças', async () => {
    api.myCharges.mockResolvedValue(todas());
    mount();
    await screen.findByText('Mensalidade de outubro de 2026');
    expect(screen.getByRole('tab', { name: /A pagar/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Previstas/ })).toHaveTextContent('1');
    expect(screen.queryByText('Mensalidade de novembro de 2026')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Previstas/ }));
    expect(await screen.findByText('Mensalidade de novembro de 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Pagas' }));
    expect(await screen.findByText('Mensalidade de junho de 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Canceladas' }));
    expect(await screen.findByText('Mensalidade de maio de 2026')).toBeInTheDocument();
    expect(screen.getByText('Cancelada: Sócio afastado')).toBeInTheDocument();
  });

  it('aba sem cobranças diz "Nada por aqui"; sem nenhuma cobrança explica quando elas aparecem', async () => {
    api.myCharges.mockResolvedValue([open('c1', '2026-10-01')]);
    mount();
    await screen.findByText('Mensalidade de outubro de 2026');
    fireEvent.click(screen.getByRole('tab', { name: 'Pagas' }));
    expect(await screen.findByText('Nada por aqui')).toBeInTheDocument();
  });

  it('sem cobrança nenhuma, a tela explica que mensalidades e pendências aparecerão ali', async () => {
    api.myCharges.mockResolvedValue([]);
    mount();
    expect(await screen.findByText('Você não tem cobranças financeiras cadastradas')).toBeInTheDocument();
    expect(screen.getByText(/Mensalidades e pendências aparecerão aqui/)).toBeInTheDocument();
  });

  it('erro ao carregar mostra "Tentar de novo" e tentar de novo busca outra vez', async () => {
    api.myCharges.mockRejectedValueOnce(new Error('falhou'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Mensalidade de agosto de 2026')).toBeInTheDocument();
    expect(api.myCharges).toHaveBeenCalledTimes(2);
  });
});

describe('Meu financeiro — cartão da cobrança', () => {
  it('cobrança paga esconde atraso, encargos e o total de hoje, e não deixa selecionar', async () => {
    api.myCharges.mockResolvedValue([charge({ display_status: 'paid', stored_status: 'paid', total_due_cents: 0, principal_paid_cents: 15000, days_late: 10 })]);
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Pagas' }));
    const c = card('Mensalidade de agosto de 2026');

    expect(await c.findByText('Já pago')).toBeInTheDocument();
    expect(c.getByText('Já pago').nextSibling).toHaveTextContent('− R$ 150,00');
    expect(c.queryByText('Dias de atraso')).toBeNull();
    expect(c.queryByText('Total atualizado hoje')).toBeNull();
    expect(c.queryByText('Pagar esta')).toBeNull();
  });

  it('mostra "Valor com ajustes" só quando difere do original', async () => {
    api.myCharges.mockResolvedValue([charge({ principal_base_cents: 14000 })]);
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');
    const c = card('Mensalidade de agosto de 2026');

    expect(c.getByText('Valor com ajustes').nextSibling).toHaveTextContent('R$ 140,00');
  });

  it('sem ajuste não repete o valor', async () => {
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');

    expect(screen.queryByText('Valor com ajustes')).toBeNull();
  });

  it('em dia (sem atraso) mostra só o total; comprovante em análise avisa que o clube está conferindo', async () => {
    api.myCharges.mockResolvedValue([open('c1', '2026-10-01', { display_status: 'in_review', in_review: true })]);
    mount();
    await screen.findByText('Mensalidade de outubro de 2026');

    expect(screen.queryByText('Dias de atraso')).toBeNull();
    expect(screen.getByText('Total atualizado hoje').nextSibling).toHaveTextContent('R$ 150,00');
    expect(screen.getByText(/Você enviou um comprovante para esta cobrança/)).toBeInTheDocument();
  });

  it('"Pagar esta" inclui a cobrança no comprovante e o botão do topo conta quantas', async () => {
    api.myCharges.mockResolvedValue([charge(), charge({ charge_id: 'c2', competence_month: '2026-07-01' })]);
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');
    fireEvent.click(screen.getByLabelText('Incluir Mensalidade de agosto de 2026 no comprovante'));

    expect(screen.getByText('Incluída no comprovante')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar comprovante (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Incluir Mensalidade de julho de 2026 no comprovante'));
    expect(screen.getByRole('button', { name: 'Enviar comprovante (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Incluir Mensalidade de agosto de 2026 no comprovante'));
    expect(screen.getByRole('button', { name: 'Enviar comprovante (1)' })).toBeInTheDocument();
  });

  it('parcela prevista também pode ser incluída', async () => {
    api.myCharges.mockResolvedValue([open('c2', '2026-11-01', { display_status: 'forecast' })]);
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Previstas/ }));

    expect(await screen.findByText('Pagar esta')).toBeInTheDocument();
  });

  it('o histórico abre sob demanda: pagamentos (com a divisão), estorno e ajustes; fechar esconde', async () => {
    api.chargeHistory.mockResolvedValue({
      payments: [
        { id: 'p1', kind: 'payment', amount_cents: 15000, paid_on: '2026-09-08', principal_cents: 14000, fine_cents: 300, interest_cents: 200, excess_cents: 500, method: 'pix' },
        { id: 'p2', kind: 'reversal', amount_cents: 1000, paid_on: '2026-09-09', principal_cents: 1000, fine_cents: 0, interest_cents: 0, excess_cents: 0, method: 'pix' },
      ],
      adjustments: [
        { id: 'a1', kind: 'discount', amount_cents: 1000, reason: 'Bolsa', created_at: '2026-09-01T10:00:00Z' },
        { id: 'a2', kind: 'increase', amount_cents: 500, reason: 'Reposição', created_at: '2026-09-02T10:00:00Z' },
        { id: 'a3', kind: 'fee_waiver', amount_cents: 300, reason: 'Erro do clube', created_at: '2026-09-03T10:00:00Z' },
      ],
    });
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');
    expect(api.chargeHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Histórico/ }));

    expect(await screen.findByText(/principal R\$ 140,00, encargos R\$ 5,00, crédito R\$ 5,00/)).toBeInTheDocument();
    expect(screen.getByText(/Estorno/)).toHaveTextContent('09/09/2026');
    expect(screen.getByText(/Bolsa/)).toHaveTextContent('Desconto de R$ 10,00: Bolsa');
    expect(screen.getByText(/Reposição/)).toHaveTextContent('Acréscimo de R$ 5,00: Reposição');
    expect(screen.getByText(/Erro do clube/)).toHaveTextContent('Dispensa de encargos de R$ 3,00: Erro do clube');
    expect(api.chargeHistory).toHaveBeenCalledWith('c1');

    fireEvent.click(screen.getByRole('button', { name: /Histórico/ }));
    expect(screen.queryByText(/Bolsa/)).toBeNull();
  });

  it('histórico vazio diz que não há pagamento nem ajuste', async () => {
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');
    fireEvent.click(screen.getByRole('button', { name: /Histórico/ }));

    expect(await screen.findByText('Nenhum pagamento ou ajuste ainda.')).toBeInTheDocument();
  });
});

describe('Meu financeiro — pendências do clube', () => {
  const comPendencia = () => {
    api.myCharges.mockResolvedValue([charge({ charge_id: 'p-1', plan_id: null, competence_month: '2026-10-01', total_due_cents: 5000, original_amount_cents: 5000, principal_base_cents: 5000, display_status: 'open', days_late: 0, fees_due_cents: 0 })]);
    api.listPendencyMeta.mockResolvedValue([pendency()]);
  };

  it('o cartão usa a descrição da pendência, a competência e o convidado; o quadro resume o saldo e o PIX', async () => {
    comPendencia();
    mount();

    expect(await screen.findByText('Day Card do convidado Carlos')).toBeInTheDocument();
    expect(screen.getByText(/Pendência · competência outubro de 2026 · Vencimento em 07\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Convidado: Carlos · Visita: 05/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Pendências financeiras')).toBeInTheDocument();
    expect(screen.getByText('Saldo das pendências').nextSibling).toHaveTextContent('R$ 50,00');
    expect(screen.getByText(/PIX do clube:/)).toHaveTextContent('52.393.541/0001-20');
    expect(api.listPendencyMeta).toHaveBeenCalledWith('u1');
  });

  it('só convidado ou só data aparecem sem separador', async () => {
    comPendencia();
    api.listPendencyMeta.mockResolvedValue([pendency({ guest_name: null })]);
    mount();

    expect(await screen.findByText('Visita: 05/10/2026')).toBeInTheDocument();
  });

  it('sem pendências em aberto o quadro não aparece', async () => {
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');

    expect(screen.queryByText('Pendências financeiras')).toBeNull();
  });

  it('copiar o PIX usa a área de transferência e confirma; se falhar mostra a chave', async () => {
    comPendencia();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Copiar PIX/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('52.393.541/0001-20'));
    expect(sucesso).toHaveBeenCalledWith('Chave PIX copiada.');
    expect(await screen.findByRole('button', { name: /Copiado/ })).toBeInTheDocument();

    const aviso = vi.spyOn(notify, 'info').mockImplementation(() => undefined as never);
    writeText.mockRejectedValueOnce(new Error('negado'));
    fireEvent.click(await screen.findByRole('button', { name: /Copiado|Copiar PIX/ }));
    await waitFor(() => expect(aviso).toHaveBeenCalledWith('PIX: 52.393.541/0001-20'));
  });

  it('sem chave PIX configurada não há botão de copiar', async () => {
    comPendencia();
    api.getMemberPaymentSettings.mockResolvedValue({ pix_key: '' });
    mount();
    await screen.findByText('Pendências financeiras');

    expect(screen.queryByRole('button', { name: /Copiar PIX/ })).toBeNull();
  });
});

describe('Meu financeiro — regras do clube e comprovantes enviados', () => {
  it.each([
    [{ due_month_offset: 0 }, /Vence no dia 5 do mês do período cobrado/],
    [{ non_business_rule: 'previous_business_day' as const }, /passa para o dia útil anterior/],
    [{ non_business_rule: 'keep' as const }, /é mantido/],
    [{ grace_days: 3 }, /após 3 dia\(s\) de carência/],
    [{ fine_fixed_cents: 500 }, /multa única de R\$ 5,00 \+ 2% no 1º dia de atraso/],
    [{ interest_daily_fixed_cents: 100 }, /juros de R\$ 1,00 por dia \+ 0,03% ao dia sobre o valor em aberto/],
    [{ fine_percent_bps: null, interest_daily_percent_bps: null }, /O clube não cobra encargos de atraso/],
    [{ late_fee_confirmed: false }, /ainda não foram definidos pelo clube/],
  ])('regra %j aparece em português', async (over, texto) => {
    api.getPublicSettings.mockResolvedValue(settings(over));
    mount();

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('comprovante recusado ou só enviado oferece "Enviar novo comprovante"; aprovado não', async () => {
    api.myReceipts.mockResolvedValue([receipt(), receipt({ id: 'r2', status: 'submitted', decision_reason: null }), receipt({ id: 'r3', status: 'approved', decision_reason: null })]);
    mount();
    await screen.findByText(/Motivo: Valor não confere/);

    expect(screen.getAllByRole('button', { name: 'Enviar novo comprovante' })).toHaveLength(2);
  });

  it('a lista de comprovantes informa o valor, a data e a duplicidade', async () => {
    api.myReceipts.mockResolvedValue([receipt({ possible_duplicate: true }), receipt({ id: 'r2', declared_amount_cents: null, declared_paid_on: null })]);
    mount();

    expect(await screen.findByText('R$ 154,50 · 17/09/2026')).toBeInTheDocument();
    expect(screen.getByText('Valor não informado')).toBeInTheDocument();
    expect(screen.getByText('Este arquivo já tinha sido enviado antes.')).toBeInTheDocument();
  });

  it('sem comprovantes diz que ainda não enviou', async () => {
    mount();

    expect(await screen.findByText('Você ainda não enviou comprovantes.')).toBeInTheDocument();
  });

  it('"Enviar novo comprovante" abre o envio com as cobranças do anterior marcadas e manda o que ele substitui', async () => {
    api.myReceipts.mockResolvedValue([receipt()]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar novo comprovante' }));
    const sheet = within(await screen.findByRole('dialog'));

    expect(sheet.getByRole('checkbox')).toBeChecked();
    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: '154,50' } });
    fireEvent.change(sheet.getByLabelText('Data do pagamento'), { target: { value: '2026-09-17' } });
    fireEvent.change(document.querySelector('input[type="file"][accept="image/*,application/pdf"]') as HTMLInputElement, { target: { files: [pngFile()] } });
    const enviar = sheet.getByRole('button', { name: /Enviar comprovante/ });
    await waitFor(() => expect(enviar).toBeEnabled());
    fireEvent.click(enviar);

    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(1));
    expect(api.submitReceipt.mock.calls[0][0]).toMatchObject({ replaces: 'r1', chargeIds: ['c1'], requestId: KEY, submissionId: KEY });
  });
});

describe('Meu financeiro — envio do comprovante', () => {
  const abrirEnvio = async () => {
    mount();
    await screen.findByText('Mensalidade de agosto de 2026');
    fireEvent.click(screen.getByRole('button', { name: /Enviar comprovante/ }));
    const sheet = within(await screen.findByRole('dialog'));
    return sheet;
  };
  const arquivo = () => document.querySelector('input[type="file"][accept="image/*,application/pdf"]') as HTMLInputElement;
  const preencher = async (sheet: ReturnType<typeof within>, valor = '154,50', data = '2026-09-17') => {
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    fireEvent.change(arquivo(), { target: { files: [pngFile()] } });
    await sheet.findByText(/Não conseguimos ler o comprovante/);
    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: valor } });
    fireEvent.change(sheet.getByLabelText('Data do pagamento'), { target: { value: data } });
  };

  it('só habilita com arquivo, cobrança escolhida, valor e data', async () => {
    const sheet = await abrirEnvio();
    const enviar = sheet.getByRole('button', { name: /Enviar comprovante/ });
    expect(enviar).toBeDisabled();
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: '154,50' } });
    fireEvent.change(sheet.getByLabelText('Data do pagamento'), { target: { value: '2026-09-17' } });
    expect(enviar).toBeDisabled();
    fireEvent.change(arquivo(), { target: { files: [pngFile()] } });
    await waitFor(() => expect(enviar).toBeEnabled());
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    expect(enviar).toBeDisabled();
  });

  it('mostra o total devido hoje das cobranças marcadas', async () => {
    const sheet = await abrirEnvio();
    expect(sheet.queryByText(/Total devido hoje/)).toBeNull();
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);

    expect(sheet.getByText(/Total devido hoje:/)).toHaveTextContent('R$ 154,50');
  });

  it('leitura automática preenche valor, data e identificador (data futura é ignorada)', async () => {
    readReceipt.mockResolvedValue({ status: 'ok', stored: { raw: 'x' }, extracted: { amountCents: 15450, paidOn: '2026-12-31', identifier: 'E123456' } });
    const sheet = await abrirEnvio();
    fireEvent.change(arquivo(), { target: { files: [pngFile()] } });

    expect(await sheet.findByText('Preenchemos o que conseguimos ler')).toBeInTheDocument();
    expect(sheet.getByLabelText('Valor pago')).toHaveValue('154,50');
    expect(sheet.getByLabelText('Data do pagamento')).toHaveValue('');
    expect(sheet.getByLabelText(/Identificador do Pix/)).toHaveValue('E123456');
  });

  it('leitura com data válida preenche a data e o envio leva o texto lido', async () => {
    readReceipt.mockResolvedValue({ status: 'ok', stored: { raw: 'x' }, extracted: { amountCents: 15450, paidOn: '2026-09-17', identifier: 'E123456' } });
    const sheet = await abrirEnvio();
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    fireEvent.change(arquivo(), { target: { files: [pngFile()] } });
    await waitFor(() => expect(sheet.getByLabelText('Data do pagamento')).toHaveValue('2026-09-17'));
    fireEvent.change(sheet.getByLabelText(/^Observação/), { target: { value: '  paguei pelo app  ' } });
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));

    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(1));
    expect(api.submitReceipt.mock.calls[0][0]).toMatchObject({ declaredAmountCents: 15450, declaredPaidOn: '2026-09-17', reference: 'E123456', note: 'paguei pelo app', ocrStatus: 'ok', ocr: { raw: 'x' } });
  });

  it('sem identificador nem observação envia null', async () => {
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));

    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(1));
    expect(api.submitReceipt.mock.calls[0][0]).toMatchObject({ reference: null, note: null, replaces: null, ocr: null });
  });

  it('orienta (sem impedir) quando o valor não confere: insuficiente e depois exato', async () => {
    api.chargeStatementsByIds.mockResolvedValue([charge()]);
    const sheet = await abrirEnvio();
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: '100' } });
    fireEvent.change(sheet.getByLabelText('Data do pagamento'), { target: { value: '2026-09-17' } });

    expect(await sheet.findByText('Confira antes de enviar')).toBeInTheDocument();
    expect(sheet.getByText(/Valor insuficiente: faltam R\$ 54,50/)).toBeInTheDocument();
    expect(api.chargeStatementsByIds).toHaveBeenLastCalledWith(['c1'], '2026-09-17');

    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: '154,50' } });
    expect(await sheet.findByText(/O valor confere com o total devido/)).toBeInTheDocument();
    expect(sheet.queryByText(/Valor insuficiente/)).toBeNull();
  });

  it('sem data não confere nada (nenhuma consulta)', async () => {
    const sheet = await abrirEnvio();
    fireEvent.click(sheet.getAllByRole('checkbox')[0]);
    fireEvent.change(sheet.getByLabelText('Valor pago'), { target: { value: '100' } });

    expect(api.chargeStatementsByIds).not.toHaveBeenCalled();
    expect(sheet.queryByText('Confira antes de enviar')).toBeNull();
  });

  it.each([
    [{ id: 's1', auto_approved: true }, 'Pagamento identificado e baixado!', 'O OCR conferiu os dados e o financeiro foi atualizado automaticamente.'],
    [{ id: 's1', possible_duplicate: true }, 'Comprovante enviado!', 'Este arquivo já tinha sido enviado antes; o clube vai conferir.'],
    [{ id: 's1', possible_duplicate: false }, 'Comprovante enviado!', 'O clube vai conferir o pagamento e você será avisado.'],
  ])('resposta %j avisa "%s"', async (resposta, titulo, descricao) => {
    api.submitReceipt.mockResolvedValue(resposta);
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));

    await waitFor(() => expect(sucesso).toHaveBeenCalledWith(titulo, { description: descricao }));
  });

  it('depois de enviar fecha a folha, limpa a seleção e recarrega cobranças, comprovantes, créditos e pendências', async () => {
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(api.myCharges).toHaveBeenCalledTimes(2));
    expect(api.myReceipts).toHaveBeenCalledTimes(2);
    expect(api.listCredits).toHaveBeenCalledTimes(2);
    expect(api.listPendencyMeta).toHaveBeenCalledTimes(2);
  });

  it('falha no envio mantém a folha e os dados, avisa o erro e libera o botão', async () => {
    const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    api.submitReceipt.mockRejectedValueOnce(new Error('rede caiu'));
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));

    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(sheet.getByLabelText('Valor pago')).toHaveValue('154,50');
    await waitFor(() => expect(sheet.getByRole('button', { name: /Enviar comprovante/ })).toBeEnabled());
  });

  it('o mesmo envio repetido depois de uma falha reaproveita a chave (não duplica)', async () => {
    api.submitReceipt.mockRejectedValueOnce(new Error('rede caiu')).mockResolvedValueOnce({ id: 's1', possible_duplicate: false });
    vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));
    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sheet.getByRole('button', { name: /Enviar comprovante/ })).toBeEnabled());
    fireEvent.click(sheet.getByRole('button', { name: /Enviar comprovante/ }));
    await waitFor(() => expect(api.submitReceipt).toHaveBeenCalledTimes(2));

    const [primeiro, segundo] = api.submitReceipt.mock.calls.map(([a]) => a);
    expect(segundo.requestId).toBe(primeiro.requestId);
    expect(segundo.submissionId).toBe(primeiro.submissionId);
  });

  it('reabrir o envio começa limpo: sem arquivo, valor, data nem cobranças marcadas', async () => {
    const sheet = await abrirEnvio();
    await preencher(sheet);
    fireEvent.click(sheet.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Enviar comprovante/ }));
    const reaberta = within(await screen.findByRole('dialog'));
    expect(reaberta.getByLabelText('Valor pago')).toHaveValue('');
    expect(reaberta.getByLabelText('Data do pagamento')).toHaveValue('');
    expect(reaberta.getAllByRole('checkbox')[0]).not.toBeChecked();
    expect(reaberta.queryByText(/Não conseguimos ler/)).toBeNull();
  });

  it('sem cobranças a pagar a lista do envio diz isso', async () => {
    api.myCharges.mockResolvedValue([charge({ display_status: 'paid', stored_status: 'paid', total_due_cents: 0 })]);
    mount();
    await screen.findByText('Tudo em dia');

    expect(screen.getByRole('button', { name: /Enviar comprovante/ })).toBeDisabled();
  });
});
