// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ADMIN_READ_DOMAINS, isAdminReadDomain, renderAdminRead } from '../../supabase/functions/_shared/aiAgent/adminReads';

describe('consultas do assessor: texto escrito pelo servidor', () => {
  it('só aceita os domínios do registro', () => {
    expect(ADMIN_READ_DOMAINS).toHaveLength(8);
    expect(isAdminReadDomain('caixa')).toBe(true);
    expect(isAdminReadDomain('apagar_tudo')).toBe(false);
    expect(isAdminReadDomain(null)).toBe(false);
  });

  it('caixa: entrou, saiu, resultado e saldos, com sinal negativo quando saiu mais', () => {
    const t = renderAdminRead('caixa', { from: '2026-10-01', to: '2026-10-07', opening_cents: 1000000, inflow_cents: 123456, outflow_cents: 200000, net_cents: -76544, closing_cents: 923456 });
    expect(t).toContain('01/10/2026 a 07/10/2026');
    expect(t).toContain('Entrou: R$ 1.234,56');
    expect(t).toContain('Resultado do período: -R$ 765,44');
    expect(t).toContain('Saldo no fim: R$ 9.234,56');
  });

  it('dre: resultado = receitas − deduções − despesas, e compara com o período anterior', () => {
    const t = renderAdminRead('dre', {
      from: '2026-10-01', to: '2026-10-07',
      by_line: [{ line: 'revenue', amount_cents: 1000000 }, { line: 'deduction', amount_cents: 50000 }, { line: 'operational', amount_cents: 300000 }, { line: 'administrative', amount_cents: 18000 }],
      previous_by_line: [{ line: 'revenue', amount_cents: 200000 }, { line: 'operational', amount_cents: 500000 }],
      top: [{ line: 'operational', name: 'Aluguel', amount_cents: 300000 }],
    });
    expect(t).toContain('resultado R$ 632,00'.replace('R$ 632,00', 'R$ 6.320,00'));
    expect(t).toContain('Período anterior (mesma duração): receitas R$ 2.000,00, despesas R$ 5.000,00, resultado -R$ 3.000,00');
    expect(t).toContain('Aluguel: R$ 3.000,00');
  });

  it('receber/pagar, receita de alunos, ocupação e assinaturas trazem os números do banco', () => {
    expect(renderAdminRead('receber_pagar', { receivables: { open_cents: 50000, open_count: 4, overdue_cents: 20000, overdue_count: 2, overdue_members: 2, due_7d_cents: 10000, due_30d_cents: 30000 },
      payables: { payable_open_cents: 80000, payable_overdue_cents: 0, payable_overdue_count: 0, payable_due_7d_cents: 80000, payable_due_30d_cents: 80000 } }))
      .toMatch(/A receber: R\$ 500,00 em aberto \(4 cobranças\); vencido R\$ 200,00 \(2 cobranças, 2 sócios\)[\s\S]*A pagar: R\$ 800,00/);
    expect(renderAdminRead('receita_alunos', { from: '2026-10-01', to: '2026-10-07', count: 3, total_cents: 90000, by_category: [{ name: 'Card Mensal (alunos)', amount_cents: 90000 }] }))
      .toContain('R$ 900,00 em 3 lançamentos');
    expect(renderAdminRead('ocupacao', { date: '2026-10-07', items: [{ court: 'Quadra 1', start: '19:00', end: '20:00', type: 'Play', by: 'Ana' }, { court: 'Quadra 1', start: '20:00', end: '21:00', type: 'Aula', by: null }] }))
      .toBe('Reservas de 07/10/2026:\nQuadra 1: 19:00-20:00 Play (Ana) · 20:00-21:00 Aula');
    expect(renderAdminRead('ocupacao', { date: '2026-10-07', items: [] })).toBe('Sem reservas em 07/10/2026.');
    expect(renderAdminRead('assinaturas', { documents: [{ title: 'Regimento', version: 2, due_at: '2026-10-20T00:00:00Z', recipients: 100, signed: 60, notifications_failed: 3, no_phone: 1 }] }))
      .toBe('- Regimento (v2): 60 de 100 assinaram, faltam 40, prazo 20/10/2026 · 3 aviso(s) com falha, 1 sem telefone');
  });

  it('listas vazias e dados ausentes não quebram nem inventam', () => {
    expect(renderAdminRead('comprovantes', { total: 0, items: [] })).toBe('Nenhum comprovante aguardando análise.');
    expect(renderAdminRead('acessos', { total: 0, items: [] })).toBe('Nenhum pedido de acesso pendente.');
    expect(renderAdminRead('assinaturas', { documents: [] })).toBe('Não há documento publicado para assinatura.');
    expect(() => renderAdminRead('caixa', null)).not.toThrow();
    expect(renderAdminRead('comprovantes', { total: 17, items: [{ member: 'Ana', status: 'submitted', declared_amount_cents: 15000, declared_paid_on: '2026-10-06', created_at: '2026-10-06T12:00:00Z', possible_duplicate: true }] }))
      .toMatch(/17 comprovantes aguardando análise:\n- Ana: R\$ 150,00, pago em 06\/10\/2026, enviado em 06\/10\/2026 ⚠ possível duplicado\n…e mais 16\./);
  });
});
