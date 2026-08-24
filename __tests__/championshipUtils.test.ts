/**
 * Rede de caracterização de `generateRoundRobinMatches`.
 *
 * É a segunda implementação de "quem joga contra quem" do repositório — a
 * outra, `championship/roundRobin.buildRoundRobinPairings`, tem 100% de
 * cobertura e esta tinha 5,12%. Antes de unificá-las é preciso saber o que
 * exatamente esta faz, inclusive onde ela **não faz nada e não avisa**.
 *
 * A regra do clube, que os testes travam:
 *   Rodada 1: 1º vs 2º · 3º vs 4º
 *   Rodada 2: 1º vs 3º · 2º vs 4º
 *   Rodada 3: 1º vs 4º · 2º vs 3º
 */

import { describe, expect, it } from 'vitest';
import { generateRoundRobinMatches, getClassCourtRestriction } from '../lib/championshipUtils';
import type { ChampionshipRound } from '../types';

const rodada = (n: number): ChampionshipRound => ({
    id: `r${n}`,
    championship_id: 'c1',
    round_number: n,
    name: `Rodada ${n}`,
    start_date: '2026-08-01',
    end_date: '2026-08-07',
    status: 'pending',
} as ChampionshipRound);

/** Membros em ordem de sorteio: 1º, 2º, 3º… */
const membros = (quantos: number) =>
    Array.from({ length: quantos }, (_, i) => ({
        id: `p${i + 1}`,
        drawOrder: i + 1,
        registrationId: `reg${i + 1}`,
    }));

/** `a x b` de cada confronto, para comparar a escalação de forma legível. */
const confrontos = (matches: { registration_a_id?: string; registration_b_id?: string }[]) =>
    matches.map(m => `${m.registration_a_id} x ${m.registration_b_id}`);

const TODAS = [rodada(1), rodada(2), rodada(3)];

describe('generateRoundRobinMatches — grupo de 4', () => {
    it('segue a escalação do clube nas três rodadas', () => {
        const gerados = generateRoundRobinMatches(membros(4), 'g1', TODAS);

        expect(confrontos(gerados)).toEqual([
            'reg1 x reg2', 'reg3 x reg4',
            'reg1 x reg3', 'reg2 x reg4',
            'reg1 x reg4', 'reg2 x reg3',
        ]);
    });

    it('liga cada confronto à rodada certa', () => {
        const gerados = generateRoundRobinMatches(membros(4), 'g1', TODAS);
        expect(gerados.map(m => m.round_id)).toEqual(['r1', 'r1', 'r2', 'r2', 'r3', 'r3']);
    });

    it('ordena pelo sorteio, não pela ordem em que os membros chegaram', () => {
        const embaralhado = [...membros(4)].reverse();
        const gerados = generateRoundRobinMatches(embaralhado, 'g1', TODAS);

        expect(confrontos(gerados)[0]).toBe('reg1 x reg2');
    });

    it('devolve só os confrontos da rodada pedida — é assim que a tela usa', () => {
        const gerados = generateRoundRobinMatches(membros(4), 'g1', [rodada(2)]);
        expect(confrontos(gerados)).toEqual(['reg1 x reg3', 'reg2 x reg4']);
    });

    it('marca cada confronto como pendente, do grupo e do tipo campeonato', () => {
        const [primeiro] = generateRoundRobinMatches(membros(4), 'g1', TODAS);

        expect(primeiro).toMatchObject({
            type: 'Campeonato',
            championship_group_id: 'g1',
            status: 'pending',
            playerAId: null,
            playerBId: null,
        });
    });
});

describe('generateRoundRobinMatches — grupo de 3', () => {
    it('resolve em duas rodadas, com o 3º entrando só na segunda', () => {
        const gerados = generateRoundRobinMatches(membros(3), 'g1', TODAS);

        expect(confrontos(gerados)).toEqual(['reg1 x reg2', 'reg1 x reg3', 'reg2 x reg3']);
        expect(gerados.map(m => m.round_id)).toEqual(['r1', 'r2', 'r2']);
    });

    it('não inventa uma terceira rodada', () => {
        const gerados = generateRoundRobinMatches(membros(3), 'g1', TODAS);
        expect(gerados.some(m => m.round_id === 'r3')).toBe(false);
    });
});

describe('generateRoundRobinMatches — tamanhos que a versão antiga ignorava', () => {
    // A tabela escrita à mão cobria só 3 e 4 atletas. Qualquer outro tamanho
    // saía do sorteio sem um único confronto, e sem erro nenhum.

    it('grupo de 5 gera as três primeiras rodadas quando só três existem', () => {
        const gerados = generateRoundRobinMatches(membros(5), 'g1', TODAS);

        // Cinco atletas jogam em cinco rodadas; aqui só três foram passadas.
        expect(gerados).toHaveLength(6);
        expect(gerados.map(m => m.round_id)).toEqual(['r1', 'r1', 'r2', 'r2', 'r3', 'r3']);
    });

    it('grupo de 5 dá folga a um atleta por rodada, sem escalar ninguém duas vezes', () => {
        const gerados = generateRoundRobinMatches(membros(5), 'g1', [rodada(1)]);
        const escalados = gerados.flatMap(m => [m.registration_a_id, m.registration_b_id]);

        expect(escalados).toHaveLength(4);
        expect(new Set(escalados).size).toBe(4);
    });

    it('grupo de 2 joga uma vez', () => {
        const gerados = generateRoundRobinMatches(membros(2), 'g1', TODAS);
        expect(confrontos(gerados)).toEqual(['reg1 x reg2']);
    });

    it('rodada além das que o grupo tem não gera nada — quatro atletas têm três rodadas', () => {
        expect(generateRoundRobinMatches(membros(4), 'g1', [rodada(4)])).toEqual([]);
    });

    it('grupo vazio devolve lista vazia', () => {
        expect(generateRoundRobinMatches([], 'g1', TODAS)).toEqual([]);
    });
});

describe('getClassCourtRestriction', () => {
    /** Só a 4ª joga no saibro. */
    it('manda a 4ª para o saibro', () => {
        expect(getClassCourtRestriction('4ª Classe')).toBe('Saibro');
    });

    it('manda 5ª e 6ª para a rápida', () => {
        expect(getClassCourtRestriction('5ª Classe')).toBe('Rápida');
        expect(getClassCourtRestriction('6ª Classe')).toBe('Rápida');
    });

    it('deixa 1ª a 3ª livres', () => {
        expect(getClassCourtRestriction('1ª Classe')).toBeNull();
        expect(getClassCourtRestriction('3ª Classe')).toBeNull();
    });

    it('não restringe classe desconhecida', () => {
        expect(getClassCourtRestriction('Feminino A')).toBeNull();
    });
});
