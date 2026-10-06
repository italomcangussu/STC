import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DreLineRow, FinAccount, FinCategory, FinSettings } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  RECEIPTS_BUCKET: 'fin-receipts', DOCS_BUCKET: 'fin-docs', newRequestId: () => globalThis.crypto.randomUUID(),
  dreLines: vi.fn(), dreMemo: vi.fn(), dreDetail: vi.fn(), accountBalances: vi.fn(), receivablesSummary: vi.fn(), payablesSummary: vi.fn(), monthlyTrend: vi.fn(),
  cashFlow: vi.fn(), movements: vi.fn(), receiptQueue: vi.fn(), listAccounts: vi.fn(), listCategories: vi.fn(), getSettings: vi.fn(),
  listEntries: vi.fn(), createEntry: vi.fn(), listEntryPayments: vi.fn(), listAttachments: vi.fn(), payEntry: vi.fn(),
  dayCardRows: vi.fn(), listCharges: vi.fn(), listPlans: vi.fn(), listCredits: vi.fn(), chargeHistory: vi.fn(), adjustCharge: vi.fn(), registerPayment: vi.fn(), listHolidays: vi.fn(),
  generateCharges: vi.fn(), listMembersWithoutPlan: vi.fn(), createPlan: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);
vi.mock('../../components/FinanceiroAdmin', () => ({ FinanceiroAdmin: ({ dayCardPriceCents }: { dayCardPriceCents?: number }) => <div data-testid="painel-alunos">valor do Day Card: {dayCardPriceCents}</div> }));
// recharts mede o DOM; nos testes de números ele só atrapalha.
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nil = () => null;
  return { ResponsiveContainer: Pass, BarChart: Pass, ComposedChart: Pass, Bar: Nil, Line: Nil, XAxis: Nil, YAxis: Nil, Tooltip: Nil, Legend: Nil, CartesianGrid: Nil };
});

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import { FinanceHub } from '../../components/finance/FinanceHub';
import DreTab from '../../components/finance/tabs/DreTab';
import BillsTab from '../../components/finance/tabs/BillsTab';
import MembersTab from '../../components/finance/tabs/MembersTab';
import StudentsTab from '../../components/finance/tabs/StudentsTab';

const settings = (over: Partial<FinSettings> = {}): FinSettings => ({
  id: true, due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: null, interest_daily_fixed_cents: null, interest_daily_percent_bps: null, late_fee_confirmed_at: null,
  late_fee_confirmed_by: null, day_card_price_cents: 5000, day_card_in_cash: false, payee_names: [], version: 1, updated_at: '2026-10-01T00:00:00Z', ...over,
});
const account: FinAccount = { id: 'a1', name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: true, active: true, position: 0, version: 1 };
const cat = (over: Partial<FinCategory>): FinCategory => ({ id: 'x', parent_id: null, name: 'x', kind: 'expense', dre_line: 'operational', system_key: null, active: true, position: 0, version: 1, ...over });
const categories: FinCategory[] = [
  cat({ id: 'k-rent', name: 'Aluguel' }),
  cat({ id: 'k-sys', name: 'Mensalidades de sócios', kind: 'revenue', dre_line: 'revenue', system_key: 'member_fees' }),
  cat({ id: 'k-rev', name: 'Patrocínio', kind: 'revenue', dre_line: 'revenue' }),
];

const mount = (ui: React.ReactElement, opts: { settings?: FinSettings | null; categories?: FinCategory[]; accounts?: FinAccount[] } = {}) => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: opts.accounts ?? [account], categories: opts.categories ?? categories, settings: opts.settings === undefined ? settings() : opts.settings, reload: vi.fn(), go: vi.fn() }}>{ui}</FinanceProvider>
  </ConfirmProvider>,
);

const line = (period: 'current' | 'previous', l: DreLineRow['line'], id: string, name: string, cents: number): DreLineRow => ({ period, line: l, category_id: id, name, parent_name: null, amount_cents: cents });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* sem storage */ }
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.dreMemo.mockResolvedValue({ contributions_cents: 20000, withdrawals_cents: 5000 });
  api.dreLines.mockResolvedValue([
    line('current', 'revenue', 'k-mens', 'Mensalidades de sócios', 100000), line('current', 'deduction', 'k-desc', 'Descontos', 5000), line('current', 'operational', 'k-rent', 'Aluguel', 30000),
    line('previous', 'revenue', 'k-mens', 'Mensalidades de sócios', 80000), line('previous', 'operational', 'k-rent', 'Aluguel', 30000),
  ]);
  api.dreDetail.mockResolvedValue([{ category_id: 'k-rent', category_name: 'Aluguel', source_type: 'entry', source_id: 'e1', occurred_on: '2026-10-01', description: 'Aluguel de outubro', amount_cents: 30000, profile_id: null }]);
  api.accountBalances.mockResolvedValue([{ id: 'a1', name: 'Banco do clube', kind: 'bank', active: true, is_default_receipts: true, balance_cents: 250000 }]);
  api.receivablesSummary.mockResolvedValue({ open_count: 10, open_cents: 150000, overdue_count: 2, overdue_cents: 30000, due_7d_cents: 15000, due_30d_cents: 45000, forecast_cents: 60000, fees_configured: false, overdue_members: 2 });
  api.payablesSummary.mockResolvedValue({ payable_open_cents: 40000, payable_overdue_count: 1, payable_overdue_cents: 10000, payable_due_7d_cents: 5000, payable_due_30d_cents: 25000, receivable_open_cents: 0 });
  api.monthlyTrend.mockResolvedValue([]);
  api.cashFlow.mockResolvedValue([{ bucket_start: '2026-10-01', bucket_end: '2026-10-31', opening_cents: 100000, inflow_cents: 90000, outflow_cents: 40000, net_cents: 50000, closing_cents: 150000 }]);
  api.receiptQueue.mockResolvedValue([]);
  api.listAccounts.mockResolvedValue([account]);
  api.listCategories.mockResolvedValue(categories);
  api.getSettings.mockResolvedValue(settings());
  api.listEntries.mockResolvedValue([]);
  api.listHolidays.mockResolvedValue([]);
  api.listCharges.mockResolvedValue([]);
  api.listPlans.mockResolvedValue([]);
  api.listCredits.mockResolvedValue([]);
});

describe('Painel — período visível e definição de cada indicador', () => {
  it('abre no painel, mostra o período por extenso e as definições (competência × posição) a um toque', async () => {
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    expect(await screen.findByText(/Período selecionado:/)).toBeInTheDocument();
    expect(await screen.findByText('Receitas')).toBeInTheDocument();
    // definição de "Receitas" fica escondida até tocar no (i)
    expect(screen.queryByText(/Receita líquida do DRE no período/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Como é calculado: Receitas/ }));
    expect(screen.getByText(/Receita líquida do DRE no período/)).toBeInTheDocument();
    expect(screen.getAllByText('Competência').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Posição hoje').length).toBeGreaterThan(0);
  });

  it('calcula receita líquida, resultado e saldo a partir dos fatos do banco', async () => {
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    // receita líquida = 1.000 − 50 = 950; resultado = 950 − 300 = 650; saldo = 2.500
    expect(await screen.findByText('R$ 950,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 650,00')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 2.500,00').length).toBeGreaterThan(0);
  });

  it('alerta que os encargos de atraso ainda não foram configurados', async () => {
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    expect(await screen.findByText(/encargos de atraso ainda não foram configurados/i)).toBeInTheDocument();
  });

  it('navega entre as áreas (Receber → Mensalidades) sem recarregar', async () => {
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    await screen.findByText(/Período selecionado:/);
    fireEvent.click(screen.getByRole('tab', { name: 'Receber' }));
    expect(await screen.findByRole('tab', { name: /Sócios e valores/ })).toBeInTheDocument();
  });
});

describe('DRE — competência, comparação e detalhe', () => {
  it('mostra a demonstração com comparação ao período anterior e itens fora do resultado à parte', async () => {
    mount(<DreTab />);
    expect(await screen.findByText('(=) Resultado operacional')).toBeInTheDocument();
    expect(screen.getByText(/Comparado com/)).toBeInTheDocument();
    expect(screen.getByText('Aportes no período').nextSibling).toHaveTextContent('R$ 200,00');
    expect(screen.getByText('Retiradas no período').nextSibling).toHaveTextContent('R$ 50,00');
    const resultRow = screen.getByText('(=) Resultado operacional').closest('li')!;
    expect(resultRow).toHaveTextContent('R$ 650,00');
    expect(resultRow).toHaveTextContent(/ant\. R\$ 500,00/); // anterior: 800 − 300
    expect(resultRow).toHaveTextContent('+30%'); // (650 − 500) / 500
  });

  it('detalha por categoria e depois pelos lançamentos que formam o valor', async () => {
    mount(<DreTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Despesas operacionais/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Aluguel/ }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Aluguel de outubro')).toBeInTheDocument();
    expect(api.dreDetail).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'k-rent');
  });

  it('a exportação traz exatamente o que está na tela: totais, base (competência) e data de geração', async () => {
    const blobs: Blob[] = [];
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; });
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    mount(<DreTab />);
    await screen.findByText('(=) Resultado operacional');
    fireEvent.click(screen.getByRole('button', { name: /Planilha \(CSV\)/ }));
    await waitFor(() => expect(blobs.length).toBe(1));
    const csv = await blobs[0].text();
    expect(csv).toContain('Competência (não é fluxo de caixa)');
    expect(csv).toContain('Gerado em;');
    expect(csv).toContain('Resultado operacional;650,00;500,00');
    expect(csv).toContain('Resultado operacional (período atual);650,00');
  });
});

describe('Contas a pagar — categorias automáticas ficam de fora', () => {
  it('no novo lançamento só aparecem categorias manuais (a mensalidade nasce sozinha)', async () => {
    mount(<BillsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Novo$/ }));
    const dlg = await screen.findByRole('dialog');
    const catSelect = within(dlg).getByLabelText(/^Categoria/) as HTMLSelectElement;
    const options = [...catSelect.options].map((o) => o.textContent);
    expect(options).toContain('Aluguel');
    expect(options).not.toContain('Mensalidades de sócios');
    // trocar para receita: só categorias de receita manuais
    fireEvent.change(within(dlg).getByLabelText(/^Tipo/), { target: { value: 'revenue' } });
    const revOptions = [...(within(dlg).getByLabelText(/^Categoria/) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(revOptions).toContain('Patrocínio');
    expect(revOptions).not.toContain('Mensalidades de sócios');
  });

  it('registra uma despesa pendente com vencimento (idempotente: chave por tentativa)', async () => {
    api.createEntry.mockResolvedValue({ id: 'e1' });
    mount(<BillsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Novo$/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText(/^Descrição/), { target: { value: 'Conta de luz' } });
    fireEvent.change(within(dlg).getByLabelText(/^Categoria/), { target: { value: 'k-rent' } });
    fireEvent.change(within(dlg).getByLabelText(/^Valor$/), { target: { value: '320,50' } });
    const save = within(dlg).getByRole('button', { name: 'Registrar' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    const [data, key] = api.createEntry.mock.calls[0];
    expect(data).toMatchObject({ kind: 'expense', description: 'Conta de luz', amount_cents: 32050, status: 'pending', category_id: 'k-rent' });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Mensalidades — ajustes exigem justificativa e conta', () => {
  const row = {
    charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07', original_amount_cents: 15000,
    stored_status: 'open', display_status: 'overdue', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0, principal_remaining_cents: 15000, days_late: 3,
    fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0, total_due_cents: 15000, fees_configured: false, overdue: true,
    last_payment_on: null, cancel_reason: null, total_count: 1,
  };

  it('desconto só com motivo de 5+ caracteres e confirmação; o motivo vai junto', async () => {
    api.listCharges.mockResolvedValue([row]);
    api.chargeHistory.mockResolvedValue({ payments: [], adjustments: [] });
    api.adjustCharge.mockResolvedValue({});
    mount(<MembersTab />);
    fireEvent.click(await screen.findByText('Ana Sócia'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: /Desconto \/ acréscimo/ }));
    fireEvent.change(within(dlg).getByLabelText(/^Valor/), { target: { value: '20' } });
    const reg = within(dlg).getByRole('button', { name: 'Registrar' });
    expect(reg).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/^Justificativa/), { target: { value: 'Bolsa aprovada pela diretoria' } });
    expect(reg).toBeEnabled();
    fireEvent.click(reg);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.adjustCharge).toHaveBeenCalledWith('c1', 'discount', 2000, 'Bolsa aprovada pela diretoria', expect.any(String)));
  });

  it('registrar pagamento exige a conta onde o dinheiro entrou', async () => {
    api.listCharges.mockResolvedValue([row]);
    api.chargeHistory.mockResolvedValue({ payments: [], adjustments: [] });
    mount(<MembersTab />, { accounts: [] });
    fireEvent.click(await screen.findByText('Ana Sócia'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Registrar pagamento' }));
    expect(within(dlg).getByRole('button', { name: 'Confirmar pagamento' })).toBeDisabled();
    expect(api.registerPayment).not.toHaveBeenCalled();
  });
});

describe('Alunos e Day Card — vocabulário e regras do clube', () => {
  it('Day Card é a taxa do convidado (derivada da reserva); Aula avulsa e Card Mensal são pagamentos do aluno; professor fica fora', async () => {
    api.dayCardRows.mockResolvedValue([
      { reservation_id: 'r1', occurred_on: '2026-10-03', guest_name: 'Convidado Fulano', booked_by: 'Ana Sócia', exempt: false, charged_cents: 5000 },
      { reservation_id: 'r2', occurred_on: '2026-10-04', guest_name: 'Convidado Isento', booked_by: null, exempt: true, charged_cents: 0 },
    ]);
    mount(<StudentsTab />);
    expect(await screen.findByText('Convidado Fulano')).toBeInTheDocument();
    expect(screen.getByText(/reserva de Ana Sócia/)).toBeInTheDocument();
    expect(screen.getByText('Isento')).toBeInTheDocument();
    expect(screen.getByText(/taxa do convidado de um sócio, para ter acesso ao clube por um dia/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pagamento registrado/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/é pago pelo próprio aluno, por hora\/aula/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cobrado\(s\) · 1 isento\(s\)/)).toBeInTheDocument();
  });

  it('o painel de alunos recebe o valor do Day Card configurado', async () => {
    api.dayCardRows.mockResolvedValue([]);
    mount(<StudentsTab />, { settings: settings({ day_card_price_cents: 6500 }) });
    fireEvent.click(await screen.findByRole('tab', { name: 'Painel de alunos' }));
    expect(await screen.findByTestId('painel-alunos')).toHaveTextContent('valor do Day Card: 6500');
  });

  it('o hub não tem mais área de professores: repasse não é assunto do financeiro do clube', async () => {
    render(<ConfirmProvider><FinanceHub /></ConfirmProvider>);
    await screen.findByText(/Período selecionado:/);
    fireEvent.click(screen.getByRole('tab', { name: 'Pagar' }));
    expect(await screen.findByRole('tab', { name: 'Contas a pagar' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Professor/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Receber' }));
    expect(await screen.findByRole('tab', { name: 'Alunos e Day Card' })).toBeInTheDocument();
  });
});
