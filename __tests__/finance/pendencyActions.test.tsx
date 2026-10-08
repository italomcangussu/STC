import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinAccount, FinCategory, FinSettings, MemberPendencyMeta } from '../../lib/finance/types';

// Caracteriza as ações de Pendências de sócios (nova pendência, pagar, cobrar, cancelar) e o resumo da régua
// pela porta pública da aba, para a divisão do arquivo não mudar nenhuma chamada ao banco.
const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  saveSettings: vi.fn(), listCharges: vi.fn(), listPendencyMeta: vi.fn(), listActiveMembers: vi.fn(), createMemberPendency: vi.fn(),
  sendPendencyNow: vi.fn(), setPendencyCollection: vi.fn(), registerPayment: vi.fn(), cancelCharge: vi.fn(),
  listHolidays: vi.fn(), listAudit: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import PendenciesTab from '../../components/finance/tabs/PendenciesTab';
import { notify } from '../../lib/notifications';

const account = { id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1 } as FinAccount;
const categories = [{ id: 'cat-day', system_key: 'day_card', name: 'Day Card' }, { id: 'cat-pend', system_key: 'member_pendency', name: 'Pendência de sócio' }] as unknown as FinCategory[];

const settings = (over: Partial<FinSettings> = {}): FinSettings => ({
  id: true, due_day: 5, due_month_offset: 0, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: null, interest_daily_fixed_cents: null, interest_daily_percent_bps: null, late_fee_confirmed_at: null,
  late_fee_confirmed_by: null, day_card_price_cents: 5000, day_card_in_cash: false, payee_names: [],
  pix_key: '52.393.541/0001-20', pendency_automation_enabled: true, pendency_reminder_days: [0, 3, 7, 14, 21], pendency_grace_days: 0,
  pendency_fine_fixed_cents: 0, pendency_fine_percent_bps: 0, pendency_interest_daily_fixed_cents: 0, pendency_interest_daily_percent_bps: 0,
  version: 3, updated_at: '2026-10-01T00:00:00Z', ...over,
} as FinSettings);

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

const mount = (s: FinSettings = settings(), accounts: FinAccount[] = [account]) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts, categories, settings: s, reload: vi.fn(), go: vi.fn() }}><PendenciesTab /></FinanceProvider>
  </ConfirmProvider>,
);

const KEY = expect.stringMatching(/^[0-9a-f-]{36}$/);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z')); // "hoje" no clube: 06/10/2026
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listCharges.mockResolvedValue([stmt()]);
  api.listPendencyMeta.mockResolvedValue([meta()]);
  api.listActiveMembers.mockResolvedValue([{ id: 'u1', name: 'Ana Sócia', phone: null }, { id: 'u2', name: 'Beto Sócio', phone: null }]);
  for (const fn of [api.createMemberPendency, api.sendPendencyNow, api.setPendencyCollection, api.registerPayment, api.cancelCharge]) fn.mockResolvedValue({});
  api.listHolidays.mockResolvedValue([]);
  api.listAudit.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const openPendency = async (text = 'Day Card do convidado Carlos') => {
  fireEvent.click(await screen.findByText(text));
  return within(await screen.findByRole('dialog'));
};

const openNew = async () => {
  mount();
  await screen.findByText('Day Card do convidado Carlos');
  fireEvent.click(screen.getByRole('button', { name: /Nova pendência/ }));
  const sheet = within(await screen.findByRole('dialog'));
  await sheet.findByRole('option', { name: 'Beto Sócio' });
  return sheet;
};

const fillBasics = (sheet: ReturnType<typeof within>, description = 'Consumo do bar') => {
  fireEvent.change(sheet.getByLabelText(/^Sócio/), { target: { value: 'u2' } });
  fireEvent.change(sheet.getByLabelText(/^Motivo/), { target: { value: 'consumo' } });
  fireEvent.change(sheet.getByLabelText(/^Descrição/), { target: { value: description } });
};

describe('Pendência — extrato e ações', () => {
  it('mostra valor, saldo e o convidado do Day Card', async () => {
    mount();
    const dlg = await openPendency();

    expect(dlg.getByText('Valor original').nextSibling).toHaveTextContent('R$ 50,00');
    expect(dlg.getByText('Saldo').nextSibling).toHaveTextContent('R$ 50,00');
    expect(dlg.getByText(/Convidado:/)).toHaveTextContent('Convidado: Carlos. Visita: 05/10/2026.');
  });

  it('registrar pagamento: valor sugerido é o saldo, conta padrão, pix, hoje; fecha e recarrega', async () => {
    mount();
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    expect(dlg.getByLabelText(/^Valor/)).toHaveValue('50,00');
    fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(api.registerPayment).toHaveBeenCalledWith('c1', 5000, '2026-10-06', 'pix', 'a1', null, KEY));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listCharges).toHaveBeenCalledTimes(2);
    expect(api.listPendencyMeta).toHaveBeenCalledTimes(2);
  });

  it('sem conta o pagamento não confirma', async () => {
    mount(settings(), []);
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));

    expect(dlg.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('cancelar pede motivo de 5+ caracteres', async () => {
    mount();
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: 'Cancelar pendência' }));
    const cancelar = dlg.getByRole('button', { name: 'Cancelar pendência' });
    expect(cancelar).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Motivo do cancelamento'), { target: { value: 'Lançada por engano' } });
    fireEvent.click(cancelar);

    await waitFor(() => expect(api.cancelCharge).toHaveBeenCalledWith('c1', 'Lançada por engano', KEY));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('com pagamento já feito não oferece cancelar', async () => {
    api.listCharges.mockResolvedValue([stmt({ principal_paid_cents: 1000, principal_remaining_cents: 4000, total_due_cents: 4000, display_status: 'partial', stored_status: 'partial' })]);
    mount();
    const dlg = await openPendency();

    expect(dlg.queryByRole('button', { name: 'Cancelar pendência' })).toBeNull();
    expect(dlg.getByRole('button', { name: 'Registrar pagamento' })).toBeInTheDocument();
  });

  it('pendência cancelada não oferece ação nenhuma', async () => {
    api.listCharges.mockResolvedValue([stmt({ stored_status: 'canceled', display_status: 'canceled', total_due_cents: 0 })]);
    mount();
    const dlg = await openPendency();

    expect(dlg.queryByRole('button', { name: /Registrar pagamento|Cobrar agora|Pausar|Reativar|Cancelar pendência/ })).toBeNull();
  });

  it('quitada: nada a cobrar nem a pagar, e não dá para cancelar', async () => {
    api.listCharges.mockResolvedValue([stmt({ stored_status: 'paid', display_status: 'paid', total_due_cents: 0, principal_paid_cents: 5000, principal_remaining_cents: 0 })]);
    mount();
    const dlg = await openPendency();

    expect(dlg.queryByRole('button', { name: /Registrar pagamento|Cobrar agora|Pausar cobrança|Cancelar pendência/ })).toBeNull();
  });

  it('comprovante em análise segura o "Cobrar agora" e mostra o selo', async () => {
    api.listCharges.mockResolvedValue([stmt({ in_review: true, display_status: 'in_review' })]);
    mount();
    const dlg = await openPendency();

    expect(dlg.getByText('Comprovante em análise')).toBeInTheDocument();
    expect(dlg.getByRole('button', { name: /Cobrar agora/ })).toBeDisabled();
  });

  it('pausar a cobrança automática chama a régua e avisa', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    mount();
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: /Pausar cobrança/ }));

    await waitFor(() => expect(api.setPendencyCollection).toHaveBeenCalledWith('c1', false, KEY));
    expect(sucesso).toHaveBeenCalledWith('Cobrança automática pausada.');
  });

  it('cobrar agora avisa que entrou na fila', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    mount();
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: /Cobrar agora/ }));

    await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Cobrança adicionada à fila do WhatsApp.'));
  });

  it('falha ao cobrar mantém a folha aberta e avisa o erro', async () => {
    const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    api.sendPendencyNow.mockRejectedValueOnce(new Error('rede caiu'));
    mount();
    const dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: /Cobrar agora/ }));

    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.listCharges).toHaveBeenCalledTimes(1);
  });

  it('abrir outra pendência não herda o formulário da anterior', async () => {
    api.listCharges.mockResolvedValue([stmt(), stmt({ charge_id: 'c2', profile_id: 'u2', profile_name: 'Beto Sócio', total_due_cents: 1200, original_amount_cents: 1200 })]);
    api.listPendencyMeta.mockResolvedValue([meta(), meta({ id: 'c2', profile_id: 'u2', description: 'Consumo do bar', pendency_kind: 'consumo', guest_name: null, guest_date: null })]);
    mount();
    let dlg = await openPendency();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    fireEvent.click(dlg.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dlg = await openPendency('Consumo do bar');
    expect(dlg.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    expect(dlg.getByLabelText(/^Valor/)).toHaveValue('12,00');
  });
});

describe('Nova pendência — salvar', () => {
  it('consumo sem enviar agora: dados normalizados e categoria genérica; limpa o formulário ao fechar', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    const sheet = await openNew();
    fillBasics(sheet, '  Consumo do bar  ');
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '12,50' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Criar pendência' }));

    await waitFor(() => expect(api.createMemberPendency).toHaveBeenCalledTimes(1));
    expect(api.createMemberPendency.mock.calls[0][0]).toEqual({
      profileId: 'u2', description: 'Consumo do bar', amountCents: 1250, competenceMonth: '2026-10-01', dueDate: '2026-10-06', pendencyKind: 'consumo',
      categoryId: 'cat-pend', guestName: null, guestDate: null, collectionEnabled: true, sendNow: false, alreadyPaid: false, paidOn: null, method: null, accountId: null,
    });
    expect(api.createMemberPendency.mock.calls[0][1]).toEqual(KEY);
    expect(sucesso).toHaveBeenCalledWith('Pendência criada.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listCharges).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Nova pendência/ }));
    const reaberta = within(await screen.findByRole('dialog'));
    await reaberta.findByRole('option', { name: 'Beto Sócio' });
    expect(reaberta.getByLabelText(/^Descrição/)).toHaveValue('');
    expect(reaberta.getByLabelText(/^Sócio/)).toHaveValue('');
  });

  it('enviar agora: o aviso diz que a cobrança entrou na fila do WhatsApp', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    const sheet = await openNew();
    fillBasics(sheet);
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '10' } });
    fireEvent.click(sheet.getByLabelText(/Enviar cobrança agora/));
    fireEvent.click(sheet.getByRole('button', { name: 'Criar pendência' }));

    await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Pendência criada. A cobrança entrou na fila do WhatsApp.'));
    expect(api.createMemberPendency.mock.calls[0][0]).toMatchObject({ sendNow: true, collectionEnabled: true });
  });

  it('cobrança automática desligada: não envia agora e grava collectionEnabled falso', async () => {
    const sheet = await openNew();
    fillBasics(sheet);
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '10' } });
    fireEvent.click(sheet.getByLabelText(/Cobrança automática habilitada/));

    expect(sheet.getByLabelText(/Enviar cobrança agora/)).toBeDisabled();
    fireEvent.click(sheet.getByRole('button', { name: 'Criar pendência' }));
    await waitFor(() => expect(api.createMemberPendency).toHaveBeenCalled());
    expect(api.createMemberPendency.mock.calls[0][0]).toMatchObject({ collectionEnabled: false, sendNow: false });
  });

  it('já foi pago: grava data, forma e conta; esconde "enviar agora"; avisa que registrou o pagamento', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    const sheet = await openNew();
    fillBasics(sheet);
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '10' } });
    fireEvent.click(sheet.getByLabelText(/Já foi pago/));

    expect(sheet.queryByLabelText(/Enviar cobrança agora/)).toBeNull();
    fireEvent.click(sheet.getByRole('button', { name: 'Criar pendência' }));
    await waitFor(() => expect(api.createMemberPendency).toHaveBeenCalled());
    expect(api.createMemberPendency.mock.calls[0][0]).toMatchObject({ alreadyPaid: true, paidOn: '2026-10-06', method: 'pix', accountId: 'a1', sendNow: false });
    expect(sucesso).toHaveBeenCalledWith('Pendência lançada e pagamento registrado.');
  });

  it('já foi pago exige a conta onde o dinheiro entrou', async () => {
    mount(settings(), []);
    await screen.findByText('Day Card do convidado Carlos');
    fireEvent.click(screen.getByRole('button', { name: /Nova pendência/ }));
    const sheet = within(await screen.findByRole('dialog'));
    await sheet.findByRole('option', { name: 'Beto Sócio' });
    fillBasics(sheet);
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '10' } });
    expect(sheet.getByRole('button', { name: 'Criar pendência' })).toBeEnabled();
    fireEvent.click(sheet.getByLabelText(/Já foi pago/));

    expect(sheet.getByRole('button', { name: 'Criar pendência' })).toBeDisabled();
  });

  it('o valor do Day Card sugerido acompanha o motivo até a pessoa digitar outro valor', async () => {
    const sheet = await openNew();
    const valor = sheet.getByLabelText('Valor da pendência');
    expect(valor).toHaveValue('50,00');

    fireEvent.change(sheet.getByLabelText(/^Motivo/), { target: { value: 'consumo' } });
    expect(valor).toHaveValue('50,00');
    fireEvent.change(valor, { target: { value: '12' } });
    fireEvent.change(sheet.getByLabelText(/^Motivo/), { target: { value: 'day_card' } });
    expect(valor).toHaveValue('12');
  });

  it('descrição curta ou sem sócio, valor ou categoria impede criar', async () => {
    const sheet = await openNew();
    const criar = sheet.getByRole('button', { name: 'Criar pendência' });
    fireEvent.change(sheet.getByLabelText(/^Sócio/), { target: { value: 'u2' } });
    fireEvent.change(sheet.getByLabelText(/^Descrição/), { target: { value: 'ab' } });
    expect(criar).toBeDisabled();
    fireEvent.change(sheet.getByLabelText(/^Descrição/), { target: { value: 'abc' } });
    expect(criar).toBeEnabled();
    fireEvent.change(sheet.getByLabelText('Valor da pendência'), { target: { value: '' } });
    expect(criar).toBeDisabled();
  });

  it('falha ao criar mantém a folha e o que foi digitado', async () => {
    const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    api.createMemberPendency.mockRejectedValueOnce(new Error('rede caiu'));
    const sheet = await openNew();
    fillBasics(sheet);
    fireEvent.click(sheet.getByRole('button', { name: 'Criar pendência' }));

    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
    expect(sheet.getByLabelText(/^Descrição/)).toHaveValue('Consumo do bar');
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Criar pendência' })).toBeEnabled());
  });
});

describe('Pendências — lista e resumo da régua', () => {
  it.each([
    [[0, 3, 7], 'No vencimento, +3 e +7 dias'],
    [[0], 'No vencimento'],
    [[3], '+3 dias'],
    [[], 'Nenhum envio'],
  ])('envios %j aparecem como "%s"', async (days, texto) => {
    mount(settings({ pendency_reminder_days: days }));
    await screen.findByText('Day Card do convidado Carlos');

    expect(screen.getByText(texto)).toBeInTheDocument();
  });

  it('multa fixa + percentual e juros aparecem formatados; sem encargos diz que não cobra', async () => {
    mount(settings({ pendency_fine_fixed_cents: 500, pendency_fine_percent_bps: 200, pendency_interest_daily_percent_bps: 3 }));
    await screen.findByText('Day Card do convidado Carlos');

    expect(screen.getByText('R$ 5,00 + 2%')).toBeInTheDocument();
    expect(screen.getByText('0,03%')).toBeInTheDocument();
  });

  it('sem multa nem juros: "Não cobra"; sem PIX: "Não configurada"', async () => {
    mount(settings({ pix_key: '  ' }));
    await screen.findByText('Day Card do convidado Carlos');

    expect(screen.getByText('Não cobra')).toBeInTheDocument();
    expect(screen.getByText('Não configurada')).toBeInTheDocument();
  });

  it('o saldo em aberto soma só o que não está quitado nem cancelado, e o vencido à parte', async () => {
    api.listCharges.mockResolvedValue([
      stmt({ charge_id: 'c1', total_due_cents: 5000 }),
      stmt({ charge_id: 'c2', total_due_cents: 1200, display_status: 'overdue', overdue: true }),
      stmt({ charge_id: 'c3', total_due_cents: 800, stored_status: 'paid', display_status: 'paid' }),
      stmt({ charge_id: 'c4', total_due_cents: 700, stored_status: 'canceled', display_status: 'canceled' }),
    ]);
    api.listPendencyMeta.mockResolvedValue(['c1', 'c2', 'c3', 'c4'].map((id) => meta({ id, description: `Pendência ${id}` })));
    mount();
    await screen.findByText('Pendência c1');

    expect(screen.getByText('Saldo em aberto').nextSibling).toHaveTextContent('R$ 62,00');
    expect(screen.getByText('Vencido').nextSibling).toHaveTextContent('R$ 12,00');
  });

  it('trocar a situação refaz a consulta; falha mostra o aviso; lista vazia mostra o vazio', async () => {
    mount();
    await screen.findByText('Day Card do convidado Carlos');
    api.listCharges.mockRejectedValueOnce(new Error('falhou'));
    fireEvent.click(screen.getByRole('tab', { name: 'Vencidas' }));
    expect(await screen.findByText('Não foi possível carregar as pendências.')).toBeInTheDocument();
    expect(api.listCharges).toHaveBeenLastCalledWith({ chargeType: 'member_pendency', status: 'overdue' }, 5000);

    api.listCharges.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Pagas' }));
    expect(await screen.findByText('Nenhuma pendência neste filtro')).toBeInTheDocument();
  });

  it('o tipo da pendência aparece por extenso na linha', async () => {
    api.listPendencyMeta.mockResolvedValue([meta({ pendency_kind: 'dano_reposicao', description: 'Raquete quebrada' })]);
    mount();

    expect(await screen.findByText(/Dano \/ reposição · competência outubro de 2026 · vence 07\/10\/2026/)).toBeInTheDocument();
  });
});
