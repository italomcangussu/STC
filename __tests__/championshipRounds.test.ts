import { describe, expect, it } from 'vitest';
import { ROUND_PHASES, deriveRounds } from '../lib/championship/rounds';
import type { GroupKnockoutConfig, KnockoutConfig, RoundRobinConfig } from '../lib/championship/formatConfig';

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16', ...over,
});
const pontos = (over: Partial<RoundRobinConfig> = {}): RoundRobinConfig => ({
    format: 'pontos-corridos', homeAndAway: false, finalPhase: null, ...over,
});
const grupos = (over: Partial<GroupKnockoutConfig> = {}): GroupKnockoutConfig => ({
    format: 'grupo-mata-mata', homeAndAway: false, groupCount: 4, membersPerGroup: 4,
    qualifiersPerGroup: 2, bestThirdPlaces: 0, seeded: true, ...over,
});

describe('championship/rounds', () => {
    describe('ROUND_PHASES', () => {
        it('usa o vocabulário reconhecido por resolve_championship_final_phases', () => {
            expect(ROUND_PHASES.semifinal.phase).toBe('semifinal');
            expect(ROUND_PHASES.semifinal.phase).toContain('semi');
            expect(ROUND_PHASES.quarterfinal.phase).toBe('quartas');
            expect(ROUND_PHASES.round_of_16.phase).toBe('oitavas');
            expect(ROUND_PHASES.round_of_32.phase).toBe('16avos');
        });
    });

    describe('deriveRounds — mata-mata', () => {
        it('gera oitavas até final para quadro de 16', () => {
            const rounds = deriveRounds(mataMata(), 16);
            expect(rounds.map(r => r.phase)).toEqual(['oitavas', 'quartas', 'semifinal', 'final']);
            expect(rounds.map(r => r.roundNumber)).toEqual([1, 2, 3, 4]);
            expect(rounds[0].matchNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
            expect(rounds[1].matchNumbers).toEqual([9, 10, 11, 12]);
            expect(rounds[2].matchNumbers).toEqual([13, 14]);
            expect(rounds[3].matchNumbers).toEqual([15]);
        });

        it('emite a final com phase e name exatos que o SQL procura', () => {
            const final = deriveRounds(mataMata(), 16).at(-1)!;
            expect(final.phase).toBe('final');
            expect(final.name).toBe('Final');
        });

        it('prefixa qualificatórias e desloca a numeração dos jogos', () => {
            const config = mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } });
            const rounds = deriveRounds(config, 20);
            expect(rounds.map(r => r.phase)).toEqual(['qualify', 'oitavas', 'quartas', 'semifinal', 'final']);
            expect(rounds[0].matchNumbers).toEqual([1, 2, 3, 4]);
            expect(rounds[1].matchNumbers).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
        });

        it('gera só semifinal e final para quadro de 4', () => {
            const rounds = deriveRounds(mataMata({ mainDrawStartPhase: 'semifinal' }), 4);
            expect(rounds.map(r => r.phase)).toEqual(['semifinal', 'final']);
        });
    });

    describe('deriveRounds — pontos corridos', () => {
        it('gera um turno para 6 participantes sem ida e volta', () => {
            const rounds = deriveRounds(pontos(), 6);
            expect(rounds).toHaveLength(1);
            expect(rounds[0].phase).toBe('classificatoria');
            expect(rounds[0].matchNumbers).toHaveLength(15);
        });

        it('dobra os confrontos com ida e volta', () => {
            const rounds = deriveRounds(pontos({ homeAndAway: true }), 6);
            expect(rounds).toHaveLength(2);
            expect(rounds[0].matchNumbers).toHaveLength(15);
            expect(rounds[1].matchNumbers).toHaveLength(15);
            expect(rounds[1].phase).toBe('classificatoria-volta');
        });

        it('acrescenta a fase final quando configurada', () => {
            const rounds = deriveRounds(pontos({ finalPhase: { startPhase: 'quarterfinal' } }), 8);
            expect(rounds.map(r => r.phase)).toEqual(['classificatoria', 'quartas', 'semifinal', 'final']);
        });
    });

    describe('deriveRounds — grupos + mata-mata', () => {
        it('gera uma rodada de grupos e o mata-mata dos classificados', () => {
            const rounds = deriveRounds(grupos(), 16);
            expect(rounds.map(r => r.phase)).toEqual(['grupos', 'quartas', 'semifinal', 'final']);
            expect(rounds[0].matchNumbers).toHaveLength(24);
            expect(rounds[1].matchNumbers).toHaveLength(4);
        });

        it('gera turno e returno nos grupos com ida e volta', () => {
            const rounds = deriveRounds(grupos({ homeAndAway: true }), 16);
            expect(rounds[0].phase).toBe('grupos');
            expect(rounds[1].phase).toBe('grupos-volta');
            expect(rounds[1].matchNumbers).toHaveLength(24);
        });

        it('considera melhores terceiros no tamanho do mata-mata', () => {
            const config = grupos({ groupCount: 6, membersPerGroup: 4, qualifiersPerGroup: 2, bestThirdPlaces: 4 });
            const rounds = deriveRounds(config, 24);
            expect(rounds.map(r => r.phase)).toEqual(['grupos', 'oitavas', 'quartas', 'semifinal', 'final']);
        });

        it('gera só a final quando apenas 2 classificam', () => {
            const config = grupos({ groupCount: 2, membersPerGroup: 4, qualifiersPerGroup: 1, bestThirdPlaces: 0 });
            const rounds = deriveRounds(config, 8);
            expect(rounds.map(r => r.phase)).toEqual(['grupos', 'final']);
        });
    });

    describe('deriveRounds — validação', () => {
        it('recusa configuração incompatível com o número de inscritos', () => {
            expect(() => deriveRounds(mataMata(), 13)).toThrow(/13/);
        });
    });
});
