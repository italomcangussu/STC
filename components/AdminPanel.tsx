import React, { useState, useEffect, useMemo } from 'react';
import {
    Calendar, Trophy, Swords, DollarSign, Users,
    Search, Filter, CheckCircle, XCircle, Clock,
    ChevronRight, AlertTriangle, Eye, Trash2, Edit, Plus, AlertCircle, Loader2,
    LayoutDashboard, Megaphone, Save, PlusSquare, Zap, History, GraduationCap, Settings
} from 'lucide-react';
import { Dashboard } from './Dashboard';
import { Reservation, User, Championship, Challenge, AccessRequest, Match, Consumption, Product, NonSocioStudent } from '../types';
import { formatDateBr, getDayName } from '../utils';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza, formatDate } from '../utils';
import { AdminUserEditor } from './AdminUserEditor';
import { AdminMatchCreator } from './AdminMatchCreator';
import { StandardModal } from './StandardModal';


import { SuperSet } from './SuperSet';

import { ScoreModal } from './ScoreModal';
import { FinanceiroAdmin } from './FinanceiroAdmin';
import { AdminProfessors } from './AdminProfessors';
import { AdminRules } from './AdminRules';
import { AdminStudents } from './AdminStudents';
import { ChampionshipAdmin } from './ChampionshipAdmin';

// --- Helpers ---
const addMinutes = (time: string, minutes: number): string => {
    const [h, m] = time.split(':').map(Number);
    const date = getNowInFortaleza();
    date.setHours(h, m + minutes);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const checkOverlap = (start1: string, end1: string, start2: string, end2: string) => {
    return (start1 < end2 && start1 >= start2) || (start1 <= start2 && end1 > start2);
};

// --- New Challenge Modal Component ---
interface NewChallengeModalProps {
    onClose: () => void;
    onSave: (data: { challengerId: string, challengedId: string, date: string, time: string, courtId: string }) => Promise<void>;
    profiles: User[];
    courts: Court[];
}

const NewChallengeModal: React.FC<NewChallengeModalProps> = ({ onClose, onSave, profiles, courts }) => {
    const [challengerId, setChallengerId] = useState('');
    const [challengedId, setChallengedId] = useState('');
    const [date, setDate] = useState(formatDate(getNowInFortaleza()));
    const [time, setTime] = useState('');
    const [courtId, setCourtId] = useState(courts.length > 0 ? courts[0].id : '');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch existing reservations for conflict check
    const [dayReservations, setDayReservations] = useState<Reservation[]>([]);

    useEffect(() => {
        const fetchReservations = async () => {
            setChecking(true);
            const { data } = await supabase.from('reservations').select('*').eq('date', date);
            if (data) {
                setDayReservations(data.map(r => ({ ...r, startTime: r.start_time, endTime: r.end_time, courtId: r.court_id } as any)));
            }
            setChecking(false);
        };
        fetchReservations();
    }, [date]);

    const getAvailableTimes = () => {
        const times: string[] = [];
        for (let h = 6; h <= 22; h++) {
            ['00', '30'].forEach(m => times.push(`${String(h).padStart(2, '0')}:${m}`));
        }
        return times;
    };

    const handleSave = async () => {
        setError(null);
        if (!challengerId || !challengedId || !date || !time || !courtId) {
            setError('Preencha todos os campos.');
            return;
        }
        if (challengerId === challengedId) {
            setError('Desafiante e Desafiado não podem ser a mesma pessoa.');
            return;
        }

        const endTime = addMinutes(time, 90); // Default 90 min for challenges? Or 60? Let's say 90 for match.

        // Conflict Check
        const hasConflict = dayReservations.some(r =>
            r.courtId === courtId && r.status !== 'cancelled' &&
            checkOverlap(time, endTime, r.startTime, r.endTime)
        );

        if (hasConflict) {
            setError('Horário indisponível nesta quadra.');
            return;
        }

        setLoading(true);
        try {
            await onSave({ challengerId, challengedId, date, time, courtId });
            onClose();
        } catch (err: any) {
            setError(err.message || 'Erro ao criar desafio.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
                <div className="flex justify-between items-center border-b border-stone-100 pb-3">
                    <h3 className="text-xl font-bold text-saibro-800 flex items-center gap-2">
                        <Swords size={20} className="text-saibro-500" /> Novo Desafio
                    </h3>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><XCircle size={24} /></button>
                </div>

                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <div className="space-y-4">
                    {/* Players */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Desafiante</label>
                            <select
                                value={challengerId}
                                onChange={e => setChallengerId(e.target.value)}
                                className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                            >
                                <option value="">Selecione...</option>
                                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Desafiado</label>
                            <select
                                value={challengedId}
                                onChange={e => setChallengedId(e.target.value)}
                                className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                            >
                                <option value="">Selecione...</option>
                                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Date & Court */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Data</label>
                            <input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Quadra</label>
                            <select
                                value={courtId}
                                onChange={e => setCourtId(e.target.value)}
                                className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                            >
                                {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Time */}
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Horário (Início)</label>
                        <select
                            value={time}
                            onChange={e => setTime(e.target.value)}
                            className="w-full p-2 bg-stone-50 border border-stone-200 rounded-lg text-sm"
                        >
                            <option value="">Selecione...</option>
                            {getAvailableTimes().map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <p className="text-xs text-stone-400 mt-1">Duração padrão: 90 min</p>
                    </div>
                </div>

                <div className="pt-2">
                    <button
                        onClick={handleSave}
                        disabled={loading || checking}
                        className="w-full py-3 bg-saibro-600 text-white font-bold rounded-xl hover:bg-saibro-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-orange-100"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : 'Confirmar Desafio'}
                    </button>
                </div>
            </div>
        </StandardModal>
    );
};

// --- Score Modal Component ---
interface ScoreModalProps {
    challenge: Challenge;
    challengerName: string;
    challengedName: string;
    onClose: () => void;
    onSave: (scores: { a: number, b: number }[]) => Promise<void>;
}


// Tab configuration
const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'lancamentos', label: 'Lançamentos', icon: <PlusSquare size={18} /> },
    { id: 'superset', label: 'SuperSet', icon: <Trophy size={18} /> },
    { id: 'torneios', label: 'Torneios', icon: <Trophy size={18} /> },
    { id: 'reservas', label: 'Reservas', icon: <Calendar size={18} /> },
    { id: 'desafios', label: 'Desafios', icon: <Swords size={18} /> },
    { id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={18} /> },
    { id: 'socios', label: 'Sócios', icon: <Users size={18} /> },
    { id: 'alunos', label: 'Alunos', icon: <Users size={18} /> },
    { id: 'professores', label: 'Professores', icon: <GraduationCap size={18} /> },
    { id: 'regras', label: 'Regras', icon: <Settings size={18} /> },
    { id: 'avisos', label: 'Avisos', icon: <Megaphone size={18} /> },
];

interface Court {
    id: string;
    name: string;
    type: string;
}

// --- Sub-component: Reservas Tab ---
const ReservasTab: React.FC = () => {
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [filter, setFilter] = useState<string>('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const [resData, courtsData, profilesData] = await Promise.all([
                supabase.from('reservations').select('*').order('date', { ascending: false }),
                supabase.from('courts').select('id, name, type'),
                supabase.from('profiles').select('id, name, avatar_url').eq('is_active', true)
            ]);

            setReservations((resData.data || []).map(r => ({
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
            setCourts(courtsData.data || []);
            setProfiles((profilesData.data || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                role: 'socio',
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));
            setLoading(false);
        };
        fetchData();
    }, []);

    const filteredReservations = reservations.filter(r =>
        filter === 'all' || r.type === filter
    ).sort((a, b) => new Date(b.date + 'T12:00:00').getTime() - new Date(a.date + 'T12:00:00').getTime());

    const handleCancel = async (id: string) => {
        await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', id);
        setReservations(reservations.map(r =>
            r.id === id ? { ...r, status: 'cancelled' } : r
        ));
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-saibro-500" size={32} /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
                {['all', 'Play', 'Aula', 'Campeonato', 'Desafio'].map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f
                            ? 'bg-saibro-500 text-white'
                            : 'bg-white text-stone-600 hover:bg-saibro-50'
                            }`}
                    >
                        {f === 'all' ? 'Todas' : f}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                {filteredReservations.map(res => {
                    const court = courts.find(c => c.id === res.courtId);
                    const creator = profiles.find(u => u.id === res.creatorId);
                    const isCancelled = res.status === 'cancelled';

                    return (
                        <div
                            key={res.id}
                            className={`bg-white rounded-xl p-4 shadow-sm border ${isCancelled ? 'border-red-200 opacity-60' : 'border-stone-100'}`}
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${res.type === 'Play' ? 'bg-green-100 text-green-700' :
                                            res.type === 'Aula' ? 'bg-orange-100 text-orange-700' :
                                                res.type === 'Campeonato' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-purple-100 text-purple-700'
                                            }`}>
                                            {res.type}
                                        </span>
                                        {isCancelled && (
                                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-100 text-red-700">
                                                Cancelada
                                            </span>
                                        )}
                                    </div>
                                    <p className="font-semibold text-stone-800">
                                        {formatDateBr(res.date)} • {res.startTime} - {res.endTime}
                                    </p>
                                    <p className="text-sm text-stone-500">
                                        {court?.name} ({court?.type}) • Criado por {creator?.name}
                                    </p>
                                </div>
                                {!isCancelled && (
                                    <button
                                        onClick={() => handleCancel(res.id)}
                                        className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <XCircle size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};



// --- Sub-component: Desafios Tab ---
const DesafiosTab: React.FC = () => {
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null); // For scoring
    const [showNewChallengeModal, setShowNewChallengeModal] = useState(false);
    const [courts, setCourts] = useState<Court[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const [challengesData, profilesData, courtsData] = await Promise.all([
                supabase.from('challenges').select('*').order('created_at', { ascending: false }),
                supabase.from('profiles').select('id, name, avatar_url').eq('is_active', true),
                supabase.from('courts').select('id, name, type')
            ]);

            setChallenges((challengesData.data || []).map(c => ({
                id: c.id,
                status: c.status,
                monthRef: c.month_ref,
                createdAt: c.created_at,
                challengerId: c.challenger_id,
                challengedId: c.challenged_id,
                matchId: c.match_id,
                reservationId: c.reservation_id
            })));

            setProfiles((profilesData.data || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                role: 'socio',
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));
            if (courtsData.data) setCourts(courtsData.data);
            setLoading(false);
        };
        fetchData();
    }, []);

    const getStatusInfo = (status: string) => {
        switch (status) {
            case 'proposed': return { color: 'bg-blue-100 text-blue-700', label: 'Pendente' };
            case 'accepted': return { color: 'bg-green-100 text-green-700', label: 'Aceito' };
            case 'declined': return { color: 'bg-red-100 text-red-700', label: 'Recusado' };
            case 'scheduled': return { color: 'bg-purple-100 text-purple-700', label: 'Agendado' };
            case 'finished': return { color: 'bg-stone-100 text-stone-600', label: 'Finalizado' };
            case 'cancelled': return { color: 'bg-red-100 text-red-700', label: 'Cancelado' };
            default: return { color: 'bg-yellow-100 text-yellow-700', label: 'Expirado' };
        }
    };

    const handleCancel = async (id: string) => {
        if (!confirm('Tem certeza que deseja cancelar este desafio?')) return;
        await supabase.from('challenges').update({ status: 'cancelled' }).eq('id', id);
        setChallenges(challenges.map(c =>
            c.id === id ? { ...c, status: 'cancelled' } : c
        ));
    };

    const handleSaveScore = async (scores: { a: number, b: number }[]) => {
        if (!selectedChallenge) return;

        try {
            // 1. Calculate Winner
            let setsA = 0;
            let setsB = 0;
            const scoreA: number[] = [];
            const scoreB: number[] = [];

            scores.forEach(s => {
                scoreA.push(s.a);
                scoreB.push(s.b);
                if (s.a > s.b) setsA++;
                else if (s.b > s.a) setsB++;
            });

            const winnerId = setsA > setsB ? selectedChallenge.challengerId : selectedChallenge.challengedId;

            // 2. Insert Match
            const { data: matchData, error: matchError } = await supabase
                .from('matches')
                .insert({
                    type: 'Desafio',
                    player_a_id: selectedChallenge.challengerId,
                    player_b_id: selectedChallenge.challengedId,
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: winnerId,
                    date: getNowInFortaleza().toISOString(), // Or usage date
                    status: 'finished'
                })
                .select()
                .single();

            if (matchError) throw matchError;

            // 3. Update Challenge (mark finished, link match)
            const { error: chalError } = await supabase
                .from('challenges')
                .update({
                    status: 'finished',
                    match_id: matchData.id
                })
                .eq('id', selectedChallenge.id);

            if (chalError) throw chalError;

            // 4. Update Reservation (if exists)
            // Note: need to know reservation_id, usually fetched or deduced
            // Ideally we'd have reservation_id in challenges per my earlier SQL, but the type might not have it yet.
            // Let's assume we can query it or use a trigger. For now, we update challenges locally.

            // Also update reservation status if linked
            // Note: Reservation status enum is likely 'active' | 'cancelled'. 
            // 'finished' is invalid. We leave it as 'active' (occupied).
            /* 
            if (selectedChallenge.reservationId) {
                 // await supabase.from('reservations').update({ status: 'finished' }).eq('id', selectedChallenge.reservationId);
            }
            */


            // Update Local State
            setChallenges(challenges.map(c =>
                c.id === selectedChallenge.id ? { ...c, status: 'finished', matchId: matchData.id } : c
            ));
            setSelectedChallenge(null);

        } catch (error) {
            console.error('Error saving score:', error);
            alert('Erro ao salvar placar.');
        }
    };

    const handleCreateChallenge = async (data: { challengerId: string, challengedId: string, date: string, time: string, courtId: string }) => {
        // 1. Create Reservation
        const endTime = addMinutes(data.time, 90);
        const { data: resData, error: resError } = await supabase
            .from('reservations')
            .insert({
                type: 'Desafio',
                date: data.date,
                start_time: data.time,
                end_time: endTime,
                court_id: data.courtId,
                creator_id: data.challengerId, // Challenger creates? Or Admin? If Admin panel, creator is current user (admin). Let's use challenger for metadata or admin. Standard: Admin creates, creator_id = admin. 
                // Wait, if it's admin panel, currentUser is Admin.
                // But challenge participants are distinct.
                // Let's set creator_id to current user (which is admin here) or the challenger if we want them to own it. 
                // Safest: challenger_id as creator if they did it, but here it's admin panel. Admin creates.
                // However, RLS might require creator to be auth.uid().
                participant_ids: [data.challengerId, data.challengedId],
                status: 'active'
            })
            .select()
            .single();

        if (resError) throw resError;

        // 2. Create Challenge
        const { data: chalData, error: chalError } = await supabase
            .from('challenges')
            .insert({
                challenger_id: data.challengerId,
                challenged_id: data.challengedId,
                status: 'scheduled',
                date: data.date, // If challenge has date
                reservation_id: resData.id,
                created_at: getNowInFortaleza().toISOString()
            })
            .select()
            .single();

        if (chalError) throw chalError;

        // Update local state
        setChallenges([{
            id: chalData.id,
            status: chalData.status,
            monthRef: chalData.month_ref, // trigger sets this?
            createdAt: chalData.created_at,
            challengerId: chalData.challenger_id,
            challengedId: chalData.challenged_id,
            matchId: null,
            reservationId: resData.id
        }, ...challenges]);
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-saibro-500" size={32} /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                    <p className="text-2xl font-bold text-blue-600">{challenges.filter(c => c.status === 'proposed').length}</p>
                    <p className="text-xs text-stone-500">Pendentes</p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                    <p className="text-2xl font-bold text-green-600">{challenges.filter(c => c.status === 'accepted' || c.status === 'scheduled').length}</p>
                    <p className="text-xs text-stone-500">Ativos</p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                    <p className="text-2xl font-bold text-stone-600">{challenges.filter(c => c.status === 'finished').length}</p>
                    <p className="text-xs text-stone-500">Finalizados</p>
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={() => setShowNewChallengeModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-saibro-500 text-white rounded-xl shadow-lg shadow-saibro-200 font-bold hover:bg-saibro-600 transition-colors"
                >
                    <Plus size={18} /> Novo Desafio
                </button>
            </div>

            <div className="space-y-3">
                {challenges.map(challenge => {
                    const challenger = profiles.find(u => u.id === challenge.challengerId);
                    const challenged = profiles.find(u => u.id === challenge.challengedId);
                    const statusInfo = getStatusInfo(challenge.status);

                    return (
                        <div key={challenge.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusInfo.color}`}>
                                            {statusInfo.label}
                                        </span>
                                        <span className="text-xs text-stone-400">{challenge.monthRef}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-2">
                                            <img src={challenger?.avatar} alt="" className="w-8 h-8 rounded-full bg-stone-200" />
                                            <span className="font-medium text-stone-700">{challenger?.name}</span>
                                        </div>
                                        <ChevronRight size={16} className="text-stone-400" />
                                        <div className="flex items-center gap-2">
                                            <img src={challenged?.avatar} alt="" className="w-8 h-8 rounded-full bg-stone-200" />
                                            <span className="font-medium text-stone-700">{challenged?.name}</span>
                                        </div>
                                    </div>
                                </div>
                                {challenge.status !== 'finished' && challenge.status !== 'cancelled' && (
                                    <button
                                        onClick={() => handleCancel(challenge.id)}
                                        className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <XCircle size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            {showNewChallengeModal && (
                <NewChallengeModal
                    onClose={() => setShowNewChallengeModal(false)}
                    onSave={handleCreateChallenge}
                    profiles={profiles}
                    courts={courts}
                />
            )}
        </div>
    );
};



// --- Sub-component: Anuncios Tab ---
interface Announcement {
    id: string;
    title: string;
    message: string;
    imageUrl: string | null;
    isActive: boolean;
    showOnce: boolean;
    createdAt: string;
    expiresAt: string | null;
}

const AnunciosTab: React.FC = () => {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);

    // Form state
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [showOnce, setShowOnce] = useState(false);
    const [expiresAt, setExpiresAt] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchAnnouncements();
    }, []);

    const fetchAnnouncements = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        if (data) {
            setAnnouncements(data.map(a => ({
                id: a.id,
                title: a.title,
                message: a.message,
                imageUrl: a.image_url,
                isActive: a.is_active,
                showOnce: a.show_once,
                createdAt: a.created_at,
                expiresAt: a.expires_at
            })));
        }
        setLoading(false);
    };

    const openAddModal = () => {
        setEditingAnn(null);
        setTitle('');
        setMessage('');
        setImageUrl('');
        setShowOnce(false);
        setExpiresAt('');
        setShowModal(true);
    };

    const openEditModal = (ann: Announcement) => {
        setEditingAnn(ann);
        setTitle(ann.title);
        setMessage(ann.message);
        setImageUrl(ann.imageUrl || '');
        setShowOnce(ann.showOnce);
        setExpiresAt(ann.expiresAt ? ann.expiresAt.split('T')[0] : '');
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!title.trim() || !message.trim()) return;
        setSaving(true);

        const payload = {
            title: title.trim(),
            message: message.trim(),
            image_url: imageUrl.trim() || null,
            show_once: showOnce,
            expires_at: expiresAt ? new Date(expiresAt + 'T23:59:59').toISOString() : null
        };

        if (editingAnn) {
            await supabase.from('announcements').update(payload).eq('id', editingAnn.id);
        } else {
            await supabase.from('announcements').insert(payload);
        }

        setSaving(false);
        setShowModal(false);
        fetchAnnouncements();
    };

    const toggleActive = async (id: string, current: boolean) => {
        await supabase.from('announcements').update({ is_active: !current }).eq('id', id);
        setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, isActive: !current } : a));
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Excluir este aviso?')) return;
        await supabase.from('announcements').delete().eq('id', id);
        setAnnouncements(prev => prev.filter(a => a.id !== id));
    };

    if (loading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-stone-800">Gerenciar Avisos</h2>
                <button
                    onClick={openAddModal}
                    className="px-4 py-2 bg-saibro-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-saibro-700"
                >
                    <Plus size={16} /> Novo Aviso
                </button>
            </div>

            {announcements.length === 0 ? (
                <div className="text-center py-8 text-stone-400">Nenhum aviso cadastrado</div>
            ) : (
                <div className="space-y-3">
                    {announcements.map(ann => (
                        <div key={ann.id} className={`p-4 rounded-xl border ${ann.isActive ? 'bg-white border-stone-200' : 'bg-stone-50 border-stone-100 opacity-60'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <h3 className="font-bold text-stone-800">{ann.title}</h3>
                                    <p className="text-sm text-stone-500 mt-1 line-clamp-2">{ann.message}</p>
                                    <div className="flex gap-2 mt-2 text-[10px] text-stone-400">
                                        {ann.showOnce && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Única vez</span>}
                                        {ann.expiresAt && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Expira: {new Date(ann.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleActive(ann.id, ann.isActive)}
                                        className={`px-3 py-1 rounded-full text-xs font-bold ${ann.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-500'}`}
                                    >
                                        {ann.isActive ? 'Ativo' : 'Inativo'}
                                    </button>
                                    <button onClick={() => openEditModal(ann)} className="p-2 hover:bg-stone-100 rounded-lg">
                                        <Edit size={16} className="text-stone-500" />
                                    </button>
                                    <button onClick={() => handleDelete(ann.id)} className="p-2 hover:bg-red-50 rounded-lg">
                                        <Trash2 size={16} className="text-red-500" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            <StandardModal isOpen={showModal} onClose={() => setShowModal(false)}>
                <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                    <h3 className="text-lg font-bold">{editingAnn ? 'Editar Aviso' : 'Novo Aviso'}</h3>

                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Título"
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl"
                    />

                    <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder="Mensagem"
                        rows={4}
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl resize-none"
                    />

                    <input
                        type="text"
                        value={imageUrl}
                        onChange={e => setImageUrl(e.target.value)}
                        placeholder="URL da imagem (opcional)"
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl"
                    />

                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={showOnce}
                                onChange={e => setShowOnce(e.target.checked)}
                                className="rounded"
                            />
                            Mostrar apenas uma vez
                        </label>
                    </div>

                    <div>
                        <label className="text-xs text-stone-500 block mb-1">Data de expiração (opcional)</label>
                        <input
                            type="date"
                            value={expiresAt}
                            onChange={e => setExpiresAt(e.target.value)}
                            className="w-full px-4 py-3 border border-stone-200 rounded-xl"
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setShowModal(false)}
                            className="flex-1 py-3 border border-stone-200 rounded-xl font-bold text-stone-600"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || !title.trim() || !message.trim()}
                            className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            Salvar
                        </button>
                    </div>
                </div>
            </StandardModal>
        </div>
    );
};

// --- Sub-component: Socios Tab ---
import { generateEmailFromPhone, generatePasswordFromPhone } from '../lib/authHelpers';

const SociosTab: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [requests, setRequests] = useState<AccessRequest[]>([]);
    const [members, setMembers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingMember, setEditingMember] = useState<User | null>(null);



    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: reqs } = await supabase
            .from('access_requests')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (reqs) {
            setRequests(reqs.map(r => ({
                id: r.id,
                phone: r.phone,
                status: r.status,
                createdAt: r.created_at
            })));
        }

        const { data: usrs } = await supabase
            .from('profiles')
            .select('*')
            .eq('role', 'socio')
            .eq('is_active', true)
            .order('name');

        if (usrs) {
            setMembers(usrs.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                role: u.role,
                balance: u.balance,
                avatar: u.avatar_url,
                category: u.category,
                isProfessor: u.is_professor,
                isActive: u.is_active,
                age: u.age
            })));
        }
        setLoading(false);
    };

    const handleApprove = async (req: AccessRequest) => {
        if (!confirm(`Aprovar acesso para ${req.phone}?`)) return;

        try {
            const { error: updateError } = await supabase
                .from('access_requests')
                .update({ status: 'approved' })
                .eq('id', req.id);

            if (updateError) throw updateError;

            setRequests(requests.filter(r => r.id !== req.id));
            alert('Acesso aprovado! O usuário já pode fazer login.');

        } catch (error) {
            console.error(error);
            alert('Erro ao aprovar.');
        }
    };

    const handleReject = async (req: AccessRequest) => {
        if (!confirm(`Rejeitar solicitação de ${req.phone}?`)) return;

        const { error } = await supabase
            .from('access_requests')
            .update({ status: 'rejected' })
            .eq('id', req.id);

        if (!error) {
            setRequests(requests.filter(r => r.id !== req.id));
        }
    };

    const openEditMember = (member: User) => {
        setEditingMember(member);
    };


    return (
        <div className="space-y-6">
            <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 space-y-3">
                <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                    <AlertCircle size={16} /> Solicitações de Acesso ({requests.length})
                </h3>
                {requests.length === 0 && (
                    <p className="text-xs text-stone-500 italic">Nenhuma solicitação pendente.</p>
                )}
                <div className="space-y-2">
                    {requests.map(req => (
                        <div key={req.id} className="bg-white p-3 rounded-xl border border-amber-200 flex justify-between items-center">
                            <div>
                                <p className="text-sm font-bold text-stone-800">+{req.phone}</p>
                                <p className="text-[10px] text-stone-400">Pendente desde {new Date(req.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleReject(req)}
                                    className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    title="Rejeitar"
                                >
                                    <XCircle size={18} />
                                </button>
                                <button
                                    onClick={() => handleApprove(req)}
                                    className="px-3 py-1 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 shadow-sm"
                                >
                                    Aprovar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar sócios..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-saibro-500"
                    />
                </div>

                <div className="grid gap-3">
                    {members.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase())).map(member => (
                        <div key={member.id} className="bg-white p-4 rounded-2xl shadow-sm border border-stone-100 flex items-center justify-between group hover:border-saibro-200 transition-all">
                            <div className="flex items-center gap-3">
                                <img src={member.avatar || 'https://via.placeholder.com/50'} alt="" className="w-12 h-12 rounded-full border-2 border-saibro-50 object-cover" />
                                <div>
                                    <h3 className="font-bold text-stone-800">{member.name}</h3>
                                    <p className="text-xs text-stone-400">+{member.phone}</p>
                                    <p className="text-[10px] text-saibro-600 uppercase font-bold mt-1">{member.category || 'Sem classe'}</p>
                                </div>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => openEditMember(member)}
                                    className="p-2 text-stone-400 hover:text-saibro-600 hover:bg-saibro-50 rounded-lg"
                                >
                                    <Edit size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {members.length === 0 && (
                        <p className="text-center text-stone-400 py-8">Nenhum sócio encontrado.</p>
                    )}
                </div>
            </div>

            {/* Edit Member Modal */}
            {editingMember && (
                <AdminUserEditor
                    user={editingMember}
                    onClose={() => setEditingMember(null)}
                    onSave={() => {
                        fetchData(); // Refresh list to get new role/points
                        setEditingMember(null);
                    }}
                />
            )}
        </div>
    );
};

// --- Sub-component: Lançamentos Tab (Retroativo & Auditoria) ---
const LancamentosTab: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);

    // Creator State
    const [showCreator, setShowCreator] = useState(false);
    const [creatorType, setCreatorType] = useState<'Desafio' | 'SuperSet'>('Desafio');
    const [profiles, setProfiles] = useState<User[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);

    const fetchAudit = async () => {
        const { data } = await supabase
            .from('point_history')
            .select('*, profiles(name)')
            .order('created_at', { ascending: false })
            .limit(50);
        if (data) setAuditLogs(data);
    };

    useEffect(() => {
        fetchAudit();
        fetchDeps();
    }, []);

    const fetchDeps = async () => {
        const [profData, courtData] = await Promise.all([
            supabase.from('profiles').select('id, name, avatar_url').eq('is_active', true).order('name'),
            supabase.from('courts').select('id, name')
        ]);
        if (profData.data) setProfiles(profData.data as any);
        if (courtData.data) setCourts(courtData.data as any);
    };

    const openCreator = (type: 'Desafio' | 'SuperSet') => {
        setCreatorType(type);
        setShowCreator(true);
    };

    return (
        <div className="space-y-8">
            <div className="bg-saibro-50 p-6 rounded-[24px] border border-saibro-100">
                <h3 className="text-xl font-black text-saibro-900 mb-2">Lançamento Histórico</h3>
                <p className="text-saibro-600 text-sm mb-6">Registre partidas que já aconteceram para pontuar o ranking retroativamente.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => openCreator('Desafio')}
                        className="p-4 bg-white border-2 border-dashed border-stone-200 rounded-2xl text-stone-500 font-bold hover:border-saibro-300 hover:text-saibro-600 transition-all flex flex-col items-center gap-2"
                    >
                        <Trophy size={32} />
                        Registrar Desafio (3 Sets)
                    </button>
                    <button
                        onClick={() => openCreator('SuperSet')}
                        className="p-4 bg-white border-2 border-dashed border-stone-200 rounded-2xl text-stone-500 font-bold hover:border-saibro-300 hover:text-saibro-600 transition-all flex flex-col items-center gap-2"
                    >
                        <Zap size={32} />
                        Registrar SuperSet (1 Set)
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                    <History size={20} className="text-stone-400" /> Auditoria de Pontos
                </h3>
                <div className="space-y-2">
                    {auditLogs.map(log => (
                        <div key={log.id} className="bg-stone-50 p-4 rounded-xl flex justify-between items-center border border-stone-100">
                            <div>
                                <p className="font-bold text-stone-800">{log.profiles?.name}</p>
                                <p className="text-xs text-stone-500">{log.reason}</p>
                            </div>
                            <div className={`font-black text-lg ${log.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {log.points > 0 ? '+' : ''}{log.points}
                            </div>
                        </div>
                    ))}
                    {auditLogs.length === 0 && <p className="text-center py-8 text-stone-400 italic">Nenhum histórico encontrado.</p>}
                </div>
            </div>

            {/* Match Creator Modal */}
            <AdminMatchCreator
                isOpen={showCreator}
                onClose={() => setShowCreator(false)}
                matchType={creatorType}
                profiles={profiles}
                courts={courts}
                onSuccess={() => {
                    fetchAudit(); // Refresh audit logs
                    alert('Pontos atualizados!');
                }}
            />
        </div>
    );
};

// --- Main Admin Panel Component ---

export const AdminPanel: React.FC = () => {
    const [activeTab, setActiveTab] = useState('dashboard');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'dashboard': return <Dashboard />;
            case 'lancamentos': return <LancamentosTab />;
            case 'superset': return <SuperSet />;
            case 'torneios': return <ChampionshipAdmin />;
            case 'reservas': return <ReservasTab />;
            case 'desafios': return <DesafiosTab />;
            case 'financeiro': return <FinanceiroAdmin />;
            case 'professores': return <AdminProfessors />;
            case 'regras': return <AdminRules />;
            case 'avisos': return <AnunciosTab />;
            case 'socios': return <SociosTab />;
            case 'alunos': return <AdminStudents />;
            default: return <Dashboard />;
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-stone-50">
            {/* Header Moderno */}
            <div className="bg-saibro-600 pt-8 pb-16 px-4 md:px-8 rounded-b-[40px] shadow-2xl relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-saibro-500/20 rounded-full -mr-20 -mt-20 blur-3xl animate-pulse"></div>
                <div className="relative z-10 flex flex-col gap-1 max-w-7xl mx-auto w-full">
                    <span className="text-saibro-200 text-xs font-bold uppercase tracking-widest">Administração</span>
                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">Centro de Comando</h1>
                    <p className="text-saibro-100 text-sm opacity-80">Gestão integrada do Reserva SCT</p>
                </div>
            </div>

            {/* Navigation Cards (Overlapping) */}
            <div className="px-2 md:px-8 -mt-10 relative z-20 max-w-7xl mx-auto w-full">
                <div className="flex gap-2 overflow-x-auto pb-4 pt-2 scrollbar-hide snap-x">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex flex-col items-center justify-center min-w-[90px] h-[90px] md:min-w-[100px] md:h-[100px] rounded-2xl md:rounded-3xl font-bold transition-all duration-300 shadow-lg snap-start ${activeTab === tab.id
                                ? 'bg-white text-saibro-600 scale-105 border-b-4 border-saibro-500'
                                : 'bg-white/95 text-stone-400 backdrop-blur-md hover:bg-white hover:text-stone-600'
                                }`}
                        >
                            <div className={`p-2 rounded-xl mb-1 ${activeTab === tab.id ? 'bg-saibro-50 text-saibro-600' : 'bg-stone-50'}`}>
                                {React.cloneElement(tab.icon as React.ReactElement, { size: 20 })}
                            </div>
                            <span className="text-[9px] uppercase tracking-tighter">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 px-2 md:px-8 mt-2 pb-8 animate-in fade-in slide-in-from-bottom-6 duration-500 max-w-7xl mx-auto w-full">
                <div className="bg-white rounded-[24px] md:rounded-[32px] shadow-sm border border-stone-100 min-h-[500px] p-4 md:p-6 overflow-x-hidden">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
};
