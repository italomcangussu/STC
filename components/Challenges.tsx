import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, Challenge, Match, Court, Reservation } from '../types';
import { Trophy, Plus, CheckCircle, XCircle, Clock, Calendar, AlertTriangle, ArrowRight, ShieldAlert, PlayCircle, Loader2, Target, Info, MapPin, ChevronRight, ChevronLeft } from 'lucide-react';
import { fetchRanking, getEligibleOpponents, canChallenge, canChallengeWithLimits, checkMonthlyChallengeLimit, PlayerStats, CLASS_ORDER } from '../lib/rankingService';
import { sendPushNotification } from '../lib/notificationService';
import { supabase } from '../lib/supabase';
import { LiveScoreboard } from './LiveScoreboard';
import { getNowInFortaleza, formatDate } from '../utils';

// Time slots available for challenges (7am to 9pm)
const TIME_SLOTS = [
    '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00',
    '19:00', '20:00', '21:00'
];

// --- COMPONENT: Create Challenge Modal ---
const CreateChallengeModal: React.FC<{
    currentUser: User;
    ranking: PlayerStats[];
    onClose: () => void;
    onConfirm: (data: { opponentId: string; date: string; time: string; courtId: string }) => void;
}> = ({ currentUser, ranking, onClose, onConfirm }) => {
    // Step management
    const [step, setStep] = useState<'opponent' | 'schedule'>('opponent');

    // Data state
    const [selectedOpponent, setSelectedOpponent] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedTime, setSelectedTime] = useState('');
    const [selectedCourt, setSelectedCourt] = useState('');

    // Loading states
    const [loading, setLoading] = useState(true);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Data lists
    const [eligibleOpponents, setEligibleOpponents] = useState<PlayerStats[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [existingReservations, setExistingReservations] = useState<Reservation[]>([]);
    const [monthlyLimits, setMonthlyLimits] = useState<{ canChallengeOthers: boolean; challengesMade: number } | null>(null);

    // Min date is today (in Fortaleza)
    const today = formatDate(getNowInFortaleza());

    // Load initial data
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);

            // Check monthly limits first
            const limits = await checkMonthlyChallengeLimit(currentUser.id);
            setMonthlyLimits(limits);

            // Get eligible opponents by position rules
            const eligible = getEligibleOpponents(currentUser.id, ranking);

            // Filter out opponents who already reached their "being challenged" limit
            const filteredEligible: PlayerStats[] = [];
            for (const opp of eligible) {
                const oppLimits = await checkMonthlyChallengeLimit(opp.id);
                if (oppLimits.canBeChallenged) {
                    filteredEligible.push(opp);
                }
            }
            setEligibleOpponents(filteredEligible);

            // Load courts
            const { data: courtsData } = await supabase
                .from('courts')
                .select('*')
                .eq('is_active', true);

            setCourts((courtsData || []).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                isActive: c.is_active
            })));

            setLoading(false);
        };

        loadData();
    }, [currentUser.id, ranking]);

    // Load reservations when date changes
    useEffect(() => {
        if (!selectedDate) return;

        const loadReservations = async () => {
            setLoadingSlots(true);
            const { data } = await supabase
                .from('reservations')
                .select('*')
                .eq('date', selectedDate)
                .neq('status', 'cancelled');

            setExistingReservations((data || []).map(r => ({
                id: r.id,
                type: r.type,
                date: r.date,
                startTime: r.start_time,
                endTime: r.end_time,
                courtId: r.court_id,
                creatorId: r.creator_id,
                participantIds: r.participant_ids || [],
                status: r.status
            })));
            setLoadingSlots(false);
        };

        loadReservations();
    }, [selectedDate]);

    // Check if a slot is available
    const isSlotAvailable = (courtId: string, time: string): boolean => {
        // Check if there's any reservation for this court overlapping this time
        return !existingReservations.some(r =>
            r.courtId === courtId &&
            r.startTime <= time &&
            r.endTime > time
        );
    };

    // Get available times for selected court
    const availableTimes = useMemo(() => {
        if (!selectedCourt || !selectedDate) return [];

        // Determine if selected date is a weekend
        const dateObj = new Date(selectedDate + 'T12:00:00');
        const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 6 = Saturday
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        return TIME_SLOTS.filter(time => {
            // Filter out past times if today
            if (selectedDate === today) {
                const now = getNowInFortaleza();
                const [h, m] = time.split(':').map(Number);
                const slotTime = new Date(selectedDate + 'T' + time + ':00'); // Construct time for slot
                slotTime.setHours(h, m, 0, 0);
                if (slotTime <= now) return false;
            }

            // On weekdays, only allow after 20:00
            if (!isWeekend) {
                const [hour] = time.split(':').map(Number);
                if (hour < 20) return false;
            }

            return isSlotAvailable(selectedCourt, time);
        });
    }, [selectedCourt, selectedDate, existingReservations, today]);

    const myStats = ranking.find(p => p.id === currentUser.id);
    const selectedOpponentData = eligibleOpponents.find(o => o.id === selectedOpponent);

    // If user already challenged this month, show message
    if (monthlyLimits && !monthlyLimits.canChallengeOthers) {
        return createPortal(
            <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 animate-in zoom-in duration-200">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-saibro-800">Novo Desafio</h3>
                        <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><XCircle size={24} /></button>
                    </div>

                    <div className="bg-orange-50 p-4 rounded-lg border border-orange-200 text-center">
                        <AlertTriangle className="mx-auto mb-2 text-orange-500" size={32} />
                        <p className="font-bold text-orange-800">Limite mensal atingido</p>
                        <p className="text-sm text-orange-600 mt-1">
                            Você já fez {monthlyLimits.challengesMade} desafio este mês.
                        </p>
                        <p className="text-xs text-orange-500 mt-2">
                            O limite é de 1 desafio por mês.
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-stone-200 text-stone-600 font-bold rounded-xl"
                    >
                        Fechar
                    </button>
                </div>
            </div>,
            document.body
        );
    }

    const handleSubmit = async () => {
        if (!selectedOpponent || !selectedDate || !selectedTime || !selectedCourt) return;
        setSubmitting(true);
        await onConfirm({
            opponentId: selectedOpponent,
            date: selectedDate,
            time: selectedTime,
            courtId: selectedCourt
        });
        setSubmitting(false);
    };

    return createPortal(
        <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden animate-in zoom-in duration-200 flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-stone-100 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {step === 'schedule' && (
                            <button onClick={() => setStep('opponent')} className="text-stone-400 hover:text-stone-600">
                                <ChevronLeft size={20} />
                            </button>
                        )}
                        <h3 className="text-xl font-bold text-saibro-800">
                            {step === 'opponent' ? 'Escolher Adversário' : 'Agendar Horário'}
                        </h3>
                    </div>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><XCircle size={24} /></button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto flex-1 space-y-4">
                    {step === 'opponent' ? (
                        <>
                            {/* Current user info */}
                            <div className="bg-saibro-50 p-3 rounded-lg border border-saibro-100">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-stone-500">Sua posição global</p>
                                        <p className="font-bold text-saibro-700">
                                            #{myStats?.globalPosition} ({myStats?.category})
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-stone-500">Pontos</p>
                                        <p className="font-bold text-saibro-700">{myStats?.totalPoints}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Rules */}
                            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800 border border-blue-100">
                                <div className="flex items-start gap-2">
                                    <Info size={16} className="shrink-0 mt-0.5" />
                                    <div className="text-xs">
                                        <p className="font-bold mb-1">Regras de Desafio:</p>
                                        <ul className="list-disc pl-4 space-y-0.5">
                                            <li>Pode desafiar 3 posições acima ou abaixo</li>
                                            <li>Empates contam como uma posição</li>
                                            <li>Limite: 1 desafio por mês</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            {/* Opponents List */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-stone-500 uppercase">Adversários disponíveis</label>
                                <div className="max-h-48 overflow-y-auto space-y-2 border border-stone-100 rounded-xl p-2">
                                    {loading ? (
                                        <div className="flex justify-center py-8">
                                            <Loader2 className="animate-spin text-saibro-600" size={24} />
                                        </div>
                                    ) : eligibleOpponents.length === 0 ? (
                                        <div className="text-center py-4">
                                            <p className="text-stone-400 text-sm">Nenhum adversário disponível.</p>
                                        </div>
                                    ) : (
                                        eligibleOpponents.map(opp => (
                                            <button
                                                key={opp.id}
                                                onClick={() => setSelectedOpponent(opp.id)}
                                                className={`w-full p-3 rounded-xl flex items-center justify-between transition-all ${selectedOpponent === opp.id ? 'bg-saibro-100 border-saibro-400 ring-1 ring-saibro-400' : 'bg-white border border-stone-100 hover:bg-stone-50'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold text-stone-600 w-8">#{opp.globalPosition}</span>
                                                    <div className="text-left">
                                                        <p className="font-bold text-stone-800">{opp.name}</p>
                                                        <span className="text-[10px] text-stone-500">{opp.category} • {opp.totalPoints} pts</span>
                                                    </div>
                                                </div>
                                                {selectedOpponent === opp.id && <CheckCircle size={20} className="text-saibro-600" />}
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Selected Opponent Summary */}
                            <div className="bg-stone-50 p-3 rounded-lg flex items-center gap-3">
                                <div className="w-10 h-10 bg-saibro-200 rounded-full flex items-center justify-center text-saibro-700 font-bold">
                                    {selectedOpponentData?.name?.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-bold text-stone-800">vs {selectedOpponentData?.name}</p>
                                    <p className="text-xs text-stone-500">#{selectedOpponentData?.globalPosition} • {selectedOpponentData?.category}</p>
                                </div>
                            </div>

                            {/* Date Picker */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-stone-500 uppercase flex items-center gap-1">
                                    <Calendar size={12} /> Data
                                </label>
                                <input
                                    type="date"
                                    min={today}
                                    value={selectedDate}
                                    onChange={(e) => {
                                        setSelectedDate(e.target.value);
                                        setSelectedTime(''); // Reset time when date changes
                                    }}
                                    className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-saibro-500"
                                />
                            </div>

                            {/* Court Selector */}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-stone-500 uppercase flex items-center gap-1">
                                    <MapPin size={12} /> Quadra
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {courts.map(court => (
                                        <button
                                            key={court.id}
                                            onClick={() => {
                                                setSelectedCourt(court.id);
                                                setSelectedTime(''); // Reset time when court changes
                                            }}
                                            className={`p-3 rounded-xl border text-left transition-all ${selectedCourt === court.id ? 'bg-saibro-100 border-saibro-400 ring-1 ring-saibro-400' : 'bg-white border-stone-200 hover:bg-stone-50'}`}
                                        >
                                            <p className="font-bold text-stone-800">{court.name}</p>
                                            <p className="text-xs text-stone-500">{court.type}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Time Slots */}
                            {selectedDate && selectedCourt && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-stone-500 uppercase flex items-center gap-1">
                                        <Clock size={12} /> Horário Disponível
                                    </label>
                                    {loadingSlots ? (
                                        <div className="flex justify-center py-4">
                                            <Loader2 className="animate-spin text-saibro-600" size={20} />
                                        </div>
                                    ) : availableTimes.length === 0 ? (
                                        <p className="text-center text-stone-400 text-sm py-4">Nenhum horário disponível nesta data/quadra.</p>
                                    ) : (
                                        <div className="grid grid-cols-4 gap-2">
                                            {availableTimes.map(time => (
                                                <button
                                                    key={time}
                                                    onClick={() => setSelectedTime(time)}
                                                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${selectedTime === time ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                                                >
                                                    {time}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-stone-100">
                    {step === 'opponent' ? (
                        <button
                            disabled={!selectedOpponent}
                            onClick={() => setStep('schedule')}
                            className="w-full py-3 bg-saibro-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2"
                        >
                            Próximo: Agendar <ChevronRight size={18} />
                        </button>
                    ) : (
                        <button
                            disabled={!selectedDate || !selectedTime || !selectedCourt || submitting}
                            onClick={handleSubmit}
                            className="w-full py-3 bg-saibro-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2"
                        >
                            {submitting ? <Loader2 className="animate-spin" size={18} /> : <Trophy size={18} />}
                            {submitting ? 'Enviando...' : 'Enviar Desafio'}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};


// --- COMPONENT: Challenge Results Modal ---
const ChallengeResultsModal: React.FC<{
    matchId: string;
    currentUser: User;
    onClose: () => void;
}> = ({ matchId, currentUser, onClose }) => {
    const [match, setMatch] = useState<Match | null>(null);
    const [loading, setLoading] = useState(true);
    const [playerA, setPlayerA] = useState<{ name: string; avatar: string | null } | null>(null);
    const [playerB, setPlayerB] = useState<{ name: string; avatar: string | null } | null>(null);

    useEffect(() => {
        const loadMatch = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('matches')
                .select(`
                    *,
                    player_a:profiles!player_a_id(name, avatar_url),
                    player_b:profiles!player_b_id(name, avatar_url)
                `)
                .eq('id', matchId)
                .single();

            if (data && !error) {
                setMatch({
                    id: data.id,
                    playerAId: data.player_a_id,
                    playerBId: data.player_b_id,
                    scoreA: data.score_a || [],
                    scoreB: data.score_b || [],
                    status: data.status,
                    winnerId: data.winner_id,
                    date: data.date,
                    type: data.type,
                    scheduledTime: data.time || '00:00' // Ensure this maps correctly if possible
                });
                setPlayerA({ name: data.player_a.name, avatar: data.player_a.avatar_url });
                setPlayerB({ name: data.player_b.name, avatar: data.player_b.avatar_url });
            }
            setLoading(false);
        };
        loadMatch();
    }, [matchId]);

    if (!match && !loading) return null;

    const profilesForBoard = match && playerA && playerB ? [
        { id: match.playerAId, name: playerA.name, avatar: playerA.avatar } as User,
        { id: match.playerBId, name: playerB.name, avatar: playerB.avatar } as User
    ] : [];

    return createPortal(
        <div className="fixed inset-0 bg-black/80 z-70 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="relative w-full max-w-md animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute -top-3 -right-3 z-50 bg-white rounded-full p-2 shadow-lg text-stone-500 hover:text-red-500 transition-colors border border-stone-100"
                >
                    <XCircle size={24} />
                </button>

                {loading ? (
                    <div className="bg-white rounded-3xl p-8 flex justify-center shadow-2xl">
                        <Loader2 className="animate-spin text-saibro-600" size={32} />
                    </div>
                ) : (
                    <LiveScoreboard
                        match={match!}
                        profiles={profilesForBoard}
                        currentUser={currentUser}
                        readOnly={true}
                    />
                )}
            </div>
        </div>,
        document.body
    );
};


// --- MAIN COMPONENT: Challenges ---
export const Challenges: React.FC = () => null;

// Actual Component Definition with Props
export const ChallengesView: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [ranking, setRanking] = useState<PlayerStats[]>([]);
    const [profiles, setProfiles] = useState<Record<string, { name: string; avatar_url: string | null }>>({});
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
    const [historyScope, setHistoryScope] = useState<'mine' | 'all'>('all');
    const [loading, setLoading] = useState(true);
    const [todayMatches, setTodayMatches] = useState<Match[]>([]);

    // Load data
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Fetch ranking
                const rankingData = await fetchRanking();
                setRanking(rankingData);

                // Fetch challenges from database
                const { data: challengesData } = await supabase
                    .from('challenges')
                    .select('*')
                    .order('created_at', { ascending: false });

                const mappedChallenges = challengesData?.map(c => ({
                    id: c.id,
                    challengerId: c.challenger_id,
                    challengedId: c.challenged_id,
                    status: c.status,
                    monthRef: c.month_ref,
                    matchId: c.match_id,
                    createdAt: c.created_at?.split('T')[0],
                    scheduledDate: c.scheduled_date,
                    scheduledTime: c.scheduled_time,
                    courtId: c.court_id,
                    reservationId: c.reservation_id,
                    notificationSeen: c.notification_seen
                })) || [];

                setChallenges(mappedChallenges);

                // Fetch today's matches for scheduled/accepted challenges
                const today = formatDate(getNowInFortaleza());
                const matchIds = mappedChallenges.filter(c => c.matchId).map(c => c.matchId);

                if (matchIds.length > 0) {
                    const { data: matchesData } = await supabase
                        .from('matches')
                        .select('*')
                        .in('id', matchIds)
                        .eq('date', today)
                        .eq('status', 'pending');

                    setTodayMatches((matchesData || []).map(m => ({
                        id: m.id,
                        type: m.type || 'Desafio Ranking',
                        playerAId: m.player_a_id,
                        playerBId: m.player_b_id,
                        scoreA: m.score_a || [],
                        scoreB: m.score_b || [],
                        winnerId: m.winner_id,
                        date: m.date,
                        scheduledTime: m.scheduled_time,
                        status: m.status || 'pending'
                    })));
                }

                // Create profiles lookup
                const profilesMap: Record<string, any> = {};
                rankingData.forEach(p => {
                    profilesMap[p.id] = { name: p.name, avatar_url: p.avatarUrl };
                });
                setProfiles(profilesMap);
            } catch (err) {
                console.error('Error loading challenges data:', err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [currentUser.id]);

    // My rank entry
    const myRankEntry = ranking.find(p => p.id === currentUser.id);

    // Stats
    const currentMonth = getNowInFortaleza().toISOString().slice(0, 7);
    const monthlyStats = useMemo(() => {
        const asChallenger = challenges.filter(c => c.challengerId === currentUser.id && c.monthRef === currentMonth && c.status !== 'cancelled').length;
        const asChallenged = challenges.filter(c => c.challengedId === currentUser.id && c.monthRef === currentMonth && c.status !== 'cancelled').length;
        return { challenger: asChallenger, challenged: asChallenged };
    }, [challenges, currentUser.id, currentMonth]);

    const canCreate = monthlyStats.challenger < 1;

    // --- Actions ---
    const handleCreate = async (data: { opponentId: string; date: string; time: string; courtId: string }) => {
        try {
            // Calculate end time (1 hour after start)
            const [h, m] = data.time.split(':').map(Number);
            const endHour = h + 1;
            const endTime = `${endHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

            // 1. Create reservation first
            const { data: resData, error: resError } = await supabase
                .from('reservations')
                .insert({
                    type: 'Desafio',
                    date: data.date,
                    start_time: data.time,
                    end_time: endTime,
                    court_id: data.courtId,
                    creator_id: currentUser.id,
                    participant_ids: [currentUser.id, data.opponentId],
                    status: 'active'
                })
                .select()
                .single();

            if (resError) throw resError;

            // 2. Create challenge with scheduling data
            const { data: chalData, error: chalError } = await supabase
                .from('challenges')
                .insert({
                    challenger_id: currentUser.id,
                    challenged_id: data.opponentId,
                    status: 'proposed',
                    month_ref: currentMonth,
                    scheduled_date: data.date,
                    scheduled_time: data.time,
                    court_id: data.courtId,
                    reservation_id: resData.id,
                    notification_seen: false
                })
                .select()
                .single();

            if (chalError) throw chalError;

            setChallenges(prev => [{
                id: chalData.id,
                challengerId: chalData.challenger_id,
                challengedId: chalData.challenged_id,
                status: chalData.status,
                monthRef: chalData.month_ref,
                createdAt: chalData.created_at?.split('T')[0],
                scheduledDate: chalData.scheduled_date,
                scheduledTime: chalData.scheduled_time,
                courtId: chalData.court_id,
                reservationId: chalData.reservation_id
            }, ...prev]);
            setShowCreateModal(false);

            // Send push notification to opponent
            // Use non-blocking call so it doesn't delay UI feedback
            sendPushNotification({
                userId: data.opponentId,
                title: 'Novo Desafio! ⚔️',
                body: `${currentUser.name} desafiou você para um jogo em ${new Date(data.date + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}!`,
                url: '/desafios',
                data: { challengeId: chalData.id }
            });

        } catch (err) {
            console.error('Error creating challenge:', err);
            alert('Erro ao criar desafio');
        }
    };

    const handleAction = async (challengeId: string, action: 'accept' | 'decline' | 'cancel') => {
        const newStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';

        try {
            const { error } = await supabase
                .from('challenges')
                .update({ status: newStatus })
                .eq('id', challengeId);

            if (error) throw error;

            setChallenges(prev => prev.map(c =>
                c.id === challengeId ? { ...c, status: newStatus } : c
            ));
        } catch (err) {
            console.error('Error updating challenge:', err);
        }
    };

    // --- Filter Lists ---
    const pendingSent = challenges.filter(c => c.challengerId === currentUser.id && ['proposed', 'accepted', 'scheduled'].includes(c.status));
    const pendingReceived = challenges.filter(c => c.challengedId === currentUser.id && ['proposed', 'accepted', 'scheduled'].includes(c.status));
    const history = challenges.filter(c => {
        const isMine = c.challengerId === currentUser.id || c.challengedId === currentUser.id;
        // For global history, prioritize finished matches
        const statusList = historyScope === 'mine'
            ? ['finished', 'declined', 'cancelled', 'expired']
            : ['finished']; // For global view, maybe only show finished/valid games? User said "history". I'll keep it simple and show finished primarily.

        // If 'all', we show finished challenges from everyone.
        // But if historyScope is 'all', we might want to see everything finished.
        // Let's stick to the list:
        const validStatuses = ['finished', 'declined', 'cancelled', 'expired'];
        return (historyScope === 'all' || isMine) && validStatuses.includes(c.status);
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-saibro-600" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-6 pb-24">
            {/* --- HEADER STATUS CARD --- */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border-l-4 border-saibro-500 relative overflow-hidden">
                <div className="relative z-10 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold text-stone-800 mb-1">Desafios</h2>
                        <p className="text-xs text-stone-500 uppercase font-bold tracking-wider">Mês: {currentMonth}</p>
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1">
                            <span className="text-2xl font-black text-saibro-600">#{myRankEntry?.categoryPosition || '-'}</span>
                        </div>
                        <span className="text-[10px] uppercase font-bold text-stone-400">{myRankEntry?.category}</span>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 relative z-10">
                    <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                        <p className="text-[10px] text-stone-400 uppercase font-bold">Como Desafiante</p>
                        <p className={`font-bold ${monthlyStats.challenger > 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {monthlyStats.challenger}/1
                        </p>
                    </div>
                    <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                        <p className="text-[10px] text-stone-400 uppercase font-bold">Como Desafiado</p>
                        <p className={`font-bold ${monthlyStats.challenged > 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {monthlyStats.challenged}/1
                        </p>
                    </div>
                </div>

                <div className="mt-4">
                    <button
                        disabled={!canCreate}
                        onClick={() => setShowCreateModal(true)}
                        className="w-full py-3 bg-stone-800 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-stone-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={18} /> {canCreate ? 'Criar Novo Desafio' : 'Limite Mensal Atingido'}
                    </button>
                </div>
            </div>

            {/* --- CHALLENGES READY FOR SCORING --- */}
            {(() => {
                // Filter challenges that are ready for scoring:
                // - Status is 'accepted' (not yet scored)
                // - Scheduled date is today or in the past
                const today = formatDate(getNowInFortaleza());
                const readyForScoring = challenges.filter(c =>
                    c.status === 'accepted' &&
                    c.scheduledDate &&
                    c.scheduledDate <= today
                );

                if (readyForScoring.length === 0) return null;

                // Convert profiles to User[] for LiveScoreboard
                const profilesAsUsers = Object.entries(profiles).map(([id, p]) => ({
                    id,
                    name: (p as { name: string; avatar_url: string | null }).name,
                    avatar: (p as { name: string; avatar_url: string | null }).avatar_url || '',
                    role: 'socio' as const,
                    isActive: true,
                    email: '',
                    phone: '',
                    balance: 0
                } as User));

                return (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                        <h3 className="font-bold text-stone-700 flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <Trophy size={18} className="text-saibro-500" /> Lançar Placar
                        </h3>
                        {readyForScoring.map(chal => {
                            // Create a Match object from the challenge for LiveScoreboard
                            const matchForScoreboard: Match = {
                                id: chal.id, // Use challenge ID as match ID for now
                                type: 'Desafio Ranking',
                                playerAId: chal.challengerId,
                                playerBId: chal.challengedId,
                                scoreA: [],
                                scoreB: [],
                                date: chal.scheduledDate,
                                scheduledTime: chal.scheduledTime,
                                status: 'pending'
                            };

                            return (
                                <LiveScoreboard
                                    key={chal.id}
                                    match={matchForScoreboard}
                                    profiles={profilesAsUsers}
                                    currentUser={currentUser}
                                    onScoreSaved={async () => {
                                        // When score is saved, update challenge status AND ensure match_id is linked
                                        await supabase
                                            .from('challenges')
                                            .update({ status: 'finished', match_id: chal.id })
                                            .eq('id', chal.id);

                                        // Update local state and remove from todayMatches if needed, or just update status
                                        setChallenges(prev => prev.map(c =>
                                            c.id === chal.id ? { ...c, status: 'finished', matchId: chal.id } : c
                                        ));
                                    }}
                                />
                            );
                        })}
                    </div>
                );
            })()}

            {/* --- RECEIVED CHALLENGES --- */}
            {pendingReceived.length > 0 && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                    <h3 className="font-bold text-stone-700 flex items-center gap-2">
                        <ShieldAlert size={18} className="text-orange-500" /> Desafios Recebidos
                    </h3>
                    {pendingReceived.map(c => {
                        const challenger = profiles[c.challengerId];
                        const challengerRank = ranking.find(r => r.id === c.challengerId);

                        return (
                            <div key={c.id} className="bg-white p-4 rounded-xl shadow-md border border-orange-100">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-linear-to-br from-saibro-200 to-saibro-400 flex items-center justify-center text-white font-bold overflow-hidden">
                                            {challenger?.avatar_url ? (
                                                <img src={challenger.avatar_url} className="w-full h-full object-cover" />
                                            ) : (
                                                challenger?.name?.charAt(0) || '?'
                                            )}
                                        </div>
                                        <div>
                                            <p className="font-bold text-stone-800">{challenger?.name}</p>
                                            <p className="text-xs text-stone-500">
                                                #{challengerRank?.categoryPosition} • {challengerRank?.category}
                                            </p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${c.status === 'proposed' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {c.status === 'proposed' ? 'Proposto' : c.status}
                                    </span>
                                </div>

                                {c.status === 'proposed' && (
                                    <div className="flex gap-2 mt-2">
                                        <button onClick={() => handleAction(c.id, 'decline')} className="flex-1 py-2 bg-stone-100 text-stone-600 font-bold rounded-lg text-xs hover:bg-stone-200">Recusar</button>
                                        <button onClick={() => handleAction(c.id, 'accept')} className="flex-1 py-2 bg-saibro-600 text-white font-bold rounded-lg text-xs hover:bg-saibro-700">Aceitar</button>
                                    </div>
                                )}
                                {c.status === 'accepted' && (
                                    <div className="bg-stone-50 p-2 rounded-lg text-center text-xs text-stone-500 font-medium">
                                        Aguardando agendamento pelo desafiante.
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* --- SENT CHALLENGES --- */}
            <div className="space-y-3">
                <h3 className="font-bold text-stone-700 flex items-center gap-2 section-header">
                    <PlayCircle size={18} className="text-saibro-500" /> Meus Desafios (Enviados)
                </h3>
                {pendingSent.length === 0 ? (
                    <p className="text-sm text-stone-400 italic section-header">Nenhum desafio ativo no momento.</p>
                ) : (
                    pendingSent.map(c => {
                        const challenged = profiles[c.challengedId];
                        const challengedRank = ranking.find(r => r.id === c.challengedId);

                        return (
                            <div key={c.id} className="bg-white p-4 rounded-xl shadow-sm border border-stone-100">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-stone-400">vs</span>
                                        <span className="font-bold text-stone-800">{challenged?.name}</span>
                                        <span className="text-[10px] text-stone-400">
                                            #{challengedRank?.categoryPosition} • {challengedRank?.category}
                                        </span>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${c.status === 'proposed' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                                        {c.status === 'proposed' ? 'Aguardando' : c.status}
                                    </span>
                                </div>

                                {c.status === 'proposed' && (
                                    <button onClick={() => handleAction(c.id, 'cancel')} className="w-full mt-2 py-1.5 border border-red-100 text-red-500 rounded-lg text-xs font-bold hover:bg-red-50">
                                        Cancelar Proposta
                                    </button>
                                )}

                                {c.status === 'accepted' && c.scheduledDate && (
                                    <div className="mt-2 text-xs text-stone-500 flex items-center gap-2">
                                        <Calendar size={12} />
                                        <span>Agendado: {new Date(c.scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })} às {c.scheduledTime}</span>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>

            {/* --- HISTORY --- */}
            {history.length > 0 && (
                <div className="space-y-3 pt-6 border-t border-stone-200">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-stone-500 text-sm section-header">Histórico Recente</h3>
                        <div className="flex bg-stone-100 rounded-lg p-0.5">
                            <button
                                onClick={() => setHistoryScope('mine')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${historyScope === 'mine' ? 'bg-white shadow text-saibro-600' : 'text-stone-400 hover:text-stone-600'}`}
                            >
                                Meus
                            </button>
                            <button
                                onClick={() => setHistoryScope('all')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${historyScope === 'all' ? 'bg-white shadow text-saibro-600' : 'text-stone-400 hover:text-stone-600'}`}
                            >
                                Geral
                            </button>
                        </div>
                    </div>
                    {history.slice(0, 20).map(c => {
                        const isChallenger = c.challengerId === currentUser.id;
                        const isChallenged = c.challengedId === currentUser.id;
                        const amInvolved = isChallenger || isChallenged;

                        const other = amInvolved
                            ? profiles[isChallenger ? c.challengedId : c.challengerId]
                            : null;

                        const challengerProfile = profiles[c.challengerId];
                        const challengedProfile = profiles[c.challengedId];

                        const isFinished = c.status === 'finished' && c.matchId;

                        return (
                            <div
                                key={c.id}
                                onClick={() => isFinished && setSelectedMatchId(c.matchId!)}
                                className={`flex justify-between items-center p-3 rounded-lg border border-transparent transition-all ${isFinished
                                    ? 'bg-white shadow-sm cursor-pointer hover:border-saibro-300 hover:shadow-md active:scale-[0.99]'
                                    : 'bg-stone-50 opacity-75'
                                    }`}
                            >
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {amInvolved ? (
                                        <>
                                            <span className="text-xs font-bold text-stone-400 shrink-0">{isChallenger ? 'Desafiou' : 'Desafiado por'}</span>
                                            <span className="font-semibold text-stone-700 text-sm truncate">{other?.name}</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="font-semibold text-stone-700 text-sm truncate max-w-[80px] sm:max-w-[120px]">{challengerProfile?.name}</span>
                                            <span className="text-xs font-bold text-stone-400 shrink-0">vs</span>
                                            <span className="font-semibold text-stone-700 text-sm truncate max-w-[80px] sm:max-w-[120px]">{challengedProfile?.name}</span>
                                        </>
                                    )}
                                    {isFinished && <ChevronRight size={14} className="text-stone-300 shrink-0" />}
                                </div>
                                <span className={`text-[10px] font-bold uppercase shrink-0 ${c.status === 'finished' ? 'text-green-600' : 'text-red-500'}`}>
                                    {c.status}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}

            {showCreateModal && (
                <CreateChallengeModal
                    currentUser={currentUser}
                    ranking={ranking}
                    onClose={() => setShowCreateModal(false)}
                    onConfirm={handleCreate}
                />
            )}

            {selectedMatchId && (
                <ChallengeResultsModal
                    matchId={selectedMatchId}
                    currentUser={currentUser}
                    onClose={() => setSelectedMatchId(null)}
                />
            )}
        </div>
    );
};