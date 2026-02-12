/**
 * Hook customizado para gerenciar Desafios com useReducer
 *
 * Aplica Single Responsibility Principle e gerenciamento de estado robusto
 *
 * Uso:
 * const { state, actions } = useChallenges(currentUser);
 */

import { useReducer, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Challenge, User } from '../types';
import { PlayerStats, fetchRanking, canChallenge, checkMonthlyChallengeLimit } from '../lib/rankingService';
import { logger } from '../lib/logger';
import { notify } from '../lib/notifications';

// --- STATE TYPES ---
interface ChallengeState {
  // Data
  challenges: Challenge[];
  ranking: PlayerStats[];
  eligibleOpponents: PlayerStats[];

  // UI State
  loading: boolean;
  error: string | null;
  activeTab: 'create' | 'active' | 'history';

  // Create Challenge Flow
  step: 'opponent' | 'schedule';
  selectedOpponent: PlayerStats | null;
  selectedDate: string;
  selectedTime: string;
  selectedCourtId: string;

  // Limits
  monthlyLimits: {
    canChallengeOthers: boolean;
    canBeChallenged: boolean;
    sentCount: number;
    receivedCount: number;
  } | null;
}

// --- ACTION TYPES ---
type ChallengeAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_CHALLENGES'; payload: Challenge[] }
  | { type: 'SET_RANKING'; payload: PlayerStats[] }
  | { type: 'SET_ELIGIBLE_OPPONENTS'; payload: PlayerStats[] }
  | { type: 'SET_MONTHLY_LIMITS'; payload: ChallengeState['monthlyLimits'] }
  | { type: 'SET_ACTIVE_TAB'; payload: ChallengeState['activeTab'] }
  | { type: 'SET_STEP'; payload: ChallengeState['step'] }
  | { type: 'SELECT_OPPONENT'; payload: PlayerStats }
  | { type: 'SET_SCHEDULE'; payload: { date: string; time: string; courtId: string } }
  | { type: 'RESET_CREATE_FLOW' }
  | { type: 'ADD_CHALLENGE'; payload: Challenge }
  | { type: 'UPDATE_CHALLENGE'; payload: { id: string; updates: Partial<Challenge> } }
  | { type: 'DELETE_CHALLENGE'; payload: string };

// --- REDUCER ---
function challengeReducer(state: ChallengeState, action: ChallengeAction): ChallengeState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };

    case 'SET_CHALLENGES':
      return { ...state, challenges: action.payload };

    case 'SET_RANKING':
      return { ...state, ranking: action.payload };

    case 'SET_ELIGIBLE_OPPONENTS':
      return { ...state, eligibleOpponents: action.payload };

    case 'SET_MONTHLY_LIMITS':
      return { ...state, monthlyLimits: action.payload };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };

    case 'SET_STEP':
      return { ...state, step: action.payload };

    case 'SELECT_OPPONENT':
      return { ...state, selectedOpponent: action.payload, step: 'schedule' };

    case 'SET_SCHEDULE':
      return {
        ...state,
        selectedDate: action.payload.date,
        selectedTime: action.payload.time,
        selectedCourtId: action.payload.courtId,
      };

    case 'RESET_CREATE_FLOW':
      return {
        ...state,
        step: 'opponent',
        selectedOpponent: null,
        selectedDate: '',
        selectedTime: '',
        selectedCourtId: '',
      };

    case 'ADD_CHALLENGE':
      return { ...state, challenges: [...state.challenges, action.payload] };

    case 'UPDATE_CHALLENGE':
      return {
        ...state,
        challenges: state.challenges.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
        ),
      };

    case 'DELETE_CHALLENGE':
      return {
        ...state,
        challenges: state.challenges.filter(c => c.id !== action.payload),
      };

    default:
      return state;
  }
}

// --- INITIAL STATE ---
const initialState: ChallengeState = {
  challenges: [],
  ranking: [],
  eligibleOpponents: [],
  loading: true,
  error: null,
  activeTab: 'create',
  step: 'opponent',
  selectedOpponent: null,
  selectedDate: '',
  selectedTime: '',
  selectedCourtId: '',
  monthlyLimits: null,
};

// --- HOOK ---
export function useChallenges(currentUser: User) {
  const [state, dispatch] = useReducer(challengeReducer, initialState);

  // Fetch challenges on mount
  useEffect(() => {
    fetchChallenges();
  }, [currentUser.id]);

  // Fetch ranking on mount
  useEffect(() => {
    fetchRankingData();
  }, []);

  // Fetch monthly limits on mount
  useEffect(() => {
    fetchMonthlyLimits();
  }, [currentUser.id]);

  // Calculate eligible opponents when ranking changes
  useEffect(() => {
    if (state.ranking.length > 0) {
      calculateEligibleOpponents();
    }
  }, [state.ranking, currentUser.id]);

  const fetchChallenges = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });

      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .or(`challenger_id.eq.${currentUser.id},challenged_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mappedChallenges: Challenge[] = data.map(c => ({
        id: c.id,
        status: c.status,
        monthRef: c.month_ref,
        createdAt: c.created_at,
        challengerId: c.challenger_id,
        challengedId: c.challenged_id,
        reservationId: c.reservation_id,
        matchId: c.match_id,
        cancelReason: c.cancel_reason,
        scheduledDate: c.scheduled_date,
        scheduledTime: c.scheduled_time,
        courtId: c.court_id,
        notificationSeen: c.notification_seen
      }));

      dispatch({ type: 'SET_CHALLENGES', payload: mappedChallenges });
      logger.debug('fetch_challenges_success', { count: mappedChallenges.length });
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao carregar desafios';
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      logger.error('fetch_challenges_failed', { error: errorMessage });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const fetchRankingData = async () => {
    try {
      const rankingData = await fetchRanking();
      dispatch({ type: 'SET_RANKING', payload: rankingData });
      logger.debug('fetch_ranking_success', { count: rankingData.length });
    } catch (err: any) {
      logger.error('fetch_ranking_failed', { error: err.message });
    }
  };

  const fetchMonthlyLimits = async () => {
    try {
      const limits = await checkMonthlyChallengeLimit(currentUser.id);
      dispatch({ type: 'SET_MONTHLY_LIMITS', payload: limits });
      logger.debug('fetch_monthly_limits_success', limits);
    } catch (err: any) {
      logger.error('fetch_monthly_limits_failed', { error: err.message });
    }
  };

  const calculateEligibleOpponents = () => {
    const eligible = state.ranking.filter(player => {
      if (player.id === currentUser.id) return false;

      const result = canChallenge(currentUser.id, player.id, state.ranking);
      return result.allowed;
    });

    dispatch({ type: 'SET_ELIGIBLE_OPPONENTS', payload: eligible });
  };

  const createChallenge = useCallback(async () => {
    if (!state.selectedOpponent) {
      notify.error('Selecione um oponente');
      return { success: false };
    }

    if (!state.selectedDate || !state.selectedTime || !state.selectedCourtId) {
      notify.error('Preencha todos os campos de agendamento');
      return { success: false };
    }

    try {
      const monthRef = new Date().toISOString().slice(0, 7); // YYYY-MM

      const { data, error } = await supabase
        .from('challenges')
        .insert({
          challenger_id: currentUser.id,
          challenged_id: state.selectedOpponent.id,
          status: 'proposed',
          month_ref: monthRef,
          scheduled_date: state.selectedDate,
          scheduled_time: state.selectedTime,
          court_id: state.selectedCourtId,
        })
        .select()
        .single();

      if (error) throw error;

      const newChallenge: Challenge = {
        id: data.id,
        status: data.status,
        monthRef: data.month_ref,
        createdAt: data.created_at,
        challengerId: data.challenger_id,
        challengedId: data.challenged_id,
        scheduledDate: data.scheduled_date,
        scheduledTime: data.scheduled_time,
        courtId: data.court_id,
      };

      dispatch({ type: 'ADD_CHALLENGE', payload: newChallenge });
      dispatch({ type: 'RESET_CREATE_FLOW' });

      logger.info('challenge_created', { challengeId: data.id });
      notify.success('Desafio criado com sucesso!', {
        description: `${state.selectedOpponent.name} foi desafiado(a)`,
      });

      // Refetch limits
      await fetchMonthlyLimits();

      return { success: true, data: newChallenge };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao criar desafio';
      logger.error('create_challenge_failed', { error: errorMessage });
      notify.error('Erro ao criar desafio', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, [state.selectedOpponent, state.selectedDate, state.selectedTime, state.selectedCourtId, currentUser.id]);

  const acceptChallenge = useCallback(async (challengeId: string) => {
    try {
      const { error } = await supabase
        .from('challenges')
        .update({ status: 'accepted' })
        .eq('id', challengeId);

      if (error) throw error;

      dispatch({ type: 'UPDATE_CHALLENGE', payload: { id: challengeId, updates: { status: 'accepted' } } });

      logger.info('challenge_accepted', { challengeId });
      notify.success('Desafio aceito!');

      return { success: true };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao aceitar desafio';
      logger.error('accept_challenge_failed', { challengeId, error: errorMessage });
      notify.error('Erro ao aceitar desafio', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  const declineChallenge = useCallback(async (challengeId: string, reason?: string) => {
    try {
      const { error } = await supabase
        .from('challenges')
        .update({
          status: 'declined',
          cancel_reason: reason || 'Recusado pelo desafiado',
        })
        .eq('id', challengeId);

      if (error) throw error;

      dispatch({ type: 'UPDATE_CHALLENGE', payload: { id: challengeId, updates: { status: 'declined', cancelReason: reason } } });

      logger.info('challenge_declined', { challengeId });
      notify.info('Desafio recusado');

      return { success: true };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao recusar desafio';
      logger.error('decline_challenge_failed', { challengeId, error: errorMessage });
      notify.error('Erro ao recusar desafio', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  const cancelChallenge = useCallback(async (challengeId: string, reason?: string) => {
    try {
      const { error } = await supabase
        .from('challenges')
        .update({
          status: 'cancelled',
          cancel_reason: reason || 'Cancelado pelo desafiante',
        })
        .eq('id', challengeId);

      if (error) throw error;

      dispatch({ type: 'UPDATE_CHALLENGE', payload: { id: challengeId, updates: { status: 'cancelled', cancelReason: reason } } });

      logger.info('challenge_cancelled', { challengeId });
      notify.info('Desafio cancelado');

      return { success: true };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao cancelar desafio';
      logger.error('cancel_challenge_failed', { challengeId, error: errorMessage });
      notify.error('Erro ao cancelar desafio', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  // Filtros computados (memoizados)
  const filteredChallenges = useMemo(() => {
    return state.challenges.filter(c => {
      if (state.activeTab === 'active') {
        return ['proposed', 'accepted', 'scheduled'].includes(c.status);
      }
      if (state.activeTab === 'history') {
        return ['finished', 'cancelled', 'declined', 'expired'].includes(c.status);
      }
      return true;
    });
  }, [state.challenges, state.activeTab]);

  // Actions object
  const actions = {
    setActiveTab: (tab: ChallengeState['activeTab']) => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab }),
    setStep: (step: ChallengeState['step']) => dispatch({ type: 'SET_STEP', payload: step }),
    selectOpponent: (opponent: PlayerStats) => dispatch({ type: 'SELECT_OPPONENT', payload: opponent }),
    setSchedule: (date: string, time: string, courtId: string) =>
      dispatch({ type: 'SET_SCHEDULE', payload: { date, time, courtId } }),
    resetCreateFlow: () => dispatch({ type: 'RESET_CREATE_FLOW' }),
    createChallenge,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
    refetch: fetchChallenges,
  };

  return {
    state: {
      ...state,
      filteredChallenges,
    },
    actions,
  };
}
