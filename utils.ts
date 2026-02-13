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

// --- Date Helpers (Timezone: America/Fortaleza) ---

/**
 * Returns the current date/time adjusted to America/Fortaleza timezone (UTC-3).
 * Since we can't easily change the system timezone of the browser, 
 * we return a Date object that "looks" like the Fortaleza time in the local getters.
 * CAUTION: usage of .toISOString() on this object will be "wrong" by the timezone offset difference.
 * Use valid formatters below.
 */
export function getNowInFortaleza(): Date {
  // Create date with current instant
  const now = new Date();

  // Get the string representation in Fortaleza time
  const fortalezaString = now.toLocaleString('en-US', { timeZone: 'America/Fortaleza' });

  // Create a new Date from that string
  // This new date object, when accessed with .getHours() etc., will return Fortaleza components
  // but internally it might represent a different UTC instant depending on local browser TZ.
  // This is a "shifted" date approach to ease component rendering.
  return new Date(fortalezaString);
}


export function formatDate(date: Date): string {
  // Ensure we are formatting the date part correctly relative to Fortaleza
  // If 'date' is already a "shifted" date (from getNowInFortaleza), native methods work naturally for YYYY-MM-DD
  // If 'date' is a true UTC timestamp, we should probably shift it first if we want "local" date.

  // Simple YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateBr(dateStr: string): string {
  if (!dateStr) return '';
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
/**
 * Validates if a set score is valid according to tennis rules.
 * Valid scenarios:
 * - 6-0, 6-1, 6-2, 6-3, 6-4 (winner has 6, loser has ≤4)
 * - 7-5 (winner has 7, loser has exactly 5)
 * - 7-6 (tiebreak, winner has 7, loser has exactly 6)
 * - Super Tiebreak (if enabled): Winner >= 10 and diff >= 2
 */
export function isValidSet(gamesA: number, gamesB: number, isSuperTiebreak = false): boolean {
  if (isSuperTiebreak) {
    const winner = Math.max(gamesA, gamesB);
    const loser = Math.min(gamesA, gamesB);
    return winner >= 10 && (winner - loser) >= 2;
  }

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
export function getSetWinner(gamesA: number, gamesB: number, isSuperTiebreak = false): 'A' | 'B' | null {
  if (!isValidSet(gamesA, gamesB, isSuperTiebreak)) return null;

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
    // Treat 3rd set as super tiebreak only when the score looks like one (>=10 with diff 2)
    const isSuperTie = i === 2 && (scoreA[i] >= 10 || scoreB[i] >= 10);
    const setWinner = getSetWinner(scoreA[i], scoreB[i], isSuperTie);
    
    if (setWinner === 'A') setsA++;
    else if (setWinner === 'B') setsB++;
  }

  if (setsA >= 2) return 'A';
  if (setsB >= 2) return 'B';
  // Also handle the case where sets are 1-1 and we played the 3rd set (super tiebreak)
  // If we have a winner for the 3rd set, that player wins the match
  if (setsPlayed >= 3) {
      const set3Winner = getSetWinner(scoreA[2], scoreB[2], true);
      if (set3Winner === 'A') return 'A';
      if (set3Winner === 'B') return 'B';
  }
  
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
    const isSuperTie = i === 2 && (scoreA[i] >= 10 || scoreB[i] >= 10);
    const setWinner = getSetWinner(scoreA[i], scoreB[i], isSuperTie);
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
