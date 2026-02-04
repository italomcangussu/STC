import React, { useState, useEffect } from 'react';
import { User, Challenge, Court } from '../types';
import { Trophy, XCircle, CheckCircle, Calendar, Clock, MapPin, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PlayerStats, fetchRanking } from '../lib/rankingService';

interface ChallengeNotificationPopupProps {
    currentUser: User;
    onClose: () => void;
}

export const ChallengeNotificationPopup: React.FC<ChallengeNotificationPopupProps> = ({
    currentUser,
    onClose
}) => {
    const [challenge, setChallenge] = useState<Challenge | null>(null);
    const [challenger, setChallenger] = useState<PlayerStats | null>(null);
    const [court, setCourt] = useState<Court | null>(null);
    const [loading, setLoading] = useState(true);
    const [responding, setResponding] = useState(false);

    // Load pending challenge notification
    useEffect(() => {
        const loadPendingChallenge = async () => {
            setLoading(true);

            // Fetch unseen proposed challenges where user is the challenged party
            const { data: pendingChallenges } = await supabase
                .from('challenges')
                .select('*')
                .eq('challenged_id', currentUser.id)
                .eq('status', 'proposed')
                .eq('notification_seen', false)
                .order('created_at', { ascending: false })
                .limit(1);

            if (!pendingChallenges || pendingChallenges.length === 0) {
                setLoading(false);
                onClose();
                return;
            }

            const c = pendingChallenges[0];
            setChallenge({
                id: c.id,
                challengerId: c.challenger_id,
                challengedId: c.challenged_id,
                status: c.status,
                monthRef: c.month_ref,
                createdAt: c.created_at?.split('T')[0],
                scheduledDate: c.scheduled_date,
                scheduledTime: c.scheduled_time,
                courtId: c.court_id,
                reservationId: c.reservation_id
            });

            // Fetch challenger info from ranking
            const ranking = await fetchRanking();
            const challengerStats = ranking.find(p => p.id === c.challenger_id);
            setChallenger(challengerStats || null);

            // Fetch court info
            if (c.court_id) {
                const { data: courtData } = await supabase
                    .from('courts')
                    .select('*')
                    .eq('id', c.court_id)
                    .single();

                if (courtData) {
                    setCourt({
                        id: courtData.id,
                        name: courtData.name,
                        type: courtData.type,
                        isActive: courtData.is_active
                    });
                }
            }

            setLoading(false);
        };

        loadPendingChallenge();
    }, [currentUser.id, onClose]);

    const handleAction = async (accept: boolean) => {
        if (!challenge) return;

        setResponding(true);

        try {
            // Update challenge status
            const newStatus = accept ? 'accepted' : 'declined';
            await supabase
                .from('challenges')
                .update({
                    status: newStatus,
                    notification_seen: true
                })
                .eq('id', challenge.id);

            // If declined, cancel the linked reservation
            if (!accept && challenge.reservationId) {
                await supabase
                    .from('reservations')
                    .update({ status: 'cancelled' })
                    .eq('id', challenge.reservationId);
            }

            onClose();
        } catch (err) {
            console.error('Error responding to challenge:', err);
            setResponding(false);
        }
    };

    // Format date for display
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T12:00:00'); // Consistent parsing
        return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black/70 z-100 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-8 flex items-center justify-center">
                    <Loader2 className="animate-spin text-saibro-600" size={32} />
                </div>
            </div>
        );
    }

    if (!challenge) return null;

    return (
        <div className="fixed inset-0 bg-black/70 z-100 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="bg-linear-to-r from-indigo-600 to-indigo-500 p-6 text-center text-white relative overflow-hidden">
                    <div className="absolute -top-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />
                    <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-white/10 rounded-full" />

                    <div className="relative z-10">
                        <div className="w-16 h-16 mx-auto bg-white/20 rounded-full flex items-center justify-center mb-3">
                            <Trophy size={32} />
                        </div>
                        <h2 className="text-xl font-bold">Você foi desafiado!</h2>
                        <p className="text-indigo-200 text-sm mt-1">Novo desafio de ranking</p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Challenger Info */}
                    <div className="bg-stone-50 p-4 rounded-xl flex items-center gap-4">
                        <div className="w-14 h-14 bg-linear-to-br from-saibro-200 to-saibro-400 rounded-full flex items-center justify-center text-white font-bold text-xl">
                            {challenger?.name?.charAt(0) || '?'}
                        </div>
                        <div>
                            <p className="font-bold text-stone-800 text-lg">{challenger?.name}</p>
                            <p className="text-sm text-stone-500">
                                #{challenger?.globalPosition} • {challenger?.category} • {challenger?.totalPoints} pts
                            </p>
                        </div>
                    </div>

                    {/* Schedule Info */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                            <Calendar size={18} className="text-indigo-600" />
                            <span className="font-medium text-stone-700 capitalize">{formatDate(challenge.scheduledDate)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center gap-2 p-3 bg-stone-50 rounded-lg border border-stone-100">
                                <Clock size={16} className="text-stone-500" />
                                <span className="font-medium text-stone-700">{challenge.scheduledTime}</span>
                            </div>
                            <div className="flex items-center gap-2 p-3 bg-stone-50 rounded-lg border border-stone-100">
                                <MapPin size={16} className="text-stone-500" />
                                <span className="font-medium text-stone-700">{court?.name || 'Quadra'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Warning about declining */}
                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-xs text-amber-700 flex items-start gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <span>Recusar cancelará a reserva e contará para o limite mensal do desafiante.</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-stone-100 grid grid-cols-2 gap-3">
                    <button
                        disabled={responding}
                        onClick={() => handleAction(false)}
                        className="py-3 bg-stone-100 text-stone-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-stone-200 transition-colors disabled:opacity-50"
                    >
                        <XCircle size={18} />
                        Recusar
                    </button>
                    <button
                        disabled={responding}
                        onClick={() => handleAction(true)}
                        className="py-3 bg-saibro-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-saibro-700 transition-colors disabled:opacity-50"
                    >
                        {responding ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                        Aceitar
                    </button>
                </div>
            </div>
        </div>
    );
};
