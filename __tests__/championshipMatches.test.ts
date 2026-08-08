import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { deleteChampionshipMatches } from '../lib/championship/matches';

/** Encadeamento mínimo do PostgREST: `.delete()` seguido de `.in()` ou `.eq()`. */
const stubDelete = (result: { error: unknown } = { error: null }) => {
    const inFilter = vi.fn().mockResolvedValue(result);
    const eqFilter = vi.fn().mockResolvedValue(result);
    supabaseMock.from.mockReturnValue({ delete: () => ({ in: inFilter, eq: eqFilter }) });
    return { inFilter, eqFilter };
};

describe('championship/matches', () => {
    beforeEach(() => supabaseMock.from.mockReset());

    it('apaga por rodada quando o campeonato tem rodadas', async () => {
        const { inFilter, eqFilter } = stubDelete();

        await deleteChampionshipMatches('champ-1', ['r1', 'r2']);

        expect(supabaseMock.from).toHaveBeenCalledWith('matches');
        expect(inFilter).toHaveBeenCalledWith('round_id', ['r1', 'r2']);
        expect(eqFilter).not.toHaveBeenCalled();
    });

    it('cai para o campeonato inteiro quando não há rodada — o modelo antigo', async () => {
        const { inFilter, eqFilter } = stubDelete();

        await deleteChampionshipMatches('champ-1', []);

        expect(eqFilter).toHaveBeenCalledWith('championship_id', 'champ-1');
        expect(inFilter).not.toHaveBeenCalled();
    });

    it('propaga o erro do banco em vez de engolir', async () => {
        stubDelete({ error: { message: 'permission denied' } });

        await expect(deleteChampionshipMatches('champ-1', ['r1']))
            .rejects.toMatchObject({ message: 'permission denied' });
    });
});
