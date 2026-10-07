import { describe, expect, it } from 'vitest';
import { createReadingTracker, pageCountsAsSeen } from '../../../lib/signatures/reading';

describe('"leia até o fim": todas as páginas vistas E o fim alcançado', () => {
  it('só libera quando as duas coisas aconteceram', () => {
    const t = createReadingTracker(3);
    expect(t.snapshot()).toMatchObject({ pagesSeen: 0, pagesTotal: 3, complete: false, percent: 0 });

    [1, 2, 3].forEach((p) => t.markSeen(p));
    expect(t.snapshot()).toMatchObject({ pagesSeen: 3, endReached: false, complete: false });
    expect(t.snapshot().percent).toBeLessThan(100);

    expect(t.markEnd()).toBe(true);
    expect(t.snapshot()).toMatchObject({ complete: true, percent: 100 });
  });

  it('pular direto para o fim NÃO vale: as páginas do meio nunca apareceram', () => {
    const t = createReadingTracker(5);
    t.markSeen(1);
    t.markSeen(5);
    t.markEnd();
    expect(t.snapshot()).toMatchObject({ pagesSeen: 2, endReached: true, complete: false });
    expect(t.snapshot().percent).toBeLessThan(100);
  });

  it('documento de uma página: ver a página e chegar ao fim basta', () => {
    const t = createReadingTracker(1);
    t.markSeen(1);
    t.markEnd();
    expect(t.snapshot().complete).toBe(true);
  });

  it('repetir ou informar página fora da faixa não muda nada (e avisa que não mudou)', () => {
    const t = createReadingTracker(2);
    expect(t.markSeen(1)).toBe(true);
    expect(t.markSeen(1)).toBe(false);
    expect(t.markSeen(0)).toBe(false);
    expect(t.markSeen(3)).toBe(false);
    expect(t.markSeen(1.5)).toBe(false);
    expect(t.markEnd()).toBe(true);
    expect(t.markEnd()).toBe(false);
    expect(t.snapshot().pagesSeen).toBe(1);
  });

  it('o progresso só sobe', () => {
    const t = createReadingTracker(4);
    const seen: number[] = [];
    [1, 2, 3, 4].forEach((p) => { t.markSeen(p); seen.push(t.snapshot().percent); });
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBeLessThan(100);
  });
});

describe('uma página conta como vista com 40% do que cabe dela na tela', () => {
  const base = { isIntersecting: true, pageHeight: 800, viewportHeight: 600 };

  it('página mais alta que a tela: 40% da TELA basta', () => {
    expect(pageCountsAsSeen({ ...base, visibleHeight: 250 })).toBe(true);
    expect(pageCountsAsSeen({ ...base, visibleHeight: 200 })).toBe(false);
  });

  it('página mais baixa que a tela: 40% da PÁGINA basta', () => {
    expect(pageCountsAsSeen({ isIntersecting: true, pageHeight: 300, viewportHeight: 600, visibleHeight: 130 })).toBe(true);
    expect(pageCountsAsSeen({ isIntersecting: true, pageHeight: 300, viewportHeight: 600, visibleHeight: 100 })).toBe(false);
  });

  it('fora da tela ou sem altura medida não conta', () => {
    expect(pageCountsAsSeen({ ...base, isIntersecting: false, visibleHeight: 500 })).toBe(false);
    expect(pageCountsAsSeen({ ...base, visibleHeight: 0 })).toBe(false);
    expect(pageCountsAsSeen({ isIntersecting: true, pageHeight: 0, viewportHeight: 0, visibleHeight: 10 })).toBe(false);
  });
});
