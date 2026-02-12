/**
 * Animação de Quadra de Tênis em Pixel Art
 *
 * Componente visual para jogos de campeonato agendados.
 * Simula uma mini quadra de tênis com jogadores em pixels devolvendo
 * a bola usando 5 trajetórias diferentes (paralela, cruzado, balão,
 * paralela reversa, subindo a rede).
 *
 * Performance: CSS puro com keyframes (GPU-accelerated)
 * Acessibilidade: Respeita prefers-reduced-motion
 * Responsivo: Escala automaticamente em diferentes viewports
 */

import React from 'react';

export const TennisCourtAnimation: React.FC = () => {
  return (
    <div className="tennis-court-animation" aria-hidden="true">
      {/* Background da quadra com linhas e rede */}
      <div className="tennis-court-bg" />

      {/* Jogador 1 (Lado esquerdo - Azul) */}
      <div className="player-1" role="presentation" />

      {/* Jogador 2 (Lado direito - Vermelho) */}
      <div className="player-2" role="presentation" />

      {/* Bolinha de Tênis */}
      <div className="tennis-ball" role="presentation" />
    </div>
  );
};
