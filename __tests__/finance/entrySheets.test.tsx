import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryKind, FinAccount, FinCategory, FinEntry, FinSettings } from '../../lib/finance/types';

// Caracteriza as folhas de lançamento do financeiro (novo lançamento e o detalhe com pagar/receber, estornar, editar,
// cancelar e anexos) pela porta pública, para a divisão do arquivo não mudar nenhuma chamada ao banco.
const api = vi.hoisted(() => ({
  DOCS_BUCKET: 'fin-docs', newRequestId: () => globalThis.crypto.randomUUID(),
  cancelEntry: vi.fn(), createEntry: vi.fn(), listAttachments: vi.fn(), listEntryPayments: vi.fn(), payEntry: vi.fn(), removeAttachment: vi.fn(),
  reverseEntryPayment: vi.fn(), signedUrl: vi.fn(), updateEntry: vi.fn(), uploadAttachment: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import { EntrySheet, NewEntrySheet } from '../../components/finance/tabs/entries/EntrySheets';
import { notify } from '../../lib/notifications';

const KEY = expect.stringMatching(/^[0-9a-f-]{36}$/);

const acc = (id: string, name: string, over: Partial<FinAccount> = {}): FinAccount => ({ id, name, kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: false, active: true, position: 0, version: 1, ...over });
const accounts = [acc('a1', 'Banco do clube', { is_default_receipts: true }), acc('a2', 'Caixa'), acc('a3', 'Conta antiga', { active: false })];
const cat = (over: Partial<FinCategory>): FinCategory => ({ id: 'x', parent_id: null, name: 'x', kind: 'expense', dre_line: 'operational', system_key: null, active: true, position: 0, version: 1, ...over });
const categories: FinCategory[] = [
  cat({ id: 'k-rent', name: 'Aluguel' }),
  cat({ id: 'k-luz', name: 'Energia' }),
  cat({ id: 'k-sysx', name: 'Automática de despesa', system_key: 'auto_exp' }),
  cat({ id: 'k-none', name: 'Sem DRE', dre_line: 'none' }),
  cat({ id: 'k-off', name: 'Despesa antiga', active: false }),
  cat({ id: 'k-rev', name: 'Patrocínio', kind: 'revenue', dre_line: 'revenue' }),
  cat({ id: 'k-sys', name: 'Mensalidades de sócios', kind: 'revenue', dre_line: 'revenue', system_key: 'member_fees' }),
];
const settings = { pix_key: '', version: 1 } as unknown as FinSettings;

const entry = (kind: EntryKind, over: Partial<FinEntry> = {}): FinEntry => ({
  id: 'e1', kind, status: 'pending', display_status: 'pending', description: 'Conta de luz', supplier: null, category_id: kind === 'revenue' ? 'k-rev' : 'k-rent', amount_cents: 10000,
  paid_cents: 0, remaining_cents: 10000, competence_date: '2026-10-01', due_date: '2026-10-10', account_id: null, counter_account_id: null, recurrence_id: null,
  notes: null, adjustment_cents: 0, settled_on: null, cancel_reason: null, version: 4, ...over,
});
const paidEntry = (kind: EntryKind = 'expense', over: Partial<FinEntry> = {}) =>
  entry(kind, { status: 'paid', display_status: 'paid', paid_cents: 10000, remaining_cents: 0, ...over });

const payment = (over: Record<string, unknown> = {}) => ({ id: 'p1', kind: 'payment', paid_on: '2026-10-02', amount_cents: 10000, note: null, reverses_payment_id: null, ...over });
const attachment = (over: Record<string, unknown> = {}) => ({ id: 'at1', file_name: 'boleto.pdf', storage_path: 'e1/boleto.pdf', ...over });

const wrap = (ui: React.ReactElement) => (
  <ConfirmProvider><FinanceProvider value={{ accounts, categories, settings, reload: vi.fn(), go: vi.fn() }}>{ui}</FinanceProvider></ConfirmProvider>
);

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])], 'nota.png', { type: 'image/png' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z')); // "hoje" no clube: 06/10/2026
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listEntryPayments.mockResolvedValue([]);
  api.listAttachments.mockResolvedValue([]);
  for (const fn of [api.cancelEntry, api.createEntry, api.payEntry, api.removeAttachment, api.reverseEntryPayment, api.updateEntry, api.uploadAttachment]) fn.mockResolvedValue({});
  api.signedUrl.mockResolvedValue('https://exemplo.test/arquivo');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ------------------------------------------------------------------
describe('Novo lançamento', () => {
  const abrir = (direction?: 'pay' | 'receive') => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(wrap(<NewEntrySheet open onClose={onClose} onDone={onDone} direction={direction} />));
    return { onDone, onClose, dlg: within(screen.getByRole('dialog')) };
  };
  const registrar = (dlg: ReturnType<typeof within>) => fireEvent.click(dlg.getByRole('button', { name: 'Registrar' }));
  const preencher = (dlg: ReturnType<typeof within>, over: { desc?: string; valor?: string; categoria?: string } = {}) => {
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: over.desc ?? 'Conta de luz' } });
    fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: over.valor ?? '100' } });
    if (over.categoria !== '') fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: over.categoria ?? 'k-rent' } });
  };

  it('despesa pendente: datas de hoje, sem conta, categoria e vencimento enviados', async () => {
    const { dlg, onDone, onClose } = abrir();
    preencher(dlg);
    fireEvent.change(dlg.getByLabelText(/^Fornecedor/), { target: { value: '  Enel  ' } });
    fireEvent.change(dlg.getByLabelText(/^Observações/), { target: { value: ' pagar até dia 10 ' } });
    registrar(dlg);

    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toEqual({
      kind: 'expense', description: 'Conta de luz', supplier: 'Enel', category_id: 'k-rent', amount_cents: 10000, competence_date: '2026-10-06', due_date: '2026-10-06',
      status: 'pending', paid_on: null, paid_amount_cents: null, account_id: null, counter_account_id: null, notes: 'pagar até dia 10',
    });
    expect(api.createEntry.mock.calls[0][1]).toEqual(KEY);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('só aceita categorias de despesa ativas, manuais e que entram no DRE', () => {
    const { dlg } = abrir();
    const opcoes = [...(dlg.getByLabelText(/^Categoria/) as HTMLSelectElement).options].map((o) => o.textContent);

    expect(opcoes).toEqual(['Escolha…', 'Aluguel', 'Energia']);
  });

  it('já foi paga: lança como paga, com a data, a conta e o valor pago (que pode diferir do documento)', async () => {
    const { dlg } = abrir();
    preencher(dlg);
    fireEvent.click(dlg.getByLabelText('Já foi paga'));
    expect(dlg.getByRole('button', { name: 'Registrar' })).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Conta'), { target: { value: 'a2' } });
    fireEvent.change(dlg.getByLabelText(/^Valor pago/), { target: { value: '95' } });
    registrar(dlg);

    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ status: 'paid', paid_on: '2026-10-06', paid_amount_cents: 9500, account_id: 'a2', amount_cents: 10000 });
  });

  it('já foi paga sem mexer no valor pago usa o valor do documento', async () => {
    const { dlg } = abrir();
    preencher(dlg);
    fireEvent.click(dlg.getByLabelText('Já foi paga'));
    fireEvent.change(dlg.getByLabelText('Conta'), { target: { value: 'a1' } });
    registrar(dlg);

    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ paid_amount_cents: 10000 });
  });

  it('só oferece contas ativas', () => {
    const { dlg } = abrir();
    fireEvent.click(dlg.getByLabelText('Já foi paga'));
    const opcoes = [...(dlg.getByLabelText('Conta') as HTMLSelectElement).options].map((o) => o.textContent);

    expect(opcoes).toEqual(['Escolha…', 'Banco do clube', 'Caixa']);
  });

  it('retirada não é documento: nasce paga, sem categoria nem vencimento, e pede a conta', async () => {
    const { dlg } = abrir();
    fireEvent.change(dlg.getByLabelText('Tipo'), { target: { value: 'withdrawal' } });
    expect(dlg.getByText(/Retirada movimenta o caixa, mas não é receita nem despesa/)).toBeInTheDocument();
    expect(dlg.queryByLabelText(/^Categoria/)).toBeNull();
    expect(dlg.queryByLabelText('Vencimento')).toBeNull();
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'Retirada para o caixa' } });
    fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: '200' } });
    expect(dlg.getByRole('button', { name: 'Registrar' })).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Conta'), { target: { value: 'a1' } });
    registrar(dlg);

    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ kind: 'withdrawal', category_id: null, due_date: null, status: 'paid', paid_on: '2026-10-06', paid_amount_cents: null, account_id: 'a1', supplier: null });
  });

  it('transferência: conta de origem e de destino diferentes; o destino não lista a origem', async () => {
    const { dlg } = abrir();
    fireEvent.change(dlg.getByLabelText('Tipo'), { target: { value: 'transfer' } });
    expect(dlg.getByText(/Transferência move dinheiro entre contas do clube/)).toBeInTheDocument();
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'Banco para o caixa' } });
    fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: '300' } });
    fireEvent.change(dlg.getByLabelText('Conta de origem'), { target: { value: 'a1' } });
    const destinos = [...(dlg.getByLabelText('Conta de destino') as HTMLSelectElement).options].map((o) => o.value);
    expect(destinos).toEqual(['', 'a2']);
    expect(dlg.getByRole('button', { name: 'Registrar' })).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Conta de destino'), { target: { value: 'a2' } });
    registrar(dlg);

    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ kind: 'transfer', account_id: 'a1', counter_account_id: 'a2', status: 'paid', category_id: null });
  });

  it('trocar o tipo limpa a categoria escolhida', () => {
    const { dlg } = abrir();
    fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: 'k-rent' } });
    fireEvent.change(dlg.getByLabelText('Tipo'), { target: { value: 'withdrawal' } });
    fireEvent.change(dlg.getByLabelText('Tipo'), { target: { value: 'expense' } });

    expect(dlg.getByLabelText(/^Categoria/)).toHaveValue('');
  });

  it('só habilita com descrição de 2+ letras, valor, categoria e vencimento', () => {
    const { dlg } = abrir();
    const registrarBtn = dlg.getByRole('button', { name: 'Registrar' });
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'a' } });
    fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: '100' } });
    fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: 'k-rent' } });
    expect(registrarBtn).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'ab' } });
    expect(registrarBtn).toBeEnabled();
    fireEvent.change(dlg.getByLabelText('Vencimento'), { target: { value: '' } });
    expect(registrarBtn).toBeDisabled();
    fireEvent.change(dlg.getByLabelText('Vencimento'), { target: { value: '2026-10-20' } });
    fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: '' } });
    expect(registrarBtn).toBeDisabled();
  });

  it('receita: rótulos de quem recebe, categoria de receita e aviso próprio', async () => {
    const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
    const { dlg } = abrir('receive');
    expect(dlg.getByLabelText(/^Origem \/ pagador/)).toBeInTheDocument();
    expect(dlg.getByLabelText('Já foi recebida')).toBeInTheDocument();
    fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'Patrocínio do torneio' } });
    fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: '500' } });
    fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: 'k-rev' } });
    registrar(dlg);

    await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Receita registrada.'));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ kind: 'revenue', category_id: 'k-rev' });
  });

  it('aporte (entrada que não é documento) pede a conta e avisa que não é receita', () => {
    const { dlg } = abrir('receive');
    fireEvent.change(dlg.getByLabelText('Tipo'), { target: { value: 'contribution' } });

    expect(dlg.getByText(/Aporte movimenta o caixa, mas não é receita nem despesa/)).toBeInTheDocument();
    expect(dlg.getByLabelText('Conta')).toBeInTheDocument();
  });

  it('depois de registrar o formulário volta limpo; se falhar, mantém o que foi digitado', async () => {
    const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    api.createEntry.mockRejectedValueOnce(new Error('rede caiu'));
    const { dlg } = abrir();
    preencher(dlg);
    registrar(dlg);
    await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
    expect(dlg.getByLabelText('Descrição')).toHaveValue('Conta de luz');
    await waitFor(() => expect(dlg.getByRole('button', { name: 'Registrar' })).toBeEnabled());

    registrar(dlg);
    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(dlg.getByLabelText('Descrição')).toHaveValue(''));
    expect(api.createEntry.mock.calls[1][1]).toBe(api.createEntry.mock.calls[0][1]);
  });
});

// ------------------------------------------------------------------
describe('Detalhe do lançamento', () => {
  const abrir = (e: FinEntry) => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(wrap(<EntrySheet entry={e} onClose={onClose} onChanged={onChanged} />));
    return { onChanged, onClose, dlg: within(screen.getByRole('dialog')) };
  };

  it('mostra documento, pago, em aberto, fornecedor, observações e juros/desconto', async () => {
    const { dlg } = abrir(entry('expense', { supplier: 'Enel', notes: 'Fatura de setembro', paid_cents: 4000, remaining_cents: 6000, adjustment_cents: 150, status: 'partial', display_status: 'partial' }));

    expect(dlg.getByText('Valor do documento').nextSibling).toHaveTextContent('R$ 100,00');
    expect(dlg.getByText('Pago').nextSibling).toHaveTextContent('R$ 40,00');
    expect(dlg.getByText('Juros (+) ou desconto (−)').nextSibling).toHaveTextContent('R$ 1,50');
    expect(dlg.getByText('Em aberto').nextSibling).toHaveTextContent('R$ 60,00');
    expect(dlg.getByText('Fornecedor').nextSibling).toHaveTextContent('Enel');
    expect(dlg.getByText('Fatura de setembro')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(/competência 01\/10\/2026 · vence 10\/10\/2026/);
    await waitFor(() => expect(api.listEntryPayments).toHaveBeenCalledWith('e1'));
  });

  it('receita fala em "Recebido" e "Origem"; aporte não mostra pago nem em aberto', () => {
    const r = abrir(entry('revenue', { supplier: 'Loja X' }));
    expect(r.dlg.getByText('Recebido')).toBeInTheDocument();
    expect(r.dlg.getByText('Origem').nextSibling).toHaveTextContent('Loja X');
  });

  it('aporte (não é documento) esconde pago, em aberto e categoria', () => {
    const { dlg } = abrir(paidEntry('contribution', { category_id: null, due_date: null }));

    expect(dlg.queryByText('Em aberto')).toBeNull();
    expect(dlg.queryByText('Recebido')).toBeNull();
    expect(dlg.queryByText('Pago')).toBeNull();
  });

  it('lançamento cancelado mostra o motivo e não oferece ação nem anexar', () => {
    const { dlg } = abrir(entry('expense', { status: 'canceled', display_status: 'canceled', cancel_reason: 'Duplicado' }));

    expect(dlg.getByText('Cancelada: Duplicado')).toBeInTheDocument();
    expect(dlg.queryByRole('button', { name: /Pagar|Editar|Cancelar lançamento|Anexar/ })).toBeNull();
  });

  it('despesa pendente: pagar, editar e cancelar; transferência não edita; com pagamento não cancela', () => {
    const a = abrir(entry('expense'));
    expect(a.dlg.getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Pagar', 'Editar', 'Cancelar lançamento']));
  });

  it('transferência paga: sem pagar nem editar (só cancelar enquanto não houve dinheiro movimentado)', () => {
    const { dlg } = abrir(paidEntry('transfer', { paid_cents: 0, category_id: null, due_date: null }));

    expect(dlg.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(dlg.queryByRole('button', { name: 'Pagar' })).toBeNull();
  });

  it('despesa já paga: edita, mas não paga de novo nem cancela', () => {
    const { dlg } = abrir(paidEntry('expense'));

    expect(dlg.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(dlg.queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(dlg.queryByRole('button', { name: 'Cancelar lançamento' })).toBeNull();
  });

  describe('pagar / receber', () => {
    it('vem com o valor em aberto, hoje e a conta padrão; envia versão, valor, data, conta e observação', async () => {
      const { dlg, onChanged } = abrir(entry('expense', { paid_cents: 4000, remaining_cents: 6000, status: 'partial', display_status: 'partial' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Pagar' }));
      expect(dlg.getByLabelText('Valor')).toHaveValue('60,00');
      expect(dlg.getByLabelText('Conta')).toHaveValue('a1');
      fireEvent.change(dlg.getByLabelText(/^Observação/), { target: { value: '  Pix  ' } });
      fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(api.payEntry).toHaveBeenCalledWith('e1', 4, { amount_cents: 6000, paid_on: '2026-10-06', account_id: 'a1', note: 'Pix', settle: false }, KEY));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      await waitFor(() => expect(api.listEntryPayments).toHaveBeenCalledTimes(2));
      expect(dlg.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    });

    it('a conta do próprio lançamento vence a padrão; "dar baixa" envia settle', async () => {
      const { dlg } = abrir(entry('expense', { account_id: 'a2' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Pagar' }));
      expect(dlg.getByLabelText('Conta')).toHaveValue('a2');
      fireEvent.click(dlg.getByLabelText(/Dar baixa mesmo que o valor seja diferente/));
      fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(api.payEntry).toHaveBeenCalled());
      expect(api.payEntry.mock.calls[0][2]).toMatchObject({ account_id: 'a2', settle: true });
    });

    it('receita: botão "Receber" e aviso de recebimento', async () => {
      const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
      const { dlg } = abrir(entry('revenue'));
      fireEvent.click(dlg.getByRole('button', { name: 'Receber' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Recebimento registrado.'));
    });

    it('sem conta ou sem valor não confirma; "Voltar" desfaz', () => {
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Pagar' }));
      fireEvent.change(dlg.getByLabelText('Conta'), { target: { value: '' } });
      expect(dlg.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
      fireEvent.click(dlg.getByRole('button', { name: 'Voltar' }));

      expect(dlg.getByRole('button', { name: 'Pagar' })).toBeInTheDocument();
    });

    it('falha mantém o formulário e libera o botão', async () => {
      const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
      api.payEntry.mockRejectedValueOnce(new Error('rede caiu'));
      const { dlg, onChanged } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Pagar' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
      expect(onChanged).not.toHaveBeenCalled();
      await waitFor(() => expect(dlg.getByRole('button', { name: 'Confirmar' })).toBeEnabled());
    });
  });

  describe('editar', () => {
    it('despesa sem pagamento: envia descrição, vencimento, categoria e o valor só se mudou; sem justificativa', async () => {
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      expect(dlg.getByLabelText('Descrição')).toHaveValue('Conta de luz');
      expect(dlg.getByLabelText('Vencimento')).toHaveValue('2026-10-10');
      expect(dlg.queryByLabelText(/^Justificativa/)).toBeNull();
      fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: '  Conta de luz de outubro ' } });
      fireEvent.change(dlg.getByLabelText('Valor'), { target: { value: '120' } });
      fireEvent.change(dlg.getByLabelText(/^Categoria/), { target: { value: 'k-luz' } });
      fireEvent.click(dlg.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith('e1', 4, { description: 'Conta de luz de outubro', due_date: '2026-10-10', category_id: 'k-luz', amount_cents: 12000 }, null, KEY));
    });

    it('valor igual ao do documento não vai no pedido', async () => {
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
      expect(api.updateEntry.mock.calls[0][2]).toEqual({ description: 'Conta de luz', due_date: '2026-10-10', category_id: 'k-rent' });
    });

    it('vencimento apagado vai como null', async () => {
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      fireEvent.change(dlg.getByLabelText('Vencimento'), { target: { value: '' } });
      fireEvent.click(dlg.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
      expect(api.updateEntry.mock.calls[0][2]).toMatchObject({ due_date: null });
    });

    it('com pagamento: o valor fica travado e a justificativa de 5+ caracteres é obrigatória e vai junto', async () => {
      const { dlg } = abrir(paidEntry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      expect(dlg.getByLabelText(/^Valor/)).toBeDisabled();
      expect(dlg.getByText('Com pagamento, estorne antes de mudar o valor.')).toBeInTheDocument();
      const salvar = dlg.getByRole('button', { name: 'Salvar' });
      expect(salvar).toBeDisabled();
      fireEvent.change(dlg.getByLabelText(/^Justificativa/), { target: { value: 'Erro de digitação' } });
      fireEvent.click(salvar);

      await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
      expect(api.updateEntry.mock.calls[0][2]).not.toHaveProperty('amount_cents');
      expect(api.updateEntry.mock.calls[0][3]).toBe('Erro de digitação');
    });

    it('aporte edita só a descrição', async () => {
      const { dlg } = abrir(paidEntry('contribution', { category_id: null, due_date: null, paid_cents: 0, remaining_cents: 0 }));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      expect(dlg.queryByLabelText('Vencimento')).toBeNull();
      expect(dlg.queryByLabelText(/^Categoria/)).toBeNull();
      fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'Aporte do presidente' } });
      fireEvent.click(dlg.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith('e1', 4, { description: 'Aporte do presidente' }, null, KEY));
    });

    it('a categoria inclui a atual mesmo desativada ou automática, e exclui as de outro tipo', () => {
      const { dlg } = abrir(entry('expense', { category_id: 'k-off' }));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      const opcoes = [...(dlg.getByLabelText(/^Categoria/) as HTMLSelectElement).options].map((o) => o.value);

      expect(opcoes).toEqual(['k-rent', 'k-luz', 'k-none', 'k-off']);
    });

    it('descrição curta impede salvar', () => {
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Editar' }));
      fireEvent.change(dlg.getByLabelText('Descrição'), { target: { value: 'a' } });

      expect(dlg.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    });
  });

  describe('cancelar', () => {
    it('exige motivo de 5+ caracteres e envia a versão', async () => {
      const { dlg, onChanged } = abrir(entry('expense'));
      fireEvent.click(dlg.getByRole('button', { name: 'Cancelar lançamento' }));
      const cancelar = dlg.getByRole('button', { name: 'Cancelar lançamento' });
      expect(cancelar).toBeDisabled();
      fireEvent.change(dlg.getByLabelText(/^Motivo/), { target: { value: 'Lançada em duplicidade' } });
      fireEvent.click(cancelar);

      await waitFor(() => expect(api.cancelEntry).toHaveBeenCalledWith('e1', 4, 'Lançada em duplicidade', KEY));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });
  });

  describe('pagamentos e estornos', () => {
    it('lista os pagamentos e só oferece "estornar" nos que ainda não foram estornados', async () => {
      api.listEntryPayments.mockResolvedValue([
        payment({ id: 'p1', note: 'Pix' }),
        payment({ id: 'p2', paid_on: '2026-10-03', amount_cents: 500 }),
        payment({ id: 'r2', kind: 'reversal', paid_on: '2026-10-04', amount_cents: 500, reverses_payment_id: 'p2' }),
      ]);
      const { dlg } = abrir(paidEntry('expense'));

      expect(await dlg.findByText('Pagamentos')).toBeInTheDocument();
      expect(dlg.getByText(/Pix/)).toHaveTextContent('02/10/2026 — Pagamento · Pix');
      expect(dlg.getByText('Estorno')).toBeInTheDocument();
      expect(dlg.getAllByRole('button', { name: 'estornar' })).toHaveLength(1);
      expect(dlg.getByLabelText('Motivo do estorno')).toBeInTheDocument();
    });

    it('receita chama de "Recebimentos"', async () => {
      api.listEntryPayments.mockResolvedValue([payment()]);
      const { dlg } = abrir(paidEntry('revenue'));

      expect(await dlg.findByText('Recebimentos')).toBeInTheDocument();
      expect(dlg.getByText(/Recebimento ·|Recebimento$/, { selector: 'span' })).toBeInTheDocument();
    });

    it('estornar sem motivo avisa; com motivo pede confirmação e envia', async () => {
      api.listEntryPayments.mockResolvedValue([payment()]);
      const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
      const { dlg, onChanged } = abrir(paidEntry('expense'));
      fireEvent.click(await dlg.findByRole('button', { name: 'estornar' }));
      expect(aviso).toHaveBeenCalledWith('Escreva o motivo do estorno no campo abaixo (mínimo de 5 caracteres).');
      expect(api.reverseEntryPayment).not.toHaveBeenCalled();

      fireEvent.change(dlg.getByLabelText('Motivo do estorno'), { target: { value: 'Pago em duplicidade' } });
      fireEvent.click(dlg.getByRole('button', { name: 'estornar' }));
      expect(await screen.findByText('Estornar este pagamento?')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Estornar' }));

      await waitFor(() => expect(api.reverseEntryPayment).toHaveBeenCalledWith('p1', 'Pago em duplicidade', KEY));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });

    it('recusar a confirmação não estorna', async () => {
      api.listEntryPayments.mockResolvedValue([payment()]);
      const { dlg } = abrir(paidEntry('expense'));
      await dlg.findByRole('button', { name: 'estornar' });
      fireEvent.change(dlg.getByLabelText('Motivo do estorno'), { target: { value: 'Pago em duplicidade' } });
      fireEvent.click(dlg.getByRole('button', { name: 'estornar' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

      await waitFor(() => expect(screen.queryByText('Estornar este pagamento?')).toBeNull());
      expect(api.reverseEntryPayment).not.toHaveBeenCalled();
    });

    it('receita estornada fala em recebimento', async () => {
      api.listEntryPayments.mockResolvedValue([payment()]);
      const { dlg } = abrir(paidEntry('revenue'));
      await dlg.findByRole('button', { name: 'estornar' });
      fireEvent.change(dlg.getByLabelText('Motivo do estorno'), { target: { value: 'Recebido em duplicidade' } });
      fireEvent.click(dlg.getByRole('button', { name: 'estornar' }));

      expect(await screen.findByText('Estornar este recebimento?')).toBeInTheDocument();
    });

    it('lançamento cancelado não oferece estornar', async () => {
      api.listEntryPayments.mockResolvedValue([payment()]);
      const { dlg } = abrir(paidEntry('expense', { status: 'canceled', display_status: 'canceled' }));
      await dlg.findByText('Pagamentos');

      expect(dlg.queryByRole('button', { name: 'estornar' })).toBeNull();
      expect(dlg.queryByLabelText('Motivo do estorno')).toBeNull();
    });
  });

  describe('anexos', () => {
    it('sem anexos explica o limite; "Anexar" aparece para lançamento vivo', async () => {
      const { dlg } = abrir(entry('expense'));

      expect(await dlg.findByText(/Nenhum anexo. Imagem ou PDF de até 10 MB/)).toBeInTheDocument();
      expect(dlg.getByRole('button', { name: /Anexar/ })).toBeInTheDocument();
    });

    it('envia arquivo válido com o nome seguro e recarrega a lista', async () => {
      const sucesso = vi.spyOn(notify, 'success').mockImplementation(() => undefined as never);
      const { dlg } = abrir(entry('expense'));
      await dlg.findByText(/Nenhum anexo/);
      fireEvent.change(dlg.getByLabelText('Anexar arquivo'), { target: { files: [pngFile()] } });

      await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(1));
      expect(api.uploadAttachment.mock.calls[0].slice(0, 3)).toEqual(['e1', expect.any(File), 'image/png']);
      expect(api.uploadAttachment.mock.calls[0][3]).toMatch(/\.png$/);
      await waitFor(() => expect(sucesso).toHaveBeenCalledWith('Anexo enviado.'));
      await waitFor(() => expect(api.listAttachments).toHaveBeenCalledTimes(2));
    });

    it('arquivo de tipo falso é recusado sem enviar nada', async () => {
      const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
      const { dlg } = abrir(entry('expense'));
      await dlg.findByText(/Nenhum anexo/);
      const fake = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0])], 'virus.png', { type: 'image/png' });
      fireEvent.change(dlg.getByLabelText('Anexar arquivo'), { target: { files: [fake] } });

      await waitFor(() => expect(aviso).toHaveBeenCalledTimes(1));
      expect(api.uploadAttachment).not.toHaveBeenCalled();
    });

    it('abre o anexo por um link assinado, em outra aba e sem referrer', async () => {
      api.listAttachments.mockResolvedValue([attachment()]);
      const abrirJanela = vi.spyOn(window, 'open').mockImplementation(() => null);
      const { dlg } = abrir(entry('expense'));
      fireEvent.click(await dlg.findByRole('button', { name: 'boleto.pdf' }));

      await waitFor(() => expect(abrirJanela).toHaveBeenCalledWith('https://exemplo.test/arquivo', '_blank', 'noopener,noreferrer'));
      expect(api.signedUrl).toHaveBeenCalledWith('fin-docs', 'e1/boleto.pdf', 120);
    });

    it('remover pede motivo, confirmação e envia; sem motivo avisa', async () => {
      api.listAttachments.mockResolvedValue([attachment()]);
      const aviso = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
      const { dlg, onChanged } = abrir(entry('expense'));
      fireEvent.click(await dlg.findByRole('button', { name: 'remover' }));
      expect(aviso).toHaveBeenCalledWith('Escreva o motivo da remoção no campo de motivo (mínimo de 5 caracteres).');

      fireEvent.change(dlg.getByLabelText('Motivo (para remover anexo)'), { target: { value: 'Arquivo errado' } });
      fireEvent.click(dlg.getByRole('button', { name: 'remover' }));
      expect(await screen.findByText('Remover este anexo?')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));

      await waitFor(() => expect(api.removeAttachment).toHaveBeenCalledWith('at1', 'Arquivo errado', KEY));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
    });
  });
});
