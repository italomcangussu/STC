import { beforeEach, describe, expect, it } from 'vitest';
import { applyPreferences, loadPreferences, savePreferences } from '../../lib/appPreferences';

describe('appPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.nativeFeel;
    delete document.documentElement.dataset.reduceMotion;
  });

  it('começa com tudo desligado no navegador comum', () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    expect(loadPreferences()).toEqual({ nativeFeel: false, reduceMotion: false, keepAwake: false });
  });

  it('liga a sensação nativa por padrão quando instalado como app', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    expect(loadPreferences().nativeFeel).toBe(true);
  });

  it('a escolha salva vence o padrão e volta na próxima leitura', () => {
    savePreferences({ nativeFeel: true, reduceMotion: true, keepAwake: false });
    expect(loadPreferences()).toEqual({ nativeFeel: true, reduceMotion: true, keepAwake: false });
  });

  it('marca e desmarca os atributos no <html>', () => {
    applyPreferences({ nativeFeel: true, reduceMotion: true, keepAwake: false });
    expect(document.documentElement.dataset.nativeFeel).toBe('on');
    expect(document.documentElement.dataset.reduceMotion).toBe('on');
    applyPreferences({ nativeFeel: false, reduceMotion: false, keepAwake: false });
    expect(document.documentElement.dataset.nativeFeel).toBeUndefined();
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
  });
});
