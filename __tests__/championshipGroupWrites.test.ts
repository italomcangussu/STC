/**
 * Testes de caracterização da **escrita** de grupos e confrontos.
 *
 * Os construtores puros (`buildGroupStageMatches`, `buildLeagueMatches`) já
 * tinham rede; `saveGroups` e `saveLeagueMatches` não tinham nenhuma — e são
 * elas que tocam o banco em três inserts seguidos, sem transação.
 *
 * O objetivo aqui não é aprovar o comportamento atual: é **travá-lo** antes de
 * mexer. Os testes marcados com `DEFEITO` documentam o que acontece hoje
 * quando um dos passos falha no meio.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { saveGroups, saveLeagueMatches, type LeagueMatchRow } from '../lib/championship/groupPersistence';
import type { DrawnGroup } from '../lib/championship/roundRobin';

const grupos: DrawnGroup[] = [
    {
        name: 'A',
        members: [
            { registrationId: 'a1', isSeed: true, drawOrder: 1 },
            { registrationId: 'a2', isSeed: false, drawOrder: 2 },
        ],
    },
    {
        name: 'B',
        members: [
            { registrationId: 'b1', isSeed: true, drawOrder: 1 },
            { registrationId: 'b2', isSeed: false, drawOrder: 2 },
        ],
    },
];

interface Cenario {
    /** Grupos que já existem no banco para esta classe. */
    existentes?: { id: string; group_name: string }[];
    /** Membros que já existem, como `group_id|registration_id`. */
    membrosExistentes?: { group_id: string; registration_id: string }[];
    /** Erro ao consultar os grupos existentes. */
    erroConsulta?: unknown;
    /** Erro ao inserir em championship_groups. */
    erroGrupos?: unknown;
    /** Erro ao inserir em championship_group_members. */
    erroMembros?: unknown;
}

/**
 * Mock do encadeamento do PostgREST, registrando o que foi inserido em cada
 * tabela — é a única forma de ver o estado parcial que um erro no meio deixa.
 */
function montarBanco(cenario: Cenario = {}) {
    const inseridos: Record<string, any[]> = {};

    supabaseMock.from.mockImplementation((tabela: string) => ({
        select: () => ({
            // championship_groups: .eq(championship_id).eq(category)
            eq: () => ({
                eq: () => Promise.resolve({
                    data: cenario.existentes ?? [],
                    error: cenario.erroConsulta ?? null,
                }),
            }),
            // championship_group_members: .in(group_id, [...])
            in: () => Promise.resolve({
                data: cenario.membrosExistentes ?? [],
                error: null,
            }),
        }),
        insert: (linhas: any[]) => {
            const erro = tabela === 'championship_groups' ? cenario.erroGrupos
                : tabela === 'championship_group_members' ? cenario.erroMembros
                    : null;
            if (!erro) (inseridos[tabela] ??= []).push(...linhas);

            const resultado = {
                data: erro ? null : linhas.map((l: any, i: number) => ({
                    id: `${l.group_name ?? 'row'}-id`, group_name: l.group_name, _i: i,
                })),
                error: erro ?? null,
            };
            // `.insert(...)` é aguardável direto e também aceita `.select(...)`.
            return Object.assign(Promise.resolve(resultado), {
                select: () => Promise.resolve(resultado),
            });
        },
    }));

    return inseridos;
}

describe('saveGroups', () => {
    beforeEach(() => supabaseMock.from.mockReset());

    it('grava os grupos e devolve group_name → id', async () => {
        montarBanco();

        const ids = await saveGroups({ championshipId: 'c1', classe: '4ª Classe', groups: grupos });

        expect([...ids.entries()]).toEqual([['A', 'A-id'], ['B', 'B-id']]);
    });

    it('grava o cabeça de chave de cada grupo', async () => {
        const inseridos = montarBanco();

        await saveGroups({ championshipId: 'c1', classe: '4ª Classe', groups: grupos });

        expect(inseridos['championship_groups']).toEqual([
            { championship_id: 'c1', category: '4ª Classe', group_name: 'A', seed_registration_id: 'a1' },
            { championship_id: 'c1', category: '4ª Classe', group_name: 'B', seed_registration_id: 'b1' },
        ]);
    });

    it('grava cada membro com sua ordem de sorteio', async () => {
        const inseridos = montarBanco();

        await saveGroups({ championshipId: 'c1', classe: '4ª Classe', groups: grupos });

        expect(inseridos['championship_group_members']).toEqual([
            { group_id: 'A-id', registration_id: 'a1', is_seed: true, draw_order: 1 },
            { group_id: 'A-id', registration_id: 'a2', is_seed: false, draw_order: 2 },
            { group_id: 'B-id', registration_id: 'b1', is_seed: true, draw_order: 1 },
            { group_id: 'B-id', registration_id: 'b2', is_seed: false, draw_order: 2 },
        ]);
    });

    it('não recria grupo nem membro quando tudo já está gravado — clicar duas vezes não duplica', async () => {
        const inseridos = montarBanco({
            existentes: [{ id: 'A-id', group_name: 'A' }, { id: 'B-id', group_name: 'B' }],
            membrosExistentes: [
                { group_id: 'A-id', registration_id: 'a1' },
                { group_id: 'A-id', registration_id: 'a2' },
                { group_id: 'B-id', registration_id: 'b1' },
                { group_id: 'B-id', registration_id: 'b2' },
            ],
        });

        const ids = await saveGroups({ championshipId: 'c1', classe: '4ª Classe', groups: grupos });

        expect([...ids.entries()]).toEqual([['A', 'A-id'], ['B', 'B-id']]);
        expect(inseridos['championship_groups']).toBeUndefined();
        expect(inseridos['championship_group_members']).toBeUndefined();
    });

    it('propaga erro de consulta em vez de sortear por cima', async () => {
        montarBanco({ erroConsulta: { message: 'permission denied' } });

        await expect(saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos }))
            .rejects.toThrow(/permission denied/);
    });

    it('propaga erro ao criar os grupos', async () => {
        montarBanco({ erroGrupos: { message: 'violates foreign key' } });

        await expect(saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos }))
            .rejects.toThrow(/violates foreign key/);
    });

    it('falha alto quando o insert de membros dá erro — sem sucesso silencioso', async () => {
        // Os dois inserts não estão na mesma transação: os grupos já foram
        // gravados quando este falha. O que a próxima tentativa faz com esse
        // estado é o que os dois testes abaixo travam.
        const inseridos = montarBanco({ erroMembros: { message: 'deadlock detected' } });

        await expect(saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos }))
            .rejects.toThrow(/deadlock detected/);

        expect(inseridos['championship_groups']).toHaveLength(2);
        expect(inseridos['championship_group_members']).toBeUndefined();
    });

    it('tentar de novo grava os membros que faltaram — a operação converge', async () => {
        // O cenário que a versão anterior deixava permanente: os grupos ficaram
        // da falha anterior, sem nenhum membro. Repetir a ação tem que terminar
        // o serviço, não declarar vitória.
        const inseridos = montarBanco({
            existentes: [{ id: 'A-id', group_name: 'A' }, { id: 'B-id', group_name: 'B' }],
        });

        await saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos });

        expect(inseridos['championship_groups']).toBeUndefined();
        expect(inseridos['championship_group_members']).toHaveLength(4);
    });

    it('completa um grupo gravado pela metade sem duplicar quem já está lá', async () => {
        const inseridos = montarBanco({
            existentes: [{ id: 'A-id', group_name: 'A' }, { id: 'B-id', group_name: 'B' }],
            membrosExistentes: [
                { group_id: 'A-id', registration_id: 'a1' },
                { group_id: 'A-id', registration_id: 'a2' },
            ],
        });

        await saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos });

        expect(inseridos['championship_group_members']).toEqual([
            { group_id: 'B-id', registration_id: 'b1', is_seed: true, draw_order: 1 },
            { group_id: 'B-id', registration_id: 'b2', is_seed: false, draw_order: 2 },
        ]);
    });

    it('propaga erro ao consultar os membros existentes', async () => {
        supabaseMock.from.mockImplementation(() => ({
            select: () => ({
                eq: () => ({ eq: () => Promise.resolve({ data: [{ id: 'A-id', group_name: 'A' }], error: null }) }),
                in: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
            }),
        }));

        await expect(saveGroups({ championshipId: 'c1', classe: '4ª', groups: grupos }))
            .rejects.toThrow(/permission denied/);
    });
});

describe('saveLeagueMatches', () => {
    beforeEach(() => supabaseMock.from.mockReset());

    const rows: LeagueMatchRow[] = [
        { matchNumber: 1, phase: 'grupos', a: 'a1', b: 'a2', groupId: 'A-id' },
        { matchNumber: 2, phase: 'grupos', a: 'b1', b: 'b2', groupId: 'B-id' },
    ];
    const phaseToRoundId = new Map([['grupos', 'r1']]);
    const registrationUserMap = new Map([['a1', 'u1'], ['a2', null], ['b1', 'u3'], ['b2', 'u4']]);

    /** `matches` responde à checagem prévia e ao insert. */
    const montarMatches = (opcoes: { jaTemPartidas?: boolean; erroInsert?: unknown } = {}) => {
        const inseridos: any[] = [];
        supabaseMock.from.mockImplementation(() => ({
            select: () => ({
                eq: () => ({
                    in: () => ({
                        limit: () => Promise.resolve({
                            data: opcoes.jaTemPartidas ? [{ id: 'm0' }] : [],
                            error: null,
                        }),
                    }),
                }),
            }),
            insert: (linhas: any[]) => {
                if (!opcoes.erroInsert) inseridos.push(...linhas);
                return Promise.resolve({ error: opcoes.erroInsert ?? null });
            },
        }));
        return inseridos;
    };

    it('não toca no banco quando não há confronto para gravar', async () => {
        montarMatches();

        await saveLeagueMatches({ championshipId: 'c1', rows: [], phaseToRoundId, registrationUserMap });

        expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('liga cada confronto à rodada da sua fase e resolve os user_id', async () => {
        const inseridos = montarMatches();

        await saveLeagueMatches({ championshipId: 'c1', rows, phaseToRoundId, registrationUserMap });

        expect(inseridos).toHaveLength(2);
        expect(inseridos[0]).toMatchObject({
            championship_id: 'c1',
            round_id: 'r1',
            championship_group_id: 'A-id',
            status: 'pending',
            match_number: 1,
            phase: 'grupos',
            registration_a_id: 'a1',
            player_a_id: 'u1',
            player_b_id: null,
        });
    });

    it('recusa gerar por cima de partidas que já existem', async () => {
        const inseridos = montarMatches({ jaTemPartidas: true });

        await expect(saveLeagueMatches({ championshipId: 'c1', rows, phaseToRoundId, registrationUserMap }))
            .rejects.toThrow(/já têm partidas geradas/);

        expect(inseridos).toHaveLength(0);
    });

    it('falha alto quando a fase não tem rodada — sem rodada, a partida some da tela', async () => {
        montarMatches();

        await expect(saveLeagueMatches({
            championshipId: 'c1', rows, phaseToRoundId: new Map(), registrationUserMap,
        })).rejects.toThrow(/Rodada não encontrada para a fase "grupos"/);
    });

    it('propaga erro do insert de confrontos', async () => {
        montarMatches({ erroInsert: { message: 'value too long' } });

        await expect(saveLeagueMatches({ championshipId: 'c1', rows, phaseToRoundId, registrationUserMap }))
            .rejects.toThrow(/value too long/);
    });
});
