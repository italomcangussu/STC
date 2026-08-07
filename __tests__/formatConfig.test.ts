import { describe, expect, it } from 'vitest';
import {
    BRACKET_SLOTS,
    defaultConfigFor,
    validateAgainstParticipants,
    validateFormatShape,
    type GroupKnockoutConfig,
    type KnockoutConfig,
    type RoundRobinConfig,
} from '../lib/championship/formatConfig';

const grupos = (over: Partial<GroupKnockoutConfig> = {}): GroupKnockoutConfig => ({
    format: 'grupo-mata-mata',
    homeAndAway: false,
    groupCount: 4,
    membersPerGroup: 4,
    qualifiersPerGroup: 2,
    bestThirdPlaces: 0,
    seeded: true,
    ...over,
});

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata',
    seeded: true,
    qualifying: null,
    mainDrawStartPhase: 'round_of_16',
    ...over,
});

const pontosCorridos = (over: Partial<RoundRobinConfig> = {}): RoundRobinConfig => ({
    format: 'pontos-corridos',
    homeAndAway: false,
    finalPhase: null,
    ...over,
});

describe('formatConfig', () => {
    describe('BRACKET_SLOTS', () => {
        it('mapeia cada fase para o número de vagas', () => {
            expect(BRACKET_SLOTS).toEqual({
                round_of_32: 32,
                round_of_16: 16,
                quarterfinal: 8,
                semifinal: 4,
            });
        });
    });

    describe('defaultConfigFor', () => {
        it('devolve um padrão estruturalmente válido para cada formato', () => {
            for (const format of ['mata-mata', 'pontos-corridos', 'grupo-mata-mata'] as const) {
                const config = defaultConfigFor(format);
                expect(config.format).toBe(format);
                expect(validateFormatShape(config).ok).toBe(true);
            }
        });
    });

    describe('validateFormatShape — grupos + mata-mata', () => {
        it('aceita 4 grupos de 4 com 2 classificados', () => {
            expect(validateFormatShape(grupos())).toEqual({ ok: true, errors: [] });
        });

        it('recusa quando classificados + melhores terceiros não é potência de 2', () => {
            const r = validateFormatShape(grupos({ groupCount: 3, qualifiersPerGroup: 2 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('potência de 2');
        });

        it('aceita 6 grupos de 4 com 2 classificados e 4 melhores terceiros', () => {
            const r = validateFormatShape(grupos({ groupCount: 6, qualifiersPerGroup: 2, bestThirdPlaces: 4 }));
            expect(r).toEqual({ ok: true, errors: [] });
        });

        it('recusa melhores terceiros acima do número de grupos', () => {
            const r = validateFormatShape(grupos({ bestThirdPlaces: 5 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('melhores terceiros');
        });

        it('recusa classificar todo mundo do grupo', () => {
            const r = validateFormatShape(grupos({ qualifiersPerGroup: 4 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('precisa ser menor que os membros do grupo');
        });

        it('recusa melhores terceiros com grupos de 2', () => {
            const r = validateFormatShape(grupos({ membersPerGroup: 2, qualifiersPerGroup: 1, bestThirdPlaces: 2 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('terceiro colocado');
        });
    });

    describe('validateFormatShape — mata-mata', () => {
        it('aceita quadro de 16 sem qualificatórias', () => {
            expect(validateFormatShape(mataMata())).toEqual({ ok: true, errors: [] });
        });

        it('aceita qualificatórias com vagas dentro do quadro', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } }));
            expect(r).toEqual({ ok: true, errors: [] });
        });

        it('recusa quantidade de vagas diferente do número de jogos', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('uma vaga para cada jogo');
        });

        it('recusa vaga fora do quadro principal', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 1, entrySlots: [99] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('fora do quadro');
        });

        it('recusa vagas repetidas', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 2, entrySlots: [3, 3] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('repetida');
        });
    });

    describe('validateFormatShape — pontos corridos', () => {
        it('aceita sem fase final', () => {
            expect(validateFormatShape(pontosCorridos())).toEqual({ ok: true, errors: [] });
        });

        it('aceita com fase final começando nas quartas', () => {
            const r = validateFormatShape(pontosCorridos({ finalPhase: { startPhase: 'quarterfinal' } }));
            expect(r).toEqual({ ok: true, errors: [] });
        });
    });

    describe('validateAgainstParticipants', () => {
        it('exige que grupos × membros bata com os inscritos', () => {
            const r = validateAgainstParticipants(grupos(), 15);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('16');
            expect(r.errors.join(' ')).toContain('15');
        });

        it('aceita quando grupos × membros bate', () => {
            expect(validateAgainstParticipants(grupos(), 16)).toEqual({ ok: true, errors: [] });
        });

        it('mata-mata sem qualificatórias exige exatamente as vagas do quadro', () => {
            expect(validateAgainstParticipants(mataMata(), 16)).toEqual({ ok: true, errors: [] });
            expect(validateAgainstParticipants(mataMata(), 14).ok).toBe(false);
        });

        it('mata-mata com qualificatórias soma entradas diretas e disputantes', () => {
            const config = mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } });
            // 16 vagas - 4 preenchidas pelo qualify = 12 diretos, + 8 disputando = 20
            expect(validateAgainstParticipants(config, 20)).toEqual({ ok: true, errors: [] });
            expect(validateAgainstParticipants(config, 16).ok).toBe(false);
        });

        it('pontos corridos exige ao menos 2 inscritos', () => {
            expect(validateAgainstParticipants(pontosCorridos(), 1).ok).toBe(false);
            expect(validateAgainstParticipants(pontosCorridos(), 2)).toEqual({ ok: true, errors: [] });
        });

        it('fase final não pode ser maior que o número de inscritos', () => {
            const config = pontosCorridos({ finalPhase: { startPhase: 'round_of_16' } });
            expect(validateAgainstParticipants(config, 10).ok).toBe(false);
            expect(validateAgainstParticipants(config, 16)).toEqual({ ok: true, errors: [] });
        });
    });
});
