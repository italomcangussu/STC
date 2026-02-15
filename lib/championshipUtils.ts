import { Match, InternalStanding, ChampionshipRound, ChampionshipRegistration } from '../types';
import { calculateGroupStandingsWithRules, ChampionshipScoringConfig } from './championshipStandings';

// Helper to get round dates (mock or computed)
export const getRoundDates = (roundNumber: number) => {
    // Hardcoded for the specific championship rule
    // Rodada 1 – 05/02 a 16/02
    // Rodada 2 – 17/02 a 28/02
    // Rodada 3 – 01/03 a 12/03
    // Semifinais – 13/03 a 24/03
    // Final – 28/03

    // We should probably get this from the database rounds, but for generation we might need defaults
    const currentYear = new Date().getFullYear();
    switch (roundNumber) {
        case 1: return { start: `${currentYear}-02-05`, end: `${currentYear}-02-16` };
        case 2: return { start: `${currentYear}-02-17`, end: `${currentYear}-02-28` };
        case 3: return { start: `${currentYear}-03-01`, end: `${currentYear}-03-12` };
        case 4: return { start: `${currentYear}-03-13`, end: `${currentYear}-03-24` }; // Semis
        case 5: return { start: `${currentYear}-03-28`, end: `${currentYear}-03-28` }; // Final
        default: return { start: `${currentYear}-01-01`, end: `${currentYear}-12-31` };
    }
};

/**
 * Generate Round Robin Matches based on group members
 * members must have { id, drawOrder }
 * drawOrder: 0 for seed, 1, 2, 3...
 */
export function generateRoundRobinMatches(
    members: { id: string; drawOrder: number; registrationId: string }[],
    groupId: string,
    rounds: ChampionshipRound[]
): Partial<Match>[] {
    const sortedMembers = [...members].sort((a, b) => a.drawOrder - b.drawOrder);
    const n = sortedMembers.length;
    const matches: Partial<Match>[] = [];

    // Map drawOrder to member (0=1st, 1=2nd, 2=3rd, 3=4th in user terms)
    // User rules:
    // Rodada 1: 1º vs 2º, 3º vs 4º
    // Rodada 2: 1º vs 3º, 2º vs 4º
    // Rodada 3: 1º vs 4º, 2º vs 3º

    // Array indices: 0 (1º/Seed), 1 (2º), 2 (3º), 3 (4º)

    if (n === 4) {
        // Round 1
        const r1 = rounds.find(r => r.round_number === 1);
        if (r1) {
            matches.push(createMatch(sortedMembers[0], sortedMembers[1], groupId, r1.id)); // 1 vs 2
            matches.push(createMatch(sortedMembers[2], sortedMembers[3], groupId, r1.id)); // 3 vs 4
        }

        // Round 2
        const r2 = rounds.find(r => r.round_number === 2);
        if (r2) {
            matches.push(createMatch(sortedMembers[0], sortedMembers[2], groupId, r2.id)); // 1 vs 3
            matches.push(createMatch(sortedMembers[1], sortedMembers[3], groupId, r2.id)); // 2 vs 4
        }

        // Round 3
        const r3 = rounds.find(r => r.round_number === 3);
        if (r3) {
            matches.push(createMatch(sortedMembers[0], sortedMembers[3], groupId, r3.id)); // 1 vs 4
            matches.push(createMatch(sortedMembers[1], sortedMembers[2], groupId, r3.id)); // 2 vs 3
        }
    } else if (n === 3) {
        // 3 Players: 0, 1, 2
        // "Se algum grupo tiver apenas 3 atletas, serão apenas duas rodadas."
        // Strategy:
        // R1: 1 vs 2 (0 vs 1)
        // R2: 1 vs 3 (0 vs 2) AND 2 vs 3 (1 vs 2)

        const r1 = rounds.find(r => r.round_number === 1);
        if (r1) {
            matches.push(createMatch(sortedMembers[0], sortedMembers[1], groupId, r1.id)); // 1 vs 2
        }

        const r2 = rounds.find(r => r.round_number === 2);
        if (r2) {
            matches.push(createMatch(sortedMembers[0], sortedMembers[2], groupId, r2.id)); // 1 vs 3
            matches.push(createMatch(sortedMembers[1], sortedMembers[2], groupId, r2.id)); // 2 vs 3
        }
    }

    return matches;
}

function createMatch(
    p1: { id: string; registrationId: string },
    p2: { id: string; registrationId: string },
    groupId: string,
    roundId: string
): Partial<Match> {
    return {
        type: 'Campeonato',
        championship_group_id: groupId,
        round_id: roundId,
        playerAId: null, // Will be set by caller based on registration
        playerBId: null,
        registration_a_id: p1.registrationId,
        registration_b_id: p2.registrationId,
        scoreA: [0, 0, 0],
        scoreB: [0, 0, 0],
        status: 'pending'
    };
}

/**
 * Calculate Group Standings with H2H tiebreaker
 */
export function calculateGroupStandings(
    registrations: ChampionshipRegistration[],
    matches: Match[],
    scoring?: ChampionshipScoringConfig
): InternalStanding[] {
    return calculateGroupStandingsWithRules(registrations, matches, scoring);
}

export function getClassCourtRestriction(className: string): 'Saibro' | 'Rápida' | null {
    if (['4ª Classe', '5ª Classe'].includes(className)) return 'Saibro';
    if (['6ª Classe'].includes(className)) return 'Rápida';
    return null; // Livre (1, 2, 3)
}
