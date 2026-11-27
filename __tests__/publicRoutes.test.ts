import { describe, expect, it } from 'vitest';
import { getPublicChampionshipRoute, publicChampionshipPath, selectPublicChampionship } from '../lib/publicRoutes';

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

  it('abre o link público pelo prefixo /campeonato', () => {
    expect(getPublicChampionshipRoute('/campeonato/serra-e-sertao-2026')).toEqual({ type: 'slug', slug: 'serra-e-sertao-2026' });
    expect(getPublicChampionshipRoute('/campeonato/Serra-E-Sertao-2026/')).toEqual({ type: 'slug', slug: 'serra-e-sertao-2026' });
    expect(getPublicChampionshipRoute('/campeonato')).toEqual({ type: 'list' });
    expect(getPublicChampionshipRoute('/campeonatos')).toEqual({ type: 'none' });
    expect(getPublicChampionshipRoute('/campeonato/a/b')).toEqual({ type: 'none' });
    expect(publicChampionshipPath('serra-e-sertao-2026')).toBe('/campeonato/serra-e-sertao-2026');
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
