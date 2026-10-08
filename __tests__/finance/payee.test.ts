import { describe, expect, it } from 'vitest';
import { payeeCnpjMatches, payeeNameMatches } from '../../lib/finance/payee';
import { canAutoApprovePendencyReceipt } from '../../lib/finance/memberPendency';

const KEY = '12.345.678/0001-95';

describe('favorecido por CNPJ', () => {
  it('CNPJ completo igual à chave Pix confere', () => expect(payeeCnpjMatches('12345678000195', KEY)).toBe(true));
  it('CNPJ diferente não confere', () => expect(payeeCnpjMatches('12345678000196', KEY)).toBe(false));
  it('mascarado confere se os dígitos visíveis (8+) batem', () => {
    expect(payeeCnpjMatches('**3456780001**', KEY)).toBe(true);
    expect(payeeCnpjMatches('**3456790001**', KEY)).toBe(false);
  });
  it('mascarado com poucos dígitos visíveis não basta', () => expect(payeeCnpjMatches('**********0001**', KEY)).toBe(false));
  it('sem leitura ou sem chave não confere', () => {
    expect(payeeCnpjMatches(null, KEY)).toBe(false);
    expect(payeeCnpjMatches('12345678000195', 'a@b.com')).toBe(false);
  });
});

describe('favorecido por nome', () => {
  it('o nome do clube em palavras inteiras dentro do lido confere', () => {
    expect(payeeNameMatches('SOBRAL TENIS CLUBE LTDA', ['Sobral Tênis Clube'])).toBe(true);
  });
  it('o lido ser parte do esperado NÃO confere (era o furo do sentido contrário)', () => {
    expect(payeeNameMatches('Clube', ['Sobral Tênis Clube'])).toBe(false);
  });
  it('fragmento de palavra não confere', () => expect(payeeNameMatches('Sobral Tenisclube', ['Sobral Tênis Clube'])).toBe(false));
});

describe('baixa automática: favorecido', () => {
  const base = {
    ocrStatus: 'ok' as const, possibleDuplicate: false, amountCents: 15000, paidOn: '2026-10-05' as const,
    ocrAmountCents: 15000, ocrPaidOn: '2026-10-05' as const, amountConfidence: 'high' as const, dateConfidence: 'high' as const,
    payee: null, payeeConfidence: 'none' as const, expectedPayees: ['Sobral Tênis Clube'],
  };
  it('CNPJ = chave Pix aprova mesmo sem nome lido', () => {
    expect(canAutoApprovePendencyReceipt({ ...base, payeeDocument: '12345678000195', pixKey: KEY })).toEqual({ ok: true, reason: null });
  });
  it('sem CNPJ e sem nome não aprova', () => {
    expect(canAutoApprovePendencyReceipt({ ...base, pixKey: KEY }).reason).toBe('PAYEE_NOT_CONFIRMED');
  });
  it('nome correto sem CNPJ aprova', () => {
    expect(canAutoApprovePendencyReceipt({ ...base, payee: 'SOBRAL TENIS CLUBE', payeeConfidence: 'high' }).ok).toBe(true);
  });
  it('nada configurado não aprova', () => {
    expect(canAutoApprovePendencyReceipt({ ...base, expectedPayees: [] }).reason).toBe('PAYEE_NOT_CONFIGURED');
  });
});
