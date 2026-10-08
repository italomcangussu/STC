import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeStatementRow, FinAccount, FinSettings, MemberCreditRow } from '../../lib/finance/types';

// Caracteriza as ações de Mensalidades (cobrança, plano, crédito) pela porta pública da aba,
// para a divisão do arquivo em peças menores não mudar nenhuma chamada ao banco.
const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  adjustCharge: vi.fn(), cancelCharge: vi.fn(), chargeHistory: vi.fn(), createPlan: vi.fn(), endPlan: vi.fn(), generateCharges: vi.fn(),
  listCharges: vi.fn(), listCredits: vi.fn(), listHolidays: vi.fn(), listMembersWithoutPlan: vi.fn(), listPlanPrices: vi.fn(), listPlans: vi.fn(),
  profileNames: vi.fn(), registerPayment: vi.fn(), resolveCredit: vi.fn(), reversePayment: vi.fn(), setPlanPrice: vi.fn(), updatePlan: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import MembersTab from '../../components/finance/tabs/MembersTab';
import { notify } from '../../lib/notifications';

const settings = { id: true, due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, version: 1 } as FinSettings;
const account = { id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1 } as FinAccount;

const charge = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15000, fees_configured: false, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'payment', method: 'pix', paid_on: '2026-09-08', amount_cents: 15000, principal_cents: 15000, fine_cents: 0, interest_cents: 0,
  excess_cents: 0, note: null, created_at: '2026-09-08T10:00:00Z', ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'pl1', profile_id: 'u1', start_on: '2026-01-10', ended_on: null, status: 'active', period_months: 1, version: 3, end_reason: null,
  profile: { name: 'João da Silva', avatar_url: null, is_active: true }, ...over,
});

const mount = (accounts: FinAccount[] = [account]) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts, categories: [], settings, reload: vi.fn(), go: vi.fn() }}><MembersTab /></FinanceProvider>
  </ConfirmProvider>,
);

const KEY = expect.stringMatching(/^[0-9a-f-]{36}$/);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z')); // "hoje" no clube: 06/10/2026
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listCharges.mockResolvedValue([charge()]);
  api.chargeHistory.mockResolvedValue({ payments: [], adjustments: [] });
  api.listPlans.mockResolvedValue([plan()]);
  api.listPlanPrices.mockResolvedValue([{ id: 'pr1', plan_id: 'pl1', effective_from: '2026-01-01', amount_cents: 15000, reason: 'Início' }]);
  api.listCredits.mockResolvedValue([]);
  api.listHolidays.mockResolvedValue([]);
  api.listMembersWithoutPlan.mockResolvedValue([{ id: 'u7', name: 'Beto Novo' }]);
  api.profileNames.mockResolvedValue({});
  for (const fn of [api.registerPayment, api.adjustCharge, api.cancelCharge, api.reversePayment, api.updatePlan, api.resolveCredit]) fn.mockResolvedValue({});
  api.generateCharges.mockResolvedValue({ created: 2, missing_price: 0 });
  api.setPlanPrice.mockResolvedValue({ repriced_charges: 2 });
  api.endPlan.mockResolvedValue({ canceled_charges: 1 });
  api.createPlan.mockResolvedValue({ id: 'pl-new' });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const openCharge = async (name = 'Ana Sócia') => {
  fireEvent.click(await screen.findByText(name));
  return within(await screen.findByRole('dialog'));
};
const goPlans = async () => { fireEvent.click(await screen.findByRole('tab', { name: 'Sócios e valores' })); };
const confirmDialog = async (label: string) => fireEvent.click(await screen.findByRole('button', { name: label }));

describe('Cobrança — registrar pagamento', () => {
  it('preenche o total devido, usa a conta padrão e envia pix/hoje; fecha a folha e recarrega a lista', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    expect(dlg.getByLabelText('Valor recebido')).toHaveValue('150,00');
    fireEvent.change(dlg.getByLabelText(/^Observação/), { target: { value: 'Pix na recepção' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => expect(api.registerPayment).toHaveBeenCalledWith('c1', 15000, '2026-10-06', 'pix', 'a1', 'Pix na recepção', KEY));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listCharges).toHaveBeenCalledTimes(2);
  });

  it('sem observação envia null e o valor digitado vence o sugerido', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    fireEvent.change(dlg.getByLabelText('Valor recebido'), { target: { value: '100' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => expect(api.registerPayment).toHaveBeenCalledWith('c1', 10000, '2026-10-06', 'pix', 'a1', null, KEY));
  });

  it('falha do banco mantém a folha aberta, avisa o erro e libera o botão para tentar de novo', async () => {
    const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    api.registerPayment.mockRejectedValueOnce(new Error('rede caiu'));
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    fireEvent.click(dlg.getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(dlg.getByRole('button', { name: 'Confirmar pagamento' })).toBeEnabled());
    expect(api.listCharges).toHaveBeenCalledTimes(1);
  });

  it('"Voltar" desfaz o formulário e mostra de novo as ações', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    fireEvent.click(dlg.getByRole('button', { name: 'Voltar' }));

    expect(dlg.getByRole('button', { name: 'Registrar pagamento' })).toBeInTheDocument();
    expect(dlg.queryByRole('button', { name: 'Confirmar pagamento' })).toBeNull();
  });
});

describe('Cobrança — desconto, acréscimo e dispensa', () => {
  it('acréscimo: tipo "increase", confirmação com o título certo', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: /Desconto \/ acréscimo/ }));
    fireEvent.change(dlg.getByLabelText(/^Tipo/), { target: { value: 'increase' } });
    fireEvent.change(dlg.getByLabelText(/^Valor/), { target: { value: '10' } });
    fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'Taxa de reposição' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar' }));

    expect(await screen.findByText('Lançar este acréscimo?')).toBeInTheDocument();
    await confirmDialog('Confirmar');
    await waitFor(() => expect(api.adjustCharge).toHaveBeenCalledWith('c1', 'increase', 1000, 'Taxa de reposição', KEY));
  });

  it('recusar a confirmação não grava nada', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: /Desconto \/ acréscimo/ }));
    fireEvent.change(dlg.getByLabelText(/^Valor/), { target: { value: '10' } });
    fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'Bolsa aprovada' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar' }));

    expect(await screen.findByText('Conceder este desconto?')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Conceder este desconto?')).toBeNull());
    expect(api.adjustCharge).not.toHaveBeenCalled();
  });

  it('dispensa de encargos: o valor sugerido são os encargos devidos', async () => {
    api.listCharges.mockResolvedValue([charge({ fees_due_cents: 800, total_due_cents: 15800, fees_configured: true, display_status: 'overdue' })]);
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Dispensar encargos' }));
    expect(dlg.getByLabelText(/^Valor/)).toHaveValue('8,00');
    fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'Atraso por erro do clube' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar' }));

    expect(await screen.findByText('Dispensar estes encargos?')).toBeInTheDocument();
    await confirmDialog('Confirmar');
    await waitFor(() => expect(api.adjustCharge).toHaveBeenCalledWith('c1', 'fee_waiver', 800, 'Atraso por erro do clube', KEY));
  });
});

describe('Cobrança — cancelar e estornar', () => {
  it('sem pagamento, cancela com motivo de 5+ caracteres', async () => {
    mount();
    const dlg = await openCharge();
    fireEvent.click(dlg.getByRole('button', { name: 'Cancelar cobrança' }));
    const cancel = dlg.getByRole('button', { name: 'Cancelar cobrança' });
    expect(cancel).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/^Motivo/), { target: { value: 'Sócio saiu' } });
    fireEvent.click(cancel);

    await waitFor(() => expect(api.cancelCharge).toHaveBeenCalledWith('c1', 'Sócio saiu', KEY));
  });

  it('com pagamento, oferece estornar o último (e não cancelar); estorno exige motivo', async () => {
    api.listCharges.mockResolvedValue([charge({ stored_status: 'paid', display_status: 'paid', principal_paid_cents: 15000, principal_remaining_cents: 0, total_due_cents: 0 })]);
    api.chargeHistory.mockResolvedValue({ payments: [payment()], adjustments: [] });
    mount();
    const dlg = await openCharge();
    fireEvent.click(await dlg.findByRole('button', { name: 'Estornar último pagamento' }));

    expect(dlg.getByText('Estornar pagamento de R$ 150,00 (08/09/2026)')).toBeInTheDocument();
    const estornar = dlg.getByRole('button', { name: 'Estornar' });
    expect(estornar).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/^Motivo/), { target: { value: 'Pix devolvido' } });
    fireEvent.click(estornar);

    await waitFor(() => expect(api.reversePayment).toHaveBeenCalledWith('p1', 'Pix devolvido', KEY));
  });

  it('pagamento já estornado não é "o último": volta a poder cancelar a cobrança', async () => {
    api.chargeHistory.mockResolvedValue({
      payments: [payment(), payment({ id: 'r1', kind: 'reversal', paid_on: '2026-09-09', created_at: '2026-09-09T10:00:00Z' })],
      adjustments: [],
    });
    mount();
    const dlg = await openCharge();

    expect(await dlg.findByRole('button', { name: 'Cancelar cobrança' })).toBeInTheDocument();
    expect(dlg.queryByRole('button', { name: 'Estornar último pagamento' })).toBeNull();
  });

  it('cobrança cancelada não oferece nenhuma ação', async () => {
    api.listCharges.mockResolvedValue([charge({ stored_status: 'canceled', display_status: 'canceled', total_due_cents: 0 })]);
    mount();
    const dlg = await openCharge();

    expect(dlg.queryByRole('button', { name: /Registrar pagamento|Desconto|Dispensar|Estornar|Cancelar cobrança/ })).toBeNull();
  });

  it('abrir outra cobrança não herda o formulário nem o valor da anterior', async () => {
    api.listCharges.mockResolvedValue([charge(), charge({ charge_id: 'c2', profile_name: 'Bia Sócia', total_due_cents: 9000, original_amount_cents: 9000 })]);
    mount();
    let dlg = await openCharge('Ana Sócia');
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    expect(dlg.getByLabelText('Valor recebido')).toHaveValue('150,00');
    fireEvent.click(dlg.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dlg = await openCharge('Bia Sócia');
    expect(dlg.queryByRole('button', { name: 'Confirmar pagamento' })).toBeNull();
    fireEvent.click(dlg.getByRole('button', { name: 'Registrar pagamento' }));
    expect(dlg.getByLabelText('Valor recebido')).toHaveValue('90,00');
  });
});

describe('Cobrança — extrato e histórico', () => {
  it('mostra os valores, os encargos configurados e o total a pagar', async () => {
    api.listCharges.mockResolvedValue([charge({ fees_configured: true, fine_due_cents: 300, interest_due_cents: 200, fees_due_cents: 500, total_due_cents: 15500, days_late: 4, display_status: 'overdue' })]);
    mount();
    const dlg = await openCharge();

    expect(dlg.getByText('Multa devida').nextSibling).toHaveTextContent('R$ 3,00');
    expect(dlg.getByText('Juros devidos').nextSibling).toHaveTextContent('R$ 2,00');
    expect(dlg.getByText('Total a pagar').nextSibling).toHaveTextContent('R$ 155,00');
    expect(dlg.getByText('Dias de atraso').nextSibling).toHaveTextContent('4');
  });

  it('sem encargos configurados avisa onde configurar', async () => {
    mount();
    const dlg = await openCharge();

    expect(dlg.getByText(/Encargos de atraso não configurados/)).toBeInTheDocument();
    expect(dlg.queryByText('Multa devida')).toBeNull();
  });

  it('lista pagamentos (com principal, encargos e crédito), estornos e ajustes', async () => {
    api.chargeHistory.mockResolvedValue({
      payments: [payment({ principal_cents: 14000, fine_cents: 300, interest_cents: 200, excess_cents: 500, amount_cents: 15000, note: 'balcão' }), payment({ id: 'r1', kind: 'reversal', amount_cents: 1000, paid_on: '2026-09-09', method: 'cash' })],
      adjustments: [
        { id: 'a1', kind: 'discount', amount_cents: 1000, reason: 'Bolsa', created_at: '2026-09-01T10:00:00Z' },
        { id: 'a2', kind: 'increase', amount_cents: 500, reason: 'Reposição', created_at: '2026-09-02T10:00:00Z' },
        { id: 'a3', kind: 'fee_waiver', amount_cents: 300, reason: 'Erro do clube', created_at: '2026-09-03T10:00:00Z' },
      ],
    });
    mount();
    const dlg = await openCharge();

    expect(await dlg.findByText(/principal R\$ 140,00, encargos R\$ 5,00, crédito R\$ 5,00/)).toBeInTheDocument();
    expect(dlg.getByText(/balcão/)).toBeInTheDocument();
    expect(dlg.getByText('Estorno')).toBeInTheDocument();
    expect(dlg.getByText(/Bolsa/)).toHaveTextContent(/Desconto.*R\$ 10,00: Bolsa/);
    expect(dlg.getByText(/Reposição/)).toHaveTextContent(/Acréscimo.*R\$ 5,00: Reposição/);
    expect(dlg.getByText(/Erro do clube/)).toHaveTextContent(/Dispensa de encargos.*R\$ 3,00: Erro do clube/);
  });

  it('sem pagamentos nem ajustes diz isso', async () => {
    mount();
    const dlg = await openCharge();

    expect(await dlg.findByText('Sem pagamentos ou ajustes.')).toBeInTheDocument();
  });
});

describe('Gerar cobranças', () => {
  it('gera para todos, avisa o que faltou de preço e recarrega a lista', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    api.generateCharges.mockResolvedValue({ created: 3, missing_price: 1 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar cobranças/ }));

    await waitFor(() => expect(api.generateCharges).toHaveBeenCalledWith(null, KEY));
    expect(sucesso).toHaveBeenCalledWith('3 cobrança(s) gerada(s).', { description: '1 competência(s) sem preço definido não foram geradas.' });
    await waitFor(() => expect(api.listCharges).toHaveBeenCalledTimes(2));
  });

  it('quando não há nada novo, diz que já está tudo gerado', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    api.generateCharges.mockResolvedValue({ created: 0, missing_price: 0 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar cobranças/ }));

    await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Nada novo a gerar — tudo já está gerado.', { description: undefined }));
  });
});

describe('Plano — pausar, reajustar, encerrar', () => {
  it('pausa um plano ativo e retoma um pausado', async () => {
    api.listPlans.mockResolvedValueOnce([plan()]).mockResolvedValue([plan({ status: 'paused' })]); // depois de pausar, a lista recarregada já vem pausada
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenCalledWith('pl1', 3, { status: 'paused' }, KEY));

    fireEvent.click(await screen.findByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(api.updatePlan).toHaveBeenLastCalledWith('pl1', 3, { status: 'active' }, KEY));
  });

  it('reajuste vale a partir do mês seguinte, exige valor e motivo e conta as cobranças reprecificadas', async () => {
    const info = vi.spyOn(notify, 'info').mockImplementation(() => undefined as never);
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Reajustar valor' }));
    const enviar = screen.getByRole('button', { name: 'Reajustar' });
    expect(enviar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Novo valor'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Reajuste anual' } });
    expect(enviar).toBeEnabled();
    fireEvent.click(enviar);

    await waitFor(() => expect(api.setPlanPrice).toHaveBeenCalledWith('pl1', '2026-11-01', 18000, 'Reajuste anual', KEY));
    await waitFor(() => expect(info).toHaveBeenCalledWith('2 cobrança(s) futura(s) ainda intocada(s) passam ao novo valor.'));
    expect(api.listPlanPrices).toHaveBeenCalledTimes(2);
  });

  it('escolher o mês do reajuste muda a data enviada', async () => {
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Reajustar valor' }));
    fireEvent.change(screen.getByLabelText('A partir de'), { target: { value: '2027-02' } });
    fireEvent.change(screen.getByLabelText('Novo valor'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Nova tabela' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reajustar' }));

    await waitFor(() => expect(api.setPlanPrice).toHaveBeenCalledWith('pl1', '2027-02-01', 20000, 'Nova tabela', KEY));
  });

  it('encerrar o vínculo pede confirmação e envia o último dia (hoje por padrão) e o motivo', async () => {
    const info = vi.spyOn(notify, 'info').mockImplementation(() => undefined as never);
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: /Encerrar vínculo/ }));
    const encerrar = screen.getByRole('button', { name: 'Encerrar' });
    expect(encerrar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Mudou de cidade' } });
    fireEvent.click(encerrar);

    expect(await screen.findByText('Encerrar este vínculo?')).toBeInTheDocument();
    const botoes = await screen.findAllByRole('button', { name: 'Encerrar' });
    fireEvent.click(botoes[botoes.length - 1]);
    await waitFor(() => expect(api.endPlan).toHaveBeenCalledWith('pl1', '2026-10-06', 'Mudou de cidade', KEY));
    await waitFor(() => expect(info).toHaveBeenCalledWith('1 cobrança(s) futura(s) cancelada(s).'));
  });

  it('histórico de preços abre e lista valor e motivo', async () => {
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Histórico de preços' }));

    expect(await screen.findByText(/desde janeiro de 2026 — Início/)).toBeInTheDocument();
    expect(screen.getAllByText('R$ 150,00').length).toBeGreaterThan(0);
  });

  it('plano encerrado mostra quando e por quê, sem ações de edição, só o histórico', async () => {
    api.listPlans.mockResolvedValue([plan({ status: 'ended', ended_on: '2026-09-30', end_reason: 'Mudou de cidade' })]);
    mount();
    await goPlans();

    expect(await screen.findByText('Encerrada')).toBeInTheDocument();
    expect(screen.getByText(/encerrada em 30\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: Mudou de cidade')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pausar|Retomar|Reajustar valor|Encerrar vínculo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Histórico de preços' })).toBeInTheDocument();
  });

  it('plano trimestral mostra a periodicidade; pausado mostra o selo', async () => {
    api.listPlans.mockResolvedValue([plan({ status: 'paused', period_months: 3 })]);
    mount();
    await goPlans();

    expect(await screen.findByText('Pausada')).toBeInTheDocument();
    expect(screen.getByText(/a cada 3 meses/)).toBeInTheDocument();
  });
});

describe('Nova mensalidade — salvar', () => {
  it('cria o plano e gera as cobranças dele; avisa quantas nasceram', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    api.generateCharges.mockResolvedValue({ created: 2, missing_price: 0 });
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
    const dlg = within(await screen.findByRole('dialog'));
    await dlg.findByRole('option', { name: 'Beto Novo' });
    fireEvent.change(dlg.getByLabelText(/^Sócio/), { target: { value: 'u7' } });
    fireEvent.change(dlg.getByLabelText('Valor da mensalidade'), { target: { value: '150' } });
    fireEvent.change(dlg.getByLabelText(/^Periodicidade/), { target: { value: '3' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Criar e gerar cobranças' }));

    await waitFor(() => expect(api.createPlan).toHaveBeenCalledWith({ profile_id: 'u7', start_on: '2026-10-01', amount_cents: 15000, period_months: 3 }, KEY));
    expect(api.generateCharges).toHaveBeenCalledWith('pl-new');
    expect(sucesso).toHaveBeenCalledWith('Mensalidade criada.', { description: '2 cobrança(s) gerada(s).' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('só habilita com sócio e valor', async () => {
    mount();
    await goPlans();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova' }));
    const dlg = within(await screen.findByRole('dialog'));
    await dlg.findByRole('option', { name: 'Beto Novo' });

    expect(dlg.getByRole('button', { name: 'Criar e gerar cobranças' })).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/^Sócio/), { target: { value: 'u7' } });
    fireEvent.change(dlg.getByLabelText('Valor da mensalidade'), { target: { value: '150' } });
    expect(dlg.getByRole('button', { name: 'Criar e gerar cobranças' })).toBeEnabled();
  });
});

describe('Créditos — resolver', () => {
  const credit: MemberCreditRow = { id: 'k1', profile_id: 'u9', reason: 'duplicate', amount_cents: 12000, remaining_cents: 12000, status: 'open', resolution_note: null, created_at: '2026-10-01T10:00:00Z' };

  const openCredit = async () => {
    api.listCredits.mockResolvedValue([credit]);
    api.profileNames.mockResolvedValue({ u9: 'Carla Antiga' });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Créditos/ }));
    fireEvent.click(await screen.findByText('Carla Antiga'));
    return within(await screen.findByRole('dialog'));
  };

  it('mostra o motivo do crédito (duplicado) e a data', async () => {
    api.listCredits.mockResolvedValue([credit]);
    api.profileNames.mockResolvedValue({ u9: 'Carla Antiga' });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Créditos/ }));

    expect(await screen.findByText(/Pagamento duplicado · 01\/10\/2026/)).toBeInTheDocument();
  });

  it('aplica numa cobrança do sócio e fecha a folha recarregando créditos e cobranças', async () => {
    api.listCharges.mockImplementation(async (filters: { profileId?: string }) => (filters.profileId === 'u9' ? [charge({ charge_id: 'old', profile_id: 'u9' })] : []));
    const dlg = await openCredit();
    const opcao = await dlg.findByRole('option', { name: /150,00/ });
    fireEvent.change(dlg.getByLabelText(/^Cobrança/), { target: { value: (opcao as HTMLOptionElement).value } });
    fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(api.resolveCredit).toHaveBeenCalledWith('k1', 'apply', { charge_id: 'old' }, KEY));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listCredits).toHaveBeenCalledTimes(2);
  });

  it('devolver o dinheiro: conta padrão e observação de 3+ caracteres', async () => {
    const dlg = await openCredit();
    fireEvent.change(dlg.getByLabelText(/^O que fazer/), { target: { value: 'refund' } });
    const confirmar = dlg.getByRole('button', { name: 'Confirmar' });
    expect(confirmar).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/^Observação/), { target: { value: 'Pix de volta' } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.resolveCredit).toHaveBeenCalledWith('k1', 'refund', { account_id: 'a1', reason: 'Pix de volta' }, KEY));
  });

  it('baixar exige justificativa de 5+ caracteres', async () => {
    const dlg = await openCredit();
    fireEvent.change(dlg.getByLabelText(/^O que fazer/), { target: { value: 'void' } });
    const confirmar = dlg.getByRole('button', { name: 'Confirmar' });
    fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'abc' } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'Erro de lançamento' } });
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.resolveCredit).toHaveBeenCalledWith('k1', 'void', { reason: 'Erro de lançamento' }, KEY));
  });
});
