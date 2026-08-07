import { describe, expect, it } from 'vitest';
import {
    assignToSlot, buildEmptyBracket, seedPositionFor, seedSlots, validateBracket,
} from '../lib/championship/bracket';
import type { KnockoutConfig } from '../lib/championship/formatConfig';

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16', ...over,
});

describe('championship/bracket', () => {
    describe('seedSlots', () => {
        it('distribui 8 vagas no padrão do tênis', () => {
            expect(seedSlots(8)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
        });

        it('põe cabeça 1 na primeira vaga e cabeça 2 na última', () => {
            for (const size of [4, 8, 16, 32]) {
                const slots = seedSlots(size);
                expect(slots[0]).toBe(1);
                expect(slots[size - 1]).toBe(2);
            }
        });

        it('gera uma permutação completa sem repetição', () => {
            const slots = seedSlots(16);
            expect([...slots].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
        });

        it('emparelha cada cabeça com o complementar na primeira rodada', () => {
            const slots = seedSlots(16);
            for (let i = 0; i < slots.length; i += 2) {
                expect(slots[i] + slots[i + 1]).toBe(17);
            }
        });
    });

    describe('seedPositionFor', () => {
        it('mantém cabeças 1 e 2 em metades opostas', () => {
            expect(seedPositionFor(16, 1)).toBe(1);
            expect(seedPositionFor(16, 2)).toBe(16);
        });

        it('põe o cabeça 3 na metade do 2 e o 4 na metade do 1', () => {
            expect(seedPositionFor(8, 3)).toBe(5);
            expect(seedPositionFor(8, 4)).toBe(4);
        });
    });

    describe('buildEmptyBracket', () => {
        it('gera as vagas do quadro de 16 com ligações de vencedor', () => {
            const bracket = buildEmptyBracket(mataMata(), 16);
            expect(bracket).toHaveLength(15);
            expect(bracket[0]).toMatchObject({ matchNumber: 1, phase: 'oitavas', a: null, b: null });

            const quartas1 = bracket.find(s => s.matchNumber === 9)!;
            expect(quartas1.phase).toBe('quartas');
            expect(quartas1.aSourceMatch).toBe(1);
            expect(quartas1.bSourceMatch).toBe(2);

            const final = bracket.find(s => s.matchNumber === 15)!;
            expect(final.phase).toBe('final');
            expect(final.aSourceMatch).toBe(13);
            expect(final.bSourceMatch).toBe(14);
        });

        it('liga vencedores das qualificatórias às vagas configuradas', () => {
            const config = mataMata({ qualifying: { matchCount: 2, entrySlots: [2, 15] } });
            const bracket = buildEmptyBracket(config, 18);
            const qualify = bracket.filter(s => s.phase === 'qualify');
            expect(qualify).toHaveLength(2);

            // vaga 2 do quadro = lado B do primeiro jogo das oitavas
            const primeiro = bracket.find(s => s.phase === 'oitavas' && s.matchNumber === 3)!;
            expect(primeiro.bSourceMatch).toBe(qualify[0].matchNumber);

            // vaga 15 = lado A do oitavo jogo das oitavas
            const oitavo = bracket.find(s => s.phase === 'oitavas' && s.matchNumber === 10)!;
            expect(oitavo.aSourceMatch).toBe(qualify[1].matchNumber);
        });
    });

    describe('assignToSlot', () => {
        it('preenche a vaga sem mutar o array original', () => {
            const bracket = buildEmptyBracket(mataMata(), 16);
            const next = assignToSlot(bracket, 1, 'a', 'r1');
            expect(next.find(s => s.matchNumber === 1)!.a).toBe('r1');
            expect(bracket.find(s => s.matchNumber === 1)!.a).toBeNull();
        });

        it('limpa a vaga quando recebe null', () => {
            const bracket = assignToSlot(buildEmptyBracket(mataMata(), 16), 1, 'a', 'r1');
            expect(assignToSlot(bracket, 1, 'a', null).find(s => s.matchNumber === 1)!.a).toBeNull();
        });
    });

    describe('validateBracket', () => {
        const cheia = () => {
            let b = buildEmptyBracket(mataMata({ mainDrawStartPhase: 'semifinal' }), 4);
            b = assignToSlot(b, 1, 'a', 'r1');
            b = assignToSlot(b, 1, 'b', 'r2');
            b = assignToSlot(b, 2, 'a', 'r3');
            b = assignToSlot(b, 2, 'b', 'r4');
            return b;
        };

        it('aceita chave completa e sem repetição', () => {
            const r = validateBracket(cheia(), []);
            expect(r.ok).toBe(true);
            expect(r.errors).toEqual([]);
        });

        it('recusa vaga vazia', () => {
            const b = assignToSlot(cheia(), 2, 'b', null);
            const r = validateBracket(b, []);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('vaga');
        });

        it('recusa atleta em duas vagas', () => {
            const b = assignToSlot(cheia(), 2, 'b', 'r1');
            const r = validateBracket(b, []);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('duas vagas');
        });

        it('não exige atleta em vaga que recebe vencedor', () => {
            const r = validateBracket(cheia(), []);
            // o jogo 3 (final) fica vazio de propósito: recebe os vencedores
            expect(r.errors.join(' ')).not.toContain('Jogo 3');
        });

        it('avisa, sem bloquear, quando dois cabeças caem no mesmo lado', () => {
            const r = validateBracket(cheia(), ['r1', 'r2']);
            expect(r.ok).toBe(true);
            expect(r.warnings.join(' ')).toContain('mesmo lado');
        });

        it('não avisa quando os cabeças estão em lados opostos', () => {
            const r = validateBracket(cheia(), ['r1', 'r3']);
            expect(r.ok).toBe(true);
            expect(r.warnings).toEqual([]);
        });
    });
});
