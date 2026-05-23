import { describe, expect, it } from 'vitest';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import {
    buildResenhaBracketLayout,
    getCurrentPhaseForClass,
    getMatchWinnerSide,
    normalizeScoreSlots,
} from '../lib/resenhaOpenBracketLayout';

const match = (overrides: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m-${overrides.match_number ?? 1}`,
    match_number: overrides.match_number ?? 1,
    registration_a_id: overrides.registration_a_id ?? 'a1',
    registration_b_id: overrides.registration_b_id ?? 'b1',
    player_a_label: overrides.player_a_label ?? 'Player A',
    player_b_label: overrides.player_b_label ?? 'Player B',
    status: overrides.status ?? 'pending',
    winner_registration_id: overrides.winner_registration_id ?? null,
    is_walkover: overrides.is_walkover ?? false,
    round_phase: overrides.round_phase ?? 'oitavas',
    bracket_class: overrides.bracket_class ?? '5ª Classe',
    player_a_source_match_number: overrides.player_a_source_match_number,
    player_b_source_match_number: overrides.player_b_source_match_number,
    score_a: overrides.score_a,
    score_b: overrides.score_b,
});

describe('resenhaOpenBracketLayout', () => {
    it('normalizes score slots to exactly three set columns', () => {
        expect(normalizeScoreSlots([6, 6], [4, 3])).toEqual([
            { a: 6, b: 4, index: 0, played: true },
            { a: 6, b: 3, index: 1, played: true },
            { a: null, b: null, index: 2, played: false },
        ]);
    });

    it('detects the winner side from winner_registration_id', () => {
        expect(getMatchWinnerSide(match({ winner_registration_id: 'a1', status: 'finished' }))).toBe('a');
        expect(getMatchWinnerSide(match({ winner_registration_id: 'b1', status: 'finished' }))).toBe('b');
        expect(getMatchWinnerSide(match({ winner_registration_id: null, status: 'pending' }))).toBe(null);
    });

    it('builds 5ª Classe columns and connectors from match centers', () => {
        const layout = buildResenhaBracketLayout([
            match({ match_number: 1, round_phase: 'oitavas' }),
            match({ match_number: 2, round_phase: 'oitavas', registration_a_id: 'a2', registration_b_id: 'b2' }),
            match({
                match_number: 9,
                round_phase: 'quartas',
                registration_a_id: null,
                registration_b_id: null,
                player_a_source_match_number: 1,
                player_b_source_match_number: 2,
            }),
        ], '5ª Classe');

        expect(layout.phases.map(phase => phase.phase)).toEqual(['oitavas', 'quartas', 'semifinal', 'final']);
        expect(layout.matchesByNumber.get(1)?.centerY).toBe(layout.matchesByNumber.get(1)!.y + layout.cardHeight / 2);
        expect(layout.connectors).toContainEqual(expect.objectContaining({
            fromMatchNumber: 1,
            toMatchNumber: 9,
            toSlot: 'a',
            startX: layout.matchesByNumber.get(1)!.x + layout.cardWidth,
            startY: layout.matchesByNumber.get(1)!.centerY,
            endY: layout.matchesByNumber.get(9)!.centerY,
        }));
    });

    it('builds 4ª Classe from preliminar through final', () => {
        const layout = buildResenhaBracketLayout([
            match({ bracket_class: '4ª Classe', match_number: 1, round_phase: 'preliminar' }),
            match({ bracket_class: '4ª Classe', match_number: 5, round_phase: 'oitavas', player_b_source_match_number: 1 }),
            match({ bracket_class: '4ª Classe', match_number: 13, round_phase: 'quartas', player_a_source_match_number: 5 }),
            match({ bracket_class: '4ª Classe', match_number: 17, round_phase: 'semifinal', player_a_source_match_number: 13 }),
            match({ bracket_class: '4ª Classe', match_number: 19, round_phase: 'final', player_a_source_match_number: 17 }),
        ], '4ª Classe');

        expect(layout.phases.map(phase => phase.phase)).toEqual(['preliminar', 'oitavas', 'quartas', 'semifinal', 'final']);
    });

    it('selects the earliest pending playable phase', () => {
        const matches = [
            match({
                id: 'j13',
                match_number: 13,
                round_phase: 'quartas',
                bracket_class: '4ª Classe',
                registration_a_id: 'a',
                registration_b_id: 'b',
                status: 'pending',
            }),
            match({
                id: 'j17',
                match_number: 17,
                round_phase: 'semifinal',
                bracket_class: '4ª Classe',
                registration_a_id: null,
                registration_b_id: null,
                player_a_source_match_number: 13,
                player_b_source_match_number: 14,
                status: 'pending',
            }),
        ];

        expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('quartas');
    });

    it('selects the final when all class matches are finished', () => {
        const matches = [
            match({
                id: 'j13',
                match_number: 13,
                round_phase: 'quartas',
                bracket_class: '4ª Classe',
                registration_a_id: 'a',
                registration_b_id: 'b',
                status: 'finished',
            }),
            match({
                id: 'j19',
                match_number: 19,
                round_phase: 'final',
                bracket_class: '4ª Classe',
                registration_a_id: 'c',
                registration_b_id: 'd',
                status: 'finished',
            }),
        ];

        expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('final');
    });
});
