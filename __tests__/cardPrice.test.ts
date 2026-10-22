import { describe, expect, it } from 'vitest';
import { cardPriceReais, cardTierOf, DEFAULT_CARD_PRICES } from '../lib/students/cardPrice';

describe('Card Mensal por faixa', () => {
  it('Mensalista Kids paga metade do mensalista', () => {
    expect(cardPriceReais('regular', DEFAULT_CARD_PRICES)).toBe(200);
    expect(cardPriceReais('kids', DEFAULT_CARD_PRICES)).toBe(100);
  });
  it('faixa desconhecida ou ausente vale como mensalista', () => {
    expect(cardTierOf(null)).toBe('regular');
    expect(cardTierOf('bebe')).toBe('regular');
    expect(cardPriceReais(undefined, { regularCents: 25000, kidsCents: 12500 })).toBe(250);
  });
});
