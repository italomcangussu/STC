/**
 * Scoreboard HUD (HTML Overlay)
 * Compact landscape mode, glassmorphism style
 */

import React from 'react';
import type { MatchScore } from '../engine/useScoring';

interface HUDProps {
  score: MatchScore;
  pointsDisplay: string;
  isLandscape: boolean;
}

export const HUD: React.FC<HUDProps> = ({ score, pointsDisplay, isLandscape }) => {
  if (isLandscape) {
    // Compact horizontal HUD for landscape
    return (
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none">
        <div className="bg-black/50 backdrop-blur-xl rounded-xl px-3 py-1.5 border border-white/10 shadow-xl flex items-center gap-3">
          {/* Player labels */}
          <div className="flex items-center gap-1">
            {score.server === 1 && <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />}
            <span className="text-blue-400 font-bold text-[10px] tracking-wide">VOCÊ</span>
          </div>

          {/* Set scores */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            {score.setHistory.map(([g1, g2], i) => (
              <span key={i} className="text-white/60">{g1}-{g2}</span>
            ))}
            <span className="text-amber-400 font-bold">{score.p1.games}-{score.p2.games}</span>
          </div>

          {/* Points */}
          <div className="text-white font-black text-xs tracking-wider border-l border-white/10 pl-3">
            {pointsDisplay}
          </div>

          {/* AI label */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-3">
            {score.server === 2 && <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />}
            <span className="text-red-400 font-bold text-[10px] tracking-wide">IA</span>
          </div>
        </div>
      </div>
    );
  }

  // Standard portrait HUD
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none">
      <div className="bg-black/60 backdrop-blur-xl rounded-2xl px-4 py-2.5 min-w-[260px] border border-white/10 shadow-2xl">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-[11px] font-mono">
          {/* Header row */}
          <div />
          {score.setHistory.map((_, i) => (
            <div key={i} className="text-stone-500 text-center font-bold text-[9px]">S{i + 1}</div>
          ))}
          <div className="text-amber-400 text-center font-bold text-[9px]">
            {score.tieBreak ? 'TB' : `S${score.currentSet}`}
          </div>

          {/* Player 1 row */}
          <div className="flex items-center gap-1.5">
            {score.server === 1 && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            <span className="text-blue-400 font-bold tracking-wide">VOCÊ</span>
          </div>
          {score.setHistory.map(([g1], i) => (
            <div key={i} className="text-white/70 text-center">{g1}</div>
          ))}
          <div className="text-amber-400 font-bold text-center">{score.p1.games}</div>

          {/* Player 2 row */}
          <div className="flex items-center gap-1.5">
            {score.server === 2 && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            <span className="text-red-400 font-bold tracking-wide">IA</span>
          </div>
          {score.setHistory.map(([, g2], i) => (
            <div key={i} className="text-white/70 text-center">{g2}</div>
          ))}
          <div className="text-amber-400 font-bold text-center">{score.p2.games}</div>
        </div>

        {/* Points display */}
        <div className="text-center mt-1.5 pt-1.5 border-t border-white/10">
          <span className="text-white font-black text-sm tracking-wider">{pointsDisplay}</span>
        </div>
      </div>
    </div>
  );
};
