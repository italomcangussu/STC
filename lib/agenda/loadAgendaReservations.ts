// Reservas e jogos de campeonato que a Agenda mostra, a partir de `historyFrom` ('YYYY-MM-DD') em diante.
// Falha de leitura das reservas sobe como erro: tela vazia por falha não pode parecer dia sem reserva.
import { supabase } from '../supabase';
import { fetchAllRows } from '../fetchAllRows';
import { getNowInFortaleza } from '../../utils';
import { Reservation, User } from '../../types';

type Participant = { name: string | null; avatar: string | null };

const MATCH_DURATION_MINUTES = 90;

const toReservation = (r: any): Reservation => ({
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
    status: r.status || 'active'
});

async function fetchReservations(historyFrom: string): Promise<Reservation[]> {
    const { data, error } = await fetchAllRows((from, to) =>
        supabase
            .from('reservations')
            .select('*')
            .gte('date', historyFrom)
            .order('date', { ascending: true })
            .order('start_time', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to));

    if (error) throw error;
    return (data ?? []).map(toReservation);
}

async function fetchScheduledMatches(historyFrom: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('matches')
        .select(`
            *,
            championships(name),
            championship_rounds(name)
        `)
        .not('scheduled_date', 'is', null)
        .not('scheduled_time', 'is', null)
        .gte('scheduled_date', historyFrom)
        .order('scheduled_date', { ascending: true })
        .order('scheduled_time', { ascending: true });

    if (error) console.warn('Error fetching matches for agenda:', error.message);
    return data ?? [];
}

const toParticipant = (reg: any): Participant => {
    const isGuest = reg.participant_type === 'guest';
    return {
        name: isGuest ? (reg.guest_name || null) : (reg.user?.name || null),
        avatar: isGuest ? null : (reg.user?.avatar_url || null)
    };
};

async function fetchRegistrationLookup(matches: any[]): Promise<Map<string, Participant>> {
    const lookup = new Map<string, Participant>();
    const ids = Array.from(new Set(
        matches.flatMap(m => [m.registration_a_id, m.registration_b_id].filter(Boolean))
    )) as string[];
    if (ids.length === 0) return lookup;

    const { data, error } = await supabase
        .from('championship_registrations')
        .select('id, participant_type, guest_name, user_id, user:profiles!user_id(name, avatar_url)')
        .in('id', ids);

    if (error) {
        console.warn('Error fetching championship registrations for agenda:', error.message);
        return lookup;
    }
    (data ?? []).forEach((reg: any) => lookup.set(reg.id, toParticipant(reg)));
    return lookup;
}

function matchEndTime(scheduledTime: string | null): string {
    const [hours, minutes] = (scheduledTime || '00:00').split(':').map(Number);
    const end = getNowInFortaleza();
    end.setHours(hours, minutes + MATCH_DURATION_MINUTES, 0);
    return end.toTimeString().slice(0, 5);
}

type Lookups = { profiles: User[]; registrations: Map<string, Participant> };

function resolveSide(registrationId: string | null, playerId: string | null, { profiles, registrations }: Lookups): Participant {
    const registration = registrationId ? registrations.get(registrationId) : undefined;
    const profile = profiles.find(p => p.id === playerId);
    return {
        name: registration?.name || profile?.name || null,
        avatar: registration?.avatar || profile?.avatar || null
    };
}

const matchObservation = (m: any): string =>
    `${m.championships?.name || 'Campeonato'} | ${m.championship_rounds?.name || 'Rodada'}`;

function toMatchReservation(m: any, lookups: Lookups): Reservation {
    const sideA = resolveSide(m.registration_a_id, m.player_a_id, lookups);
    const sideB = resolveSide(m.registration_b_id, m.player_b_id, lookups);

    return {
        id: `match_${m.id}`,
        matchId: m.id,
        type: 'Campeonato',
        date: m.scheduled_date!,
        startTime: (m.scheduled_time || '').slice(0, 5),
        endTime: matchEndTime(m.scheduled_time),
        courtId: m.court_id!,
        creatorId: 'system',
        participantIds: [m.player_a_id, m.player_b_id].filter(Boolean) as string[],
        participantNames: [sideA.name, sideB.name],
        participantAvatars: [sideA.avatar, sideB.avatar],
        scoreA: m.score_a || [0],
        scoreB: m.score_b || [0],
        matchStatus: m.status || 'pending',
        matchWinnerId: m.winner_id || null,
        matchIsWalkover: !!m.is_walkover,
        matchRegistrationAId: m.registration_a_id || null,
        matchRegistrationBId: m.registration_b_id || null,
        matchWalkoverWinnerRegistrationId: m.walkover_winner_registration_id || null,
        guestName: null,
        guestResponsibleId: null,
        professorId: null,
        studentType: null,
        nonSocioStudentId: null,
        nonSocioStudentIds: [],
        observation: matchObservation(m),
        status: 'active'
    };
}

// Um horário por (data, início, quadra); o jogo de campeonato vence a reserva comum no mesmo horário.
function dedupeBySlot(items: Reservation[]): Reservation[] {
    const bySlot = new Map<string, Reservation>();
    items.forEach(item => {
        const key = `${item.date}_${item.startTime}_${item.courtId}`;
        if (!bySlot.has(key) || item.id.startsWith('match_')) bySlot.set(key, item);
    });
    return Array.from(bySlot.values());
}

export async function loadAgendaReservations(historyFrom: string, profiles: User[]): Promise<Reservation[]> {
    const reservations = await fetchReservations(historyFrom);
    const matches = await fetchScheduledMatches(historyFrom);
    const registrations = await fetchRegistrationLookup(matches);
    const matchReservations = matches.map(m => toMatchReservation(m, { profiles, registrations }));
    return dedupeBySlot([...reservations, ...matchReservations]);
}
