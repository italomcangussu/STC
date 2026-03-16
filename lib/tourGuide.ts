/**
 * Tour Guiado para Novos Usuários
 *
 * Uso:
 * import { startAppTour, startChallengeTour } from './lib/tourGuide';
 * startAppTour();
 */

import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { logger } from './logger';

// Check if user has seen tour
const TOUR_STORAGE_KEY = 'stc-tour-completed';

export function hasCompletedTour(tourName: string): boolean {
  const completed = localStorage.getItem(`${TOUR_STORAGE_KEY}-${tourName}`);
  return completed === 'true';
}

export function markTourCompleted(tourName: string): void {
  localStorage.setItem(`${TOUR_STORAGE_KEY}-${tourName}`, 'true');
  logger.info('tour_completed', { tourName });
}

/**
 * Tour principal do app
 */
export function startAppTour() {
  if (hasCompletedTour('app')) {
    return;
  }

  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        element: '#agenda-tab',
        popover: {
          title: '📅 Agenda',
          description: 'Aqui você vê todas as reservas de quadras. Crie novas reservas clicando no botão +',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#desafios-tab',
        popover: {
          title: '🎯 Desafios',
          description: 'Desafie outros jogadores para subir no ranking! Você pode desafiar jogadores até 3 posições acima ou abaixo.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#ranking-tab',
        popover: {
          title: '🏆 Ranking',
          description: 'Acompanhe sua posição e veja os melhores jogadores por classe (4ª, 5ª, 6ª).',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '#perfil-menu',
        popover: {
          title: '👤 Seu Perfil',
          description: 'Clique aqui para ver suas estatísticas, editar perfil e acessar configurações.',
          side: 'left',
          align: 'start',
        },
      },
    ],
    onDestroyStarted: () => {
      markTourCompleted('app');
      driverObj.destroy();
    },
  });

  driverObj.drive();
  logger.info('tour_started', { tourName: 'app' });
}

/**
 * Tour do sistema de desafios
 */
export function startChallengeTour() {
  if (hasCompletedTour('challenges')) {
    return;
  }

  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        popover: {
          title: '🎯 Bem-vindo aos Desafios!',
          description: 'Aprenda como funciona o sistema de desafios do STC Play.',
        },
      },
      {
        element: '#challenge-rules',
        popover: {
          title: '📋 Regras',
          description: 'Leia as regras de desafio: posições, limites mensais e pontuação.',
          side: 'bottom',
        },
      },
      {
        element: '#create-challenge-btn',
        popover: {
          title: '➕ Criar Desafio',
          description: 'Clique aqui para desafiar outro jogador. Escolha seu oponente e agende a partida.',
          side: 'bottom',
        },
      },
      {
        element: '#challenge-tabs',
        popover: {
          title: '📊 Abas',
          description: 'Navegue entre criar desafio, desafios ativos e histórico de partidas.',
          side: 'top',
        },
      },
    ],
    onDestroyStarted: () => {
      markTourCompleted('challenges');
      driverObj.destroy();
    },
  });

  driverObj.drive();
  logger.info('tour_started', { tourName: 'challenges' });
}

/**
 * Tour do ranking
 */
export function startRankingTour() {
  if (hasCompletedTour('ranking')) {
    return;
  }

  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        popover: {
          title: '🏆 Sistema de Ranking',
          description: 'Entenda como funciona o ranking do STC Play.',
        },
      },
      {
        element: '#ranking-filters',
        popover: {
          title: '🎯 Filtros',
          description: 'Filtre o ranking por classe: 4ª (avançado), 5ª (intermediário), 6ª (iniciante).',
          side: 'bottom',
        },
      },
      {
        element: '#ranking-position',
        popover: {
          title: '📊 Sua Posição',
          description: 'Sua posição é calculada por: pontos > vitórias > sets vencidos.',
          side: 'right',
        },
      },
      {
        popover: {
          title: '💡 Como Subir no Ranking',
          description: 'Aceite e vença desafios para ganhar 100 pontos por vitória. SuperSets valem 10 pontos!',
        },
      },
    ],
    onDestroyStarted: () => {
      markTourCompleted('ranking');
      driverObj.destroy();
    },
  });

  driverObj.drive();
  logger.info('tour_started', { tourName: 'ranking' });
}

/**
 * Tour admin
 */
export function startAdminTour() {
  if (hasCompletedTour('admin')) {
    return;
  }

  const driverObj = driver({
    showProgress: true,
    showButtons: ['next', 'previous', 'close'],
    steps: [
      {
        popover: {
          title: '👨‍💼 Painel Administrativo',
          description: 'Bem-vindo ao painel admin! Aqui você gerencia todo o clube.',
        },
      },
      {
        element: '#admin-users',
        popover: {
          title: '👥 Gerenciar Usuários',
          description: 'Adicione, edite e desative usuários do clube.',
          side: 'bottom',
        },
      },
      {
        element: '#admin-courts',
        popover: {
          title: '🎾 Gerenciar Quadras',
          description: 'Configure quadras, tipos (saibro/rápida) e disponibilidade.',
          side: 'bottom',
        },
      },
      {
        element: '#admin-reports',
        popover: {
          title: '📊 Relatórios',
          description: 'Acesse métricas, gráficos de ocupação e exporte dados.',
          side: 'bottom',
        },
      },
      {
        element: '#admin-championships',
        popover: {
          title: '🏆 Campeonatos',
          description: 'Crie e gerencie campeonatos, grupos e chaveamentos.',
          side: 'bottom',
        },
      },
    ],
    onDestroyStarted: () => {
      markTourCompleted('admin');
      driverObj.destroy();
    },
  });

  driverObj.drive();
  logger.info('tour_started', { tourName: 'admin' });
}

/**
 * Reset tour (for testing or user request)
 */
export function resetTour(tourName?: string) {
  if (tourName) {
    localStorage.removeItem(`${TOUR_STORAGE_KEY}-${tourName}`);
  } else {
    // Reset all tours
    ['app', 'challenges', 'ranking', 'admin'].forEach((name) => {
      localStorage.removeItem(`${TOUR_STORAGE_KEY}-${name}`);
    });
  }
  logger.info('tour_reset', { tourName: tourName || 'all' });
}
