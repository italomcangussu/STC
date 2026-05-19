import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
    supabaseMock: {
        from: vi.fn(),
    },
}));

vi.mock('../lib/supabase', () => ({
    supabase: supabaseMock,
}));

import {
    createResenhaOpenChampionship,
    createResenhaOpenRounds,
    fetchBracket,
} from '../lib/resenhaOpenService';

function makeChain(resultByTerminal: Record<string, any> = {}) {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'insert']) {
        chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(() => Promise.resolve(resultByTerminal.limit ?? { data: [], error: null }));
    chain.single = vi.fn(() => Promise.resolve(resultByTerminal.single ?? { data: null, error: null }));
    return chain;
}

describe('resenhaOpenService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reutiliza campeonato Resenha Open aberto com mesmo nome e datas', async () => {
        const seriesChain = makeChain({
            single: { data: { id: 'series-1' }, error: null },
        });
        const existingChampionshipChain = makeChain({
            limit: {
                data: [{ id: 'champ-existing', status: 'draft' }],
                error: null,
            },
        });
        const insertChampionshipChain = makeChain({
            single: { data: { id: 'champ-new' }, error: null },
        });

        supabaseMock.from.mockImplementation((table: string) => {
            if (table === 'championship_series') return seriesChain;
            if (table === 'championships') {
                return supabaseMock.from.mock.calls.filter(([calledTable]) => calledTable === 'championships').length === 1
                    ? existingChampionshipChain
                    : insertChampionshipChain;
            }
            throw new Error(`Unexpected table ${table}`);
        });

        const id = await createResenhaOpenChampionship({
            name: 'Resenha Open 2026',
            classe: '4ª Classe',
            startDate: '2026-05-20',
            endDate: '2026-05-23',
        });

        expect(id).toBe('champ-existing');
        expect(insertChampionshipChain.insert).not.toHaveBeenCalled();
    });

    it('reutiliza rodadas existentes antes de inserir novas rodadas', async () => {
        const existingRounds = [
            { id: 'r1', phase: 'preliminar', round_number: 1 },
            { id: 'r2', phase: 'oitavas', round_number: 2 },
            { id: 'r3', phase: 'quartas', round_number: 3 },
            { id: 'r4', phase: 'semifinal', round_number: 4 },
            { id: 'r5', phase: 'final', round_number: 5 },
        ];
        const existingRoundsChain = makeChain({
            limit: { data: existingRounds, error: null },
        });
        const insertRoundsChain = makeChain();

        supabaseMock.from.mockImplementation((table: string) => {
            if (table === 'championship_rounds') {
                return supabaseMock.from.mock.calls.filter(([calledTable]) => calledTable === 'championship_rounds').length === 1
                    ? existingRoundsChain
                    : insertRoundsChain;
            }
            throw new Error(`Unexpected table ${table}`);
        });

        const phaseMap = await createResenhaOpenRounds(
            'champ-existing',
            '4ª Classe',
            () => ({ startDate: '2026-05-20', endDate: '2026-05-23' }),
        );

        expect(phaseMap.get('preliminar')).toBe('r1');
        expect(phaseMap.get('final')).toBe('r5');
        expect(insertRoundsChain.insert).not.toHaveBeenCalled();
    });

    it('usa o chaveamento oficial do app quando Resenha Open ainda não tem partidas no backend', async () => {
        const matchesChain: Record<string, any> = {};
        matchesChain.select = vi.fn(() => matchesChain);
        matchesChain.eq = vi.fn(() => matchesChain);
        matchesChain.order = vi.fn(() => Promise.resolve({ data: [], error: null }));

        const registrationsChain: Record<string, any> = {};
        registrationsChain.select = vi.fn(() => registrationsChain);
        registrationsChain.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));

        supabaseMock.from.mockImplementation((table: string) => {
            if (table === 'matches') return matchesChain;
            if (table === 'championship_registrations') return registrationsChain;
            throw new Error(`Unexpected table ${table}`);
        });

        const bracket = await fetchBracket('resenha-open-2026');

        expect(registrationsChain.select).toHaveBeenCalledWith('id, participant_type, guest_name, class, user:profiles!user_id(name)');
        expect(bracket).toHaveLength(34);
        expect(bracket[0]).toMatchObject({
            bracket_class: '5ª Classe',
            round_phase: 'oitavas',
            match_number: 1,
            player_a_label: 'Davi Arcelino',
            player_b_label: 'Williams Santos',
        });
        expect(bracket.some(match => match.player_a_label === 'Vencedor Jogo 1')).toBe(true);
    });
});
