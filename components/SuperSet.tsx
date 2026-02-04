import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { Trophy, CheckCircle, AlertCircle, Save, Search, Users, ArrowRight, History, Zap, TrendingUp, Sparkles, Filter } from 'lucide-react';
import { getNowInFortaleza, formatDate } from '../utils';

interface SuperSetProps {
    // No props needed
}

export const SuperSet: React.FC<SuperSetProps> = () => {
    const [players, setPlayers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Filter & Search
    const [searchTerm, setSearchTerm] = useState('');

    // Selection
    const [playerAId, setPlayerAId] = useState<string>('');
    const [playerBId, setPlayerBId] = useState<string>('');

    // Score
    const [scoreA, setScoreA] = useState(0);
    const [scoreB, setScoreB] = useState(0);

    // Suggestions from Schedule
    const [todayPlayers, setTodayPlayers] = useState<string[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // 1. Fetch Profiles
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, role')
                .in('role', ['socio', 'admin'])
                .eq('is_active', true)
                .order('name');

            if (profilesData) {
                const mappedPlayers = profilesData.map(p => ({
                    id: p.id,
                    name: p.name,
                    avatar: p.avatar_url,
                    role: p.role,
                    email: '', phone: '', isActive: true, balance: 0 // Mock unused fields
                }));
                setPlayers(mappedPlayers);

                // 2. Fetch Today's Reservations for Smart Suggestion
                const today = formatDate(getNowInFortaleza());
                const { data: reservations } = await supabase
                    .from('reservations')
                    .select('creator_id, participant_ids')
                    .eq('date', today)
                    .neq('status', 'cancelled');

                if (reservations) {
                    const activeIds = new Set<string>();
                    reservations.forEach(r => {
                        activeIds.add(r.creator_id);
                        if (Array.isArray(r.participant_ids)) {
                            r.participant_ids.forEach((pid: string) => activeIds.add(pid));
                        }
                    });
                    const activeList = Array.from(activeIds);
                    setTodayPlayers(activeList);

                    // Smart Select: If exactly 2 players found today, pre-select them
                    if (activeList.length === 2 && !playerAId && !playerBId) {
                        setPlayerAId(activeList[0]);
                        setPlayerBId(activeList[1]);
                    }
                }
            }
            setLoading(false);
        };
        fetchData();
    }, []);

    // Winner Detection logic (Standard Set)
    const getWinner = () => {
        // Standard Win: 6-x where x <= 4
        if (scoreA === 6 && scoreA - scoreB >= 2) return 'A';
        if (scoreB === 6 && scoreB - scoreA >= 2) return 'B';

        // Extended Win / Tiebreak: 7-x (7-5, 7-6) - Also catches overshoot safely
        if (scoreA === 7) return 'A';
        if (scoreB === 7) return 'B';

        return null;
    };

    const winner = getWinner();

    const handleSave = async () => {
        if (!winner || !playerAId || !playerBId) return;
        setSaving(true);

        try {
            const winnerId = winner === 'A' ? playerAId : playerBId;

            const { data: newMatch, error } = await supabase.from('matches').insert({
                type: 'SuperSet',
                status: 'finished',
                date: getNowInFortaleza().toISOString(),
                player_a_id: playerAId,
                player_b_id: playerBId,
                score_a: [scoreA],
                score_b: [scoreB],
                winner_id: winnerId
            }).select().single();

            if (error) throw error;

            // Manual update for immediate feedback
            if (newMatch) {
                setHistory(prev => {
                    // Check if already 20, remove last if so
                    const base = [newMatch, ...prev.filter(m => m.id !== newMatch.id)];
                    const updated = base.slice(0, 20);
                    calculateStats(updated);
                    return updated;
                });
            }

            alert('SuperSet Salvo! 10 pontos computados.');
            // Reset
            setScoreA(0);
            setScoreB(0);
            setPlayerAId('');
            setPlayerBId('');
        } catch (error: any) {
            console.error(error);
            alert('Erro ao salvar: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    // Sorted Players: Put "Today's Players" at top
    const sortedPlayersList = [...players].sort((a, b) => {
        const aToday = todayPlayers.includes(a.id) ? 1 : 0;
        const bToday = todayPlayers.includes(b.id) ? 1 : 0;
        if (aToday !== bToday) return bToday - aToday; // Today's first
        return a.name.localeCompare(b.name);
    });

    // History & Stats State
    const [history, setHistory] = useState<any[]>([]);
    const [stats, setStats] = useState({ totalGames: 0, topWinner: { name: '-', count: 0 } });

    // Fetch History & Subscribe
    useEffect(() => {
        const fetchHistory = async () => {
            const { data } = await supabase
                .from('matches')
                .select('*')
                .eq('type', 'SuperSet')
                .order('date', { ascending: false }) // Most recent first
                .limit(20); // Last 20 games

            if (data) {
                setHistory(data);
                calculateStats(data);
            }
        };

        fetchHistory();

        // Realtime Subscription
        const channel = supabase
            .channel('superset-realtime-changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'matches',
                filter: "type=eq.SuperSet"
            }, (payload) => {
                console.log('Realtime update received:', payload);
                setHistory(prev => {
                    // Avoid duplicates if we already added it manually
                    if (prev.some(m => m.id === payload.new.id)) return prev;
                    const newHistory = [payload.new, ...prev].slice(0, 20);
                    calculateStats(newHistory);
                    return newHistory;
                });
            })
            .subscribe((status) => {
                console.log('Realtime status:', status);
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const calculateStats = (matches: any[]) => {
        const wins: Record<string, number> = {};
        matches.forEach(m => {
            if (m.winner_id) {
                wins[m.winner_id] = (wins[m.winner_id] || 0) + 1;
            }
        });

        let topWinnerId = '';
        let maxWins = 0;
        Object.entries(wins).forEach(([id, count]) => {
            if (count > maxWins) {
                maxWins = count;
                topWinnerId = id;
            }
        });

        // We need player names. If players array is loaded, we can find it.
        // But players array is loaded in another useEffect. 
        // Let's derived the name in render or store just ID here.
        setStats({
            totalGames: matches.length,
            topWinner: { name: topWinnerId, count: maxWins }
        });
    };

    // Helper to get player name safely
    const getPlayerName = (id: string) => players.find(p => p.id === id)?.name || 'Anônimo';

    // Optimized Filter Logic:
    // 1. If searching, search GLOBAL list (all players), but prioritize today's players for visibility
    // 2. If NOT searching, show ONLY today's players (smart suggestion default)
    const filteredPlayers = searchTerm
        ? players
            .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => {
                const aToday = todayPlayers.includes(a.id) ? 1 : 0;
                const bToday = todayPlayers.includes(b.id) ? 1 : 0;
                if (aToday !== bToday) return bToday - aToday; // Prioritize today's players
                return a.name.localeCompare(b.name);
            })
        : players.filter(p => todayPlayers.includes(p.id));

    // Helper for UI indicators
    const playersPresentToday = players.filter(p => todayPlayers.includes(p.id));

    return (
        <div className="p-4 sm:p-6 pb-40 space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="text-center sm:text-left">
                    <h2 className="text-2xl sm:text-3xl font-black text-stone-800 tracking-tighter flex items-center justify-center sm:justify-start gap-2">
                        <Sparkles className="text-saibro-500" /> SuperSet
                    </h2>
                    <p className="text-stone-500 font-bold text-[10px] sm:text-xs uppercase tracking-widest mt-1 opacity-70">
                        1 Set • 10 Pontos no Ranking
                    </p>
                </div>

                {stats.totalGames > 0 && (
                    <div className="flex items-center justify-center gap-2 bg-stone-100/50 p-1.5 rounded-2xl border border-stone-200/50 self-center sm:self-auto">
                        <div className="px-3 py-1.5 bg-white rounded-xl shadow-sm border border-stone-200/50">
                            <span className="text-[9px] sm:text-[10px] font-black text-stone-400 block leading-none mb-1">JOGOS</span>
                            <span className="text-base sm:text-lg font-black text-stone-800 leading-none tabular-nums">{stats.totalGames}</span>
                        </div>
                        <div className="px-3 py-1.5 bg-saibro-50 rounded-xl shadow-sm border border-saibro-100/50">
                            <span className="text-[9px] sm:text-[10px] font-black text-saibro-500 block leading-none mb-1">TOP WINNER</span>
                            <span className="text-xs sm:text-sm font-black text-saibro-700 leading-none truncate block max-w-[80px] sm:max-w-[100px]">
                                {getPlayerName(stats.topWinner.name).split(' ')[0]}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* SELECTION AREA */}
            <div className="relative">
                <div className="absolute -inset-1 bg-linear-to-r from-saibro-500/10 to-court-green/10 rounded-[40px] blur-2xl opacity-50"></div>
                <div className="relative bg-white rounded-[40px] shadow-xl shadow-stone-200/50 border border-stone-100 overflow-hidden">

                    {/* Multi-step Selection Header */}
                    <div className="px-4 sm:px-8 py-8 sm:py-10 text-center space-y-6">
                        <div className="flex items-center justify-center gap-4 sm:gap-12 mb-2">
                            {/* ATLETA A */}
                            <div
                                className={`flex flex-col items-center gap-2 sm:gap-3 flex-1 transition-all ${playerAId ? 'cursor-pointer active:scale-95' : ''}`}
                                onClick={() => playerAId && setPlayerAId('')}
                            >
                                <div className={`w-16 h-16 sm:w-24 sm:h-24 rounded-[20px] sm:rounded-[32px] border-2 sm:border-4 flex items-center justify-center transition-all duration-500 overflow-hidden shadow-xl sm:shadow-2xl ${playerAId ? 'border-saibro-500 hover:border-saibro-400' : 'border-stone-100 bg-stone-50'}`}>
                                    {playerAId ? (
                                        <img src={players.find(p => p.id === playerAId)?.avatar} className="w-full h-full object-cover animate-in zoom-in duration-300" alt="" />
                                    ) : (
                                        <Users size={24} className="text-stone-300 sm:w-8 sm:h-8" />
                                    )}
                                </div>
                                <div className="space-y-0.5 sm:space-y-1">
                                    <span className="text-[8px] sm:text-[10px] font-black text-stone-400 uppercase tracking-widest block">Atleta A</span>
                                    <span className={`text-[11px] sm:text-sm font-black uppercase tracking-tight truncate max-w-[70px] sm:max-w-[100px] block ${playerAId ? 'text-stone-800' : 'text-stone-300'}`}>
                                        {playerAId ? getPlayerName(playerAId).split(' ')[0] : 'Pendente'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col items-center shrink-0">
                                <span className="text-stone-200 font-black italic text-lg sm:text-2xl tracking-tighter opacity-50">VS</span>
                                <div className="h-8 sm:h-12 w-px bg-stone-100 my-1 sm:my-2"></div>
                            </div>

                            {/* ATLETA B */}
                            <div
                                className={`flex flex-col items-center gap-2 sm:gap-3 flex-1 transition-all ${playerBId ? 'cursor-pointer active:scale-95' : ''}`}
                                onClick={() => playerBId && setPlayerBId('')}
                            >
                                <div className={`w-16 h-16 sm:w-24 sm:h-24 rounded-[20px] sm:rounded-[32px] border-2 sm:border-4 flex items-center justify-center transition-all duration-500 overflow-hidden shadow-xl sm:shadow-2xl ${playerBId ? 'border-court-green' : 'border-stone-100 bg-stone-50'}`}>
                                    {playerBId ? (
                                        <img src={players.find(p => p.id === playerBId)?.avatar} className="w-full h-full object-cover animate-in zoom-in duration-300" alt="" />
                                    ) : (
                                        <Users size={24} className="text-stone-300 sm:w-8 sm:h-8" />
                                    )}
                                </div>
                                <div className="space-y-0.5 sm:space-y-1">
                                    <span className="text-[8px] sm:text-[10px] font-black text-stone-400 uppercase tracking-widest block">Atleta B</span>
                                    <span className={`text-[11px] sm:text-sm font-black uppercase tracking-tight truncate max-w-[70px] sm:max-w-[100px] block ${playerBId ? 'text-stone-800' : 'text-stone-300'}`}>
                                        {playerBId ? getPlayerName(playerBId).split(' ')[0] : 'Pendente'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {(!playerAId || !playerBId) && (
                            <div className="max-w-md mx-auto space-y-4 px-2">
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-4 flex items-center text-stone-400 group-focus-within:text-saibro-500 transition-colors">
                                        <Search size={16} />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder={`Buscar atleta ${!playerAId ? 'A' : 'B'}...`}
                                        className="w-full pl-10 pr-4 py-3 sm:pl-12 sm:pr-6 sm:py-4 bg-stone-50 border-2 border-stone-100 rounded-2xl outline-none focus:border-saibro-500 transition-all font-bold text-sm sm:text-base text-stone-700 shadow-inner"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                    {playersPresentToday.length > 0 && (
                                        <div className="hidden sm:flex absolute right-4 inset-y-0 items-center gap-1.5">
                                            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                                            <span className="text-[10px] font-black text-stone-500 uppercase tracking-tight">Clube</span>
                                        </div>
                                    )}
                                </div>

                                {playersPresentToday.length > 0 && !searchTerm && (
                                    <div className="sm:hidden flex items-center justify-center gap-1.5 py-1">
                                        <span className="flex h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                        <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest">Atletas presentes hoje</span>
                                    </div>
                                )}

                                {/* Results Grid */}
                                <div className="grid grid-cols-2 xs:grid-cols-3 gap-3 pt-2">
                                    {filteredPlayers.length > 0 ? filteredPlayers

                                        .filter(p => p.id !== playerAId && p.id !== playerBId)
                                        .slice(0, 6)
                                        .map(p => (
                                            <button
                                                key={p.id}
                                                onClick={() => {
                                                    if (!playerAId) setPlayerAId(p.id);
                                                    else setPlayerBId(p.id);
                                                    setSearchTerm('');
                                                }}
                                                className="group/btn flex flex-col items-center gap-2 p-3 bg-white border border-stone-100 rounded-2xl hover:border-saibro-200 hover:shadow-lg transition-all active:scale-95"
                                            >
                                                <img src={p.avatar} className="w-12 h-12 rounded-full border-2 border-white shadow-sm object-cover group-hover/btn:scale-110 transition-transform" />
                                                <span className="text-[10px] font-bold text-stone-600 uppercase truncate w-full text-center tracking-tight">
                                                    {p.name.split(' ')[0]}
                                                </span>
                                            </button>
                                        )) : (
                                        <div className="col-span-full py-8 text-center bg-stone-50 rounded-2xl border-2 border-dashed border-stone-100">
                                            <p className="text-xs font-black text-stone-400 uppercase tracking-widest">
                                                Nenhum atleta encontrado com reservas para hoje
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Scoreboard */}
                    {playerAId && playerBId && (
                        <div className="p-6 sm:p-12 flex flex-col items-center gap-6 sm:gap-10 bg-stone-50/50 border-t border-stone-100">
                            <div className="flex items-center gap-4 sm:gap-16 w-full justify-center">
                                {/* Score A */}
                                <div className="flex flex-col items-center gap-3 sm:gap-4 flex-1">
                                    <button
                                        disabled={!!winner}
                                        onClick={() => !winner && setScoreA(s => Math.min(s + 1, 7))}
                                        className="w-12 h-12 sm:w-20 sm:h-20 rounded-[20px] sm:rounded-[28px] bg-white border-2 border-saibro-100 text-saibro-600 flex items-center justify-center text-2xl sm:text-4xl font-black hover:bg-saibro-500 hover:text-white transition-all active:scale-90 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >+</button>
                                    <div className="relative group">
                                        <span className="text-7xl sm:text-[160px] font-black text-stone-800 tabular-nums leading-none tracking-tighter drop-shadow-sm transition-transform block">
                                            {scoreA}
                                        </span>
                                        {winner === 'A' && (
                                            <div className="absolute -top-3 -right-3 sm:-top-6 sm:-right-6 bg-yellow-400 text-yellow-900 p-1.5 sm:p-2 rounded-full shadow-lg animate-bounce border-2 border-white">
                                                <Trophy size={16} className="sm:w-6 sm:h-6" />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setScoreA(s => Math.max(s - 1, 0))}
                                        className="w-10 h-10 rounded-xl bg-white border border-stone-200 text-stone-400 flex items-center justify-center text-lg sm:text-2xl font-bold hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                                    >-</button>
                                </div>

                                <div className="flex flex-col items-center gap-2 sm:gap-4 py-4 sm:py-8 shrink-0">
                                    <div className="px-3 py-1 bg-stone-800 text-stone-300 rounded-full text-[8px] sm:text-[10px] font-black uppercase tracking-widest shadow-lg">SET</div>
                                    <div className="h-20 sm:h-40 w-0.5 sm:w-1 rounded-full bg-linear-to-b from-transparent via-stone-200 to-transparent"></div>
                                </div>

                                {/* Score B */}
                                <div className="flex flex-col items-center gap-3 sm:gap-4 flex-1">
                                    <button
                                        disabled={!!winner}
                                        onClick={() => !winner && setScoreB(s => Math.min(s + 1, 7))}
                                        className="w-12 h-12 sm:w-20 sm:h-20 rounded-[20px] sm:rounded-[28px] bg-white border-2 border-court-green/20 text-court-green flex items-center justify-center text-2xl sm:text-4xl font-black hover:bg-court-green hover:text-white transition-all active:scale-90 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    >+</button>
                                    <div className="relative group">
                                        <span className="text-7xl sm:text-[160px] font-black text-stone-800 tabular-nums leading-none tracking-tighter drop-shadow-sm transition-transform block">
                                            {scoreB}
                                        </span>
                                        {winner === 'B' && (
                                            <div className="absolute -top-3 -right-3 sm:-top-6 sm:-right-6 bg-yellow-400 text-yellow-900 p-1.5 sm:p-2 rounded-full shadow-lg animate-bounce border-2 border-white">
                                                <Trophy size={16} className="sm:w-6 sm:h-6" />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setScoreB(s => Math.max(s - 1, 0))}
                                        className="w-10 h-10 rounded-xl bg-white border border-stone-200 text-stone-400 flex items-center justify-center text-lg sm:text-2xl font-bold hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                                    >-</button>
                                </div>
                            </div>

                            {/* Status & Save */}
                            <div className="w-full max-w-sm space-y-4">
                                {winner ? (
                                    <div className="bg-green-500 text-white px-6 py-4 rounded-[28px] shadow-xl shadow-green-100/50 flex items-center justify-between animate-in zoom-in-95 duration-300">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-white/20 rounded-full">
                                                <Zap size={20} className="fill-white" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-tighter opacity-80 leading-none mb-1">Finalizado</p>
                                                <p className="font-black text-sm uppercase tracking-tight">Partida Concluída!</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-black uppercase opacity-80">+10 PTS</p>
                                            <p className="font-black text-xs">RANKING</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-2 text-stone-400 bg-white border border-stone-100 px-6 py-4 rounded-3xl text-xs font-black uppercase tracking-widest shadow-inner">
                                        <Zap size={16} /> Jogo em andamento...
                                    </div>
                                )}

                                {winner && (
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="w-full py-5 bg-stone-900 text-white rounded-[28px] font-black text-xl shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3 hover:bg-black group"
                                    >
                                        {saving ? (
                                            <span className="flex items-center gap-3">
                                                <div className="w-5 h-5 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                SALVANDO...
                                            </span>
                                        ) : (
                                            <>
                                                CONFIRMAR <ArrowRight className="group-hover:translate-x-2 transition-transform" />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* History Feed */}
            <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                    <h3 className="font-black text-stone-800 text-xl tracking-tighter flex items-center gap-2">
                        <History className="text-saibro-500" /> Match Feed
                    </h3>
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-stone-400 uppercase tracking-widest bg-stone-100/80 px-3 py-1.5 rounded-full">
                        <TrendingUp size={14} /> Recentes
                    </div>
                </div>

                <div className="space-y-4">
                    {history.map((match) => {
                        const playerA = players.find(p => p.id === match.player_a_id);
                        const playerB = players.find(p => p.id === match.player_b_id);
                        const isWinnerA = match.winner_id === match.player_a_id;

                        return (
                            <div key={match.id} className="group/match bg-white p-5 rounded-[40px] border border-stone-100 shadow-sm hover:shadow-xl hover:scale-[1.01] transition-all duration-500">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 sm:gap-8 flex-1">
                                        {/* Player A */}
                                        <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
                                            <div className="relative">
                                                <img src={playerA?.avatar} className={`w-14 h-14 sm:w-20 sm:h-20 rounded-[28px] object-cover border-4 shadow-sm transition-all duration-500 ${isWinnerA ? 'border-saibro-400 scale-105' : 'border-stone-50 opacity-40'}`} />
                                                {isWinnerA && (
                                                    <div className="absolute -top-3 -right-3 bg-saibro-500 text-white p-1.5 rounded-full border-2 border-white shadow-lg animate-bounce">
                                                        <Trophy size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <span className={`text-[10px] font-black uppercase tracking-tight truncate w-full text-center ${isWinnerA ? 'text-stone-800' : 'text-stone-300'}`}>
                                                {playerA?.name.split(' ')[0]}
                                            </span>
                                        </div>

                                        {/* Result Center */}
                                        <div className="flex flex-col items-center gap-2 px-2">
                                            <div className="bg-stone-900 text-white px-5 py-2.5 rounded-[22px] font-black text-xl sm:text-3xl tabular-nums shadow-xl shadow-stone-200 border-2 border-stone-800">
                                                {match.score_a[0]}<span className="text-stone-500 mx-1.5 font-light">-</span>{match.score_b[0]}
                                            </div>
                                            <span className="text-[9px] font-black text-stone-300 uppercase tracking-widest whitespace-nowrap">
                                                {new Date(match.date + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: 'short' })}
                                            </span>
                                        </div>

                                        {/* Player B */}
                                        <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
                                            <div className="relative">
                                                <img src={playerB?.avatar} className={`w-14 h-14 sm:w-20 sm:h-20 rounded-[28px] object-cover border-4 shadow-sm transition-all duration-500 ${!isWinnerA ? 'border-court-green scale-105' : 'border-stone-50 opacity-40'}`} />
                                                {!isWinnerA && (
                                                    <div className="absolute -top-3 -right-3 bg-court-green text-white p-1.5 rounded-full border-2 border-white shadow-lg animate-bounce">
                                                        <Trophy size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <span className={`text-[10px] font-black uppercase tracking-tight truncate w-full text-center ${!isWinnerA ? 'text-stone-800' : 'text-stone-300'}`}>
                                                {playerB?.name.split(' ')[0]}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {history.length === 0 && (
                        <div className="py-20 text-center space-y-4">
                            <div className="w-20 h-20 bg-stone-100 rounded-[32px] flex items-center justify-center mx-auto text-stone-300">
                                <History size={40} />
                            </div>
                            <p className="text-stone-400 font-black text-[10px] uppercase tracking-widest">Aguardando estreias no Match Feed...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
