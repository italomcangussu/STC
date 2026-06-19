import { describe, expect, it } from 'vitest';
import { getPublicChampionshipRoute, selectPublicChampionship } from '../lib/publicRoutes';

describe('public championship routing', () => {
  it('does not route the retired public championship list path inside the main app', () => {
    expect(getPublicChampionshipRoute('/campeonatos-publico')).toEqual({ type: 'none' });
    expect(getPublicChampionshipRoute('/campeonatos-publico/')).toEqual({ type: 'none' });
  });

  it('does not route the retired championship subdomain as a public page', () => {
    expect(getPublicChampionshipRoute('/', 'camp.stcplay.com.br')).toEqual({ type: 'none' });
  });

  it('does not route public championship slugs anymore', () => {
    expect(getPublicChampionshipRoute('/resenha-open-2026')).toEqual({ type: 'none' });
    expect(getPublicChampionshipRoute('/')).toEqual({ type: 'none' });
    expect(getPublicChampionshipRoute('/assets/index.js')).toEqual({ type: 'none' });
  });

  it('prioritizes the current active championship and keeps the id when slug is missing', () => {
    expect(selectPublicChampionship([
      { id: 'older-finished', slug: '3-circuito-inverno', status: 'finished', registration_open: false },
      { id: 'resenha-open', slug: null, status: 'active', registration_open: false },
    ])).toEqual({
      id: 'resenha-open',
      slug: null,
    });
  });
});
