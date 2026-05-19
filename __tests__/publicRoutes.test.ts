import { describe, expect, it } from 'vitest';
import { getPublicChampionshipRoute, selectPublicChampionship } from '../lib/publicRoutes';

describe('public championship routing', () => {
  it('detects the public championship list route with or without a trailing slash', () => {
    expect(getPublicChampionshipRoute('/campeonatos-publico')).toEqual({ type: 'list' });
    expect(getPublicChampionshipRoute('/campeonatos-publico/')).toEqual({ type: 'list' });
  });

  it('uses the championship subdomain root as the public championship list route', () => {
    expect(getPublicChampionshipRoute('/', 'camp.stcplay.com.br')).toEqual({ type: 'list' });
  });

  it('detects public championship slugs without treating app routes or assets as public pages', () => {
    expect(getPublicChampionshipRoute('/resenha-open-2026')).toEqual({
      type: 'slug',
      slug: 'resenha-open-2026',
    });
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
