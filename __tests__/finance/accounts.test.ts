import { describe, expect, it } from 'vitest';
import type { FinAccount } from '../../lib/finance/types';
import { defaultReceiptsAccountId } from '../../lib/finance/accounts';

const account = (id: string, over: Partial<FinAccount> = {}): FinAccount => ({
  id, name: id, kind: 'bank', opening_balance_cents: 0, opening_date: '2026-01-01', is_default_receipts: false, active: true, position: 0, version: 1, ...over,
});

describe('conta pré-selecionada para receber', () => {
  it('a padrão de recebimentos, quando ativa', () => {
    expect(defaultReceiptsAccountId([account('a'), account('b', { is_default_receipts: true })])).toBe('b');
  });

  it('sem padrão, a primeira ativa', () => {
    expect(defaultReceiptsAccountId([account('a', { active: false }), account('b'), account('c')])).toBe('b');
  });

  it('padrão desativada não vale: usa a primeira ativa', () => {
    expect(defaultReceiptsAccountId([account('velha', { is_default_receipts: true, active: false }), account('nova')])).toBe('nova');
  });

  it('nenhuma conta ativa: vazio, para a pessoa escolher', () => {
    expect(defaultReceiptsAccountId([])).toBe('');
    expect(defaultReceiptsAccountId([account('a', { active: false })])).toBe('');
  });
});
