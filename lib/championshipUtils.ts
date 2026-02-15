import { Match, InternalStanding, ChampionshipRound, ChampionshipRegistration } from '../types';

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
 * Helper: Get Head-to-Head wins between two players
 */
function getH2HWins(regIdA: string, regIdB: string, matches: Match[]): number {
    const h2hMatches = matches.filter(m =>
        m.status === 'finished' &&
        ((m.registration_a_id === regIdA && m.registration_b_id === regIdB) ||
         (m.registration_a_id === regIdB && m.registration_b_id === regIdA))
    );

    return h2hMatches.filter(m => {
        // Count sets to determine winner
        let setsA = 0;
        let setsB = 0;

        m.scoreA.forEach((sA, idx) => {
            const sB = m.scoreB[idx];
            if (sA === 0 && sB === 0 && idx > 0) return; // Skip empty sets
            if (sA > sB) setsA++;
            else if (sB > sA) setsB++;
        });

        // Check if player A won this match
        if (m.registration_a_id === regIdA) {
            return setsA > setsB;
        } else {
            return setsB > setsA;
        }
    }).length;
}

/**
 * Calculate Group Standings with H2H tiebreaker
 */
export function calculateGroupStandings(
    registrations: ChampionshipRegistration[],
    matches: Match[]
): InternalStanding[] {
    const standings: Record<string, InternalStanding> = {};

    // Initialize
    registrations.forEach(reg => {
        standings[reg.id] = {
            userId: reg.id, // Using registration ID as key for standings
            points: 0,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            setsWon: 0,
            setsLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            groupName: reg.class // Temp placeholder
        };
    });

    matches.forEach(match => {
        if (match.status !== 'finished') return;

        const pA = match.registration_a_id;
        const pB = match.registration_b_id;

        if (!pA || !pB || !standings[pA] || !standings[pB]) return;

        const statA = standings[pA];
        const statB = standings[pB];

        statA.matchesPlayed++;
        statB.matchesPlayed++;

        // Calculate Sets/Games
        let setsA = 0;
        let setsB = 0;
        let gamesA = 0;
        let gamesB = 0;

        match.scoreA.forEach((sA, idx) => {
            const sB = match.scoreB[idx];
            if (sA === 0 && sB === 0 && idx > 0) return; // Skip empty sets

            gamesA += sA;
            gamesB += sB;

            // Set Logic
            if (match.is_walkover) {
                // WO Handling is specific
            } else {
                // Determine set winner
                if (sA > sB) setsA++;
                else if (sB > sA) setsB++;
            }
        });

        // Determine winner registration (align with DB logic)
        let winnerRegId: string | null = null;
        if (match.walkover_winner_registration_id) {
            winnerRegId = match.walkover_winner_registration_id;
        } else if (match.walkover_winner_id) {
            if (match.walkover_winner_id === match.playerAId) winnerRegId = pA;
            else if (match.walkover_winner_id === match.playerBId) winnerRegId = pB;
        } else if (match.winnerId) {
            if (match.winnerId === match.playerAId) winnerRegId = pA;
            else if (match.winnerId === match.playerBId) winnerRegId = pB;
        }
        if (!winnerRegId) {
            if (setsA > setsB) winnerRegId = pA;
            else if (setsB > setsA) winnerRegId = pB;
        }

        // WO Logic can override sets for display/standings
        if (match.is_walkover && winnerRegId) {
            if (winnerRegId === pA) {
                setsA = 2;
                setsB = 0;
            } else if (winnerRegId === pB) {
                setsA = 0;
                setsB = 2;
            }
        }

        statA.setsWon += setsA;
        statA.setsLost += setsB;
        statA.gamesWon += gamesA;
        statA.gamesLost += gamesB;

        statB.setsWon += setsB;
        statB.setsLost += setsA;
        statB.gamesWon += gamesB;
        statB.gamesLost += gamesA;

        if (winnerRegId === pA) {
            statA.points += 3;
            statA.wins++;
            statB.losses++;
        } else if (winnerRegId === pB) {
            statB.points += 3;
            statB.wins++;
            statA.losses++;
        }
    });

    return Object.values(standings).sort((a, b) => {
        // 1º: Pontos
        if (b.points !== a.points) return b.points - a.points;

        // 2º: Head-to-Head (confronto direto)
        const h2hA = getH2HWins(a.userId, b.userId, matches);
        const h2hB = getH2HWins(b.userId, a.userId, matches);
        if (h2hA !== h2hB) return h2hB - h2hA;

        // 3º: Saldo de Sets
        const setsDiffA = a.setsWon - a.setsLost;
        const setsDiffB = b.setsWon - b.setsLost;
        if (setsDiffB !== setsDiffA) return setsDiffB - setsDiffA;

        // 4º: Saldo de Games
        const gamesDiffA = a.gamesWon - a.gamesLost;
        const gamesDiffB = b.gamesWon - b.gamesLost;
        return gamesDiffB - gamesDiffA;
    });
}

export function getClassCourtRestriction(className: string): 'Saibro' | 'Rápida' | null {
    if (['4ª Classe', '5ª Classe'].includes(className)) return 'Saibro';
    if (['6ª Classe'].includes(className)) return 'Rápida';
    return null; // Livre (1, 2, 3)
}
