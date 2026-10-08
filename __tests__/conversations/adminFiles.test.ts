// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { reportDoc, renderPdf, safeName, isFileKind } from '../../supabase/functions/_shared/aiAgent/adminFiles';

const dre = {
  from: '2026-10-01', to: '2026-10-07',
  by_line: [{ line: 'revenue', amount_cents: 1000000 }, { line: 'deduction', amount_cents: 50000 }, { line: 'operational', amount_cents: 300000 }],
  previous_by_line: [{ line: 'revenue', amount_cents: 200000 }, { line: 'operational', amount_cents: 500000 }],
  top: [{ line: 'operational', name: 'Aluguel à vista', amount_cents: 300000 }],
};

describe('arquivos do João: PDF do relatório', () => {
  it('DRE: a tabela traz os mesmos números da consulta e o resultado fecha', () => {
    const d = reportDoc('dre', dre, '08/10/2026 07:40');
    expect(d.title).toBe('STC — DRE — Demonstração do Resultado');
    expect(d.subtitle).toBe('Período: 01/10/2026 a 07/10/2026');
    const [t] = d.tables;
    expect(t.rows[0]).toEqual(['Receitas', 'R$ 10.000,00', 'R$ 2.000,00', '400,0%']);
    expect(t.rows.at(-1)).toEqual(['Resultado', 'R$ 6.500,00', '-R$ 3.000,00', '316,7%']);
    expect(d.tables[1].rows[0]).toEqual(['Aluguel à vista', 'R$ 3.000,00']);
  });

  it('gera um PDF de verdade (assinatura %PDF), com acento e emoji sem quebrar', () => {
    const bytes = renderPdf(jsPDF as never, reportDoc('dre', dre, '08/10/2026 07:40'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1500);
    const txt = renderPdf(jsPDF as never, reportDoc('caixa', { from: '2026-10-01', to: '2026-10-07', opening_cents: 1, inflow_cents: 2, outflow_cents: 3, net_cents: -1, closing_cents: 0 }, 'x'));
    expect(new TextDecoder().decode(txt.slice(0, 5))).toBe('%PDF-');
  });

  it('nome de arquivo seguro e tipos aceitos', () => {
    expect(safeName('DRE — Demonstração do Resultado')).toBe('DRE-Demonstracao-do-Resultado');
    expect(isFileKind('comprovante')).toBe(true);
    expect(isFileKind('senha')).toBe(false);
  });
});
