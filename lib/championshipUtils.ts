import { Match, InternalStanding, ChampionshipRound, ChampionshipRegistration } from '../types';
import { calculateGroupStandingsWithRules, ChampionshipScoringConfig } from './championshipStandings';
import { buildRoundRobinSchedule } from './championship/roundRobin';

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
 * Gera os confrontos de um grupo, distribuídos entre as rodadas informadas.
 *
 * A escalação vem de `buildRoundRobinSchedule` — antes, a tabela estava escrita
 * à mão aqui, e só para grupos de 3 e 4: qualquer outro tamanho devolvia lista
 * vazia **sem avisar ninguém**. Um grupo de 5 saía do sorteio sem um único
 * confronto, e a tela não tinha como saber a diferença entre "não gerou" e
 * "não havia o que gerar".
 *
 * Só entram as rodadas que o chamador passou: a tela gera uma de cada vez.
 *
 * @param members Precisam ter `drawOrder`; a ordem de chegada é ignorada.
 */
export function generateRoundRobinMatches(
    members: { id: string; drawOrder: number; registrationId: string }[],
    groupId: string,
    rounds: ChampionshipRound[]
): Partial<Match>[] {
    const ordenados = [...members].sort((a, b) => a.drawOrder - b.drawOrder);
    const porInscricao = new Map(ordenados.map(m => [m.registrationId, m]));
    const agenda = buildRoundRobinSchedule(ordenados.map(m => m.registrationId));

    return agenda.flatMap((pares, indice) => {
        const rodada = rounds.find(r => r.round_number === indice + 1);
        if (!rodada) return [];
        return pares.map(([a, b]) =>
            createMatch(porInscricao.get(a)!, porInscricao.get(b)!, groupId, rodada.id));
    });
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
