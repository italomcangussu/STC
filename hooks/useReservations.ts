/**
 * Hook customizado para gerenciar reservas
 *
 * Uso:
 * const { reservations, loading, error, createReservation, updateReservation, deleteReservation } = useReservations(date);
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Reservation, Court, User } from '../types';
import { logger } from '../lib/logger';
import { notify } from '../lib/notifications';

interface UseReservationsOptions {
  date?: string; // YYYY-MM-DD
  courtId?: string;
  userId?: string;
  autoFetch?: boolean;
}

interface UseReservationsReturn {
  reservations: Reservation[];
  courts: Court[];
  profiles: User[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createReservation: (reservation: Omit<Reservation, 'id'>) => Promise<{ success: boolean; data?: Reservation; error?: string }>;
  updateReservation: (id: string, updates: Partial<Reservation>) => Promise<{ success: boolean; error?: string }>;
  deleteReservation: (id: string) => Promise<{ success: boolean; error?: string }>;
  checkConflict: (reservation: Omit<Reservation, 'id'>) => boolean;
}

export function useReservations(options: UseReservationsOptions = {}): UseReservationsReturn {
  const { date, courtId, userId, autoFetch = true } = options;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [profiles, setProfiles] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch courts (apenas uma vez)
  useEffect(() => {
    fetchCourts();
  }, []);

  // Fetch profiles (apenas uma vez)
  useEffect(() => {
    fetchProfiles();
  }, []);

  // Fetch reservations quando as dependências mudarem
  useEffect(() => {
    if (autoFetch) {
      fetchReservations();
    }
  }, [date, courtId, userId, autoFetch]);

  const fetchCourts = async () => {
    try {
      const { data, error } = await supabase
        .from('courts')
        .select('*')
        .eq('isActive', true)
        .order('name');

      if (error) throw error;

      setCourts(data.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        isActive: c.is_active
      })));
    } catch (err) {
      logger.error('fetch_courts_failed', { error: err });
    }
  };

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, phone, role, avatar_url, category, is_active, balance')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      setProfiles(data.map(p => ({
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        role: p.role,
        balance: p.balance,
        avatar: p.avatar_url,
        category: p.category,
        isActive: p.is_active
      })));
    } catch (err) {
      logger.error('fetch_profiles_failed', { error: err });
    }
  };

  const fetchReservations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('reservations')
        .select('*')
        .eq('status', 'active');

      if (date) {
        query = query.eq('date', date);
      }

      if (courtId) {
        query = query.eq('courtId', courtId);
      }

      if (userId) {
        query = query.contains('participantIds', [userId]);
      }

      query = query.order('date', { ascending: true }).order('startTime', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;

      const mappedReservations: Reservation[] = data.map(r => ({
        id: r.id,
        type: r.type,
        date: r.date,
        startTime: r.start_time,
        endTime: r.end_time,
        courtId: r.court_id,
        creatorId: r.creator_id,
        participantIds: r.participant_ids || [],
        guestName: r.guest_name,
        guestResponsibleId: r.guest_responsible_id,
        professorId: r.professor_id,
        studentType: r.student_type,
        nonSocioStudentId: r.non_socio_student_id,
        nonSocioStudentIds: r.non_socio_student_ids || [],
        observation: r.observation,
        status: r.status,
        matchId: r.match_id,
        scoreA: r.score_a,
        scoreB: r.score_b
      }));

      setReservations(mappedReservations);
      logger.debug('fetch_reservations_success', { count: mappedReservations.length });
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao carregar reservas';
      setError(errorMessage);
      logger.error('fetch_reservations_failed', { error: errorMessage });
    } finally {
      setLoading(false);
    }
  }, [date, courtId, userId]);

  const createReservation = useCallback(async (reservation: Omit<Reservation, 'id'>) => {
    try {
      // Verificar conflito antes de criar
      const hasConflict = checkConflict(reservation);
      if (hasConflict) {
        notify.error('Conflito de horário', {
          description: 'Já existe uma reserva neste horário'
        });
        return { success: false, error: 'Conflito de horário' };
      }

      const { data, error } = await supabase
        .from('reservations')
        .insert({
          type: reservation.type,
          date: reservation.date,
          start_time: reservation.startTime,
          end_time: reservation.endTime,
          court_id: reservation.courtId,
          creator_id: reservation.creatorId,
          participant_ids: reservation.participantIds,
          guest_name: reservation.guestName,
          guest_responsible_id: reservation.guestResponsibleId,
          professor_id: reservation.professorId,
          student_type: reservation.studentType,
          non_socio_student_id: reservation.nonSocioStudentId,
          non_socio_student_ids: reservation.nonSocioStudentIds || [],
          observation: reservation.observation,
          status: 'active'
        })
        .select()
        .single();

      if (error) throw error;

      const newReservation: Reservation = {
        id: data.id,
        type: data.type,
        date: data.date,
        startTime: data.start_time,
        endTime: data.end_time,
        courtId: data.court_id,
        creatorId: data.creator_id,
        participantIds: data.participant_ids || [],
        guestName: data.guest_name,
        guestResponsibleId: data.guest_responsible_id,
        professorId: data.professor_id,
        studentType: data.student_type,
        nonSocioStudentId: data.non_socio_student_id,
        nonSocioStudentIds: data.non_socio_student_ids || [],
        observation: data.observation,
        status: data.status,
        matchId: data.match_id,
        scoreA: data.score_a,
        scoreB: data.score_b
      };

      // Atualizar estado local
      setReservations(prev => [...prev, newReservation]);

      logger.info('reservation_created', { reservationId: data.id });
      notify.success('Reserva criada com sucesso!');

      return { success: true, data: newReservation };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao criar reserva';
      logger.error('create_reservation_failed', { error: errorMessage });
      notify.error('Erro ao criar reserva', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, [reservations]);

  const updateReservation = useCallback(async (id: string, updates: Partial<Reservation>) => {
    try {
      const updateData: any = {};

      if (updates.participantIds) updateData.participant_ids = updates.participantIds;
      if (updates.nonSocioStudentIds) updateData.non_socio_student_ids = updates.nonSocioStudentIds;
      if (updates.startTime) updateData.start_time = updates.startTime;
      if (updates.endTime) updateData.end_time = updates.endTime;
      if (updates.observation) updateData.observation = updates.observation;
      if (updates.status) updateData.status = updates.status;

      const { error } = await supabase
        .from('reservations')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      // Atualizar estado local
      setReservations(prev =>
        prev.map(r => (r.id === id ? { ...r, ...updates } : r))
      );

      logger.info('reservation_updated', { reservationId: id });
      notify.success('Reserva atualizada!');

      return { success: true };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao atualizar reserva';
      logger.error('update_reservation_failed', { reservationId: id, error: errorMessage });
      notify.error('Erro ao atualizar reserva', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  const deleteReservation = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', id);

      if (error) throw error;

      // Remover do estado local
      setReservations(prev => prev.filter(r => r.id !== id));

      logger.info('reservation_deleted', { reservationId: id });
      notify.success('Reserva cancelada!');

      return { success: true };
    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao cancelar reserva';
      logger.error('delete_reservation_failed', { reservationId: id, error: errorMessage });
      notify.error('Erro ao cancelar reserva', { description: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  const checkConflict = useCallback((reservation: Omit<Reservation, 'id'>): boolean => {
    const conflicts = reservations.filter(r => {
      // Mesma quadra e mesma data
      if (r.courtId !== reservation.courtId || r.date !== reservation.date) {
        return false;
      }

      // Verificar sobreposição de horário
      const startA = reservation.startTime;
      const endA = reservation.endTime;
      const startB = r.startTime;
      const endB = r.endTime;

      return (startA < endB) && (endA > startB);
    });

    return conflicts.length > 0;
  }, [reservations]);

  const refetch = useCallback(async () => {
    await fetchReservations();
  }, [fetchReservations]);

  return {
    reservations,
    courts,
    profiles,
    loading,
    error,
    refetch,
    createReservation,
    updateReservation,
    deleteReservation,
    checkConflict
  };
}
