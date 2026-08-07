import { describe, expect, it } from 'vitest';
import { bestThirds, rankQualifiers, type GroupStanding } from '../lib/championship/groupStage';

const s = (
    registrationId: string,
    groupName: string,
    position: number,
    points: number,
    setDiff = 0,
    gameDiff = 0
): GroupStanding => ({ registrationId, groupName, position, points, setDiff, gameDiff });

/** 4 grupos (A–D) de 4, com posições 1 a 4 e pontos decrescentes. */
const quatroGrupos = (): GroupStanding[] =>
    ['A', 'B', 'C', 'D'].flatMap(g =>
        [1, 2, 3, 4].map(pos => s(`${g}${pos}`, g, pos, 10 - pos))
    );

describe('championship/groupStage', () => {
    describe('rankQualifiers', () => {
        it('classifica 2 por grupo em 4 grupos, na ordem posição depois grupo', () => {
            const result = rankQualifiers(quatroGrupos(), 2, 0);
            expect(result).toHaveLength(8);
            // Todos os primeiros colocados vêm antes dos segundos
            expect(result.slice(0, 4).map(r => r.registrationId)).toEqual(['A1', 'B1', 'C1', 'D1']);
            expect(result.slice(4).map(r => r.registrationId)).toEqual(['A2', 'B2', 'C2', 'D2']);
        });

        it('classifica 1 por grupo quando configurado', () => {
            const result = rankQualifiers(quatroGrupos(), 1, 0);
            expect(result.map(r => r.registrationId)).toEqual(['A1', 'B1', 'C1', 'D1']);
        });

        it('acrescenta os melhores terceiros depois dos classificados diretos', () => {
            const standings = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap(g =>
                [1, 2, 3, 4].map(pos => s(`${g}${pos}`, g, pos, 10 - pos))
            );
            // 6 grupos × 2 = 12 diretos + 4 melhores terceiros = 16
            const result = rankQualifiers(standings, 2, 4);
            expect(result).toHaveLength(16);
            expect(result.slice(12).every(r => r.position === 3)).toBe(true);
        });

        it('não inclui terceiros quando bestThirdPlaces é zero', () => {
            const result = rankQualifiers(quatroGrupos(), 2, 0);
            expect(result.some(r => r.position === 3)).toBe(false);
        });

        it('trunca quando bestThirdPlaces passa do número de grupos', () => {
            const result = rankQualifiers(quatroGrupos(), 2, 10);
            // só existem 4 terceiros colocados
            expect(result).toHaveLength(12);
        });
    });

    describe('bestThirds', () => {
        const terceiros = [
            s('A3', 'A', 3, 4, 1, 5),
            s('B3', 'B', 3, 7, 0, 0),
            s('C3', 'C', 3, 4, 2, 0),
            s('D3', 'D', 3, 4, 1, 9),
        ];

        it('ordena por pontos primeiro', () => {
            expect(bestThirds(terceiros, 1).map(t => t.registrationId)).toEqual(['B3']);
        });

        it('desempata por saldo de sets antes de saldo de games', () => {
            expect(bestThirds(terceiros, 2).map(t => t.registrationId)).toEqual(['B3', 'C3']);
        });

        it('desempata por saldo de games quando pontos e sets empatam', () => {
            expect(bestThirds(terceiros, 4).map(t => t.registrationId)).toEqual(['B3', 'C3', 'D3', 'A3']);
        });

        it('é determinístico com empate total, usando o id como último critério', () => {
            const empatados = [s('Z3', 'Z', 3, 5), s('A3', 'A', 3, 5), s('M3', 'M', 3, 5)];
            expect(bestThirds(empatados, 3).map(t => t.registrationId)).toEqual(['A3', 'M3', 'Z3']);
        });

        it('ignora quem não é terceiro colocado', () => {
            const misto = [...terceiros, s('E1', 'E', 1, 99)];
            expect(bestThirds(misto, 1).map(t => t.registrationId)).toEqual(['B3']);
        });

        it('devolve lista vazia quando count é zero', () => {
            expect(bestThirds(terceiros, 0)).toEqual([]);
        });
    });
});
