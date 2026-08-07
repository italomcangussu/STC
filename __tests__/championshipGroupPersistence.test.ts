import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { buildGroupStageMatches, buildLeagueMatches } from '../lib/championship/groupPersistence';
import type { DrawnGroup } from '../lib/championship/roundRobin';

const grupos: DrawnGroup[] = [
    {
        name: 'A',
        members: [
            { registrationId: 'a1', isSeed: true, drawOrder: 1 },
            { registrationId: 'a2', isSeed: false, drawOrder: 2 },
            { registrationId: 'a3', isSeed: false, drawOrder: 3 },
        ],
    },
    {
        name: 'B',
        members: [
            { registrationId: 'b1', isSeed: true, drawOrder: 1 },
            { registrationId: 'b2', isSeed: false, drawOrder: 2 },
            { registrationId: 'b3', isSeed: false, drawOrder: 3 },
        ],
    },
];

const groupIds = new Map([['A', 'gid-a'], ['B', 'gid-b']]);

describe('championship/groupPersistence', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('buildGroupStageMatches', () => {
        it('gera todos os confrontos de cada grupo', () => {
            const rows = buildGroupStageMatches({ groups: grupos, groupIds, homeAndAway: false });
            // 3 participantes por grupo = 3 confrontos; 2 grupos = 6
            expect(rows).toHaveLength(6);
            expect(rows.filter(r => r.groupId === 'gid-a')).toHaveLength(3);
        });

        it('numera os jogos sequencialmente entre os grupos', () => {
            const rows = buildGroupStageMatches({ groups: grupos, groupIds, homeAndAway: false });
            expect(rows.map(r => r.matchNumber)).toEqual([1, 2, 3, 4, 5, 6]);
        });

        it('marca todos com a fase grupos', () => {
            const rows = buildGroupStageMatches({ groups: grupos, groupIds, homeAndAway: false });
            expect(rows.every(r => r.phase === 'grupos')).toBe(true);
        });

        it('acrescenta o returno com mando invertido', () => {
            const rows = buildGroupStageMatches({ groups: grupos, groupIds, homeAndAway: true });
            expect(rows).toHaveLength(12);

            const ida = rows.filter(r => r.phase === 'grupos');
            const volta = rows.filter(r => r.phase === 'grupos-volta');
            expect(ida).toHaveLength(6);
            expect(volta).toHaveLength(6);
            expect(volta[0].a).toBe(ida[0].b);
            expect(volta[0].b).toBe(ida[0].a);
        });

        it('continua a numeração no returno', () => {
            const rows = buildGroupStageMatches({ groups: grupos, groupIds, homeAndAway: true });
            expect(rows.map(r => r.matchNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        });

        it('não gera confronto em grupo de um só participante', () => {
            const soloGroup: DrawnGroup[] = [{ name: 'A', members: [{ registrationId: 'x', isSeed: false, drawOrder: 1 }] }];
            const rows = buildGroupStageMatches({
                groups: soloGroup, groupIds: new Map([['A', 'gid-a']]), homeAndAway: false,
            });
            expect(rows).toEqual([]);
        });
    });

    describe('buildLeagueMatches', () => {
        it('gera todos contra todos, sem grupo', () => {
            const rows = buildLeagueMatches({ registrationIds: ['p1', 'p2', 'p3', 'p4'], homeAndAway: false });
            expect(rows).toHaveLength(6);
            expect(rows.every(r => r.groupId === null)).toBe(true);
            expect(rows.every(r => r.phase === 'classificatoria')).toBe(true);
        });

        it('dobra os confrontos no returno', () => {
            const rows = buildLeagueMatches({ registrationIds: ['p1', 'p2', 'p3'], homeAndAway: true });
            expect(rows).toHaveLength(6);
            expect(rows.filter(r => r.phase === 'classificatoria-volta')).toHaveLength(3);
        });

        it('numera sequencialmente', () => {
            const rows = buildLeagueMatches({ registrationIds: ['p1', 'p2', 'p3'], homeAndAway: true });
            expect(rows.map(r => r.matchNumber)).toEqual([1, 2, 3, 4, 5, 6]);
        });
    });
});
