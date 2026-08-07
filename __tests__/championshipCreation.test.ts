import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
    supabaseMock: { from: vi.fn() },
}));

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { createChampionship, ensureSeries, slugify, DEFAULT_SCORING } from '../lib/championship/creation';
import { defaultConfigFor } from '../lib/championship/formatConfig';

function makeChain(resultByTerminal: Record<string, any> = {}) {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'insert']) {
        chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(() => Promise.resolve(resultByTerminal.limit ?? { data: [], error: null }));
    chain.single = vi.fn(() => Promise.resolve(resultByTerminal.single ?? { data: null, error: null }));
    chain.maybeSingle = vi.fn(() => Promise.resolve(resultByTerminal.maybeSingle ?? { data: null, error: null }));
    return chain;
}

describe('championship/creation', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('slugify', () => {
        it('remove acentos, espaços e maiúsculas', () => {
            expect(slugify('Circuito de Inverno')).toBe('circuito-de-inverno');
            expect(slugify('3º Torneio Ação!')).toBe('3o-torneio-acao');
        });
    });

    describe('ensureSeries', () => {
        it('devolve a série existente sem inserir', async () => {
            const chain = makeChain({ maybeSingle: { data: { id: 's1', name: 'Circuito de Inverno', slug: 'circuito-de-inverno' }, error: null } });
            supabaseMock.from.mockReturnValue(chain);

            const serie = await ensureSeries('Circuito de Inverno');

            expect(serie.id).toBe('s1');
            expect(chain.insert).not.toHaveBeenCalled();
        });

        it('cria a série quando não existe', async () => {
            const lookup = makeChain({ maybeSingle: { data: null, error: null } });
            const insert = makeChain({ single: { data: { id: 's2', name: 'Copa Nova', slug: 'copa-nova' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            const serie = await ensureSeries('Copa Nova');

            expect(serie.id).toBe('s2');
            expect(insert.insert).toHaveBeenCalledWith({ name: 'Copa Nova', slug: 'copa-nova' });
        });
    });

    describe('createChampionship', () => {
        const classFormats = {
            '4ª Classe': defaultConfigFor('mata-mata'),
            '5ª Classe': defaultConfigFor('grupo-mata-mata'),
        };
        const params = {
            name: 'Copa Nova 2026',
            classFormats,
            classes: ['4ª Classe', '5ª Classe'],
            startDate: '2026-09-01',
            endDate: '2026-09-05',
            seriesId: 's1',
        };

        it('reutiliza campeonato equivalente em vez de duplicar', async () => {
            const existing = makeChain({ limit: { data: [{ id: 'champ-1' }], error: null } });
            supabaseMock.from.mockReturnValue(existing);

            await expect(createChampionship(params)).resolves.toBe('champ-1');
            expect(existing.insert).not.toHaveBeenCalled();
        });

        it('insere com edition_year derivado da data de início e pontuação padrão', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: { id: 'champ-2' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await expect(createChampionship(params)).resolves.toBe('champ-2');

            expect(insert.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Copa Nova 2026',
                    status: 'draft',
                    start_date: '2026-09-01',
                    end_date: '2026-09-05',
                    series_id: 's1',
                    edition_year: 2026,
                    format_config: classFormats,
                    pts_victory: DEFAULT_SCORING.ptsVictory,
                })
            );
        });

        it('guarda a configuração de cada classe e usa a primeira na coluna format', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: { id: 'champ-4' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await createChampionship(params);

            const row = insert.insert.mock.calls[0][0];
            // coluna única: formato da primeira classe
            expect(row.format).toBe('mata-mata');
            // verdade por classe
            expect(row.format_config['4ª Classe'].format).toBe('mata-mata');
            expect(row.format_config['5ª Classe'].format).toBe('grupo-mata-mata');
        });

        it('usa .is para série nula em vez de .eq', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: { id: 'champ-3' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await createChampionship({ ...params, seriesId: null });

            expect(lookup.is).toHaveBeenCalledWith('series_id', null);
            expect(insert.insert).toHaveBeenCalledWith(
                expect.objectContaining({ series_id: null, edition_year: null })
            );
        });

        it('propaga erro do banco com mensagem legível', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: null, error: { message: 'duplicate key' } } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await expect(createChampionship(params)).rejects.toThrow('duplicate key');
        });
    });
});
