import { describe, expect, it } from 'vitest';
import { analyzeReceipt, receiptDecisionNotice, receiptStatusInfo, type ReceiptAnalysisInput, type ReceiptChargeContext } from '../../lib/finance/receipts';
import { computeStatement, type FeePolicy } from '../../lib/finance/lateFees';

const policy: FeePolicy = { confirmed: true, graceDays: 0, fineFixedCents: 300, finePercentBps: null, interestDailyFixedCents: 10, interestDailyPercentBps: null };
const TODAY = '2026-09-20';
const ctx = (id: string, due: string, paidOn: string, over: { original?: number; policy?: FeePolicy; settledPay?: boolean } = {}): ReceiptChargeContext => {
  const base = { originalCents: over.original ?? 10000, dueDate: due, payments: over.settledPay ? [{ paidOn: due, fineCents: 0, interestCents: 0, principalCents: over.original ?? 10000 }] : [] };
  return { id, competenceMonth: due.slice(0, 7) + '-01', dueDate: due, statementAtPaid: computeStatement(base, over.policy ?? policy, paidOn), statementToday: computeStatement(base, over.policy ?? policy, TODAY) };
};
const input = (over: Partial<ReceiptAnalysisInput> = {}): ReceiptAnalysisInput => ({
  declared: { amountCents: null, paidOn: null }, extracted: null, ocrStatus: 'not_run', charges: [ctx('c1', '2026-09-05', '2026-09-05')],
  today: TODAY, possibleDuplicate: false, ...over,
});
const codes = (a: ReturnType<typeof analyzeReceipt>) => a.flags.map((f) => f.code);

describe('conferência do comprovante — sugere, nunca quita', () => {
  it('a análise nunca confirma sozinha (autoConfirms é sempre false)', () => {
    const a = analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-05' } }));
    expect(a.autoConfirms).toBe(false);
    expect(a.verdict).toBe('ok');
    expect(codes(a)).toEqual(['amount_matches_total']);
  });

  it('valor igual ao total atualizado (com multa e juros de atraso) confere', () => {
    const charge = ctx('c1', '2026-09-05', '2026-09-08'); // 3 dias: multa 300 + juros 30
    expect(charge.statementAtPaid.totalDueCents).toBe(10330);
    const a = analyzeReceipt(input({ charges: [charge], declared: { amountCents: 10330, paidOn: '2026-09-08' } }));
    expect(codes(a)).toEqual(expect.arrayContaining(['amount_matches_total', 'paid_after_due']));
    expect(a.verdict).toBe('review'); // fora do prazo = revisar
    expect(a.allocation).toEqual([{ chargeId: 'c1', amountCents: 10330 }]);
  });

  it('pagou só o valor original: alerta falta de encargos', () => {
    const a = analyzeReceipt(input({ charges: [ctx('c1', '2026-09-05', '2026-09-08')], declared: { amountCents: 10000, paidOn: '2026-09-08' } }));
    const f = a.flags.find((x) => x.code === 'amount_principal_only')!;
    expect(f).toMatchObject({ severity: 'warn', cents: 330 });
  });

  it('valor insuficiente e valor excedente', () => {
    const below = analyzeReceipt(input({ declared: { amountCents: 6000, paidOn: '2026-09-05' } }));
    expect(below.flags.find((f) => f.code === 'amount_below_total')).toMatchObject({ cents: 4000 });
    expect(below.allocation).toEqual([{ chargeId: 'c1', amountCents: 6000 }]);
    const above = analyzeReceipt(input({ declared: { amountCents: 12500, paidOn: '2026-09-05' } }));
    expect(above.flags.find((f) => f.code === 'amount_above_total')).toMatchObject({ cents: 2500 });
    expect(above.excessCents).toBe(2500);
  });

  it('ilegível, sem valor e sem data viram alertas — não erro', () => {
    const a = analyzeReceipt(input({ ocrStatus: 'unreadable' }));
    expect(codes(a)).toEqual(expect.arrayContaining(['unreadable', 'amount_missing', 'date_missing']));
    expect(a.verdict).toBe('review');
    // se o sócio informou o valor, "ilegível" deixa de ser alerta
    expect(codes(analyzeReceipt(input({ ocrStatus: 'failed', declared: { amountCents: 10000, paidOn: '2026-09-05' } })))).not.toContain('unreadable');
  });

  it('data no futuro, cobrança já quitada e nenhuma cobrança bloqueiam', () => {
    expect(analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-25' } })).verdict).toBe('blocked');
    const settled = analyzeReceipt(input({ charges: [ctx('c1', '2026-09-05', '2026-09-05', { settledPay: true })], declared: { amountCents: 10000, paidOn: '2026-09-05' } }));
    expect(settled.verdict).toBe('blocked');
    expect(codes(settled)).toContain('charge_already_settled');
    expect(codes(analyzeReceipt(input({ charges: [] })))).toContain('no_charges');
  });

  it('duplicidade: mesmo arquivo, mesmo identificador, ou mesmo valor+data em outro comprovante', () => {
    expect(codes(analyzeReceipt(input({ possibleDuplicate: true, declared: { amountCents: 10000, paidOn: '2026-09-05' } })))).toContain('possible_duplicate');
    const byId = analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-05' }, extracted: { amountCents: 10000, paidOn: '2026-09-05', identifier: 'E123' }, others: [{ amountCents: 1, paidOn: null, identifier: 'E123' }] }));
    expect(codes(byId)).toContain('duplicate_fields');
    const byValue = analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-05' }, others: [{ amountCents: 10000, paidOn: '2026-09-05', identifier: null }] }));
    expect(codes(byValue)).toContain('duplicate_fields');
    expect(codes(analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-05' }, others: [{ amountCents: 9999, paidOn: '2026-09-05', identifier: null }] })))).not.toContain('duplicate_fields');
  });

  it('favorecido: só confere se o clube configurou os nomes esperados', () => {
    const base = { declared: { amountCents: 10000, paidOn: '2026-09-05' }, extracted: { amountCents: 10000, paidOn: '2026-09-05', payee: 'João da Padaria' } };
    expect(codes(analyzeReceipt(input(base)))).not.toContain('payee_mismatch');
    expect(codes(analyzeReceipt(input({ ...base, payeeNames: ['Sobral Tênis Clube'] })))).toContain('payee_mismatch');
    expect(codes(analyzeReceipt(input({ ...base, extracted: { ...base.extracted, payee: 'SOBRAL TENIS CLUBE LTDA' }, payeeNames: ['Sobral Tênis Clube'] })))).not.toContain('payee_mismatch');
  });

  it('o valor corrigido pelo sócio prevalece sobre o lido, com aviso informativo', () => {
    const a = analyzeReceipt(input({ declared: { amountCents: 10000, paidOn: '2026-09-05' }, extracted: { amountCents: 100000, paidOn: '2026-09-05' } }));
    expect(a.amountCents).toBe(10000);
    expect(codes(a)).toContain('amount_edited');
  });

  it('encargos não configurados: avisa que nenhum encargo foi calculado', () => {
    const noPolicy = { ...policy, confirmed: false };
    const a = analyzeReceipt(input({ charges: [ctx('c1', '2026-09-05', '2026-09-10', { policy: noPolicy })], declared: { amountCents: 10000, paidOn: '2026-09-10' } }));
    expect(codes(a)).toContain('fees_not_configured');
  });

  it('várias cobranças: distribui da mais antiga para a mais nova', () => {
    const a = analyzeReceipt(input({
      charges: [ctx('nova', '2026-09-05', '2026-09-05'), ctx('velha', '2026-08-05', '2026-09-05', { policy: { ...policy, confirmed: false } })],
      declared: { amountCents: 15000, paidOn: '2026-09-05' },
    }));
    expect(a.allocation).toEqual([{ chargeId: 'velha', amountCents: 10000 }, { chargeId: 'nova', amountCents: 5000 }]);
  });
});

describe('estados do comprovante e próximo passo para o sócio', () => {
  it('cada estado explica o que acontece depois', () => {
    expect(receiptStatusInfo('submitted').nextStep).toMatch(/continua em aberto/);
    expect(receiptStatusInfo('in_review').label).toBe('Em análise');
    expect(receiptStatusInfo('approved', { reviewedOn: '06/10/2026' }).nextStep).toMatch(/06\/10\/2026/);
    const rej = receiptStatusInfo('rejected', { decisionReason: 'Valor não confere' });
    expect(rej.tone).toBe('danger');
    expect(rej.nextStep).toMatch(/Valor não confere/);
    expect(rej.nextStep).toMatch(/novo comprovante/);
    expect(receiptStatusInfo('superseded').tone).toBe('muted');
  });

  it('aviso enviado ao sócio ao decidir', () => {
    expect(receiptDecisionNotice('approved').title).toBe('Pagamento confirmado');
    expect(receiptDecisionNotice('rejected', 'Ilegível.').body).toMatch(/Ilegível/);
  });
});
