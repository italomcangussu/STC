
import React, { useState, useMemo, useEffect } from 'react';
import { Search, Trophy, Calendar, Mail, User as UserIcon, ArrowLeft, TrendingUp, Activity, MapPin, Clock, History, Crown, AlertCircle, ArrowRight, Edit2, Loader2 } from 'lucide-react';
import { User, Match, Reservation } from '../types';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza, formatDateBr } from '../utils';
import { EditProfileModal } from './EditProfileModal';
import { fetchRanking, canChallenge, PlayerStats, CLASS_ORDER } from '../lib/rankingService';


// --- COMPONENT: Athlete Profile ---
interface AthleteProfileProps {
    userId: string;
    currentUser: User;
    users: User[]; // Pass full user list
    onBack: () => void;
    onProfileUpdate: () => void;
}

const AthleteProfile: React.FC<AthleteProfileProps> = ({ userId, currentUser, users, onBack, onProfileUpdate }) => {
    const user = users.find(u => u.id === userId);
    const [activeTab, setActiveTab] = useState<'stats' | 'history' | 'presence'>('stats');
    const [showEdit, setShowEdit] = useState(false);
    const [ranking, setRanking] = useState<PlayerStats[]>([]);
    const [loadingRanking, setLoadingRanking] = useState(true);
    const [matches, setMatches] = useState<any[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [courts, setCourts] = useState<{ id: string; name: string; type: string }[]>([]);

    // 1. Fetch Ranking from service
    useEffect(() => {
        const loadData = async () => {
            setLoadingRanking(true);
            try {
                const [rankingData, matchesData] = await Promise.all([
                    fetchRanking(),
                    supabase
                        .from('matches')
                        .select('*')
                        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
                        .eq('status', 'finished')
                        .order('date', { ascending: false })
                        .limit(20)
                ]);
                setRanking(rankingData);
                setMatches(matchesData.data || []);

                // Fetch reservations for this user
                const { data: resData } = await supabase
                    .from('reservations')
                    .select('*')
                    .contains('participant_ids', [userId])
                    .order('date', { ascending: false });

                setReservations((resData || []).map(r => ({
                    id: r.id,
                    type: r.type,
                    date: r.date,
                    startTime: r.start_time,
                    endTime: r.end_time,
                    courtId: r.court_id,
                    creatorId: r.creator_id,
                    participantIds: r.participant_ids || [],
                    guestName: r.guest_name,
                    status: r.status
                })));

                // Fetch courts
                const { data: courtsData } = await supabase
                    .from('courts')
                    .select('id, name, type');

                setCourts(courtsData || []);
            } catch (err) {
                console.error('Error loading profile data:', err);
            } finally {
                setLoadingRanking(false);
            }
        };
        loadData();
    }, [userId]);

    const userRankStats = ranking.find(r => r.id === userId);
    const myRankStats = ranking.find(r => r.id === currentUser.id);

    const isSelf = currentUser.id === userId;

    // Challenge Validation Logic using new service
    const handleChallengeClick = () => {
        if (!myRankStats || !userRankStats) {
            alert("Erro ao calcular ranking.");
            return;
        }

        const result = canChallenge(myRankStats, userRankStats, ranking);

        if (!result.allowed) {
            alert(`Não é possível desafiar: ${result.reason}`);
            return;
        }

        if (confirm(`Deseja iniciar um desafio contra ${user?.name}?`)) {
            // Create challenge in database
            supabase.from('challenges').insert({
                challenger_id: currentUser.id,
                challenged_id: userId,
                status: 'proposed',
                month_ref: getNowInFortaleza().toISOString().slice(0, 7)
            }).then(({ error }) => {
                if (error) {
                    alert('Erro ao criar desafio');
                } else {
                    alert("Desafio criado com sucesso!");
                }
            });
        }
    };

    const handleReservationClick = () => {
        alert(`Iniciando reserva com ${user?.name}... (Redirecionando para Agenda)`);
    };

    // 2. Get Reservations (Presence) - now from state
    const userReservations = useMemo(() => {
        return reservations
            .sort((a, b) => new Date(b.date + 'T' + b.startTime).getTime() - new Date(a.date + 'T' + a.startTime).getTime());
    }, [reservations]);

    // 3. Recent form from database matches
    const recentForm = useMemo(() => {
        return matches.slice(0, 5).map(m => m.winner_id === userId);
    }, [matches, userId]);

    // 5. Day Uses Brought
    const dayUsesCount = reservations.filter(r => r.creatorId === userId && r.guestName).length;

    if (!user) return null;

    return (
        <div className="bg-white min-h-[calc(100vh-100px)] animate-in slide-in-from-right duration-300">
            {/* --- HEADER --- */}
            <div className="relative bg-saibro-600 text-white p-6 pb-12 rounded-b-4xl shadow-xl">
                <button onClick={onBack} className="absolute top-4 left-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors">
                    <ArrowLeft size={20} />
                </button>

                {isSelf && (
                    <button
                        onClick={() => setShowEdit(true)}
                        className="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors flex items-center gap-2"
                    >
                        <Edit2 size={16} />
                        <span className="text-xs font-bold hidden md:inline">Editar</span>
                    </button>
                )}

                <div className="flex flex-col items-center mt-4">
                    <div className="relative">
                        <img
                            src={user.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=" + user.id}
                            alt={user.name}
                            className="w-24 h-24 rounded-full border-4 border-saibro-300 shadow-md bg-stone-200 object-cover"
                        />
                        <div className={`absolute bottom-1 right-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border border-white ${user.role === 'admin' ? 'bg-purple-500' : 'bg-green-500'}`}>
                            {user.role}
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold mt-3 text-center">{user.name}</h1>
                    <div className="flex flex-wrap justify-center items-center gap-2 mt-1 px-4">
                        {user.category && (
                            <span className="px-3 py-0.5 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wide backdrop-blur-sm">
                                {user.category}
                            </span>
                        )}
                        {user.age && (
                            <span className="px-3 py-0.5 bg-white/10 rounded-full text-xs font-bold backdrop-blur-sm text-saibro-100">
                                {user.age} anos
                            </span>
                        )}
                        <span className="text-xs text-saibro-100 flex items-center gap-1">
                            <Mail size={12} /> {user.email?.replace('@reserva.com', '') /* Hide dummy domain */}
                        </span>
                    </div>

                    {!isSelf && (
                        <div className="flex gap-3 mt-6 w-full max-w-xs animate-in fade-in slide-in-from-bottom-2">
                            <button
                                onClick={handleChallengeClick}
                                className="flex-1 bg-white text-saibro-700 py-2.5 rounded-xl font-bold text-sm shadow-sm hover:bg-stone-50 transition-colors active:scale-95"
                            >
                                Desafiar
                            </button>
                            <button
                                onClick={handleReservationClick}
                                className="flex-1 bg-saibro-800 text-white py-2.5 rounded-xl font-bold text-sm shadow-sm border border-saibro-700 hover:bg-saibro-900 transition-colors active:scale-95"
                            >
                                + Reserva
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* --- KPI CARDS --- */}
            <div className="max-w-4xl mx-auto px-4 -mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-xl shadow-md border border-stone-100 flex flex-col items-center text-center">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Ranking</span>
                    <div className="flex items-center gap-1 mt-1">
                        <Trophy size={16} className="text-yellow-500" />
                        <span className="text-2xl font-black text-stone-800">#{userRankStats?.categoryPosition || '-'}</span>
                    </div>
                    <span className="text-[9px] text-stone-400">{userRankStats?.category}</span>
                </div>

                <div className="bg-white p-3 rounded-xl shadow-md border border-stone-100 flex flex-col items-center text-center">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Pontos</span>
                    <span className="text-2xl font-black text-saibro-600 mt-1">{userRankStats?.totalPoints || 0}</span>
                    <span className="text-[9px] text-stone-400 leading-none">Total</span>
                </div>

                <div className="bg-white p-3 rounded-xl shadow-md border border-stone-100 flex flex-col items-center text-center">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">V / D</span>
                    <span className="text-2xl font-black text-stone-800 mt-1">
                        {userRankStats?.totalWins || 0} / {userRankStats?.totalLosses || 0}
                    </span>
                    <span className="text-[9px] text-stone-400 leading-none">Vitórias / Derrotas</span>
                </div>

                <div className="bg-white p-3 rounded-xl shadow-md border border-stone-100 flex flex-col items-center text-center">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Presença</span>
                    <span className="text-2xl font-black text-stone-800 mt-1">{userReservations.length}</span>

                    <span className="text-[9px] text-stone-400 leading-none">Reservas</span>
                </div>
            </div>

            {/* --- TABS --- */}
            <div className="max-w-4xl mx-auto px-4 mt-8 pb-40">
                <div className="flex bg-stone-100 p-1.5 rounded-2xl mb-6 shadow-inner">
                    {[
                        { id: 'stats', label: 'Estatísticas', icon: TrendingUp },
                        { id: 'history', label: 'Jogos', icon: History },
                        { id: 'presence', label: 'Presença', icon: MapPin },
                    ].map(tab => {
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 relative z-10 
                                    ${active
                                        ? 'bg-white text-saibro-700 shadow-md transform scale-[1.02] border border-stone-50'
                                        : 'text-stone-400 hover:text-stone-600 hover:bg-stone-200/50'
                                    }`}
                            >
                                <tab.icon size={16} className={active ? 'text-saibro-500' : ''} />
                                <span className="hidden md:inline">{tab.label}</span>
                            </button>
                        )
                    })}
                </div>

                {/* TAB CONTENT: STATS */}
                {activeTab === 'stats' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                        {/* Recent Form */}
                        <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                            <h3 className="text-sm font-bold text-stone-700 mb-3 flex items-center gap-2">
                                <Activity size={16} className="text-saibro-500" /> Forma Recente
                            </h3>
                            <div className="flex gap-2">
                                {recentForm.map((win, idx) => (
                                    <div key={idx} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${win ? 'bg-green-500' : 'bg-red-400'}`}>
                                        {win ? 'V' : 'D'}
                                    </div>
                                ))}
                                {recentForm.length === 0 && <span className="text-stone-400 text-sm">Sem jogos recentes.</span>}
                            </div>
                        </div>

                        {/* Stats Grid - Detailed */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Sets */}
                            <div className="bg-white border border-stone-100 p-4 rounded-xl shadow-sm">
                                <h4 className="text-xs font-bold text-stone-400 uppercase mb-2">Sets</h4>
                                <div className="flex justify-between items-end">
                                    <div className="text-center">
                                        <span className="block text-xl font-bold text-green-600">{userRankStats?.totalSetsWon || 0}</span>
                                        <span className="text-[10px] text-stone-400">Ganhos</span>
                                    </div>
                                    <div className="h-8 w-px bg-stone-100 mx-2" />
                                    <div className="text-center">
                                        <span className="block text-xl font-bold text-red-500">{userRankStats?.totalSetsLost || 0}</span>
                                        <span className="text-[10px] text-stone-400">Perdidos</span>
                                    </div>
                                </div>
                            </div>

                            {/* Games */}
                            <div className="bg-white border border-stone-100 p-4 rounded-xl shadow-sm">
                                <h4 className="text-xs font-bold text-stone-400 uppercase mb-2">Games</h4>
                                <div className="flex justify-between items-end">
                                    <div className="text-center">
                                        <span className="block text-xl font-bold text-green-600">{userRankStats?.totalGamesWon || 0}</span>
                                        <span className="text-[10px] text-stone-400">Ganhos</span>
                                    </div>
                                    <div className="h-8 w-px bg-stone-100 mx-2" />
                                    <div className="text-center">
                                        <span className="block text-xl font-bold text-red-500">{userRankStats?.totalGamesLost || 0}</span>
                                        <span className="text-[10px] text-stone-400">Perdidos</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Legacy vs Challenge Breakdown */}
                        {userRankStats && (userRankStats.legacyPoints > 0 || userRankStats.challengePoints > 0) && (
                            <div className="bg-saibro-50 border border-saibro-100 rounded-xl p-4">
                                <h4 className="text-xs font-bold text-saibro-700 uppercase mb-3">Composição de Pontos</h4>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="text-center">
                                        <span className="block text-lg font-bold text-saibro-600">{userRankStats.legacyPoints}</span>
                                        <span className="text-[10px] text-stone-500 leading-none">Campeonatos</span>
                                    </div>
                                    <div className="text-center border-x border-saibro-100">
                                        <span className="block text-lg font-bold text-saibro-600">{userRankStats.challengePoints}</span>
                                        <span className="text-[10px] text-stone-500 leading-none">Desafios</span>
                                    </div>
                                    <div className="text-center">
                                        <span className="block text-lg font-bold text-saibro-600">{userRankStats.superSetPoints || 0}</span>
                                        <span className="text-[10px] text-stone-500 leading-none">SuperSets</span>
                                    </div>
                                </div>
                                <div className="mt-3 bg-white rounded-lg p-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-stone-500">V/D Campeonatos:</span>
                                        <span className="font-bold">{userRankStats.legacyWins}/{userRankStats.legacyLosses}</span>
                                    </div>
                                    <div className="flex justify-between text-xs mt-1">
                                        <span className="text-stone-500">V/D Desafios:</span>
                                        <span className="font-bold">{userRankStats.challengeWins}/{userRankStats.challengeLosses}</span>
                                    </div>
                                    <div className="flex justify-between text-xs mt-1">
                                        <span className="text-stone-500">V/D SuperSets:</span>
                                        <span className="font-bold">{userRankStats.superSetWins}/{userRankStats.superSetLosses}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Day Use Stats */}
                        <div className="bg-white border border-stone-100 p-4 rounded-xl shadow-sm flex justify-between items-center">
                            <div>
                                <h4 className="text-xs font-bold text-stone-400 uppercase">Convidados (Day Use)</h4>
                                <p className="text-xs text-stone-500 mt-1">Levados ao clube</p>
                            </div>
                            <span className="text-2xl font-bold text-stone-800">{dayUsesCount}</span>
                        </div>
                    </div>
                )}

                {/* TAB CONTENT: HISTORY */}
                {activeTab === 'history' && (
                    <div className="space-y-3 animate-in fade-in duration-300">

                        {matches.length === 0 ? (
                            <div className="text-center py-10 text-stone-400">
                                <History size={32} className="mx-auto mb-2 opacity-30" />
                                <p>Nenhum jogo registrado.</p>
                            </div>
                        ) : (
                            matches.map((m: any, mIndex: number) => {
                                const isPlayerA = m.player_a_id === userId;
                                const opponentId = isPlayerA ? m.player_b_id : m.player_a_id;
                                const opponent = ranking.find(r => r.id === opponentId);
                                const isWinner = m.winner_id === userId;
                                const myScore = isPlayerA ? (m.score_a || []) : (m.score_b || []);
                                const oppScore = isPlayerA ? (m.score_b || []) : (m.score_a || []);

                                return (
                                    <div key={m.id} className="bg-white p-4 rounded-xl border border-stone-100 shadow-sm flex flex-col gap-2 hover:shadow-md transition-shadow animate-slide-in" style={{ animationDelay: `${mIndex * 50}ms` }}>
                                        <div className="flex justify-between items-start">
                                            <span className="text-[10px] font-bold uppercase bg-stone-100 text-stone-500 px-2 py-0.5 rounded">
                                                {m.type || 'Desafio'}
                                            </span>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${isWinner ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {isWinner ? 'Vitória' : 'Derrota'}
                                            </span>
                                        </div>

                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className="text-xs text-stone-400 shrink-0">vs</span>
                                                <span className="font-semibold text-stone-800 truncate">{opponent?.name || 'Desconhecido'}</span>
                                            </div>
                                            <div className="flex gap-1">
                                                {myScore.map((s: number, i: number) => (
                                                    <span key={i} className="text-sm font-mono font-bold text-stone-800">
                                                        {s}-{oppScore[i] || 0}
                                                        {i < myScore.length - 1 && <span className="text-stone-300 mx-1">|</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="text-[10px] text-stone-400 text-right">
                                            {m.date ? formatDateBr(m.date.split('T')[0]) : 'Data N/A'}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}


                {/* TAB CONTENT: PRESENCE */}
                {
                    activeTab === 'presence' && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-center gap-3 shadow-sm">
                                <div className="bg-white p-2 rounded-full text-blue-500 shadow-sm">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-blue-900 text-sm">Frequência</h4>
                                    <p className="text-xs text-blue-700">Calculado com base nas reservas realizadas e participadas.</p>
                                </div>
                            </div>

                            <h3 className="font-bold text-stone-700 text-sm mt-4">Próximas Reservas & Histórico</h3>
                            <div className="space-y-3">
                                {userReservations.length === 0 ? (
                                    <p className="text-stone-400 text-sm text-center py-4">Nenhuma reserva encontrada.</p>
                                ) : (
                                    userReservations.map(r => {
                                        const court = courts.find(c => c.id === r.courtId);
                                        const isUpcoming = new Date(r.date + 'T' + r.startTime) > getNowInFortaleza();

                                        return (
                                            <div key={r.id} className={`p-4 rounded-xl border flex items-center gap-3 transition-shadow ${isUpcoming ? 'bg-white border-saibro-200 shadow-sm hover:shadow-md' : 'bg-stone-50 border-stone-100 opacity-75'}`}>
                                                <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center text-xs font-bold ${isUpcoming ? 'bg-saibro-100 text-saibro-700' : 'bg-stone-200 text-stone-500'}`}>
                                                    <span>{r.startTime}</span>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between">
                                                        <span className="font-bold text-stone-800 text-sm">{court?.name}</span>
                                                        <span className="text-[10px] uppercase font-bold text-stone-400">{r.type}</span>
                                                    </div>
                                                    <p className="text-xs text-stone-500">
                                                        {formatDateBr(r.date)}
                                                    </p>
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    )
                }
            </div >

            {/* EDIT MODAL */}
            {
                showEdit && (
                    <EditProfileModal
                        currentUser={currentUser}
                        onClose={() => setShowEdit(false)}
                        onUpdate={onProfileUpdate}
                    />
                )
            }
        </div >
    );
};

interface AthletesProps {
    initialUserId: string | null;
    currentUser: User;
    onClearRequest: () => void;
}

export const Athletes: React.FC<AthletesProps> = ({ initialUserId, currentUser, onClearRequest }) => {
    const [selectedUserId, setSelectedUserId] = useState<string | null>(initialUserId);
    const [searchTerm, setSearchTerm] = useState('');
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchUsers = async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('is_active', true);

            if (error) throw error;

            if (data) {
                // Map Supabase profiles to User type
                const mappedUsers: User[] = data.map(p => ({
                    id: p.id,
                    name: p.name || 'Sem Nome',
                    email: p.email || 'sem-email@reserva.sct',
                    phone: p.phone,
                    role: p.role,
                    category: p.category,
                    avatar: p.avatar_url,
                    isProfessor: p.role === 'professor',
                    age: p.age,
                    balance: 0, // Default balance
                    isActive: p.is_active !== false // Default to true unless explicitly false
                }));
                setUsers(mappedUsers);
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    useEffect(() => {
        if (initialUserId) setSelectedUserId(initialUserId);
    }, [initialUserId]);

    const handleBack = () => {
        setSelectedUserId(null);
        onClearRequest();
    };

    const handleProfileUpdate = () => {
        fetchUsers(); // Refresh list to show updates
        window.location.reload(); // Reload to refresh Context if needed (simplest)
    };

    const filteredUsers = users.filter(u =>
        u.role !== 'lanchonete' &&
        u.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return <div className="p-8 text-center text-stone-400">Carregando atletas...</div>;
    }

    if (selectedUserId) {
        return (
            <AthleteProfile
                userId={selectedUserId}
                currentUser={currentUser}
                users={users} // Pass real users
                onBack={handleBack}
                onProfileUpdate={handleProfileUpdate}
            />
        );
    }

    return (
        <div className="p-4 pb-40 space-y-6">
            <h2 className="text-2xl font-bold text-saibro-900">Atletas</h2>

            {/* Search Bar */}
            <div className="relative">
                <input
                    type="text"
                    placeholder="Buscar atleta..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full p-3 pl-10 bg-white border border-stone-200 rounded-xl shadow-sm focus:ring-2 focus:ring-saibro-400 outline-none"
                />
                <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            </div>

            {/* Grid List */}
            <div className="grid gap-3">
                {/* Always show Current User first if not searching or if matches search */}
                {/* Actually simplistic filter is fine. */}

                {filteredUsers.map(u => (
                    <div
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 flex items-center gap-3 cursor-pointer hover:border-saibro-300 transition-all active:scale-[0.99]"
                    >
                        <img
                            src={u.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=" + u.id}
                            alt={u.name}
                            className="w-12 h-12 rounded-full bg-stone-200 object-cover"
                        />
                        <div>
                            <h3 className="font-bold text-stone-800 flex items-center gap-1">
                                {u.name}
                                {u.id === currentUser.id && <span className="text-[10px] bg-stone-100 text-stone-500 px-1 rounded">Você</span>}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-stone-500">
                                {u.role === 'admin' && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded uppercase font-bold">ADMIN</span>}
                                {u.category && <span className="bg-stone-100 px-1.5 py-0.5 rounded uppercase font-bold">{u.category}</span>}
                                {u.isProfessor && <span className="bg-saibro-100 text-saibro-700 px-1.5 py-0.5 rounded uppercase font-bold">PRO</span>}
                            </div>
                        </div>
                        <div className="ml-auto text-stone-300">
                            <ArrowRight size={20} />
                        </div>
                    </div>
                ))}
                {filteredUsers.length === 0 && (
                    <div className="text-center py-8 text-stone-400">
                        Nenhum atleta encontrado.
                    </div>
                )}
            </div>
        </div>
    );
};