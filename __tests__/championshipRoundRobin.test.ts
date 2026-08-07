import { describe, expect, it } from 'vitest';
import {
    buildRoundRobinPairings,
    distributeIntoGroups,
    groupNameFor,
    type RoundRobinAthlete,
} from '../lib/championship/roundRobin';

const atleta = (id: string, isSeed = false): RoundRobinAthlete => ({ registrationId: id, isSeed });

/** RNG determinístico: sempre devolve 0, então o embaralhamento preserva a ordem. */
const rngFixo = () => 0;

describe('championship/roundRobin', () => {
    describe('groupNameFor', () => {
        it('nomeia os grupos por letra', () => {
            expect([0, 1, 2, 25].map(groupNameFor)).toEqual(['A', 'B', 'C', 'Z']);
        });

        it('continua com duas letras depois de Z', () => {
            expect(groupNameFor(26)).toBe('AA');
        });
    });

    describe('buildRoundRobinPairings', () => {
        it('gera todas as combinações sem repetir', () => {
            expect(buildRoundRobinPairings(['a', 'b', 'c'])).toEqual([
                ['a', 'b'], ['a', 'c'], ['b', 'c'],
            ]);
        });

        it('gera n(n-1)/2 confrontos', () => {
            expect(buildRoundRobinPairings(['a', 'b', 'c', 'd'])).toHaveLength(6);
            expect(buildRoundRobinPairings(Array.from({ length: 6 }, (_, i) => `p${i}`))).toHaveLength(15);
        });

        it('não gera confronto com menos de 2 participantes', () => {
            expect(buildRoundRobinPairings(['a'])).toEqual([]);
            expect(buildRoundRobinPairings([])).toEqual([]);
        });

        it('inverte o mando no returno quando pedido', () => {
            const ida = buildRoundRobinPairings(['a', 'b']);
            const volta = buildRoundRobinPairings(['a', 'b'], { returno: true });
            expect(ida).toEqual([['a', 'b']]);
            expect(volta).toEqual([['b', 'a']]);
        });
    });

    describe('distributeIntoGroups', () => {
        const dezesseis = Array.from({ length: 16 }, (_, i) => atleta(`p${i + 1}`));

        it('divide em grupos do tamanho pedido', () => {
            const grupos = distributeIntoGroups(dezesseis, 4, rngFixo);
            expect(grupos).toHaveLength(4);
            expect(grupos.map(g => g.name)).toEqual(['A', 'B', 'C', 'D']);
            expect(grupos.every(g => g.members.length === 4)).toBe(true);
        });

        it('coloca cada atleta em exatamente um grupo', () => {
            const grupos = distributeIntoGroups(dezesseis, 4, rngFixo);
            const todos = grupos.flatMap(g => g.members.map(m => m.registrationId));
            expect(new Set(todos).size).toBe(16);
        });

        it('espalha os cabeças um por grupo', () => {
            const comCabecas = [
                atleta('c1', true), atleta('c2', true), atleta('c3', true), atleta('c4', true),
                ...Array.from({ length: 12 }, (_, i) => atleta(`p${i + 1}`)),
            ];
            const grupos = distributeIntoGroups(comCabecas, 4, rngFixo);
            for (const grupo of grupos) {
                expect(grupo.members.filter(m => m.isSeed)).toHaveLength(1);
            }
        });

        it('marca o cabeça como primeiro do grupo, com draw_order 1', () => {
            const comCabecas = [
                atleta('c1', true), atleta('c2', true),
                ...Array.from({ length: 6 }, (_, i) => atleta(`p${i + 1}`)),
            ];
            const grupos = distributeIntoGroups(comCabecas, 2, rngFixo);
            for (const grupo of grupos) {
                expect(grupo.members[0].isSeed).toBe(true);
                expect(grupo.members[0].drawOrder).toBe(1);
            }
        });

        it('distribui as sobras quando o total não divide igual', () => {
            const cinco = Array.from({ length: 5 }, (_, i) => atleta(`p${i + 1}`));
            const grupos = distributeIntoGroups(cinco, 2, rngFixo);
            expect(grupos.map(g => g.members.length).sort()).toEqual([2, 3]);
        });

        it('recusa mais grupos que atletas', () => {
            expect(() => distributeIntoGroups([atleta('a')], 2, rngFixo)).toThrow(/grupos/);
        });
    });
});
