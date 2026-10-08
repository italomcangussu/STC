import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryKind, FinAccount, FinCategory, FinEntry, FinSettings } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  DOCS_BUCKET: 'fin-docs', newRequestId: () => globalThis.crypto.randomUUID(),
  listEntries: vi.fn(), createEntry: vi.fn(), listEntryPayments: vi.fn(), listAttachments: vi.fn(), payEntry: vi.fn(),
  listAccounts: vi.fn(), listCategories: vi.fn(), getSettings: vi.fn(), receiptQueue: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import { FinanceHub } from '../../components/finance/FinanceHub';
import BillsTab from '../../components/finance/tabs/BillsTab';
import ReceivablesTab from '../../components/finance/tabs/ReceivablesTab';

const account: FinAccount = { id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1 };
const cat = (over: Partial<FinCategory>): FinCategory => ({ id: 'x', parent_id: null, name: 'x', kind: 'expense', dre_line: 'operational', system_key: null, active: true, position: 0, version: 1, ...over });
const categories: FinCategory[] = [
  cat({ id: 'k-rent', name: 'Aluguel' }),
  cat({ id: 'k-sys', name: 'Mensalidades de sócios', kind: 'revenue', dre_line: 'revenue', system_key: 'member_fees' }),
  cat({ id: 'k-rev', name: 'Patrocínio', kind: 'revenue', dre_line: 'revenue' }),
  cat({ id: 'k-off', name: 'Receita antiga', kind: 'revenue', dre_line: 'revenue', active: false }),
];
const settings = { pix_key: '', version: 1 } as unknown as FinSettings;

const entry = (id: string, kind: EntryKind, description: string, over: Partial<FinEntry> = {}): FinEntry => ({
  id, kind, status: 'pending', display_status: 'pending', description, supplier: null, category_id: null, amount_cents: 10000, paid_cents: 0,
  remaining_cents: 10000, competence_date: '2026-10-01', due_date: '2026-10-10', account_id: null, counter_account_id: null, recurrence_id: null,
  notes: null, adjustment_cents: 0, settled_on: null, cancel_reason: null, version: 1, ...over,
});
const ALL: FinEntry[] = [
  entry('e1', 'expense', 'Conta de luz'),
  entry('e2', 'revenue', 'Patrocínio da loja', { category_id: 'k-rev' }),
  entry('e3', 'contribution', 'Aporte do presidente', { status: 'paid', display_status: 'paid', remaining_cents: 0, paid_cents: 10000, due_date: null }),
  entry('e4', 'withdrawal', 'Retirada para o caixa', { status: 'paid', display_status: 'paid', due_date: null }),
  entry('e5', 'transfer', 'Banco para o caixa', { status: 'paid', display_status: 'paid', due_date: null }),
];

const mount = (ui: React.ReactElement) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [account], categories, settings, reload: vi.fn(), go: vi.fn() }}>{ui}</FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* sem storage */ }
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  // como o banco: respeita o filtro de tipo
  api.listEntries.mockImplementation(async (f: { kind?: string }) => ALL.filter((e) => !f.kind || e.kind === f.kind));
  api.listEntryPayments.mockResolvedValue([]);
  api.listAttachments.mockResolvedValue([]);
  api.createEntry.mockResolvedValue({ id: 'new' });
  api.listAccounts.mockResolvedValue([account]);
  api.listCategories.mockResolvedValue(categories);
  api.getSettings.mockResolvedValue(settings);
  api.receiptQueue.mockResolvedValue([]);
});

describe('Pagar × Receber — cada lado só mostra a sua direção', () => {
  it('Contas a pagar: despesa, retirada e transferência; nenhuma receita ou aporte', async () => {
    mount(<BillsTab />);
    expect(await screen.findByText('Conta de luz')).toBeInTheDocument();
    expect(screen.getByText('Retirada para o caixa')).toBeInTheDocument();
    expect(screen.getByText('Banco para o caixa')).toBeInTheDocument();
    expect(screen.queryByText('Patrocínio da loja')).not.toBeInTheDocument();
    expect(screen.queryByText('Aporte do presidente')).not.toBeInTheDocument();
    const kinds = [...(screen.getByLabelText('Tipo') as HTMLSelectElement).options].map((o) => o.value);
    expect(kinds).not.toContain('revenue');
    expect(kinds).not.toContain('contribution');
  });

  it('Outras receitas: receita e aporte; nenhuma despesa, retirada ou transferência', async () => {
    mount(<ReceivablesTab />);
    expect(await screen.findByText('Patrocínio da loja')).toBeInTheDocument();
    expect(screen.getByText('Aporte do presidente')).toBeInTheDocument();
    expect(screen.queryByText('Conta de luz')).not.toBeInTheDocument();
    expect(screen.queryByText('Retirada para o caixa')).not.toBeInTheDocument();
    expect(screen.queryByText('Banco para o caixa')).not.toBeInTheDocument();
    expect(screen.getByText(/Receitas em aberto nesta lista: R\$ 100,00/)).toBeInTheDocument();
    expect(screen.getByText('Recebida')).toBeInTheDocument();
    expect(api.listEntries.mock.calls.map((c) => c[0].kind).sort()).toEqual(['contribution', 'revenue']);
  });

  it('mesmo que a consulta devolva tudo misturado, a tela não mostra o outro lado', async () => {
    api.listEntries.mockResolvedValue(ALL);
    mount(<ReceivablesTab />);
    expect(await screen.findByText('Patrocínio da loja')).toBeInTheDocument();
    expect(screen.queryByText('Conta de luz')).not.toBeInTheDocument();
    expect(screen.getAllByText('Patrocínio da loja')).toHaveLength(1);
  });

  it('filtrar por tipo consulta só aquele tipo', async () => {
    mount(<ReceivablesTab />);
    await screen.findByText('Patrocínio da loja');
    api.listEntries.mockClear();
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'contribution' } });
    expect(await screen.findByText('Aporte do presidente')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Patrocínio da loja')).not.toBeInTheDocument());
    expect(api.listEntries).toHaveBeenCalledWith(expect.objectContaining({ kind: 'contribution' }));
  });

  it('uma receita em aberto abre o mesmo detalhe, com a ação "Receber"', async () => {
    mount(<ReceivablesTab />);
    fireEvent.click(await screen.findByText('Patrocínio da loja'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'Receber' })).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Pagar' })).not.toBeInTheDocument();
  });
});

describe('Outras receitas — registrar', () => {
  it('o botão do cabeçalho abre a folha só com tipos de entrada, receita pré-selecionada', async () => {
    mount(<ReceivablesTab />);
    await screen.findByText('Patrocínio da loja');
    fireEvent.click(screen.getByRole('button', { name: /^Registrar$/ }));
    const dlg = await screen.findByRole('dialog');
    const tipo = within(dlg).getByLabelText(/^Tipo/) as HTMLSelectElement;
    expect([...tipo.options].map((o) => o.value)).toEqual(['revenue', 'contribution']);
    expect(tipo.value).toBe('revenue');
    const cats = [...(within(dlg).getByLabelText(/^Categoria/) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(cats).toContain('Patrocínio');
    expect(cats).not.toContain('Aluguel');
    expect(cats).not.toContain('Mensalidades de sócios');
    expect(cats).not.toContain('Receita antiga');
    expect(within(dlg).getByLabelText(/Já foi recebida/)).toBeInTheDocument();
  });

  it('registra uma receita pendente com categoria de receita', async () => {
    mount(<ReceivablesTab />);
    await screen.findByText('Patrocínio da loja');
    fireEvent.click(screen.getByRole('button', { name: /^Registrar$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText(/^Descrição/), { target: { value: 'Patrocínio do torneio' } });
    fireEvent.change(within(dlg).getByLabelText(/^Categoria/), { target: { value: 'k-rev' } });
    fireEvent.change(within(dlg).getByLabelText(/^Valor$/), { target: { value: '500,00' } });
    const save = within(dlg).getByRole('button', { name: 'Registrar' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ kind: 'revenue', category_id: 'k-rev', amount_cents: 50000, status: 'pending' });
  });

  it('lista vazia oferece "Registrar receita"', async () => {
    api.listEntries.mockResolvedValue([]);
    mount(<ReceivablesTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Registrar receita/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Receita avulsa ou aporte');
  });
});

describe('Hub — aba "Outras receitas" em Receber', () => {
  it('abre direto pela aba salva e mantém "Contas a pagar" em Pagar', async () => {
    localStorage.setItem('finance-hub-tab', 'receivables');
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    expect(await screen.findByText('Patrocínio da loja')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Outras receitas' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Pagar' }));
    expect(await screen.findByText('Conta de luz')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contas a pagar' })).toHaveAttribute('aria-selected', 'true');
  });
});
