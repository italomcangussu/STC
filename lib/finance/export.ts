/**
 * Exportação de relatórios financeiros.
 *
 * Princípio: o arquivo é gerado a partir do MESMO objeto (`ReportSpec`) que a
 * tela mostra — mesmas linhas, mesmos filtros, mesmos totais. Não existe
 * segunda consulta nem segundo cálculo: `exportMatchesScreen` (nos testes)
 * confere que os totais do arquivo são a soma das linhas exibidas.
 *
 * Cada arquivo traz: título, período, filtros aplicados, base (competência ×
 * caixa), totais e a data/hora de geração.
 */
import { formatDecimalBRL, formatBRL, type Cents } from './money';
import { brDate } from './dates';
import type { Period } from './reports';
import type { ChargeStatementRow, DayCardRow, DreDetailRow, FinEntry, MovementRow } from './types';
import { CHARGE_STATUS_LABEL } from './memberBilling';
import type { DreStatementRow } from './reports';

export type CellKind = 'text' | 'money' | 'date' | 'number' | 'pct';

export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
}

export type CellValue = string | number | null;

export interface ReportSpec {
  id: string;
  title: string;
  /** "Competência" ou "Caixa (data real)" — nunca os dois. */
  basis: string;
  period: Period | null;
  /** Filtros aplicados, em texto ("Conta: Banco do clube"). */
  filters: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  rows: Array<Record<string, CellValue>>;
  /** Totais em centavos, calculados sobre as linhas exibidas. */
  totals: Array<{ label: string; cents: Cents; column?: string }>;
  generatedAt: string;
}

/** Formata o instante de geração no fuso do clube: "06/10/2026 14:32". */
export function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return f.format(d).replace(',', '');
}

/** Texto de uma célula como aparece na tela/PDF. */
export function cellText(kind: CellKind, v: CellValue): string {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'money': return formatBRL(Number(v));
    case 'date': return brDate(String(v));
    case 'pct': return `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    case 'number': return String(v);
    default: return String(v);
  }
}

/**
 * Texto livre digitado por usuários (descrição, nome) pode começar com = + - @
 * e ser executado como fórmula ao abrir o CSV no Excel/Planilhas. Neutraliza.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const csvField = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function csvCell(kind: CellKind, v: CellValue): string {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'money': return csvField(formatDecimalBRL(Number(v)));
    case 'date': return csvField(brDate(String(v)));
    case 'pct': return csvField(Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }));
    case 'number': return csvField(String(v));
    default: return csvField(neutralizeFormula(String(v)));
  }
}

/**
 * CSV para planilha brasileira: separador `;`, decimal com vírgula, BOM UTF-8.
 * Valores monetários em reais (não em centavos) — como o usuário os lê na tela.
 */
export function toCsv(spec: ReportSpec): string {
  const lines: string[] = [];
  lines.push(csvField(spec.title));
  lines.push(`Base;${csvField(spec.basis)}`);
  if (spec.period) lines.push(`Período;${csvField(`${brDate(spec.period.from)} a ${brDate(spec.period.to)}`)}`);
  for (const f of spec.filters) lines.push(`${csvField(neutralizeFormula(f.label))};${csvField(neutralizeFormula(f.value))}`);
  lines.push(`Gerado em;${csvField(formatGeneratedAt(spec.generatedAt))}`);
  lines.push('');
  lines.push(spec.columns.map((c) => csvField(c.label)).join(';'));
  for (const row of spec.rows) lines.push(spec.columns.map((c) => csvCell(c.kind, row[c.key] ?? null)).join(';'));
  if (spec.totals.length > 0) {
    lines.push('');
    for (const t of spec.totals) lines.push(`${csvField(t.label)};${csvField(formatDecimalBRL(t.cents))}`);
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportFilename(spec: ReportSpec, ext: 'csv' | 'pdf'): string {
  const slug = spec.id.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const range = spec.period ? `${spec.period.from}_${spec.period.to}` : spec.generatedAt.slice(0, 10);
  return `financeiro-${slug}-${range}.${ext}`;
}

/**
 * Confere que o arquivo corresponde à tela: cada total declarado tem de ser a
 * soma da coluna correspondente nas linhas exibidas. Devolve as divergências.
 */
export function exportMismatches(spec: ReportSpec): string[] {
  const problems: string[] = [];
  for (const t of spec.totals) {
    if (!t.column) continue;
    const sum = spec.rows.reduce((s, r) => s + Number(r[t.column!] ?? 0), 0);
    if (sum !== t.cents) problems.push(`${t.label}: total ${t.cents} ≠ soma das linhas ${sum}`);
  }
  return problems;
}

// ------------------------------------------------------------------
// Construtores: cada um recebe EXATAMENTE os dados que a tela renderiza.
// ------------------------------------------------------------------
export interface ExportContext {
  generatedAt: string;
  period: Period | null;
  filters?: Array<{ label: string; value: string }>;
}

export function dreSpec(rows: DreStatementRow[], ctx: ExportContext & { previous: Period }): ReportSpec {
  const result = rows.find((r) => r.key === 'result');
  return {
    id: 'dre', title: 'DRE — Demonstração do Resultado do Exercício', basis: 'Competência (não é fluxo de caixa)', period: ctx.period,
    filters: [...(ctx.filters ?? []), { label: 'Período anterior (comparação)', value: `${brDate(ctx.previous.from)} a ${brDate(ctx.previous.to)}` }],
    columns: [
      { key: 'label', label: 'Linha', kind: 'text' }, { key: 'current', label: 'Período atual', kind: 'money' },
      { key: 'previous', label: 'Período anterior', kind: 'money' }, { key: 'delta', label: 'Variação', kind: 'money' },
      { key: 'deltaPct', label: 'Variação %', kind: 'pct' }, { key: 'share', label: '% da receita líquida', kind: 'pct' },
    ],
    // Dedução, custo e despesa saem com sinal negativo, como numa demonstração.
    rows: rows.map((r) => ({
      label: r.label, current: r.negative ? -r.current : r.current, previous: r.negative ? -r.previous : r.previous,
      delta: r.negative ? -r.delta : r.delta, deltaPct: r.deltaPct, share: r.share,
    })),
    totals: result ? [{ label: 'Resultado operacional (período atual)', cents: result.current }] : [],
    generatedAt: ctx.generatedAt,
  };
}

export function dreDetailSpec(rows: DreDetailRow[], ctx: ExportContext & { categoryName?: string }): ReportSpec {
  return {
    id: 'dre-detalhe', title: `DRE — lançamentos${ctx.categoryName ? ` de ${ctx.categoryName}` : ''}`, basis: 'Competência', period: ctx.period,
    filters: ctx.filters ?? [],
    columns: [
      { key: 'occurred_on', label: 'Data de competência', kind: 'date' }, { key: 'category_name', label: 'Categoria', kind: 'text' },
      { key: 'description', label: 'Descrição', kind: 'text' }, { key: 'source_type', label: 'Origem', kind: 'text' },
      { key: 'amount_cents', label: 'Valor', kind: 'money' },
    ],
    rows: rows.map((r) => ({ occurred_on: r.occurred_on, category_name: r.category_name, description: r.description, source_type: r.source_type, amount_cents: r.amount_cents })),
    totals: [{ label: 'Total', cents: rows.reduce((s, r) => s + r.amount_cents, 0), column: 'amount_cents' }],
    generatedAt: ctx.generatedAt,
  };
}

export function movementsSpec(rows: MovementRow[], ctx: ExportContext): ReportSpec {
  const real = rows.filter((r) => !r.is_transfer);
  return {
    id: 'caixa-movimentos', title: 'Movimentos de caixa', basis: 'Caixa (data real de entrada/saída)', period: ctx.period, filters: ctx.filters ?? [],
    columns: [
      { key: 'occurred_on', label: 'Data', kind: 'date' }, { key: 'description', label: 'Descrição', kind: 'text' },
      { key: 'category_name', label: 'Categoria', kind: 'text' }, { key: 'account_name', label: 'Conta', kind: 'text' },
      { key: 'flow', label: 'Tipo', kind: 'text' }, { key: 'amount_cents', label: 'Valor', kind: 'money' },
    ],
    rows: rows.map((r) => ({ occurred_on: r.occurred_on, description: r.description, category_name: r.category_name ?? '', account_name: r.account_name, flow: r.flow, amount_cents: r.amount_cents })),
    totals: [
      { label: 'Entradas (sem transferências)', cents: real.filter((r) => r.amount_cents > 0).reduce((s, r) => s + r.amount_cents, 0) },
      { label: 'Saídas (sem transferências)', cents: -real.filter((r) => r.amount_cents < 0).reduce((s, r) => s + r.amount_cents, 0) },
      { label: 'Saldo das linhas exibidas', cents: rows.reduce((s, r) => s + r.amount_cents, 0), column: 'amount_cents' },
    ],
    generatedAt: ctx.generatedAt,
  };
}

export function chargesSpec(rows: ChargeStatementRow[], ctx: ExportContext): ReportSpec {
  return {
    id: 'mensalidades', title: 'Mensalidades dos sócios', basis: 'Posição na data de geração (valor original + encargos calculados hoje)', period: ctx.period, filters: ctx.filters ?? [],
    columns: [
      { key: 'profile_name', label: 'Sócio', kind: 'text' }, { key: 'competence_month', label: 'Competência', kind: 'date' },
      { key: 'due_date', label: 'Vencimento', kind: 'date' }, { key: 'status', label: 'Situação', kind: 'text' },
      { key: 'original_amount_cents', label: 'Valor original', kind: 'money' }, { key: 'fees_due_cents', label: 'Encargos', kind: 'money' },
      { key: 'total_due_cents', label: 'Total a pagar', kind: 'money' },
    ],
    rows: rows.map((r) => ({
      profile_name: r.profile_name, competence_month: r.competence_month, due_date: r.due_date, status: CHARGE_STATUS_LABEL[r.display_status],
      original_amount_cents: r.original_amount_cents, fees_due_cents: r.fees_due_cents, total_due_cents: r.total_due_cents,
    })),
    totals: [
      { label: 'Valor original', cents: rows.reduce((s, r) => s + r.original_amount_cents, 0), column: 'original_amount_cents' },
      { label: 'Encargos', cents: rows.reduce((s, r) => s + r.fees_due_cents, 0), column: 'fees_due_cents' },
      { label: 'Total a pagar', cents: rows.reduce((s, r) => s + r.total_due_cents, 0), column: 'total_due_cents' },
    ],
    generatedAt: ctx.generatedAt,
  };
}

export interface BalanceExportInput {
  balances: Array<{ name: string; balance_cents: number }>;
  dre: DreStatementRow[];
  flow: { inflowCents: Cents; outflowCents: Cents };
}

/** "Balanço" do período: saldos por conta (posição), resultado (competência) e caixa (data real) — em blocos separados. */
export function balanceSpec(input: BalanceExportInput, ctx: ExportContext): ReportSpec {
  const result = input.dre.find((r) => r.key === 'result');
  const net = input.dre.find((r) => r.key === 'net');
  return {
    id: 'balanco', title: 'Balanço financeiro', basis: 'Saldos = posição na data final; resultado = competência; entradas/saídas = caixa', period: ctx.period, filters: ctx.filters ?? [],
    columns: [{ key: 'item', label: 'Item', kind: 'text' }, { key: 'group', label: 'Bloco', kind: 'text' }, { key: 'value', label: 'Valor', kind: 'money' }],
    rows: [
      ...input.balances.map((b) => ({ item: b.name, group: 'Saldo por conta', value: b.balance_cents })),
      { item: 'Receita líquida', group: 'Resultado (competência)', value: net?.current ?? 0 },
      { item: 'Resultado operacional', group: 'Resultado (competência)', value: result?.current ?? 0 },
      { item: 'Entradas de caixa', group: 'Caixa (data real)', value: input.flow.inflowCents },
      { item: 'Saídas de caixa', group: 'Caixa (data real)', value: input.flow.outflowCents },
    ],
    totals: [{ label: 'Saldo total das contas', cents: input.balances.reduce((s, b) => s + b.balance_cents, 0) }],
    generatedAt: ctx.generatedAt,
  };
}

/** Day Card dos convidados (derivado das reservas): a mesma lista que a tela mostra. */
export function dayCardSpec(rows: DayCardRow[], ctx: ExportContext): ReportSpec {
  return {
    id: 'day-card-convidados', title: 'Day Card — convidados dos sócios', basis: 'Competência (data da reserva); valor derivado da reserva, não de pagamento registrado', period: ctx.period, filters: ctx.filters ?? [],
    columns: [
      { key: 'occurred_on', label: 'Data', kind: 'date' }, { key: 'guest_name', label: 'Convidado', kind: 'text' },
      { key: 'booked_by', label: 'Reserva de', kind: 'text' }, { key: 'situation', label: 'Situação', kind: 'text' },
      { key: 'charged_cents', label: 'Valor', kind: 'money' },
    ],
    rows: rows.map((r) => ({ occurred_on: r.occurred_on, guest_name: r.guest_name, booked_by: r.booked_by ?? '', situation: r.exempt ? 'Isento' : 'Cobrado', charged_cents: r.charged_cents })),
    totals: [{ label: 'Day Card das linhas exibidas', cents: rows.reduce((s, r) => s + r.charged_cents, 0), column: 'charged_cents' }],
    generatedAt: ctx.generatedAt,
  };
}

export const ENTRY_KIND_LABEL: Record<FinEntry['kind'], string> = {
  expense: 'Despesa', revenue: 'Receita', contribution: 'Aporte', withdrawal: 'Retirada', transfer: 'Transferência', member_refund: 'Devolução a sócio',
};

const ENTRY_STATUS_LABEL: Record<FinEntry['display_status'], string> = { pending: 'Pendente', partial: 'Parcial', paid: 'Paga', canceled: 'Cancelada', overdue: 'Vencida' };

export function entriesSpec(rows: FinEntry[], ctx: ExportContext & { categoryName: (id: string | null) => string }): ReportSpec {
  return {
    id: 'contas-a-pagar', title: 'Contas a pagar e lançamentos', basis: 'Competência e vencimento (posição na data de geração)', period: ctx.period, filters: ctx.filters ?? [],
    columns: [
      { key: 'due_date', label: 'Vencimento', kind: 'date' }, { key: 'competence_date', label: 'Competência', kind: 'date' },
      { key: 'description', label: 'Descrição', kind: 'text' }, { key: 'category', label: 'Categoria', kind: 'text' },
      { key: 'status', label: 'Situação', kind: 'text' }, { key: 'amount_cents', label: 'Valor', kind: 'money' },
      { key: 'paid_cents', label: 'Pago', kind: 'money' }, { key: 'remaining_cents', label: 'Em aberto', kind: 'money' },
    ],
    rows: rows.map((r) => ({
      due_date: r.due_date, competence_date: r.competence_date, description: r.description, category: ctx.categoryName(r.category_id),
      status: ENTRY_STATUS_LABEL[r.display_status], amount_cents: r.amount_cents, paid_cents: r.paid_cents, remaining_cents: r.remaining_cents,
    })),
    totals: [
      { label: 'Valor', cents: rows.reduce((s, r) => s + r.amount_cents, 0), column: 'amount_cents' },
      { label: 'Pago', cents: rows.reduce((s, r) => s + r.paid_cents, 0), column: 'paid_cents' },
      { label: 'Em aberto', cents: rows.reduce((s, r) => s + r.remaining_cents, 0), column: 'remaining_cents' },
    ],
    generatedAt: ctx.generatedAt,
  };
}
