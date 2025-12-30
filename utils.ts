import { User, Match } from './types';

// NOTE: Ranking calculation has been moved to lib/rankingService.ts
// which fetches data from Supabase instead of mock data.
// Use fetchRanking() from that module instead.

export interface RankedPlayer {
  user: User;
  wins: number;
  losses: number;
  setsWon: number;
  gamesWon: number;
  points: number;
  position: number;
}

// --- Date Helpers ---
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function getDayName(dateStr: string): string {
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const date = new Date(dateStr + 'T00:00:00');
  return days[date.getDay()];
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// --- Tennis Scoring Rules ---

/**
 * Validates if a set score is valid according to tennis rules.
 * Valid scenarios:
 * - 6-0, 6-1, 6-2, 6-3, 6-4 (winner has 6, loser has ≤4)
 * - 7-5 (winner has 7, loser has exactly 5)
 * - 7-6 (tiebreak, winner has 7, loser has exactly 6)
 */
export function isValidSet(gamesA: number, gamesB: number): boolean {
  const winner = Math.max(gamesA, gamesB);
  const loser = Math.min(gamesA, gamesB);

  // Standard win: 6 games with 2+ game lead
  if (winner === 6 && loser <= 4) return true;

  // 7-5 win: exactly 7-5
  if (winner === 7 && loser === 5) return true;

  // Tiebreak: 7-6
  if (winner === 7 && loser === 6) return true;

  return false;
}

/**
 * Determines the winner of a single set.
 * Returns 'A' if player A won, 'B' if player B won, null if invalid or incomplete.
 */
export function getSetWinner(gamesA: number, gamesB: number): 'A' | 'B' | null {
  if (!isValidSet(gamesA, gamesB)) return null;

  if (gamesA > gamesB) return 'A';
  if (gamesB > gamesA) return 'B';
  return null;
}

/**
 * Determines the winner of a best-of-3 match.
 * Returns 'A' if player A won 2 sets, 'B' if player B won 2 sets, null if match incomplete.
 */
export function getMatchWinner(scoreA: number[], scoreB: number[]): 'A' | 'B' | null {
  let setsA = 0;
  let setsB = 0;

  const setsPlayed = Math.min(scoreA.length, scoreB.length);

  for (let i = 0; i < setsPlayed; i++) {
    const setWinner = getSetWinner(scoreA[i], scoreB[i]);
    if (setWinner === 'A') setsA++;
    else if (setWinner === 'B') setsB++;
  }

  if (setsA >= 2) return 'A';
  if (setsB >= 2) return 'B';
  return null;
}

/**
 * Counts sets won by each player.
 */
export function countSetsWon(scoreA: number[], scoreB: number[]): { setsA: number; setsB: number } {
  let setsA = 0;
  let setsB = 0;

  const setsPlayed = Math.min(scoreA.length, scoreB.length);

  for (let i = 0; i < setsPlayed; i++) {
    const setWinner = getSetWinner(scoreA[i], scoreB[i]);
    if (setWinner === 'A') setsA++;
    else if (setWinner === 'B') setsB++;
  }

  return { setsA, setsB };
}

/**
 * Checks if a third set is needed (1-1 set score).
 */
export function needsThirdSet(scoreA: number[], scoreB: number[]): boolean {
  const { setsA, setsB } = countSetsWon(scoreA, scoreB);
  return setsA === 1 && setsB === 1;
}
