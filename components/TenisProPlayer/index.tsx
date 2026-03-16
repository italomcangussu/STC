/**
 * TenisProPlayer - 3D Tennis Game
 * Menu + orchestrator with landscape fullscreen support
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Trophy, Gamepad2, ArrowLeft, Volume2, VolumeX, Loader2, Maximize, RotateCcw } from 'lucide-react';
import { DIFFICULTY_CONFIG } from './constants';
import type { Difficulty, GameState } from './constants';
import { useOrientation } from './engine/useOrientation';

const Game3D = lazy(() => import('./Game3D').then(m => ({ default: m.Game3D })));

// Rotate phone prompt for portrait mode during gameplay
const RotatePrompt: React.FC = () => (
  <div className="fixed inset-0 z-50 bg-stone-900/95 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-8">
    <div className="w-20 h-20 border-2 border-saibro-500/50 rounded-2xl flex items-center justify-center animate-pulse">
      <RotateCcw size={40} className="text-saibro-400" />
    </div>
    <div className="text-center">
      <h3 className="text-white font-black text-xl mb-2">Gire o Celular</h3>
      <p className="text-stone-400 text-sm max-w-[250px]">
        Para uma melhor experiência, coloque o celular na horizontal (paisagem)
      </p>
    </div>
    <div className="flex items-center gap-2 text-stone-500 text-xs">
      <div className="w-8 h-5 border border-stone-600 rounded-sm relative">
        <div className="absolute inset-[2px] bg-stone-700 rounded-[1px]" />
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-saibro-500">
        <path d="M5 12h14m-7-7 7 7-7 7" />
      </svg>
      <div className="w-5 h-8 border border-stone-600 rounded-sm relative">
        <div className="absolute inset-[2px] bg-stone-700 rounded-[1px]" />
      </div>
    </div>
  </div>
);

export const TenisProPlayer: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const { isLandscape, isPortrait, isMobile, containerRef, requestFullscreen } = useOrientation();

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Auto-request fullscreen when entering landscape during gameplay on mobile
  useEffect(() => {
    if (gameState === 'playing' && isMobile && isLandscape) {
      requestFullscreen();
    }
  }, [gameState, isMobile, isLandscape, requestFullscreen]);

  // ─── MENU ─────────────────────────────────────────────────────
  if (gameState === 'menu') {
    return (
      <div ref={containerRef} className="min-h-dvh bg-linear-to-b from-stone-900 via-stone-800 to-stone-900 flex flex-col items-center justify-center p-4 select-none">
        <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-6">
          {/* Logo */}
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-linear-to-br from-saibro-500 to-saibro-700 flex items-center justify-center shadow-2xl shadow-saibro-500/30">
              <Trophy size={48} className="text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-lg">
              3D
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-black text-white tracking-tight">TenisProPlayer</h1>
            <p className="text-stone-400 text-sm mt-1">Jogo de Tênis 3D do Clube</p>
          </div>

          {/* Play button */}
          <button
            onClick={() => setGameState('difficulty')}
            className="w-full py-5 bg-linear-to-r from-saibro-500 to-saibro-600 hover:from-saibro-600 hover:to-saibro-700 text-white rounded-2xl font-black text-lg uppercase tracking-wider shadow-xl shadow-saibro-500/30 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <Gamepad2 size={24} />
            JOGAR vs IA
          </button>

          {/* Fullscreen button (mobile only) */}
          {isMobile && (
            <button
              onClick={requestFullscreen}
              className="w-full py-3 bg-stone-800/80 hover:bg-stone-700/80 border border-stone-700/50 text-stone-300 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Maximize size={16} />
              Tela Cheia
            </button>
          )}

          {/* Controls */}
          <div className="w-full bg-stone-800/50 rounded-2xl p-4 border border-stone-700/50">
            <h3 className="text-stone-300 font-bold text-xs uppercase tracking-wider mb-3">Controles</h3>
            {isTouchDevice ? (
              <div className="space-y-2 text-stone-400 text-xs">
                <p>👉 <span className="text-stone-300">Lado esquerdo</span> - Joystick para mover</p>
                <p>👉 <span className="text-stone-300">Lado direito</span> - Botões de golpe</p>
                <div className="flex gap-3 mt-2">
                  <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-[10px] font-bold">HIT</span>
                  <span className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-blue-400 text-[10px] font-bold">LOB</span>
                  <span className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/30 rounded text-orange-400 text-[10px] font-bold">SLICE</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-stone-400 text-xs">
                <p><span className="inline-block w-12 text-center bg-stone-700 rounded px-1 py-0.5 text-stone-300 font-mono">WASD</span> Mover jogador</p>
                <p><span className="inline-block w-12 text-center bg-stone-700 rounded px-1 py-0.5 text-stone-300 font-mono">SPACE</span> Golpe normal</p>
                <p><span className="inline-block w-12 text-center bg-stone-700 rounded px-1 py-0.5 text-stone-300 font-mono">Q</span> Lob (bola alta)</p>
                <p><span className="inline-block w-12 text-center bg-stone-700 rounded px-1 py-0.5 text-stone-300 font-mono">E</span> Slice (cortada)</p>
              </div>
            )}
          </div>

          {/* Sound */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center gap-2 text-stone-500 text-sm hover:text-stone-300 transition-colors"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            Som {soundEnabled ? 'Ligado' : 'Desligado'}
          </button>
        </div>
      </div>
    );
  }

  // ─── DIFFICULTY ───────────────────────────────────────────────
  if (gameState === 'difficulty') {
    return (
      <div className="min-h-dvh bg-linear-to-b from-stone-900 via-stone-800 to-stone-900 flex flex-col items-center justify-center p-4 select-none">
        <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-6">
          <button
            onClick={() => setGameState('menu')}
            className="self-start flex items-center gap-2 text-stone-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>

          <h2 className="text-2xl font-black text-white">Dificuldade</h2>

          <div className="w-full space-y-3">
            {(Object.entries(DIFFICULTY_CONFIG) as [Difficulty, typeof DIFFICULTY_CONFIG['easy']][]).map(([key, config]) => (
              <button
                key={key}
                onClick={() => {
                  setDifficulty(key);
                  setGameState('playing');
                }}
                className="w-full p-4 bg-stone-800/80 hover:bg-stone-700/80 border border-stone-700/50 hover:border-saibro-500/50 rounded-2xl text-left transition-all active:scale-[0.98] flex items-center gap-4"
              >
                <span className="text-2xl">{config.emoji}</span>
                <div className="flex-1">
                  <p className="text-white font-bold">{config.label}</p>
                  <p className="text-stone-400 text-xs">
                    Reação: {Math.round(config.reactionSpeed * 100)}% | Precisão: {Math.round(config.accuracy * 100)}%
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── 3D GAME ──────────────────────────────────────────────────
  return (
    <div ref={containerRef}>
      {/* Portrait prompt on mobile */}
      {isMobile && isPortrait && <RotatePrompt />}

      <Suspense fallback={
        <div className="min-h-dvh bg-stone-900 flex flex-col items-center justify-center gap-4">
          <Loader2 size={32} className="text-saibro-500 animate-spin" />
          <p className="text-stone-400 text-sm font-bold">Carregando jogo 3D...</p>
        </div>
      }>
        <Game3D
          difficulty={difficulty}
          soundEnabled={soundEnabled}
          isTouchDevice={isTouchDevice}
          isLandscape={isLandscape}
          onGameOver={() => setGameState('menu')}
        />
      </Suspense>
    </div>
  );
};

export default TenisProPlayer;
