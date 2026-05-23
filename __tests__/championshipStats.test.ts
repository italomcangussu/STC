import { describe, expect, it } from 'vitest';
import { calculateChampionshipStats, calculateOddsSimulation } from '../lib/championshipStats';

const regs = [
    { id: 'ra', class: '4ª Classe', participant_type: 'socio', user: { name: 'Ana' } },
    { id: 'rb', class: '4ª Classe', participant_type: 'socio', user: { name: 'Bia' } },
    { id: 'rc', class: '4ª Classe', participant_type: 'guest', guest_name: 'Caio' },
] as any[];

describe('championshipStats', () => {
    it('aggregates wins, sets, games, and class stats from finished matches only', () => {
        const matches = [
            { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [2, 4], winner_registration_id: 'ra' },
            { id: 'm2', status: 'pending', registration_a_id: 'ra', registration_b_id: 'rc', scoreA: [], scoreB: [] },
        ] as any[];

        const stats = calculateChampionshipStats(matches, regs);

        expect(stats.byAthlete.ra.wins).toBe(1);
        expect(stats.byAthlete.ra.setsWon).toBe(2);
        expect(stats.byAthlete.rb.gamesWon).toBe(6);
        expect(stats.byClass['4ª Classe']).toHaveLength(3);
    });

    it('counts walkover without adding played games', () => {
        const matches = [
            { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [0, 0], winner_registration_id: 'ra', is_walkover: true, walkover_winner_registration_id: 'ra' },
        ] as any[];

        const stats = calculateChampionshipStats(matches, regs);

        expect(stats.byAthlete.ra.walkoversWon).toBe(1);
        expect(stats.byAthlete.rb.walkoversLost).toBe(1);
        expect(stats.byAthlete.ra.gamesWon).toBe(0);
        expect(stats.byAthlete.rb.gamesLost).toBe(0);
    });

    it('returns lower odd for the stronger athlete', () => {
        const stats = calculateChampionshipStats([
            { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [1, 1], winner_registration_id: 'ra' },
            { id: 'm2', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rc', scoreA: [6, 6], scoreB: [2, 2], winner_registration_id: 'ra' },
        ] as any[], regs);

        const odds = calculateOddsSimulation(stats.byAthlete.ra, stats.byAthlete.rb);

        expect(odds.athleteA.probability).toBeGreaterThan(odds.athleteB.probability);
        expect(odds.athleteA.decimalOdd).toBeLessThan(odds.athleteB.decimalOdd);
    });
});
