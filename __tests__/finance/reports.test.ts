import { describe, expect, it } from 'vitest';
import {
  breakdownByCategory, buildDreStatement, cashForecast30d, composeDre, delinquencyRate, INDICATOR_DEFINITIONS, isWholeMonths, pctChange,
  previousPeriod, resolvePeriod, shareOf, type DreInputLine,
} from '../../lib/finance/reports';

const L = (line: DreInputLine['line'], cents: number): DreInputLine => ({ line, amount_cents: cents });

describe('DRE — composição dos subtotais', () => {
  const lines: DreInputLine[] = [
    L('revenue', 100000), L('revenue', 40000), L('deduction', 5000), L('variable_cost', 18000), L('operational', 30000),
    L('administrative', 8000), L('financial', 2000),
  ];

  it('receita bruta → líquida → margem → resultado operacional', () => {
    const d = composeDre(lines);
    expect(d).toEqual({
      grossRevenue: 140000, deductions: 5000, netRevenue: 135000, variableCosts: 18000, contributionMargin: 117000,
      operationalExpenses: 30000, administrativeExpenses: 8000, commercialExpenses: 0, financialExpenses: 2000,
      totalExpenses: 58000, operatingResult: 77000,
    });
  });

  it('DRE vazio é tudo zero', () => {
    expect(composeDre([]).operatingResult).toBe(0);
  });

  it('prejuízo aparece negativo', () => {
    expect(composeDre([L('revenue', 1000), L('operational', 5000)]).operatingResult).toBe(-4000);
  });

  it('demonstração: comparação com período anterior e análise vertical', () => {
    const cur = composeDre(lines);
    const prev = composeDre([L('revenue', 100000), L('operational', 30000)]);
    const rows = buildDreStatement(cur, prev);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.map((r) => r.key)).toEqual(['gross', 'deductions', 'net', 'variable', 'margin', 'operational', 'administrative', 'financial', 'result']);
    expect(byKey.gross).toMatchObject({ current: 140000, previous: 100000, delta: 40000, deltaPct: 40 });
    expect(byKey.result).toMatchObject({ current: 77000, previous: 70000, delta: 7000, deltaPct: 10 });
    expect(byKey.result.share).toBe(57); // 77000 / 135000
    expect(byKey.deductions.negative).toBe(true);
    expect(byKey.net.kind).toBe('subtotal');
  });

  it('despesas comerciais só aparecem se o clube as usa', () => {
    const cur = composeDre([L('revenue', 1000), L('commercial', 200)]);
    const rows = buildDreStatement(cur, composeDre([]));
    expect(rows.some((r) => r.key === 'commercial')).toBe(true);
    expect(buildDreStatement(composeDre([L('revenue', 1)]), composeDre([])).some((r) => r.key === 'commercial')).toBe(false);
  });

  it('variação sem base de comparação é nula, não infinita', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(shareOf(10, 0)).toBeNull();
    expect(pctChange(50, 100)).toBe(-50);
  });

  it('detalhe por categoria soma por período e ordena do maior para o menor', () => {
    const rows = breakdownByCategory([
      { period: 'current', line: 'operational', amount_cents: 20000, category_id: 'a', name: 'Aluguel', parent_name: 'Estrutura' },
      { period: 'previous', line: 'operational', amount_cents: 18000, category_id: 'a', name: 'Aluguel', parent_name: 'Estrutura' },
      { period: 'current', line: 'operational', amount_cents: 10000, category_id: 'b', name: 'Energia', parent_name: 'Estrutura' },
      { period: 'current', line: 'revenue', amount_cents: 999, category_id: 'c', name: 'Outra', parent_name: null },
    ], 'operational');
    expect(rows.map((r) => [r.name, r.current, r.previous])).toEqual([['Aluguel', 20000, 18000], ['Energia', 10000, 0]]);
  });
});

describe('períodos', () => {
  it('atalhos de período', () => {
    expect(resolvePeriod('month', '2026-10-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolvePeriod('prev_month', '2026-01-17')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePeriod('quarter', '2026-08-02')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('year', '2026-08-02')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolvePeriod('last_30', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' });
  });

  it('período anterior tem o mesmo tamanho e termina na véspera (o que o banco compara)', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(previousPeriod({ from: '2026-10-10', to: '2026-10-12' })).toEqual({ from: '2026-10-07', to: '2026-10-09' });
  });

  it('detecta meses inteiros', () => {
    expect(isWholeMonths({ from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(isWholeMonths({ from: '2026-10-10', to: '2026-10-31' })).toBe(false);
  });
});

describe('indicadores do painel', () => {
  it('inadimplência por valor e por quantidade; sem base é nulo', () => {
    expect(delinquencyRate({ overdueCents: 25000, openCents: 100000, overdueCount: 2, openCount: 8 })).toEqual({ byValuePct: 25, byCountPct: 25 });
    expect(delinquencyRate({ overdueCents: 0, openCents: 0, overdueCount: 0, openCount: 0 })).toEqual({ byValuePct: null, byCountPct: null });
  });

  it('previsão conservadora: vencidas a receber NÃO entram como entrada', () => {
    expect(cashForecast30d({ balanceCents: 500000, receivableDue30dCents: 200000, payableOverdueCents: 30000, payableDue30dCents: 120000 }))
      .toEqual({ expectedInCents: 200000, expectedOutCents: 150000, projectedBalanceCents: 550000 });
  });

  it('todo indicador declara a base (competência, caixa, posição ou previsão) e a definição', () => {
    for (const [key, def] of Object.entries(INDICATOR_DEFINITIONS)) {
      expect(def.definition.length, key).toBeGreaterThan(20);
      expect(['competencia', 'caixa', 'posicao', 'previsao']).toContain(def.basis);
    }
    expect(INDICATOR_DEFINITIONS.revenue.basis).toBe('competencia');
    expect(INDICATOR_DEFINITIONS.cash_in.basis).toBe('caixa');
  });
});
