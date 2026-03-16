/**
 * Point/Game/Match result overlay messages with animations
 */

import React, { useEffect, useState } from 'react';

interface PointOverlayProps {
  message: string;
  matchOver: boolean;
  winner: 0 | 1 | 2;
  setHistory: Array<[number, number]>;
  onBackToMenu: () => void;
}

// Simple confetti particles for win
const ConfettiEffect: React.FC = () => {
  const [particles] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 1.5 + Math.random() * 2,
      size: 4 + Math.random() * 6,
      color: ['#eab308', '#3b82f6', '#ef4444', '#22c55e', '#f97316', '#ec4899'][Math.floor(Math.random() * 6)],
    }))
  );

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full animate-confetti-fall"
          style={{
            left: `${p.x}%`,
            top: '-10px',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti-fall {
          animation: confetti-fall linear forwards;
        }
      `}</style>
    </div>
  );
};

export const PointOverlay: React.FC<PointOverlayProps> = ({
  message, matchOver, winner, setHistory, onBackToMenu
}) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (matchOver || message) {
      // Small delay for entrance animation
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
    }
  }, [matchOver, message]);

  if (matchOver) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        {winner === 1 && <ConfettiEffect />}
        <div
          className={`text-center px-8 py-10 bg-black/50 rounded-3xl border border-white/10 max-w-sm mx-4 transition-all duration-500 ${
            show ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
          }`}
        >
          <div className="text-5xl mb-4">{winner === 1 ? '🏆' : '😤'}</div>
          <h2 className="text-3xl font-black text-white mb-2">
            {winner === 1 ? (
              <span className="bg-linear-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">VITÓRIA!</span>
            ) : (
              <span className="text-red-400">DERROTA</span>
            )}
          </h2>
          <div className="flex justify-center gap-4 mt-4 mb-6">
            {setHistory.map(([g1, g2], i) => (
              <div key={i} className="text-center">
                <div className="text-stone-500 text-[10px] font-bold">SET {i + 1}</div>
                <div className="text-white font-black text-lg">{g1}-{g2}</div>
              </div>
            ))}
          </div>
          <button
            onClick={onBackToMenu}
            className="px-8 py-3 bg-saibro-600 hover:bg-saibro-700 text-white rounded-xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-saibro-500/30"
          >
            Voltar ao Menu
          </button>
        </div>
      </div>
    );
  }

  if (!message) return null;

  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-30 pointer-events-none">
      <div
        className={`mx-auto px-6 py-3 bg-black/60 backdrop-blur-sm max-w-xs rounded-2xl border border-white/10 transition-all duration-300 ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 -translate-y-4'
        }`}
      >
        <p className="text-white font-black text-center text-base tracking-wide">{message}</p>
      </div>
    </div>
  );
};
