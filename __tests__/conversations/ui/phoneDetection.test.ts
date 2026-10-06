import { describe, expect, it } from 'vitest';

import { extractPhoneMatches, splitTextByPhoneMatches } from '@/lib/conversations/phoneDetection';

describe('extractPhoneMatches', () => {
  it('detects required phone formats and normalizes to canonical CRM/UAZAPI format', () => {
    const cases = [
      '88 99998888',
      '88 99999-8888',
      '88 9.9999-8888',
      '88999998888',
    ];

    cases.forEach((input) => {
      const result = extractPhoneMatches(input);
      expect(result).toHaveLength(1);
      expect(result[0]?.normalized).toBe('558899998888');
    });
  });

  it('detects multiple valid numbers in a text block', () => {
    const result = extractPhoneMatches('Contato 88 99999-8888 ou 88 9999-0000');
    expect(result.map((item) => item.normalized)).toEqual([
      '558899998888',
      '558899990000',
    ]);
  });

  it('ignores invalid numeric sequences', () => {
    const result = extractPhoneMatches('Pedido 123456, data 14/04/2026 e ramal 1234');
    expect(result).toHaveLength(0);
  });
});

describe('splitTextByPhoneMatches', () => {
  it('splits text preserving plain fragments and phone fragments', () => {
    const result = splitTextByPhoneMatches('Ligue em 88 99999-8888 hoje');
    expect(result).toEqual([
      { type: 'text', value: 'Ligue em ' },
      { type: 'phone', value: '88 99999-8888', normalized: '558899998888' },
      { type: 'text', value: ' hoje' },
    ]);
  });
});
