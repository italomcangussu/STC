import { describe, expect, it } from 'vitest';
import {
    countSameGroupPairs,
    pairQualifiersForKnockout,
    toGroupStandings,
} from '../lib/championship/knockoutFromGroups';
import type { GroupStanding } from '../lib/championship/groupStage';

const q = (id: string, group: string, position: number, points = 10 - position): GroupStanding => ({
    registrationId: id, groupName: group, position, points, setDiff: 0, gameDiff: 0,
});

describe('championship/knockoutFromGroups', () => {
    describe('toGroupStandings', () => {
        it('converte InternalStanding em GroupStanding com posição por grupo', () => {
            const internas = [
                { userId: 'a1', groupName: 'A', points: 9, setsWon: 4, setsLost: 1, gamesWon: 24, gamesLost: 10 },
                { userId: 'a2', groupName: 'A', points: 6, setsWon: 3, setsLost: 2, gamesWon: 20, gamesLost: 15 },
                { userId: 'b1', groupName: 'B', points: 9, setsWon: 4, setsLost: 0, gamesWon: 24, gamesLost: 8 },
            ] as any[];

            const result = toGroupStandings(internas);

            expect(result.find(r => r.registrationId === 'a1')).toMatchObject({
                groupName: 'A', position: 1, points: 9, setDiff: 3, gameDiff: 14,
            });
            expect(result.find(r => r.registrationId === 'a2')?.position).toBe(2);
            expect(result.find(r => r.registrationId === 'b1')?.position).toBe(1);
        });

        it('ordena por pontos e depois saldo de sets dentro do grupo', () => {
            const internas = [
                { userId: 'x', groupName: 'A', points: 6, setsWon: 2, setsLost: 2, gamesWon: 10, gamesLost: 10 },
                { userId: 'y', groupName: 'A', points: 6, setsWon: 4, setsLost: 1, gamesWon: 10, gamesLost: 10 },
            ] as any[];

            const result = toGroupStandings(internas);
            expect(result.find(r => r.registrationId === 'y')?.position).toBe(1);
            expect(result.find(r => r.registrationId === 'x')?.position).toBe(2);
        });
    });

    describe('pairQualifiersForKnockout', () => {
        it('cruza primeiros com segundos de outro grupo', () => {
            const qualified = [q('a1', 'A', 1), q('b1', 'B', 1), q('a2', 'A', 2), q('b2', 'B', 2)];
            const pares = pairQualifiersForKnockout(qualified);

            expect(pares).toHaveLength(2);
            expect(countSameGroupPairs(pares, qualified)).toBe(0);
        });

        it('evita confronto do mesmo grupo com 4 grupos', () => {
            const qualified = [
                q('a1', 'A', 1), q('b1', 'B', 1), q('c1', 'C', 1), q('d1', 'D', 1),
                q('a2', 'A', 2), q('b2', 'B', 2), q('c2', 'C', 2), q('d2', 'D', 2),
            ];
            const pares = pairQualifiersForKnockout(qualified);

            expect(pares).toHaveLength(4);
            expect(countSameGroupPairs(pares, qualified)).toBe(0);
        });

        it('usa cada classificado uma única vez', () => {
            const qualified = [
                q('a1', 'A', 1), q('b1', 'B', 1), q('c1', 'C', 1), q('d1', 'D', 1),
                q('a2', 'A', 2), q('b2', 'B', 2), q('c2', 'C', 2), q('d2', 'D', 2),
            ];
            const usados = pairQualifiersForKnockout(qualified).flat();
            expect(new Set(usados).size).toBe(8);
        });

        it('põe o primeiro colocado como mandante do confronto', () => {
            const qualified = [q('a1', 'A', 1), q('b1', 'B', 1), q('a2', 'A', 2), q('b2', 'B', 2)];
            const pares = pairQualifiersForKnockout(qualified);
            const primeiros = ['a1', 'b1'];
            expect(pares.every(([mandante]) => primeiros.includes(mandante))).toBe(true);
        });

        it('acomoda melhores terceiros junto dos segundos', () => {
            const qualified = [
                q('a1', 'A', 1), q('b1', 'B', 1), q('c1', 'C', 1), q('d1', 'D', 1),
                q('a2', 'A', 2), q('b2', 'B', 2), q('c2', 'C', 2), q('d2', 'D', 2),
                q('e1', 'E', 1), q('f1', 'F', 1), q('e2', 'E', 2), q('f2', 'F', 2),
                q('a3', 'A', 3), q('b3', 'B', 3), q('c3', 'C', 3), q('d3', 'D', 3),
            ];
            const pares = pairQualifiersForKnockout(qualified);
            expect(pares).toHaveLength(8);
            expect(new Set(pares.flat()).size).toBe(16);
        });

        it('enfrenta os primeiros entre si quando classifica 1 por grupo', () => {
            // Sem segundos colocados não há cruzamento possível: os vencedores
            // de grupo se enfrentam.
            const qualified = [q('a1', 'A', 1), q('b1', 'B', 1)];
            const pares = pairQualifiersForKnockout(qualified);

            expect(pares).toEqual([['a1', 'b1']]);
            expect(countSameGroupPairs(pares, qualified)).toBe(0);
        });

        it('enfrenta os primeiros entre si com 4 grupos e 1 classificado cada', () => {
            const qualified = [q('a1', 'A', 1), q('b1', 'B', 1), q('c1', 'C', 1), q('d1', 'D', 1)];
            const pares = pairQualifiersForKnockout(qualified);

            expect(pares).toHaveLength(2);
            expect(new Set(pares.flat()).size).toBe(4);
            expect(countSameGroupPairs(pares, qualified)).toBe(0);
        });

        it('devolve vazio com menos de 2 classificados', () => {
            expect(pairQualifiersForKnockout([q('a1', 'A', 1)])).toEqual([]);
            expect(pairQualifiersForKnockout([])).toEqual([]);
        });
    });
});
