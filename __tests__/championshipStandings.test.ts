import { describe, expect, it } from 'vitest';
import { calculateGroupStandingsWithRules, isTechnicalDrawAllowed } from '../lib/championshipStandings';
import { ChampionshipRegistration, Match } from '../types';

const registrations: ChampionshipRegistration[] = [
    {
        id: 'reg-a',
        championship_id: 'champ-1',
        participant_type: 'socio',
        user_id: 'user-a',
        guest_name: null,
        class: '1ª Classe',
        shirt_size: 'M',
        user: { id: 'user-a', name: 'Alice', role: 'socio', email: '', phone: '', balance: 0, isActive: true }
    },
    {
        id: 'reg-b',
        championship_id: 'champ-1',
        participant_type: 'socio',
        user_id: 'user-b',
        guest_name: null,
        class: '1ª Classe',
        shirt_size: 'G',
        user: { id: 'user-b', name: 'Bob', role: 'socio', email: '', phone: '', balance: 0, isActive: true }
    }
];

const baseMatch = (overrides: Partial<Match>): Match => ({
    id: 'match-1',
    championshipId: 'champ-1',
    playerAId: 'user-a',
    playerBId: 'user-b',
    registration_a_id: 'reg-a',
    registration_b_id: 'reg-b',
    scoreA: [0, 0],
    scoreB: [0, 0],
    status: 'finished',
    ...overrides
});

describe('championshipStandings', () => {
    it('calculates played result with configured points and set/game bonuses', () => {
        const match = baseMatch({
            scoreA: [6, 6],
            scoreB: [4, 4],
            winnerId: 'user-a',
            result_type: 'played'
        });

        const standings = calculateGroupStandingsWithRules(registrations, [match], {
            ptsVictory: 3,
            ptsDefeat: 0,
            ptsSet: 1,
            ptsGame: 0,
            ptsWoVictory: 3,
            ptsTechnicalDraw: 0
        });

        expect(standings[0].userId).toBe('reg-a');
        expect(standings[0].points).toBe(5); // 3 victory + 2 sets
        expect(standings[1].points).toBe(0);
    });

    it('awards walkover winner with wo points', () => {
        const match = baseMatch({
            scoreA: [6, 6],
            scoreB: [0, 0],
            winnerId: 'user-a',
            is_walkover: true,
            result_type: 'walkover',
            walkover_winner_id: 'user-a',
            walkover_winner_registration_id: 'reg-a'
        });

        const standings = calculateGroupStandingsWithRules(registrations, [match], {
            ptsVictory: 3,
            ptsWoVictory: 5,
            ptsTechnicalDraw: 0
        });

        expect(standings[0].userId).toBe('reg-a');
        expect(standings[0].points).toBe(5);
        expect(standings[1].points).toBe(0);
    });

    it('applies technical draw without winner and without set/game points', () => {
        const match = baseMatch({
            scoreA: [0, 0],
            scoreB: [0, 0],
            winnerId: null,
            result_type: 'technical_draw'
        });

        const standings = calculateGroupStandingsWithRules(registrations, [match], {
            ptsTechnicalDraw: 0,
            ptsVictory: 3,
            ptsSet: 1,
            ptsGame: 1
        });

        expect(standings[0].points).toBe(0);
        expect(standings[1].points).toBe(0);
        expect(standings[0].setsWon + standings[0].gamesWon).toBe(0);
        expect(standings[1].setsWon + standings[1].gamesWon).toBe(0);
    });

    it('blocks technical draw for knockout phases', () => {
        expect(isTechnicalDrawAllowed('classificatoria', 'groups')).toBe(true);
        expect(isTechnicalDrawAllowed('mata-mata-semifinal', 'Semi')).toBe(false);
        expect(isTechnicalDrawAllowed(undefined, 'Final')).toBe(false);
    });
});
