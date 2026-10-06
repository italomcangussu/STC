import { describe, expect, it, vi } from 'vitest';
import { FINANCE_ERRORS, financeErrorCode, financeErrorInfo } from '../../lib/finance/errors';

vi.mock('../../lib/notifications', () => ({ notify: { error: vi.fn() } }));

describe('erros do financeiro', () => {
  it('extrai o código do texto do erro do banco', () => {
    expect(financeErrorCode({ message: 'FINANCE_FORBIDDEN' })).toBe('FINANCE_FORBIDDEN');
    expect(financeErrorCode({ message: 'error: REASON_REQUIRED (context)' })).toBe('REASON_REQUIRED');
    expect(financeErrorCode('WAIVER_EXCEEDS_FEES')).toBe('WAIVER_EXCEEDS_FEES');
    expect(financeErrorCode({ message: 'duplicate key' })).toBeNull();
    expect(financeErrorCode(null)).toBeNull();
  });

  it('traduz em causa + o que fazer, nunca em texto cru do banco', () => {
    const e = financeErrorInfo({ message: 'WAIVER_EXCEEDS_FEES' });
    expect(e.message).toMatch(/dispensa/i);
    expect(e.hint).toBeTruthy();
    const unknown = financeErrorInfo({ message: 'relation "x" does not exist: SELECT secret' }, 'Falhou.');
    expect(unknown.message).toBe('Falhou.');
    expect(JSON.stringify(unknown)).not.toContain('secret');
  });

  it('códigos do Postgres viram mensagens úteis', () => {
    expect(financeErrorInfo({ code: '42501', message: 'permission denied' }).message).toBe(FINANCE_ERRORS.FINANCE_FORBIDDEN.message);
    expect(financeErrorInfo({ code: '23514', message: 'x' }).message).toMatch(/valor/i);
  });

  it('todo código tem mensagem não vazia', () => {
    for (const [code, info] of Object.entries(FINANCE_ERRORS)) expect(info.message.length, code).toBeGreaterThan(5);
  });
});
