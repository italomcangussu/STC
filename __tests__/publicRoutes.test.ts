import { describe, expect, it } from 'vitest';
import { getPublicChampionshipRoute } from '../lib/publicRoutes';

describe('public championship routing', () => {
  it('detects the public championship list route with or without a trailing slash', () => {
    expect(getPublicChampionshipRoute('/campeonatos-publico')).toEqual({ type: 'list' });
    expect(getPublicChampionshipRoute('/campeonatos-publico/')).toEqual({ type: 'list' });
  });

  it('detects public championship slugs without treating app routes or assets as public pages', () => {
    expect(getPublicChampionshipRoute('/resenha-open-2026')).toEqual({
      type: 'slug',
      slug: 'resenha-open-2026',
    });
    expect(getPublicChampionshipRoute('/')).toEqual({ type: 'none' });
    expect(getPublicChampionshipRoute('/assets/index.js')).toEqual({ type: 'none' });
  });
});
