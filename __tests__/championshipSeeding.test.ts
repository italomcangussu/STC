import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { applySeeds, pickSeedsByRanking, type SeedCandidate } from '../lib/championship/seeding';

const cand = (id: string, userId: string | null, name: string): SeedCandidate => ({
    registrationId: id, userId, name,
});

function makeChain(result: any = { data: null, error: null }) {
    const chain: Record<string, any> = {};
    for (const m of ['select', 'eq', 'in', 'update']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: any) => Promise.resolve(result).then(resolve);
    return chain;
}

describe('championship/seeding', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('pickSeedsByRanking', () => {
        const candidates = [
            cand('r1', 'u1', 'Thieslley'),
            cand('r2', 'u2', 'Diego'),
            cand('r3', null, 'Convidado'),
            cand('r4', 'u4', 'Daniel'),
        ];

        it('escolhe na ordem do ranking', () => {
            expect(pickSeedsByRanking(candidates, ['u4', 'u1', 'u2'], 2)).toEqual(['r4', 'r1']);
        });

        it('ignora quem está no ranking mas não está inscrito', () => {
            expect(pickSeedsByRanking(candidates, ['u9', 'u2'], 1)).toEqual(['r2']);
        });

        it('nunca semeia participante sem userId (convidado ou aluno)', () => {
            const result = pickSeedsByRanking(candidates, ['u1', 'u2', 'u4'], 4);
            expect(result).not.toContain('r3');
            expect(result).toHaveLength(3);
        });

        it('devolve lista vazia quando count é zero', () => {
            expect(pickSeedsByRanking(candidates, ['u1'], 0)).toEqual([]);
        });

        it('não repete inscrito quando o ranking traz o mesmo usuário duas vezes', () => {
            expect(pickSeedsByRanking(candidates, ['u1', 'u1', 'u2'], 3)).toEqual(['r1', 'r2']);
        });
    });

    describe('applySeeds', () => {
        it('marca os escolhidos e desmarca o resto da classe', async () => {
            const clearChain = makeChain();
            const setChain = makeChain();
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? clearChain : setChain));

            await applySeeds('champ-1', '5ª Classe', ['r1', 'r2']);

            expect(clearChain.update).toHaveBeenCalledWith({ cabeca_de_chave: false });
            expect(setChain.update).toHaveBeenCalledWith({ cabeca_de_chave: true });
            expect(setChain.in).toHaveBeenCalledWith('id', ['r1', 'r2']);
        });

        it('apenas limpa quando a lista vem vazia', async () => {
            const clearChain = makeChain();
            supabaseMock.from.mockReturnValue(clearChain);

            await applySeeds('champ-1', '5ª Classe', []);

            expect(clearChain.update).toHaveBeenCalledWith({ cabeca_de_chave: false });
            expect(supabaseMock.from).toHaveBeenCalledTimes(1);
        });

        it('propaga erro do banco ao limpar', async () => {
            supabaseMock.from.mockReturnValue(makeChain({ data: null, error: { message: 'permission denied' } }));

            await expect(applySeeds('champ-1', '5ª Classe', ['r1'])).rejects.toThrow('permission denied');
        });
    });
});
