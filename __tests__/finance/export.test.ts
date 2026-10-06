import { describe, expect, it } from 'vitest';
import {
  balanceSpec, chargesSpec, cellText, dreDetailSpec, dreSpec, exportFilename, exportMismatches, formatGeneratedAt, movementsSpec,
  neutralizeFormula, toCsv, type ReportSpec,
} from '../../lib/finance/export';
import { toPdf } from '../../lib/finance/exportPdf';
import { buildDreStatement, composeDre } from '../../lib/finance/reports';
import type { ChargeStatementRow, DreDetailRow, MovementRow } from '../../lib/finance/types';

const GEN = '2026-10-06T17:32:00Z'; // 14:32 em Fortaleza
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const ctx = { generatedAt: GEN, period: PERIOD, filters: [{ label: 'Conta', value: 'Banco do clube' }, { label: 'Busca', value: 'luz' }] };

const mv = (over: Partial<MovementRow>): MovementRow => ({
  source_type: 'entry_payment', source_id: 'x', leg: 'main', occurred_on: '2026-09-02', flow: 'expense', description: 'Conta de luz', category_id: null,
  category_name: 'Energia', account_id: 'a', account_name: 'Banco do clube', amount_cents: -30000, is_transfer: false, origin: 'manual', profile_id: null, total_count: 1, ...over,
});

describe('exportação = o que a tela mostra', () => {
  const rows = [
    mv({ amount_cents: -30000 }), mv({ description: 'Mensalidade', flow: 'receipt', amount_cents: 10000, category_name: 'Mensalidades de sócios', origin: 'auto' }),
    mv({ description: 'Depósito', flow: 'transfer', amount_cents: -5000, is_transfer: true, leg: 'out' }),
    mv({ description: 'Depósito', flow: 'transfer', amount_cents: 5000, is_transfer: true, leg: 'in', account_name: 'Caixa' }),
  ];

  it('movimentos: linhas, filtros, totais e data de geração vêm do mesmo objeto da tela', () => {
    const spec = movementsSpec(rows, ctx);
    expect(spec.rows.length).toBe(rows.length);
    expect(spec.basis).toMatch(/Caixa/);
    // transferência não conta nas entradas/saídas, mas está nas linhas (e o saldo das linhas fecha)
    expect(Object.fromEntries(spec.totals.map((t) => [t.label, t.cents]))).toEqual({
      'Entradas (sem transferências)': 10000, 'Saídas (sem transferências)': 30000, 'Saldo das linhas exibidas': -20000,
    });
    expect(exportMismatches(spec)).toEqual([]);
    const csv = toCsv(spec);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Conta;Banco do clube');
    expect(csv).toContain('Busca;luz');
    expect(csv).toContain('Período;01/09/2026 a 30/09/2026');
    expect(csv).toContain('Gerado em;06/10/2026 14:32');
    expect(csv).toContain('Base;Caixa (data real de entrada/saída)');
    expect(csv).toContain('02/09/2026;Conta de luz;Energia;Banco do clube;expense;-300,00');
    expect(csv).toContain('Saldo das linhas exibidas;-200,00');
  });

  it('um total que não bate com as linhas é detectado', () => {
    const spec = movementsSpec(rows, ctx);
    const bad: ReportSpec = { ...spec, totals: spec.totals.map((t) => (t.column ? { ...t, cents: t.cents + 1 } : t)) };
    expect(exportMismatches(bad).length).toBe(1);
  });

  it('DRE: arquivo mostra exatamente as linhas e o resultado da demonstração em tela', () => {
    const cur = composeDre([{ line: 'revenue', amount_cents: 140000 }, { line: 'deduction', amount_cents: 5000 }, { line: 'operational', amount_cents: 30000 }]);
    const prev = composeDre([{ line: 'revenue', amount_cents: 100000 }]);
    const statement = buildDreStatement(cur, prev);
    const spec = dreSpec(statement, { ...ctx, previous: { from: '2026-08-02', to: '2026-08-31' } });
    expect(spec.basis).toMatch(/Competência/);
    expect(spec.rows.length).toBe(statement.length);
    expect(spec.totals).toEqual([{ label: 'Resultado operacional (período atual)', cents: cur.operatingResult }]);
    const csv = toCsv(spec);
    expect(csv).toContain('Receita bruta;1400,00;1000,00;400,00;40,0;103,7');
    expect(csv).toContain('(−) Descontos, estornos e ajustes;-50,00;0,00;-50,00;;3,7');
    expect(csv).toContain('(=) Resultado operacional;1050,00;1000,00;50,00;5,0;77,8');
    expect(csv).toContain('Período anterior (comparação);02/08/2026 a 31/08/2026');
    expect(csv).toContain('Resultado operacional (período atual);1050,00');
  });

  it('detalhe do DRE: total é a soma dos lançamentos listados', () => {
    const detail: DreDetailRow[] = [
      { category_id: 'c', category_name: 'Day Card (convidados)', source_type: 'day_card', source_id: '1', occurred_on: '2026-09-03', description: 'Day Card — A', amount_cents: 5000, profile_id: null },
      { category_id: 'c', category_name: 'Day Card (convidados)', source_type: 'day_card', source_id: '2', occurred_on: '2026-09-04', description: 'Day Card — B', amount_cents: 5000, profile_id: null },
    ];
    const spec = dreDetailSpec(detail, { ...ctx, categoryName: 'Day Card (convidados)' });
    expect(spec.title).toBe('DRE — lançamentos de Day Card (convidados)');
    expect(spec.totals[0].cents).toBe(10000);
    expect(exportMismatches(spec)).toEqual([]);
  });

  it('mensalidades: a situação exportada usa o mesmo rótulo da tela', () => {
    const r: ChargeStatementRow = {
      charge_id: 'c', plan_id: 'p', profile_id: 'u', profile_name: 'Ana Sócia', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-08',
      original_amount_cents: 10000, stored_status: 'open', display_status: 'overdue', in_review: false, principal_base_cents: 10000, principal_paid_cents: 0,
      principal_remaining_cents: 10000, days_late: 12, fine_due_cents: 300, interest_due_cents: 120, fees_due_cents: 420, fees_paid_cents: 0, fees_waived_cents: 0,
      total_due_cents: 10420, fees_configured: true, overdue: true, last_payment_on: null, cancel_reason: null, total_count: 1,
    };
    const spec = chargesSpec([r, { ...r, charge_id: 'd', display_status: 'paid', fees_due_cents: 0, total_due_cents: 0 }], ctx);
    expect(spec.rows[0].status).toBe('Vencida');
    expect(spec.rows[1].status).toBe('Paga');
    expect(spec.totals.map((t) => t.cents)).toEqual([20000, 420, 10420]);
    expect(exportMismatches(spec)).toEqual([]);
    expect(toCsv(spec)).toContain('Ana Sócia;01/08/2026;08/09/2026;Vencida;100,00;4,20;104,20');
  });

  it('balanço traz saldos (posição), resultado (competência) e caixa em blocos separados', () => {
    const cur = composeDre([{ line: 'revenue', amount_cents: 100000 }, { line: 'operational', amount_cents: 40000 }]);
    const spec = balanceSpec({ balances: [{ name: 'Banco do clube', balance_cents: 250000 }, { name: 'Caixa', balance_cents: 10000 }], dre: buildDreStatement(cur, composeDre([])), flow: { inflowCents: 90000, outflowCents: 35000 } }, ctx);
    expect(spec.rows.map((r) => r.group)).toEqual(['Saldo por conta', 'Saldo por conta', 'Resultado (competência)', 'Resultado (competência)', 'Caixa (data real)', 'Caixa (data real)']);
    expect(spec.totals).toEqual([{ label: 'Saldo total das contas', cents: 260000 }]);
  });

  it('CSV neutraliza fórmulas digitadas por usuários e escapa ; e aspas', () => {
    expect(neutralizeFormula('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(neutralizeFormula('+55 88 99999')).toBe("'+55 88 99999");
    expect(neutralizeFormula('Aluguel')).toBe('Aluguel');
    const spec = movementsSpec([mv({ description: '=CMD|"calc"; ok' })], ctx);
    const csv = toCsv(spec);
    expect(csv).toContain(`"'=CMD|""calc""; ok"`);
    // dinheiro negativo gerado pelo sistema NÃO é tratado como fórmula
    expect(csv).toContain('-300,00');
  });

  it('nome do arquivo identifica relatório e período; data legível no fuso do clube', () => {
    const spec = movementsSpec(rows, ctx);
    expect(exportFilename(spec, 'csv')).toBe('financeiro-caixa-movimentos-2026-09-01_2026-09-30.csv');
    expect(formatGeneratedAt('2026-10-06T02:30:00Z')).toBe('05/10/2026 23:30');
    expect(cellText('money', 123456)).toBe('R$ 1.234,56');
    expect(cellText('date', '2026-09-05')).toBe('05/09/2026');
  });

  it('PDF é gerado a partir do mesmo objeto', async () => {
    const blob = await toPdf(movementsSpec(rows, ctx));
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toBe('application/pdf');
  });
});
