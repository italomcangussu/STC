import { describe, expect, it } from 'vitest';
import { applyBps, formatBRL, formatDecimalBRL, legacyAmountToCents, mulDivRound, parseBRL, spreadCents, sumCents } from '../../lib/finance/money';

describe('money — centavos inteiros', () => {
  it('lê texto de dinheiro em vários formatos', () => {
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL('1234,56')).toBe(123456);
    expect(parseBRL('1234.56')).toBe(123456);
    expect(parseBRL('R$ 50')).toBe(5000);
    expect(parseBRL('R$ 50,5')).toBe(5050);
    expect(parseBRL('50')).toBe(5000);
    expect(parseBRL('0,5')).toBe(50);
    expect(parseBRL('-10,00')).toBe(-1000);
  });

  it('ponto com 3 dígitos depois é milhar, não decimal', () => {
    expect(parseBRL('1.234')).toBe(123400);
    expect(parseBRL('12.345.678')).toBe(1234567800);
  });

  it('recusa o que não é dinheiro', () => {
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('')).toBeNull();
    expect(parseBRL(null)).toBeNull();
    expect(parseBRL('12,345')).toBeNull();
    expect(parseBRL('1,2,3x')).toBeNull();
  });

  it('converte o NUMERIC legado sem erro de ponto flutuante', () => {
    expect(legacyAmountToCents(19.99)).toBe(1999);
    expect(legacyAmountToCents(200)).toBe(20000);
    expect(legacyAmountToCents('50.00')).toBe(5000);
    expect(legacyAmountToCents(null)).toBe(0);
    expect(legacyAmountToCents(0.1 + 0.2)).toBe(30);
  });

  it('percentual em pontos-base arredonda metade para cima', () => {
    expect(applyBps(10000, 150)).toBe(150);
    expect(applyBps(333, 150)).toBe(5); // 4,995
    expect(applyBps(1, 5000)).toBe(1); // 0,5 → 1
    expect(applyBps(0, 5000)).toBe(0);
  });

  it('mulDivRound não perde precisão em valores grandes', () => {
    expect(mulDivRound(99_999_999_999, 9_999, 10_000)).toBe(99_989_999_999);
  });

  it('formata moeda e decimal de planilha', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5000)).toBe('R$ 50,00');
    expect(formatDecimalBRL(123456)).toBe('1234,56');
  });

  it('reparte centavos sem perder nem criar nenhum', () => {
    expect(spreadCents(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(spreadCents(10000, 1)).toEqual([10000]);
    expect(sumCents(spreadCents(99999, 12))).toBe(99999);
    expect(spreadCents(-10000, 3)).toEqual([-3334, -3333, -3333]);
    expect(() => spreadCents(100, 0)).toThrow();
  });
});
