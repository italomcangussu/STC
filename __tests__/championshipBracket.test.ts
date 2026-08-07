import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import {
    assignToSlot, buildEmptyBracket, saveGenericBracket, seedPositionFor, seedSlots, validateBracket,
    type BracketSlot,
} from '../lib/championship/bracket';
import type { GroupKnockoutConfig, KnockoutConfig, RoundRobinConfig } from '../lib/championship/formatConfig';

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

        it('não trata a fase de grupos como rodada de chave', () => {
            const config: GroupKnockoutConfig = {
                format: 'grupo-mata-mata', homeAndAway: false, groupCount: 4, membersPerGroup: 4,
                qualifiersPerGroup: 2, bestThirdPlaces: 0, seeded: true,
            };
            const bracket = buildEmptyBracket(config, 16);

            // A chave começa nas quartas (8 classificados); os 24 jogos de grupo
            // não são vagas de chaveamento.
            expect(bracket.some(s => s.phase === 'grupos')).toBe(false);
            expect(bracket.filter(s => s.phase === 'quartas')).toHaveLength(4);

            // As quartas recebem classificados dos grupos, não vencedores de jogos.
            const quartas = bracket.filter(s => s.phase === 'quartas');
            expect(quartas.every(s => s.aSourceMatch === undefined && s.bSourceMatch === undefined)).toBe(true);

            // A partir das semis, a progressão volta a ser por vencedor.
            const semi = bracket.find(s => s.phase === 'semifinal')!;
            expect(semi.aSourceMatch).toBe(quartas[0].matchNumber);
        });

        it('não trata a fase classificatória de pontos corridos como rodada de chave', () => {
            const config: RoundRobinConfig = {
                format: 'pontos-corridos', homeAndAway: false,
                finalPhase: { startPhase: 'quarterfinal' },
            };
            const bracket = buildEmptyBracket(config, 8);

            expect(bracket.some(s => s.phase === 'classificatoria')).toBe(false);
            const quartas = bracket.filter(s => s.phase === 'quartas');
            expect(quartas).toHaveLength(4);
            expect(quartas.every(s => s.aSourceMatch === undefined)).toBe(true);
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

    describe('saveGenericBracket', () => {
        const slots: BracketSlot[] = [
            { matchNumber: 1, phase: 'semifinal', a: 'r1', b: 'r2' },
            { matchNumber: 2, phase: 'semifinal', a: 'r3', b: 'r4' },
            { matchNumber: 3, phase: 'final', a: null, b: null, aSourceMatch: 1, bSourceMatch: 2 },
        ];
        const phaseToRoundId = new Map([['semifinal', 'round-semi'], ['final', 'round-final']]);
        const registrationUserMap = new Map<string, string | null>([
            ['r1', 'u1'], ['r2', null], ['r3', 'u3'], ['r4', 'u4'],
        ]);

        beforeEach(() => vi.clearAllMocks());

        function mockMatches(insertResult: any, updateError: any = null) {
            const updateChain: Record<string, any> = {
                update: vi.fn(() => updateChain),
                eq: vi.fn(() => Promise.resolve({ error: updateError })),
            };
            const insertChain: Record<string, any> = {
                insert: vi.fn(() => insertChain),
                select: vi.fn(() => Promise.resolve(insertResult)),
                update: updateChain.update,
                eq: updateChain.eq,
            };
            supabaseMock.from.mockReturnValue(insertChain);
            return insertChain;
        }

        it('insere todas as vagas numa chamada e resolve o usuário de cada inscrição', async () => {
            const chain = mockMatches({
                data: [{ id: 'm1', match_number: 1 }, { id: 'm2', match_number: 2 }, { id: 'm3', match_number: 3 }],
                error: null,
            });

            await saveGenericBracket({ championshipId: 'c1', slots, phaseToRoundId, registrationUserMap });

            const rows = chain.insert.mock.calls[0][0];
            expect(rows).toHaveLength(3);
            expect(rows[0]).toMatchObject({
                championship_id: 'c1', round_id: 'round-semi', match_number: 1,
                registration_a_id: 'r1', player_a_id: 'u1',
                registration_b_id: 'r2', player_b_id: null,
            });
            expect(rows[2]).toMatchObject({ round_id: 'round-final', registration_a_id: null });
        });

        it('liga as FKs de origem só das vagas dependentes', async () => {
            const chain = mockMatches({
                data: [{ id: 'm1', match_number: 1 }, { id: 'm2', match_number: 2 }, { id: 'm3', match_number: 3 }],
                error: null,
            });

            await saveGenericBracket({ championshipId: 'c1', slots, phaseToRoundId, registrationUserMap });

            expect(chain.update).toHaveBeenCalledTimes(1);
            expect(chain.update).toHaveBeenCalledWith({
                player_a_source_match_id: 'm1',
                player_b_source_match_id: 'm2',
            });
        });

        it('recusa fase sem rodada correspondente com mensagem legível', async () => {
            mockMatches({ data: [], error: null });

            await expect(
                saveGenericBracket({
                    championshipId: 'c1',
                    slots,
                    phaseToRoundId: new Map([['semifinal', 'round-semi']]),
                    registrationUserMap,
                })
            ).rejects.toThrow(/fase "final"/);
        });

        it('propaga erro de inserção', async () => {
            mockMatches({ data: null, error: { message: 'violates foreign key' } });

            await expect(
                saveGenericBracket({ championshipId: 'c1', slots, phaseToRoundId, registrationUserMap })
            ).rejects.toThrow('violates foreign key');
        });
    });
});
