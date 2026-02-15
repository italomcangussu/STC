import { ChampionshipRegistration, InternalStanding, Match } from '../types';

export interface ChampionshipScoringConfig {
    ptsVictory?: number;
    ptsDefeat?: number;
    ptsWoVictory?: number;
    ptsSet?: number;
    ptsGame?: number;
    ptsTechnicalDraw?: number;
}

const DEFAULT_SCORING: Required<ChampionshipScoringConfig> = {
    ptsVictory: 3,
    ptsDefeat: 0,
    ptsWoVictory: 3,
    ptsSet: 0,
    ptsGame: 0,
    ptsTechnicalDraw: 0
};

const pickNumber = (value: number | null | undefined, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const mergeScoring = (config?: ChampionshipScoringConfig): Required<ChampionshipScoringConfig> => ({
    ptsVictory: pickNumber(config?.ptsVictory as number | null | undefined, DEFAULT_SCORING.ptsVictory),
    ptsDefeat: pickNumber(config?.ptsDefeat as number | null | undefined, DEFAULT_SCORING.ptsDefeat),
    ptsWoVictory: pickNumber(config?.ptsWoVictory as number | null | undefined, DEFAULT_SCORING.ptsWoVictory),
    ptsSet: pickNumber(config?.ptsSet as number | null | undefined, DEFAULT_SCORING.ptsSet),
    ptsGame: pickNumber(config?.ptsGame as number | null | undefined, DEFAULT_SCORING.ptsGame),
    ptsTechnicalDraw: pickNumber(config?.ptsTechnicalDraw as number | null | undefined, DEFAULT_SCORING.ptsTechnicalDraw)
});

const sumArray = (values?: number[]) => (values || []).reduce((acc, value) => acc + (value || 0), 0);

const getSetWins = (scoreA: number[] = [], scoreB: number[] = []) => {
    let setsA = 0;
    let setsB = 0;

    const length = Math.max(scoreA.length, scoreB.length);
    for (let index = 0; index < length; index += 1) {
        const a = scoreA[index] || 0;
        const b = scoreB[index] || 0;

        if (a > b) setsA += 1;
        if (b > a) setsB += 1;
    }

    return { setsA, setsB };
};

const getWinnerRegistrationId = (match: Match): string | null => {
    if (match.walkover_winner_registration_id) {
        return match.walkover_winner_registration_id;
    }

    if (match.walkover_winner_id) {
        if (match.walkover_winner_id === match.playerAId) return match.registration_a_id || null;
        if (match.walkover_winner_id === match.playerBId) return match.registration_b_id || null;
    }

    if (match.winnerId) {
        if (match.winnerId === match.playerAId) return match.registration_a_id || null;
        if (match.winnerId === match.playerBId) return match.registration_b_id || null;
    }

    return null;
};

const isFinished = (match: Match) => match.status === 'finished';

const getResultType = (match: Match): 'played' | 'walkover' | 'technical_draw' => {
    if (match.result_type) return match.result_type;
    if (match.is_walkover) return 'walkover';

    const hasWinner = Boolean(match.winnerId || match.walkover_winner_id || match.walkover_winner_registration_id);
    const hasScore = sumArray(match.scoreA) + sumArray(match.scoreB) > 0;

    if (!hasWinner && !hasScore) return 'technical_draw';
    return 'played';
};

const getH2HWins = (registrationA: string, registrationB: string, matches: Match[]): number => {
    return matches.filter((match) => {
        if (!isFinished(match)) return false;

        const playerA = match.registration_a_id;
        const playerB = match.registration_b_id;

        if (!playerA || !playerB) return false;

        const isHeadToHead =
            (playerA === registrationA && playerB === registrationB) ||
            (playerA === registrationB && playerB === registrationA);

        if (!isHeadToHead) return false;

        const winnerReg = getWinnerRegistrationId(match);
        return winnerReg === registrationA;
    }).length;
};

export const calculateGroupStandingsWithRules = (
    registrations: ChampionshipRegistration[],
    matches: Match[],
    config?: ChampionshipScoringConfig
): InternalStanding[] => {
    const scoring = mergeScoring(config);
    const standings: Record<string, InternalStanding> = {};

    registrations.forEach((registration) => {
        standings[registration.id] = {
            userId: registration.id,
            points: 0,
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            setsWon: 0,
            setsLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            groupName: registration.class
        };
    });

    matches.forEach((match) => {
        if (!isFinished(match)) return;

        const regAId = match.registration_a_id;
        const regBId = match.registration_b_id;

        if (!regAId || !regBId) return;
        if (!standings[regAId] || !standings[regBId]) return;

        const statA = standings[regAId];
        const statB = standings[regBId];
        const resultType = getResultType(match);

        statA.matchesPlayed += 1;
        statB.matchesPlayed += 1;

        if (resultType === 'technical_draw') {
            statA.points += scoring.ptsTechnicalDraw;
            statB.points += scoring.ptsTechnicalDraw;
            return;
        }

        if (resultType === 'walkover') {
            const winnerReg = getWinnerRegistrationId(match);
            if (!winnerReg) return;

            if (winnerReg === regAId) {
                statA.points += scoring.ptsWoVictory;
                statA.wins += 1;
                statB.losses += 1;
            } else if (winnerReg === regBId) {
                statB.points += scoring.ptsWoVictory;
                statB.wins += 1;
                statA.losses += 1;
            }

            return;
        }

        const scoreA = match.scoreA || [];
        const scoreB = match.scoreB || [];
        const { setsA, setsB } = getSetWins(scoreA, scoreB);
        const gamesA = sumArray(scoreA);
        const gamesB = sumArray(scoreB);

        statA.setsWon += setsA;
        statA.setsLost += setsB;
        statA.gamesWon += gamesA;
        statA.gamesLost += gamesB;

        statB.setsWon += setsB;
        statB.setsLost += setsA;
        statB.gamesWon += gamesB;
        statB.gamesLost += gamesA;

        const winnerReg = getWinnerRegistrationId(match);

        statA.points += (setsA * scoring.ptsSet) + (gamesA * scoring.ptsGame);
        statB.points += (setsB * scoring.ptsSet) + (gamesB * scoring.ptsGame);

        if (winnerReg === regAId) {
            statA.points += scoring.ptsVictory;
            statB.points += scoring.ptsDefeat;
            statA.wins += 1;
            statB.losses += 1;
        } else if (winnerReg === regBId) {
            statB.points += scoring.ptsVictory;
            statA.points += scoring.ptsDefeat;
            statB.wins += 1;
            statA.losses += 1;
        }
    });

    return Object.values(standings).sort((standingA, standingB) => {
        if (standingB.points !== standingA.points) return standingB.points - standingA.points;

        const h2hA = getH2HWins(standingA.userId, standingB.userId, matches);
        const h2hB = getH2HWins(standingB.userId, standingA.userId, matches);
        if (h2hA !== h2hB) return h2hB - h2hA;

        const setsDiffA = standingA.setsWon - standingA.setsLost;
        const setsDiffB = standingB.setsWon - standingB.setsLost;
        if (setsDiffB !== setsDiffA) return setsDiffB - setsDiffA;

        const gamesDiffA = standingA.gamesWon - standingA.gamesLost;
        const gamesDiffB = standingB.gamesWon - standingB.gamesLost;
        if (gamesDiffB !== gamesDiffA) return gamesDiffB - gamesDiffA;

        return standingA.userId.localeCompare(standingB.userId);
    });
};

export const isTechnicalDrawAllowed = (roundPhase?: string, matchPhase?: string) => {
    if ((roundPhase || '').startsWith('mata-mata')) return false;
    if (!matchPhase) return true;

    const knockoutPhases = new Set(['Oitavas', 'Quartas', 'Semi', 'Final', 'round_of_16', 'quarterfinal', 'semifinal', 'final']);
    return !knockoutPhases.has(matchPhase);
};
