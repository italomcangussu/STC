import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { ROUND_PHASES, activateFirstRound, activateRoundByPhase, deriveRounds } from '../lib/championship/rounds';
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

/**
 * Mock encadeável do supabase-js: cada `from()` devolve um builder que registra
 * verbo, payload e filtros, e resolve o próximo resultado da fila. Os builders
 * são thenable porque os updates são aguardados direto no fim da cadeia, sem
 * `.limit()`.
 */
interface Registro {
    tabela: string;
    verbo: 'select' | 'update';
    payload?: Record<string, unknown>;
    filtros: [string, unknown][];
    ordem?: string;
    limite?: number;
}

const prepararSupabase = (resultados: { data?: unknown; error?: { message: string } | null }[]) => {
    const registros: Registro[] = [];
    let proximo = 0;

    supabaseMock.from.mockImplementation((tabela: string) => {
        const registro: Registro = { tabela, verbo: 'select', filtros: [] };
        registros.push(registro);
        const resultado = resultados[proximo++] ?? { data: null, error: null };

        const cadeia: any = {
            select: () => cadeia,
            update: (payload: Record<string, unknown>) => {
                registro.verbo = 'update';
                registro.payload = payload;
                return cadeia;
            },
            eq: (coluna: string, valor: unknown) => {
                registro.filtros.push([coluna, valor]);
                return cadeia;
            },
            order: (coluna: string) => {
                registro.ordem = coluna;
                return cadeia;
            },
            limit: (n: number) => {
                registro.limite = n;
                return Promise.resolve(resultado);
            },
            then: (ok: any, falha: any) => Promise.resolve(resultado).then(ok, falha),
        };

        return cadeia;
    });

    return registros;
};

describe('championship/rounds — publicação', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('activateFirstRound', () => {
        it('publica a rodada de menor round_number e tira o campeonato do rascunho', async () => {
            const registros = prepararSupabase([
                { data: [{ id: 'rodada-1' }], error: null },
                { error: null },
                { error: null },
            ]);

            await activateFirstRound('camp-1', '4ª Classe');

            expect(registros).toHaveLength(3);

            const busca = registros[0];
            expect(busca.tabela).toBe('championship_rounds');
            expect(busca.filtros).toEqual([['championship_id', 'camp-1'], ['class', '4ª Classe']]);
            expect(busca.ordem).toBe('round_number');
            expect(busca.limite).toBe(1);

            const rodada = registros[1];
            expect(rodada.tabela).toBe('championship_rounds');
            expect(rodada.verbo).toBe('update');
            expect(rodada.payload).toEqual({ status: 'active' });
            // A condição de status é o que torna a chamada repetida inofensiva:
            // uma rodada já finalizada não volta a ficar ativa.
            expect(rodada.filtros).toEqual([['id', 'rodada-1'], ['status', 'pending']]);

            const campeonato = registros[2];
            expect(campeonato.tabela).toBe('championships');
            expect(campeonato.verbo).toBe('update');
            expect(campeonato.payload).toEqual({ status: 'ongoing' });
            expect(campeonato.filtros).toEqual([['id', 'camp-1'], ['status', 'draft']]);
        });

        it('não escreve nada quando a classe ainda não tem rodadas', async () => {
            const registros = prepararSupabase([{ data: [], error: null }]);

            await activateFirstRound('camp-1', '4ª Classe');

            expect(registros).toHaveLength(1);
            expect(registros[0].verbo).toBe('select');
        });

        it('propaga erro da publicação sem seguir para o campeonato', async () => {
            const registros = prepararSupabase([
                { data: [{ id: 'rodada-1' }], error: null },
                { error: { message: 'permissão negada' } },
            ]);

            await expect(activateFirstRound('camp-1', '4ª Classe')).rejects.toThrow(/permissão negada/);
            expect(registros).toHaveLength(2);
        });
    });

    describe('activateRoundByPhase', () => {
        it('publica a rodada da fase pedida', async () => {
            const registros = prepararSupabase([
                { data: [{ id: 'rodada-semi' }], error: null },
                { error: null },
                { error: null },
            ]);

            await activateRoundByPhase('camp-1', '4ª Classe', 'semifinal');

            expect(registros[0].filtros).toEqual([
                ['championship_id', 'camp-1'],
                ['class', '4ª Classe'],
                ['phase', 'semifinal'],
            ]);
            expect(registros[1].payload).toEqual({ status: 'active' });
            expect(registros[1].filtros).toEqual([['id', 'rodada-semi'], ['status', 'pending']]);
            expect(registros[2].tabela).toBe('championships');
        });

        it('não escreve nada quando a fase não existe na classe', async () => {
            const registros = prepararSupabase([{ data: [], error: null }]);

            await activateRoundByPhase('camp-1', '4ª Classe', 'quartas');

            expect(registros).toHaveLength(1);
        });
    });
});
