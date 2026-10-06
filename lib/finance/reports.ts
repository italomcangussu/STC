/**
 * Composição do DRE, períodos e indicadores do painel.
 *
 * O banco devolve FATOS (linhas por categoria, saldos, somas de a receber/a
 * pagar). Os subtotais e as comparações são calculados aqui, em TypeScript
 * puro — uma só implementação, testável sem banco, e a MESMA que alimenta a
 * tela e a exportação.
 *
 * DRE = competência. Fluxo de caixa = data real do dinheiro. Nunca se misturam.
 */
import { addDays, addMonths, diffDays, firstOfMonth, lastOfMonth, type IsoDate } from './dates';
import type { Cents } from './money';
import type { DreLineKey } from './types';

export type DreBucket = Exclude<DreLineKey, 'none'>;

export interface DreInputLine {
  line: DreBucket;
  amount_cents: number;
}

/** Linhas do DRE no sentido da apresentação: custos/despesas/deduções POSITIVOS. */
export interface DreSummary {
  grossRevenue: Cents;
  deductions: Cents;
  netRevenue: Cents;
  variableCosts: Cents;
  contributionMargin: Cents;
  operationalExpenses: Cents;
  administrativeExpenses: Cents;
  commercialExpenses: Cents;
  financialExpenses: Cents;
  totalExpenses: Cents;
  operatingResult: Cents;
}

export function composeDre(lines: DreInputLine[]): DreSummary {
  const sum = (bucket: DreBucket) => lines.filter((l) => l.line === bucket).reduce((s, l) => s + l.amount_cents, 0);
  const grossRevenue = sum('revenue');
  const deductions = sum('deduction');
  const variableCosts = sum('variable_cost');
  const operationalExpenses = sum('operational');
  const administrativeExpenses = sum('administrative');
  const commercialExpenses = sum('commercial');
  const financialExpenses = sum('financial');
  const netRevenue = grossRevenue - deductions;
  const contributionMargin = netRevenue - variableCosts;
  return {
    grossRevenue, deductions, netRevenue, variableCosts, contributionMargin, operationalExpenses, administrativeExpenses,
    commercialExpenses, financialExpenses,
    totalExpenses: variableCosts + operationalExpenses + administrativeExpenses + commercialExpenses + financialExpenses,
    operatingResult: contributionMargin - operationalExpenses - administrativeExpenses - commercialExpenses - financialExpenses,
  };
}

export const DRE_LINE_LABELS: Record<DreBucket, string> = {
  revenue: 'Receita bruta',
  deduction: 'Descontos, estornos e ajustes',
  variable_cost: 'Custos variáveis',
  operational: 'Despesas operacionais',
  administrative: 'Despesas administrativas',
  commercial: 'Despesas comerciais e de divulgação',
  financial: 'Despesas financeiras',
};

export type DreRowKind = 'line' | 'subtotal' | 'result';

export interface DreStatementRow {
  key: string;
  label: string;
  kind: DreRowKind;
  current: Cents;
  previous: Cents;
  /** Variação absoluta (atual − anterior). */
  delta: Cents;
  /** Variação percentual; `null` quando não há base de comparação. */
  deltaPct: number | null;
  /** % da receita líquida (análise vertical); `null` sem receita. */
  share: number | null;
  /** Linha detalhável por categoria. */
  bucket?: DreBucket;
  /** Mostra com sinal negativo (dedução/custo/despesa). */
  negative?: boolean;
}

export const pctChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

export const shareOf = (value: number, base: number): number | null => (base === 0 ? null : Math.round((value / base) * 1000) / 10);

/**
 * Demonstração completa, na ordem do DRE, com comparação e análise vertical.
 * A linha "comercial" só aparece se o clube a usa (algum valor nos períodos).
 */
export function buildDreStatement(current: DreSummary, previous: DreSummary): DreStatementRow[] {
  const base = current.netRevenue;
  const row = (key: string, label: string, kind: DreRowKind, c: Cents, p: Cents, extra: Partial<DreStatementRow> = {}): DreStatementRow => ({
    key, label, kind, current: c, previous: p, delta: c - p, deltaPct: pctChange(c, p), share: shareOf(c, base), ...extra,
  });
  const rows: DreStatementRow[] = [
    row('gross', 'Receita bruta', 'line', current.grossRevenue, previous.grossRevenue, { bucket: 'revenue' }),
    row('deductions', '(−) Descontos, estornos e ajustes', 'line', current.deductions, previous.deductions, { bucket: 'deduction', negative: true }),
    row('net', '(=) Receita líquida', 'subtotal', current.netRevenue, previous.netRevenue),
    row('variable', '(−) Custos variáveis', 'line', current.variableCosts, previous.variableCosts, { bucket: 'variable_cost', negative: true }),
    row('margin', '(=) Margem de contribuição', 'subtotal', current.contributionMargin, previous.contributionMargin),
    row('operational', '(−) Despesas operacionais', 'line', current.operationalExpenses, previous.operationalExpenses, { bucket: 'operational', negative: true }),
    row('administrative', '(−) Despesas administrativas', 'line', current.administrativeExpenses, previous.administrativeExpenses, { bucket: 'administrative', negative: true }),
  ];
  if (current.commercialExpenses !== 0 || previous.commercialExpenses !== 0) {
    rows.push(row('commercial', '(−) Despesas comerciais e de divulgação', 'line', current.commercialExpenses, previous.commercialExpenses, { bucket: 'commercial', negative: true }));
  }
  rows.push(
    row('financial', '(−) Despesas financeiras', 'line', current.financialExpenses, previous.financialExpenses, { bucket: 'financial', negative: true }),
    row('result', '(=) Resultado operacional', 'result', current.operatingResult, previous.operatingResult),
  );
  return rows;
}

export interface CategoryBreakdownRow {
  category_id: string;
  name: string;
  parent_name: string | null;
  current: Cents;
  previous: Cents;
}

/** Categorias de uma linha do DRE, com o valor dos dois períodos. */
export function breakdownByCategory(
  lines: Array<DreInputLine & { period: 'current' | 'previous'; category_id: string; name: string; parent_name: string | null }>,
  bucket: DreBucket,
): CategoryBreakdownRow[] {
  const map = new Map<string, CategoryBreakdownRow>();
  for (const l of lines.filter((x) => x.line === bucket)) {
    const r = map.get(l.category_id) ?? { category_id: l.category_id, name: l.name, parent_name: l.parent_name, current: 0, previous: 0 };
    r[l.period] += l.amount_cents;
    map.set(l.category_id, r);
  }
  return [...map.values()].sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------
// Períodos
// ------------------------------------------------------------------
export interface Period {
  from: IsoDate;
  to: IsoDate;
}

export type PeriodPreset = 'month' | 'prev_month' | 'quarter' | 'year' | 'last_30' | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'Este mês', prev_month: 'Mês anterior', quarter: 'Este trimestre', year: 'Este ano', last_30: 'Últimos 30 dias', custom: 'Personalizado',
};

export function resolvePeriod(preset: Exclude<PeriodPreset, 'custom'>, today: IsoDate): Period {
  const month = firstOfMonth(today);
  switch (preset) {
    case 'month': return { from: month, to: lastOfMonth(today) };
    case 'prev_month': {
      const prev = addMonths(month, -1);
      return { from: prev, to: lastOfMonth(prev) };
    }
    case 'quarter': {
      const qStart = `${today.slice(0, 5)}${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
      return { from: qStart, to: lastOfMonth(addMonths(qStart, 2)) };
    }
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'last_30': return { from: addDays(today, -29), to: today };
  }
}

/** Período imediatamente anterior, de mesmo tamanho (é o que o banco compara). */
export function previousPeriod(p: Period): Period {
  const len = diffDays(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

/** Meses inteiros? (para avisar quando a mensalidade entra "pelo dia 1" num período quebrado). */
export function isWholeMonths(p: Period): boolean {
  return p.from === firstOfMonth(p.from) && p.to === lastOfMonth(p.to);
}

// ------------------------------------------------------------------
// Indicadores do painel
// ------------------------------------------------------------------
export type IndicatorBasis = 'competencia' | 'caixa' | 'posicao' | 'previsao';

export interface IndicatorDefinition {
  label: string;
  basis: IndicatorBasis;
  definition: string;
  source: string;
}

export const INDICATOR_DEFINITIONS: Record<string, IndicatorDefinition> = {
  balance: {
    label: 'Saldo atual', basis: 'posicao',
    definition: 'Saldo inicial de cada conta + entradas − saídas até hoje, na data em que o dinheiro entrou ou saiu.',
    source: 'Contas e fluxo de caixa',
  },
  revenue: {
    label: 'Receitas', basis: 'competencia',
    definition: 'Receita líquida do DRE no período: mensalidades dos sócios pelo mês cobrado, Card Mensal e Aula avulsa dos alunos pela data do pagamento registrado, Day Card dos convidados pela data da reserva, menos descontos e estornos.',
    source: 'DRE por competência',
  },
  expenses: {
    label: 'Despesas', basis: 'competencia',
    definition: 'Custos variáveis, despesas operacionais, administrativas, comerciais e financeiras pelo mês de competência — pagas ou não.',
    source: 'DRE por competência',
  },
  result: {
    label: 'Resultado', basis: 'competencia',
    definition: 'Receita líquida − custos − despesas (resultado operacional do DRE). Aporte, retirada e transferência não entram.',
    source: 'DRE por competência',
  },
  delinquency: {
    label: 'Inadimplência', basis: 'posicao',
    definition: 'Valor das mensalidades vencidas e não pagas ÷ total em aberto das mensalidades (inclui encargos já calculados). Considera a data de hoje.',
    source: 'Mensalidades dos sócios',
  },
  overdue_payables: {
    label: 'Contas vencidas', basis: 'posicao',
    definition: 'Despesas pendentes ou parciais com vencimento anterior a hoje (saldo ainda por pagar).',
    source: 'Contas a pagar',
  },
  upcoming_payables: {
    label: 'Contas a vencer (30 dias)', basis: 'posicao',
    definition: 'Despesas pendentes que vencem nos próximos 30 dias.',
    source: 'Contas a pagar',
  },
  forecast: {
    label: 'Previsão de caixa (30 dias)', basis: 'previsao',
    definition: 'Saldo atual + mensalidades que vencem em até 30 dias (não vencidas) − contas a pagar vencidas e a vencer em 30 dias. Inadimplência vencida NÃO entra como entrada.',
    source: 'Saldo, mensalidades e contas a pagar',
  },
  cash_in: {
    label: 'Entradas de caixa', basis: 'caixa',
    definition: 'Dinheiro que entrou nas contas no período (data real). Transferências entre contas não contam.',
    source: 'Fluxo de caixa',
  },
  cash_out: {
    label: 'Saídas de caixa', basis: 'caixa',
    definition: 'Dinheiro que saiu das contas no período (data real). Transferências entre contas não contam.',
    source: 'Fluxo de caixa',
  },
};

export interface DelinquencyInput { overdueCents: Cents; openCents: Cents; overdueCount: number; openCount: number }

/** Inadimplência por valor e por quantidade (0–100, uma casa), `null` sem base. */
export function delinquencyRate(i: DelinquencyInput): { byValuePct: number | null; byCountPct: number | null } {
  return { byValuePct: shareOf(i.overdueCents, i.openCents), byCountPct: shareOf(i.overdueCount, i.openCount) };
}

export interface ForecastInput {
  balanceCents: Cents;
  receivableDue30dCents: Cents;
  payableOverdueCents: Cents;
  payableDue30dCents: Cents;
}

/** Previsão conservadora: não conta a inadimplência vencida como entrada certa. */
export function cashForecast30d(i: ForecastInput): { expectedInCents: Cents; expectedOutCents: Cents; projectedBalanceCents: Cents } {
  const expectedOut = i.payableOverdueCents + i.payableDue30dCents;
  return { expectedInCents: i.receivableDue30dCents, expectedOutCents: expectedOut, projectedBalanceCents: i.balanceCents + i.receivableDue30dCents - expectedOut };
}
