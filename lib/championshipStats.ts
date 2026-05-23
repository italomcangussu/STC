import type { Match } from '../types';

export interface ChampionshipStatsRegistration {
    id: string;
    class: string;
    participant_type?: 'socio' | 'guest';
    guest_name?: string | null;
    user?: { name?: string | null; avatar_url?: string | null } | null;
}

export interface AthleteStat {
    registrationId: string;
    name: string;
    className: string;
    avatarUrl?: string | null;
    matchesPlayed: number;
    wins: number;
    losses: number;
    setsWon: number;
    setsLost: number;
    gamesWon: number;
    gamesLost: number;
    superTiesWon: number;
    superTiesLost: number;
    walkoversWon: number;
    walkoversLost: number;
    lastResult: 'V' | 'D' | null;
    strength: number;
}

export interface ChampionshipStatsResult {
    byAthlete: Record<string, AthleteStat>;
    byClass: Record<string, AthleteStat[]>;
    finishedMatches: number;
    playedMatches: number;
    totalSets: number;
    totalGames: number;
}

export interface OddsSide {
    registrationId: string;
    probability: number;
    decimalOdd: number;
}

export interface OddsSimulation {
    athleteA: OddsSide;
    athleteB: OddsSide;
    favoriteRegistrationId: string | null;
    confidence: 'baixa' | 'media' | 'alta';
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getScoreA = (match: Match) => match.scoreA ?? match.score_a ?? [];
const getScoreB = (match: Match) => match.scoreB ?? match.score_b ?? [];

const getRegistrationName = (registration: ChampionshipStatsRegistration): string => {
    if (registration.participant_type === 'guest') return registration.guest_name || 'Convidado';
    return registration.user?.name || 'Atleta';
};

const getWinnerRegistrationId = (match: Match): string | null => {
    return match.winner_registration_id
        ?? match.walkover_winner_registration_id
        ?? null;
};

const getSetWinner = (scoreA: number, scoreB: number, isSuperTiebreak = false): 'A' | 'B' | null => {
    if (isSuperTiebreak) {
        if (scoreA >= 10 && scoreA - scoreB >= 2) return 'A';
        if (scoreB >= 10 && scoreB - scoreA >= 2) return 'B';
        return null;
    }
    if (scoreA === 7 && scoreA > scoreB) return 'A';
    if (scoreB === 7 && scoreB > scoreA) return 'B';
    if (scoreA === 6 && scoreB <= 4) return 'A';
    if (scoreB === 6 && scoreA <= 4) return 'B';
    if (scoreA > scoreB) return 'A';
    if (scoreB > scoreA) return 'B';
    return null;
};

const buildInitialStat = (registration: ChampionshipStatsRegistration): AthleteStat => ({
    registrationId: registration.id,
    name: getRegistrationName(registration),
    className: registration.class || 'Sem Classe',
    avatarUrl: registration.user?.avatar_url,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
    superTiesWon: 0,
    superTiesLost: 0,
    walkoversWon: 0,
    walkoversLost: 0,
    lastResult: null,
    strength: 0.5,
});

const recomputeStrength = (stat: AthleteStat): AthleteStat => {
    const winRate = stat.matchesPlayed > 0 ? stat.wins / stat.matchesPlayed : 0.5;
    const setTotal = stat.setsWon + stat.setsLost;
    const setRate = setTotal > 0 ? stat.setsWon / setTotal : 0.5;
    const gameTotal = stat.gamesWon + stat.gamesLost;
    const gameRate = gameTotal > 0 ? stat.gamesWon / gameTotal : 0.5;
    const setBalance = setTotal > 0 ? (stat.setsWon - stat.setsLost) / setTotal : 0;
    const gameBalance = gameTotal > 0 ? (stat.gamesWon - stat.gamesLost) / gameTotal : 0;
    const balance = clamp((setBalance + gameBalance) / 4 + 0.5, 0, 1);

    return {
        ...stat,
        strength: clamp((winRate * 0.45) + (setRate * 0.25) + (gameRate * 0.2) + (balance * 0.1), 0.05, 0.95),
    };
};

export function calculateChampionshipStats(
    matches: Match[],
    registrations: ChampionshipStatsRegistration[],
): ChampionshipStatsResult {
    const byAthlete = registrations.reduce<Record<string, AthleteStat>>((acc, registration) => {
        acc[registration.id] = buildInitialStat(registration);
        return acc;
    }, {});

    let finishedMatches = 0;
    let playedMatches = 0;
    let totalSets = 0;
    let totalGames = 0;

    matches
        .filter(match => match.status === 'finished')
        .forEach(match => {
            const regA = match.registration_a_id;
            const regB = match.registration_b_id;
            if (!regA || !regB || !byAthlete[regA] || !byAthlete[regB]) return;

            finishedMatches += 1;
            byAthlete[regA].matchesPlayed += 1;
            byAthlete[regB].matchesPlayed += 1;

            const winnerRegistrationId = getWinnerRegistrationId(match);
            const winnerSide = winnerRegistrationId === regA ? 'A' : winnerRegistrationId === regB ? 'B' : null;

            if (winnerSide === 'A') {
                byAthlete[regA].wins += 1;
                byAthlete[regB].losses += 1;
                byAthlete[regA].lastResult = 'V';
                byAthlete[regB].lastResult = 'D';
            } else if (winnerSide === 'B') {
                byAthlete[regB].wins += 1;
                byAthlete[regA].losses += 1;
                byAthlete[regB].lastResult = 'V';
                byAthlete[regA].lastResult = 'D';
            }

            if (match.is_walkover) {
                if (winnerSide === 'A') {
                    byAthlete[regA].walkoversWon += 1;
                    byAthlete[regB].walkoversLost += 1;
                } else if (winnerSide === 'B') {
                    byAthlete[regB].walkoversWon += 1;
                    byAthlete[regA].walkoversLost += 1;
                }
                return;
            }

            playedMatches += 1;
            const scoreA = getScoreA(match);
            const scoreB = getScoreB(match);
            const setCount = Math.max(scoreA.length, scoreB.length);

            for (let index = 0; index < setCount; index += 1) {
                const gamesA = scoreA[index];
                const gamesB = scoreB[index];
                if (typeof gamesA !== 'number' || typeof gamesB !== 'number') continue;

                const isSuperTiebreak = index === 2;
                const setWinner = getSetWinner(gamesA, gamesB, isSuperTiebreak);

                byAthlete[regA].gamesWon += gamesA;
                byAthlete[regA].gamesLost += gamesB;
                byAthlete[regB].gamesWon += gamesB;
                byAthlete[regB].gamesLost += gamesA;
                totalGames += gamesA + gamesB;

                if (setWinner === 'A') {
                    byAthlete[regA].setsWon += 1;
                    byAthlete[regB].setsLost += 1;
                    if (isSuperTiebreak) {
                        byAthlete[regA].superTiesWon += 1;
                        byAthlete[regB].superTiesLost += 1;
                    }
                } else if (setWinner === 'B') {
                    byAthlete[regB].setsWon += 1;
                    byAthlete[regA].setsLost += 1;
                    if (isSuperTiebreak) {
                        byAthlete[regB].superTiesWon += 1;
                        byAthlete[regA].superTiesLost += 1;
                    }
                }

                if (setWinner) totalSets += 1;
            }
        });

    Object.keys(byAthlete).forEach(registrationId => {
        byAthlete[registrationId] = recomputeStrength(byAthlete[registrationId]);
    });

    const byClass = Object.values(byAthlete).reduce<Record<string, AthleteStat[]>>((acc, stat) => {
        if (!acc[stat.className]) acc[stat.className] = [];
        acc[stat.className].push(stat);
        return acc;
    }, {});

    Object.keys(byClass).forEach(className => {
        byClass[className].sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if ((b.setsWon - b.setsLost) !== (a.setsWon - a.setsLost)) return (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost);
            if ((b.gamesWon - b.gamesLost) !== (a.gamesWon - a.gamesLost)) return (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost);
            return a.name.localeCompare(b.name);
        });
    });

    return {
        byAthlete,
        byClass,
        finishedMatches,
        playedMatches,
        totalSets,
        totalGames,
    };
}

export function calculateOddsSimulation(athleteA: AthleteStat, athleteB: AthleteStat): OddsSimulation {
    const sampleSize = athleteA.matchesPlayed + athleteB.matchesPlayed;
    const confidence: OddsSimulation['confidence'] = sampleSize >= 6 ? 'alta' : sampleSize >= 3 ? 'media' : 'baixa';
    const maxSpread = confidence === 'alta' ? 0.34 : confidence === 'media' ? 0.24 : 0.15;
    const strengthDelta = clamp(athleteA.strength - athleteB.strength, -1, 1);
    const probabilityA = clamp(0.5 + (strengthDelta * maxSpread), 0.1, 0.9);
    const probabilityB = 1 - probabilityA;
    const favoriteRegistrationId =
        Math.abs(probabilityA - probabilityB) < 0.01
            ? null
            : probabilityA > probabilityB
                ? athleteA.registrationId
                : athleteB.registrationId;

    return {
        athleteA: {
            registrationId: athleteA.registrationId,
            probability: round2(probabilityA * 100),
            decimalOdd: round2(1 / probabilityA),
        },
        athleteB: {
            registrationId: athleteB.registrationId,
            probability: round2(probabilityB * 100),
            decimalOdd: round2(1 / probabilityB),
        },
        favoriteRegistrationId,
        confidence,
    };
}
