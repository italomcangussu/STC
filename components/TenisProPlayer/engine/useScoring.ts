/**
 * ITF Tennis Scoring System Hook
 */

import { useRef, useCallback } from 'react';
import { POINTS_DISPLAY } from '../constants';

export interface Score {
  points: number;
  games: number;
  sets: number;
}

export interface MatchScore {
  p1: Score;
  p2: Score;
  server: 1 | 2;
  deuce: boolean;
  advantage: 0 | 1 | 2;
  tieBreak: boolean;
  setHistory: Array<[number, number]>;
  currentSet: number;
  matchOver: boolean;
  winner: 0 | 1 | 2;
}

function createInitialScore(): MatchScore {
  return {
    p1: { points: 0, games: 0, sets: 0 },
    p2: { points: 0, games: 0, sets: 0 },
    server: 1,
    deuce: false,
    advantage: 0,
    tieBreak: false,
    setHistory: [],
    currentSet: 1,
    matchOver: false,
    winner: 0,
  };
}

export function useScoring() {
  const scoreRef = useRef<MatchScore>(createInitialScore());

  const reset = useCallback(() => {
    scoreRef.current = createInitialScore();
  }, []);

  const getScore = useCallback(() => scoreRef.current, []);

  const scorePoint = useCallback((winner: 1 | 2) => {
    const sc = scoreRef.current;
    const ws = winner === 1 ? sc.p1 : sc.p2;
    const ls = winner === 1 ? sc.p2 : sc.p1;

    if (sc.tieBreak) {
      ws.points++;
      if (ws.points >= 7 && ws.points - ls.points >= 2) {
        ws.games++;
        winSet(winner);
      } else {
        const total = sc.p1.points + sc.p2.points;
        if (total % 2 === 1) sc.server = sc.server === 1 ? 2 : 1;
      }
      return;
    }

    if (sc.deuce) {
      if (sc.advantage === winner) {
        ws.games++;
        sc.deuce = false;
        sc.advantage = 0;
        checkSetEnd();
        sc.server = sc.server === 1 ? 2 : 1;
      } else if (sc.advantage === (winner === 1 ? 2 : 1)) {
        sc.advantage = 0;
      } else {
        sc.advantage = winner;
      }
      return;
    }

    ws.points++;

    if (sc.p1.points >= 3 && sc.p2.points >= 3) {
      if (sc.p1.points === sc.p2.points) {
        sc.deuce = true;
        sc.advantage = 0;
      } else if (ws.points - ls.points >= 2) {
        ws.games++;
        sc.deuce = false;
        checkSetEnd();
        sc.server = sc.server === 1 ? 2 : 1;
      }
      return;
    }

    if (ws.points >= 4) {
      ws.games++;
      checkSetEnd();
      sc.server = sc.server === 1 ? 2 : 1;
    }
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function checkSetEnd() {
    const sc = scoreRef.current;
    sc.p1.points = 0;
    sc.p2.points = 0;
    sc.deuce = false;
    sc.advantage = 0;

    const g1 = sc.p1.games;
    const g2 = sc.p2.games;

    if (g1 === 6 && g2 === 6 && !sc.tieBreak) {
      sc.tieBreak = true;
      return;
    }

    if ((Math.max(g1, g2) >= 6 && Math.abs(g1 - g2) >= 2) || sc.tieBreak) {
      winSet(g1 > g2 ? 1 : 2);
    }
  }

  function winSet(winner: 1 | 2) {
    const sc = scoreRef.current;
    const ws = winner === 1 ? sc.p1 : sc.p2;

    sc.setHistory.push([sc.p1.games, sc.p2.games]);
    ws.sets++;
    sc.p1.games = 0;
    sc.p2.games = 0;
    sc.p1.points = 0;
    sc.p2.points = 0;
    sc.tieBreak = false;
    sc.deuce = false;
    sc.advantage = 0;
    sc.currentSet++;

    if (ws.sets >= 2) {
      sc.matchOver = true;
      sc.winner = winner;
    }
  }

  const getPointsDisplay = useCallback((): string => {
    const sc = scoreRef.current;
    if (sc.tieBreak) return `${sc.p1.points} - ${sc.p2.points}`;
    if (sc.deuce) {
      if (sc.advantage === 1) return 'AD - 40';
      if (sc.advantage === 2) return '40 - AD';
      return 'DEUCE';
    }
    const p1 = POINTS_DISPLAY[Math.min(sc.p1.points, 3)];
    const p2 = POINTS_DISPLAY[Math.min(sc.p2.points, 3)];
    return `${p1} - ${p2}`;
  }, []);

  return { scoreRef, scorePoint, getPointsDisplay, getScore, reset };
}
