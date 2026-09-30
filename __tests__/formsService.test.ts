import { describe, expect, it, vi } from 'vitest';
import { getPublicAppRoute } from '../lib/publicRoutes';

describe('Public Form & Voting Routes', () => {
  it('correctly identifies /votacao/:slug paths', () => {
    const route = getPublicAppRoute('/votacao/diretoria-2026');
    expect(route).toEqual({
      type: 'form-slug',
      slug: 'diretoria-2026'
    });
  });

  it('correctly identifies /forms/:slug and /form/:slug paths', () => {
    expect(getPublicAppRoute('/forms/pesquisa-quadras')).toEqual({
      type: 'form-slug',
      slug: 'pesquisa-quadras'
    });

    expect(getPublicAppRoute('/form/eleicao-2026')).toEqual({
      type: 'form-slug',
      slug: 'eleicao-2026'
    });
  });

  it('correctly parses ?form=slug and ?votacao=slug query parameters', () => {
    expect(getPublicAppRoute('/', '?form=enquete-saibro')).toEqual({
      type: 'form-slug',
      slug: 'enquete-saibro'
    });

    expect(getPublicAppRoute('/', '?votacao=chapa-1-vs-chapa-2')).toEqual({
      type: 'form-slug',
      slug: 'chapa-1-vs-chapa-2'
    });
  });

  it('correctly routes the club improvement suggestions form', () => {
    expect(getPublicAppRoute('/votacao/sugestoes-melhorias')).toEqual({
      type: 'form-slug',
      slug: 'sugestoes-melhorias'
    });
  });

  it('ignores standard app paths', () => {
    expect(getPublicAppRoute('/agenda')).toEqual({ type: 'none' });
    expect(getPublicAppRoute('/dashboard')).toEqual({ type: 'none' });
    expect(getPublicAppRoute('/admin-panel')).toEqual({ type: 'none' });
  });
});
