import { supabase } from './supabase';
import { logger } from './logger';

// --- Class Hierarchy ---
// Classes ordenadas do mais alto (melhor) para o mais baixo
export const CLASS_ORDER = ['4ª Classe', '5ª Classe', '6ª Classe'];

// Quantos jogadores da classe acima o 1º lugar pode desafiar
export const CROSS_CLASS_CHALLENGE_LIMIT = 2;

// Cache simples para rankings (TTL: 30 segundos)
let rankingCache: { data: PlayerStats[]; timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 segundos

// --- Types ---
export interface PlayerStats {
    id: string;
    name: string;
    category: string | null;
    avatarUrl: string | null;

    // Legacy stats (from old championships)
    legacyWins: number;
    legacyLosses: number;
    legacySetsWon: number;
    legacySetsLost: number;
    legacyGamesWon: number;
    legacyGamesLost: number;
    legacyTiebreaksWon: number;
    legacyTiebreaksLost: number;
    legacyMatchesPlayed: number;
    legacyMatchesWithTiebreak: number;
    legacyPoints: number;

    // Challenge stats (calculated from matches)
    challengeWins: number;
    challengeLosses: number;
    challengeSetsWon: number;
    challengeSetsLost: number;
    challengeGamesWon: number;
    challengeGamesLost: number;
    challengeTiebreaksWon: number;
    challengeTiebreaksLost: number;
    challengeMatchesPlayed: number;
    challengeMatchesWithTiebreak: number;
    challengePoints: number;

    // SuperSet stats
    superSetWins: number;
    superSetLosses: number;
    superSetPoints: number;
    superSetMatchesPlayed: number;

    // Combined totals
    totalWins: number;
    totalLosses: number;
    totalSetsWon: number;
    totalSetsLost: number;
    totalGamesWon: number;
    totalGamesLost: number;
    totalPoints: number;

    // Positions
    categoryPosition: number;  // Position within category (1st in 6ª Classe, etc.)
    globalPosition: number;    // Position in global hierarchy (class-sorted then points)
}

// Points formula
const PTS_WIN = 100;
const PTS_SET = 10;
const PTS_GAME = 1;

/**
 * Fetch complete ranking from Supabase, combining legacy stats + challenge match stats
 * Otimizado com cache e logs estruturados
 */
export async function fetchRanking(categoryFilter?: string, forceRefresh = false): Promise<PlayerStats[]> {
    const startTime = performance.now();

    // Verificar cache (apenas se não houver filtro e não for refresh forçado)
    if (!categoryFilter && !forceRefresh && rankingCache) {
        const age = Date.now() - rankingCache.timestamp;
        if (age < CACHE_TTL) {
            logger.debug('ranking_cache_hit', { age: `${age}ms` });
            return rankingCache.data;
        }
    }

    // 1. Fetch all profiles with legacy stats (OTIMIZADO: apenas campos necessários)
    let query = supabase
        .from('profiles')
        .select(`
            id, name, category, avatar_url,
            legacy_wins, legacy_losses, legacy_sets_won, legacy_sets_lost,
            legacy_games_won, legacy_games_lost, legacy_tiebreaks_won, legacy_tiebreaks_lost,
            legacy_matches_played, legacy_matches_with_tiebreak, legacy_points
        `)
        .in('role', ['socio', 'admin'])
        .eq('is_active', true);

    if (categoryFilter) {
        query = query.eq('category', categoryFilter);
    }

    const { data: profiles, error: profilesError } = await query;
    if (profilesError) {
        logger.error('fetch_ranking_profiles_failed', { error: profilesError.message });
        return [];
    }

    logger.debug('fetch_ranking_profiles_success', { count: profiles?.length || 0 });

    // 2. Fetch all challenge matches
    const { data: matches, error: matchesError } = await supabase
        .from('matches')
        .select('player_a_id, player_b_id, score_a, score_b, winner_id, type')
        .in('type', ['Desafio', 'Desafio Ranking', 'SuperSet'])
        .eq('status', 'finished');

    if (matchesError) {
        logger.error('fetch_ranking_matches_failed', { error: matchesError.message });
        return [];
    }

    logger.debug('fetch_ranking_matches_success', { count: matches?.length || 0 });

    const challengeStats: Record<string, {
        wins: number; losses: number;
        setsWon: number; setsLost: number;
        gamesWon: number; gamesLost: number;
        tiebreaksWon: number; tiebreaksLost: number;
        matchesPlayed: number; matchesWithTiebreak: number;
        points: number; // Accumulated points (Challenges + SuperSets)
        challengeWins: number; challengeLosses: number;
        challengePoints: number;
        superSetWins: number; superSetLosses: number;
        superSetPoints: number;
    }> = {};

    // Initialize all players
    profiles?.forEach(p => {
        challengeStats[p.id] = {
            wins: 0, losses: 0,
            setsWon: 0, setsLost: 0,
            gamesWon: 0, gamesLost: 0,
            tiebreaksWon: 0, tiebreaksLost: 0,
            matchesPlayed: 0, matchesWithTiebreak: 0,
            points: 0,
            challengeWins: 0, challengeLosses: 0,
            challengePoints: 0,
            superSetWins: 0, superSetLosses: 0,
            superSetPoints: 0
        };
    });

    // Process matches
    matches?.forEach(match => {
        const playerA = match.player_a_id;
        const playerB = match.player_b_id;
        const scoreA: number[] = match.score_a || [];
        const scoreB: number[] = match.score_b || [];
        const type = match.type;

        if (!challengeStats[playerA] || !challengeStats[playerB]) return;

        // Match played
        challengeStats[playerA].matchesPlayed++;
        challengeStats[playerB].matchesPlayed++;

        // Check for tiebreak (3rd set or 7-6 sets)
        // SuperSet (1 set) usually doesn't count as "matchesWithTiebreak" unless it goes to 10-something or 7-6?
        // User said "Apenas 1 set".
        const hasTiebreak = scoreA.length === 3 ||
            scoreA.some((s, i) => (s === 7 && scoreB[i] === 6) || (s === 6 && scoreB[i] === 7));
        if (hasTiebreak) {
            challengeStats[playerA].matchesWithTiebreak++;
            challengeStats[playerB].matchesWithTiebreak++;
        }

        let matchGamesA = 0;
        let matchGamesB = 0;
        let matchSetsA = 0;
        let matchSetsB = 0;

        // Count sets and games
        scoreA.forEach((gamesA, i) => {
            const gamesB = scoreB[i] || 0;

            // Games
            challengeStats[playerA].gamesWon += gamesA;
            challengeStats[playerA].gamesLost += gamesB;
            challengeStats[playerB].gamesWon += gamesB;
            challengeStats[playerB].gamesLost += gamesA;

            matchGamesA += gamesA;
            matchGamesB += gamesB;

            // Sets (who won this set)
            // For tiebreak set (index 2), it's first to 10
            if (i === 2) {
                // Super tiebreak
                if (gamesA > gamesB) {
                    challengeStats[playerA].setsWon++;
                    challengeStats[playerB].setsLost++;
                    challengeStats[playerA].tiebreaksWon++;
                    challengeStats[playerB].tiebreaksLost++;
                    matchSetsA++;
                } else {
                    challengeStats[playerB].setsWon++;
                    challengeStats[playerA].setsLost++;
                    challengeStats[playerB].tiebreaksWon++;
                    challengeStats[playerA].tiebreaksLost++;
                    matchSetsB++;
                }
            } else {
                // Regular set OR SuperSet (index 0)
                if (gamesA > gamesB) {
                    challengeStats[playerA].setsWon++;
                    challengeStats[playerB].setsLost++;
                    matchSetsA++;
                } else if (gamesB > gamesA) {
                    challengeStats[playerB].setsWon++;
                    challengeStats[playerA].setsLost++;
                    matchSetsB++;
                }
                // 7-6 tiebreak
                if ((gamesA === 7 && gamesB === 6)) {
                    challengeStats[playerA].tiebreaksWon++;
                    challengeStats[playerB].tiebreaksLost++;
                } else if ((gamesB === 7 && gamesA === 6)) {
                    challengeStats[playerB].tiebreaksWon++;
                    challengeStats[playerA].tiebreaksLost++;
                }
            }
        });

        // Wins/Losses & Points
        if (match.winner_id === playerA) {
            challengeStats[playerA].wins++;
            challengeStats[playerB].losses++;

            if (type === 'SuperSet') {
                challengeStats[playerA].superSetWins++;
                challengeStats[playerB].superSetLosses++;
                challengeStats[playerA].superSetPoints += 10;
                challengeStats[playerA].points += 10;
            } else {
                challengeStats[playerA].challengeWins++;
                challengeStats[playerB].challengeLosses++;
                challengeStats[playerA].challengePoints += PTS_WIN;
                challengeStats[playerA].points += PTS_WIN;
            }

        } else if (match.winner_id === playerB) {
            challengeStats[playerB].wins++;
            challengeStats[playerA].losses++;

            if (type === 'SuperSet') {
                challengeStats[playerB].superSetWins++;
                challengeStats[playerA].superSetLosses++;
                challengeStats[playerB].superSetPoints += 10;
                challengeStats[playerB].points += 10;
            } else {
                challengeStats[playerB].challengeWins++;
                challengeStats[playerA].challengeLosses++;
                challengeStats[playerB].challengePoints += PTS_WIN;
                challengeStats[playerB].points += PTS_WIN;
            }
        }

        // Apply Loser Points?
        // User said: "desafio não da pontos de games e sets"
        // If we remove sets/games points, loser gets 0.
        // So we remove the block that gave loser points.

    });

    // 4. Combine legacy + challenge stats
    const ranking: PlayerStats[] = (profiles || []).map(p => {
        const legacy = {
            wins: p.legacy_wins || 0,
            losses: p.legacy_losses || 0,
            setsWon: p.legacy_sets_won || 0,
            setsLost: p.legacy_sets_lost || 0,
            gamesWon: p.legacy_games_won || 0,
            gamesLost: p.legacy_games_lost || 0,
            tiebreaksWon: p.legacy_tiebreaks_won || 0,
            tiebreaksLost: p.legacy_tiebreaks_lost || 0,
            matchesPlayed: p.legacy_matches_played || 0,
            matchesWithTiebreak: p.legacy_matches_with_tiebreak || 0,
            points: p.legacy_points || 0
        };

        const challenge = challengeStats[p.id] || {
            wins: 0, losses: 0,
            setsWon: 0, setsLost: 0,
            gamesWon: 0, gamesLost: 0,
            tiebreaksWon: 0, tiebreaksLost: 0,
            matchesPlayed: 0, matchesWithTiebreak: 0,
            points: 0,
            challengeWins: 0, challengeLosses: 0,
            challengePoints: 0,
            superSetWins: 0, superSetLosses: 0,
            superSetPoints: 0
        };

        // Calculate challenge points - ALREADY CALCULATED IN LOOP
        const challengePoints = challenge.points;

        // Combined totals
        const totalWins = legacy.wins + challenge.wins;
        const totalLosses = legacy.losses + challenge.losses;
        const totalSetsWon = legacy.setsWon + challenge.setsWon;
        const totalSetsLost = legacy.setsLost + challenge.setsLost;
        const totalGamesWon = legacy.gamesWon + challenge.gamesWon;
        const totalGamesLost = legacy.gamesLost + challenge.gamesLost;
        const totalPoints = legacy.points + challengePoints;

        return {
            id: p.id,
            name: p.name,
            category: p.category,
            avatarUrl: p.avatar_url,

            legacyWins: legacy.wins,
            legacyLosses: legacy.losses,
            legacySetsWon: legacy.setsWon,
            legacySetsLost: legacy.setsLost,
            legacyGamesWon: legacy.gamesWon,
            legacyGamesLost: legacy.gamesLost,
            legacyTiebreaksWon: legacy.tiebreaksWon,
            legacyTiebreaksLost: legacy.tiebreaksLost,
            legacyMatchesPlayed: legacy.matchesPlayed,
            legacyMatchesWithTiebreak: legacy.matchesWithTiebreak,
            legacyPoints: legacy.points,

            challengeWins: challenge.wins,
            challengeLosses: challenge.losses,
            challengeSetsWon: challenge.setsWon,
            challengeSetsLost: challenge.setsLost,
            challengeGamesWon: challenge.gamesWon,
            challengeGamesLost: challenge.gamesLost,
            challengeTiebreaksWon: challenge.tiebreaksWon,
            challengeTiebreaksLost: challenge.tiebreaksLost,
            challengeMatchesPlayed: challenge.matchesPlayed,
            challengeMatchesWithTiebreak: challenge.matchesWithTiebreak,
            challengePoints: challenge.challengePoints,

            superSetWins: challenge.superSetWins,
            superSetLosses: challenge.superSetLosses,
            superSetPoints: challenge.superSetPoints,
            superSetMatchesPlayed: challenge.superSetWins + challenge.superSetLosses,

            totalWins,
            totalLosses,
            totalSetsWon,
            totalSetsLost,
            totalGamesWon,
            totalGamesLost,
            totalPoints,
            categoryPosition: 0, // Will be set after sorting
            globalPosition: 0    // Will be set after sorting
        };
    });

    // 5. Sort within each category by points
    ranking.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
        return b.totalSetsWon - a.totalSetsWon;
    });

    // 6. Assign category positions
    const categoryCounters: Record<string, number> = {};
    ranking.forEach(player => {
        const cat = player.category || 'Sem Classe';
        categoryCounters[cat] = (categoryCounters[cat] || 0) + 1;
        player.categoryPosition = categoryCounters[cat];
    });

    // 7. Sort by class hierarchy then by points for global ranking
    ranking.sort((a, b) => {
        const classA = CLASS_ORDER.indexOf(a.category || '');
        const classB = CLASS_ORDER.indexOf(b.category || '');

        // Unknown classes go last
        const orderA = classA === -1 ? 999 : classA;
        const orderB = classB === -1 ? 999 : classB;

        if (orderA !== orderB) return orderA - orderB;

        // Within same class, sort by points
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.totalWins !== a.totalWins) return b.totalWins - a.totalWins;
        return b.totalSetsWon - a.totalSetsWon;
    });

    // 8. Assign global positions
    ranking.forEach((player, index) => {
        player.globalPosition = index + 1;
    });

    // Atualizar cache (apenas se não houver filtro)
    if (!categoryFilter) {
        rankingCache = { data: ranking, timestamp: Date.now() };
    }

    const duration = performance.now() - startTime;
    logger.info('fetch_ranking_complete', {
        count: ranking.length,
        duration: `${duration.toFixed(2)}ms`,
        cached: false,
    });

    return ranking;
}

/**
 * Get ranking grouped by category
 */
export async function fetchRankingByCategory(): Promise<Record<string, PlayerStats[]>> {
    const allPlayers = await fetchRanking();

    const byCategory: Record<string, PlayerStats[]> = {};

    CLASS_ORDER.forEach(cat => {
        byCategory[cat] = allPlayers
            .filter(p => p.category === cat)
            .sort((a, b) => a.categoryPosition - b.categoryPosition);
    });

    // Add "Sem Classe" if any
    const noClass = allPlayers.filter(p => !p.category || !CLASS_ORDER.includes(p.category));
    if (noClass.length > 0) {
        byCategory['Sem Classe'] = noClass;
    }

    return byCategory;
}

/**
 * Check if a player can challenge another based on ranking rules
 * NEW RULES (Jan 2026):
 * - Can challenge anyone within 3 POSITIONS above OR 3 POSITIONS below in General Ranking
 * - Independent of class or points, only Global Position matters.
 * - Monthly limit rules still apply (checked in canChallengeWithLimits)
 */
export function canChallenge(
    challenger: PlayerStats,
    target: PlayerStats,
    allPlayers: PlayerStats[]
): { allowed: boolean; reason?: string } {
    // Cannot challenge self
    if (challenger.id === target.id) {
        return { allowed: false, reason: 'Não pode desafiar a si mesmo' };
    }

    // Ensure we have valid global positions
    if (!challenger.globalPosition || !target.globalPosition) {
        return { allowed: false, reason: 'Erro: Posição no ranking não calculada' };
    }

    // Calculate position difference
    const posDiff = Math.abs(challenger.globalPosition - target.globalPosition);

    // Can challenge within 3 positions (above or below)
    if (posDiff <= 3) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Só pode desafiar jogadores até 3 posições de distância no Ranking Geral (diferença atual: ${posDiff} posições)`
    };
}

/**
 * Check monthly challenge limits for a player
 * Returns whether they can challenge (as challenger) and be challenged (as target) this month
 */
export async function checkMonthlyChallengeLimit(
    playerId: string
): Promise<{ canChallengeOthers: boolean; canBeChallenged: boolean; challengesMade: number; challengesReceived: number }> {
    const now = new Date();
    const monthRef = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get challenges where this player is the challenger (sent challenges)
    const { data: sentChallenges, error: sentError } = await supabase
        .from('challenges')
        .select('id')
        .eq('challenger_id', playerId)
        .eq('month_ref', monthRef)
        .not('status', 'in', '("cancelled","expired","declined")');

    // Get challenges where this player is the target (received challenges)
    const { data: receivedChallenges, error: receivedError } = await supabase
        .from('challenges')
        .select('id')
        .eq('challenged_id', playerId)
        .eq('month_ref', monthRef)
        .not('status', 'in', '("cancelled","expired","declined")');

    if (sentError || receivedError) {
        logger.error('check_monthly_limit_failed', { error: (sentError || receivedError)?.message });
        return { canChallengeOthers: false, canBeChallenged: false, challengesMade: 0, challengesReceived: 0 };
    }

    const challengesMade = sentChallenges?.length || 0;
    const challengesReceived = receivedChallenges?.length || 0;

    return {
        canChallengeOthers: challengesMade < 1,  // Can challenge if made 0 challenges this month
        canBeChallenged: challengesReceived < 1, // Can be challenged if received 0 challenges this month
        challengesMade,
        challengesReceived
    };
}

/**
 * Full validation including position rules AND monthly limits
 */
export async function canChallengeWithLimits(
    challenger: PlayerStats,
    target: PlayerStats,
    allPlayers: PlayerStats[]
): Promise<{ allowed: boolean; reason?: string }> {
    // First check position rules
    const positionCheck = canChallenge(challenger, target, allPlayers);
    if (!positionCheck.allowed) {
        return positionCheck;
    }

    // Check challenger's monthly limit
    const challengerLimits = await checkMonthlyChallengeLimit(challenger.id);
    if (!challengerLimits.canChallengeOthers) {
        return {
            allowed: false,
            reason: 'Você já fez 1 desafio este mês (limite: 1x/mês)'
        };
    }

    // Check target's monthly limit
    const targetLimits = await checkMonthlyChallengeLimit(target.id);
    if (!targetLimits.canBeChallenged) {
        return {
            allowed: false,
            reason: 'Este jogador já foi desafiado este mês (limite: 1x/mês)'
        };
    }

    return { allowed: true };
}

/**
 * Get list of players that a given player can challenge (by position rules only)
 * Note: For full validation including monthly limits, use canChallengeWithLimits
 */
export function getEligibleOpponents(
    challengerId: string,
    allPlayers: PlayerStats[]
): PlayerStats[] {
    const challenger = allPlayers.find(p => p.id === challengerId);
    if (!challenger) return [];

    return allPlayers.filter(target => {
        const result = canChallenge(challenger, target, allPlayers);
        return result.allowed;
    });
}

