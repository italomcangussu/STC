import { describe, expect, it, vi } from 'vitest';
import { contarGraos, frenteDaRajada, intensidadeDaLuz, soprarChao, EVENTO_RAJADA } from '../lib/chaoSaibro';

describe('chão de saibro · contas puras', () => {
    it('conta os grãos pela área, entre 300 e 1400', () => {
        expect(contarGraos(390, 844)).toBe(803);
        expect(contarGraos(100, 100)).toBe(300);
        expect(contarGraos(1920, 1200)).toBe(1400);
    });

    it('o refletor começa apagado e acende até perto de 1', () => {
        expect(intensidadeDaLuz(0)).toBe(0);
        expect(intensidadeDaLuz(450)).toBeGreaterThan(0);
        expect(intensidadeDaLuz(450)).toBeLessThan(1);
        for (const ms of [1200, 5000, 60000]) {
            expect(intensidadeDaLuz(ms)).toBeGreaterThanOrEqual(0.94);
            expect(intensidadeDaLuz(ms)).toBeLessThanOrEqual(1);
        }
    });

    it('a frente da rajada cruza a tela no sentido pedido', () => {
        expect(frenteDaRajada(0, 1, 390)).toBe(-90);
        expect(frenteDaRajada(1, 1, 390)).toBe(480);
        expect(frenteDaRajada(0, -1, 390)).toBe(480);
        expect(frenteDaRajada(1, -1, 390)).toBe(-90);
    });

    it('soprarChao avisa o chão pelo evento da janela', () => {
        const ouvir = vi.fn();
        window.addEventListener(EVENTO_RAJADA, ouvir);
        soprarChao(-1);
        window.removeEventListener(EVENTO_RAJADA, ouvir);
        expect(ouvir).toHaveBeenCalledTimes(1);
        expect((ouvir.mock.calls[0][0] as CustomEvent).detail).toEqual({ dir: -1 });
    });
});
