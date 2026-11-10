import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aplicarTema, lerTema, salvarTema, temaEfetivo } from '../../lib/tema';

const sistema = (escuro: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: escuro, addEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
};

describe('tema do app', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset.tema;
        sistema(false);
    });

    it('começa claro, mesmo com o aparelho no escuro', () => {
        sistema(true);
        expect(lerTema()).toBe('claro');
        aplicarTema();
        expect(document.documentElement.dataset.tema).toBeUndefined();
    });

    it('a escolha salva vale e marca o <html>', () => {
        salvarTema('escuro');
        expect(lerTema()).toBe('escuro');
        expect(document.documentElement.dataset.tema).toBe('escuro');
        salvarTema('claro');
        expect(document.documentElement.dataset.tema).toBeUndefined();
    });

    it('"do aparelho" segue o sistema', () => {
        sistema(true);
        expect(temaEfetivo('auto')).toBe('escuro');
        sistema(false);
        expect(temaEfetivo('auto')).toBe('claro');
    });
});
