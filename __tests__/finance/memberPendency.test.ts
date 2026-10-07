import { describe, expect, it } from 'vitest';
import { canAutoApprovePendencyReceipt, isPendencyReminderDue, orderPendencyAllocations } from '../../lib/finance/memberPendency';

describe('régua de cobrança de pendência', () => {
  it('cobra somente nos offsets configurados e nunca antes do vencimento', () => {
    const rule = [0, 3, 7, 14, 21];
    expect(isPendencyReminderDue('2026-10-10', '2026-10-10', rule)).toBe(true);
    expect(isPendencyReminderDue('2026-10-10', '2026-10-13', rule)).toBe(true);
    expect(isPendencyReminderDue('2026-10-10', '2026-10-17', rule)).toBe(true);
    expect(isPendencyReminderDue('2026-10-10', '2026-10-09', rule)).toBe(false);
    expect(isPendencyReminderDue('2026-10-10', '2026-10-12', rule)).toBe(false);
    expect(isPendencyReminderDue('2026-10-10', '2026-11-01', rule)).toBe(false);
  });
});

describe('ordem de quitação consolidada', () => {
  it('prioriza vencidas e depois o vencimento mais antigo', () => {
    const ordered = orderPendencyAllocations([
      { id: 'future', dueDate: '2026-10-20', totalDueCents: 5000 },
      { id: 'old', dueDate: '2026-09-05', totalDueCents: 5000 },
      { id: 'newer', dueDate: '2026-10-05', totalDueCents: 5000 },
    ], '2026-10-07');
    expect(ordered.map((x) => x.id)).toEqual(['old', 'newer', 'future']);
  });
});

describe('baixa automática de comprovante', () => {
  const base = {
    ocrStatus: 'ok' as const,
    possibleDuplicate: false,
    amountCents: 5000,
    paidOn: '2026-10-07',
    ocrAmountCents: 5000,
    ocrPaidOn: '2026-10-07',
    amountConfidence: 'high' as const,
    dateConfidence: 'high' as const,
    payee: 'Sobral Tênis Clube',
    payeeConfidence: 'high' as const,
    expectedPayees: ['Sobral Tênis Clube'],
  };

  it('permite baixa automática somente com leitura forte e coerente', () => {
    expect(canAutoApprovePendencyReceipt(base)).toEqual({ ok: true, reason: null });
  });

  it('manda para revisão quando houver divergência, duplicidade ou baixa confiança', () => {
    expect(canAutoApprovePendencyReceipt({ ...base, amountCents: 6000 })).toMatchObject({ ok: false, reason: 'AMOUNT_MISMATCH' });
    expect(canAutoApprovePendencyReceipt({ ...base, possibleDuplicate: true })).toMatchObject({ ok: false, reason: 'POSSIBLE_DUPLICATE' });
    expect(canAutoApprovePendencyReceipt({ ...base, dateConfidence: 'low' })).toMatchObject({ ok: false, reason: 'LOW_CONFIDENCE' });
    expect(canAutoApprovePendencyReceipt({ ...base, payee: 'Outra Empresa' })).toMatchObject({ ok: false, reason: 'PAYEE_MISMATCH' });
  });
});
