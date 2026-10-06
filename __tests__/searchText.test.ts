import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch } from '../lib/searchText';

describe('normalizeSearch', () => {
  it('tira acento e maiúsculas e apara espaços', () => {
    expect(normalizeSearch('  JOÃO   da  Conceição ')).toBe('joao da conceicao');
  });
  it('aceita vazio, null e undefined', () => {
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch(null)).toBe('');
    expect(normalizeSearch(undefined)).toBe('');
  });
});

describe('matchesSearch', () => {
  it('"joao" acha "João" e "SOCIA" acha "Sócia"', () => {
    expect(matchesSearch('joao', 'João Silva')).toBe(true);
    expect(matchesSearch('SOCIA', 'Ana Sócia')).toBe(true);
  });
  it('acento digitado também casa com nome sem acento', () => {
    expect(matchesSearch('João', 'Joao Silva')).toBe(true);
  });
  it('espaço sobrando no fim (teclado do iPhone) não esconde o resultado', () => {
    expect(matchesSearch('ana ', 'Ana Sócia')).toBe(true);
  });
  it('termo vazio ou só espaços casa com tudo', () => {
    expect(matchesSearch('', 'Ana')).toBe(true);
    expect(matchesSearch('   ', 'Ana')).toBe(true);
  });
  it('procura em vários campos e ignora os vazios', () => {
    expect(matchesSearch('maria', null, undefined, 'Maria José')).toBe(true);
    expect(matchesSearch('zé', 'Ana', null)).toBe(false);
  });
});
