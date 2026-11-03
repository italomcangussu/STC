import { describe, expect, it } from 'vitest';
import { findMyMatches, phaseAtScroll, sideOfUser } from '../lib/bracketNavigation';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';

const jogo = (over: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m${over.match_number}`,
    match_number: 1,
    registration_a_id: 'ra',
    registration_b_id: 'rb',
    player_a_label: 'A',
    player_b_label: 'B',
    status: 'pending',
    winner_registration_id: null,
    round_phase: 'oitavas',
    bracket_class: '4ª Classe',
    ...over,
} as BracketMatchWithPhase);

describe('phaseAtScroll', () => {
    const fases = [
        { phase: 'qualify', x: 32 },
        { phase: 'oitavas', x: 424 },
        { phase: 'quartas', x: 816 },
    ];

    it('fica na primeira fase no começo do quadro', () => {
        expect(phaseAtScroll(fases, { scrollLeft: 0, zoom: 1, viewportWidth: 375 })).toBe('qualify');
    });

    it('devolve a fase que o quadro centralizou ao tocar no chip', () => {
        // O mesmo cálculo de centerPhase: x·zoom − largura/3.
        const scrollLeft = 816 * 0.85 - 375 / 3;
        expect(phaseAtScroll(fases, { scrollLeft, zoom: 0.85, viewportWidth: 375 })).toBe('quartas');
    });

    it('não quebra sem fases', () => {
        expect(phaseAtScroll([], { scrollLeft: 100, zoom: 1, viewportWidth: 375 })).toBeNull();
    });
});

describe('sideOfUser', () => {
    it('diz o lado do sócio e ignora quem não está logado', () => {
        const m = jogo({ registration_b_user_id: 'u1' });
        expect(sideOfUser(m, 'u1')).toBe('b');
        expect(sideOfUser(m, 'u2')).toBeNull();
        expect(sideOfUser(m, undefined)).toBeNull();
    });
});

describe('findMyMatches', () => {
    const ordem = ['4ª Classe', '5ª Classe'];

    it('lista os jogos pendentes na ordem das classes e dos números', () => {
        const bracket = [
            jogo({ match_number: 7, bracket_class: '5ª Classe', registration_a_user_id: 'u1' }),
            jogo({ match_number: 4, bracket_class: '4ª Classe', registration_b_user_id: 'u1' }),
            jogo({ match_number: 2, bracket_class: '4ª Classe' }),
        ];
        expect(findMyMatches(bracket, 'u1', ordem).map(m => m.match_number)).toEqual([4, 7]);
    });

    it('sem jogo pendente, devolve o último que a pessoa jogou', () => {
        const bracket = [
            jogo({ match_number: 3, status: 'finished', registration_a_user_id: 'u1' }),
            jogo({ match_number: 11, status: 'finished', registration_a_user_id: 'u1' }),
        ];
        expect(findMyMatches(bracket, 'u1', ordem).map(m => m.match_number)).toEqual([11]);
    });

    it('não devolve nada para quem não está na chave ou não está logado', () => {
        const bracket = [jogo({ match_number: 1, registration_a_user_id: 'u9' })];
        expect(findMyMatches(bracket, 'u1', ordem)).toEqual([]);
        expect(findMyMatches(bracket, undefined, ordem)).toEqual([]);
    });
});
