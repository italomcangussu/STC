import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { Trophy, CheckCircle, AlertCircle, Save } from 'lucide-react';

interface SuperSetProps {
    // No props needed
}

export const SuperSet: React.FC<SuperSetProps> = () => {
    const [players, setPlayers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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
                const today = new Date().toISOString().split('T')[0];
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
        // 6-x (diff >= 2)
        if ((scoreA === 6 && scoreB <= 4) || (scoreA === 7 && scoreB === 5)) return 'A';
        if ((scoreB === 6 && scoreA <= 4) || (scoreB === 7 && scoreA === 5)) return 'B';
        // Tiebreak
        if (scoreA === 7 && scoreB === 6) return 'A';
        if (scoreB === 7 && scoreA === 6) return 'B';

        return null;
    };

    const winner = getWinner();

    const handleSave = async () => {
        if (!winner || !playerAId || !playerBId) return;
        setSaving(true);

        try {
            const winnerId = winner === 'A' ? playerAId : playerBId;

            const { error } = await supabase.from('matches').insert({
                type: 'SuperSet',
                status: 'finished',
                date: new Date().toISOString(),
                player_a_id: playerAId,
                player_b_id: playerBId,
                score_a: [scoreA],
                score_b: [scoreB],
                winner_id: winnerId
            });

            if (error) throw error;

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
            .channel('superset-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches', filter: "type=eq.SuperSet" }, (payload) => {
                setHistory(prev => {
                    const newHistory = [payload.new, ...prev];
                    calculateStats(newHistory);
                    return newHistory;
                });
            })
            .subscribe();

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

    return (
        <div className="p-4 pb-24 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-saibro-900 flex items-center gap-2">
                        <Trophy className="text-yellow-500" /> SuperSet
                    </h2>
                    <p className="text-stone-500 text-sm">Vencedor ganha 10 pontos no Ranking!</p>
                </div>
            </div>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 flex items-center gap-3">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                        <Trophy size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-stone-500 font-bold uppercase">Total Jogos</p>
                        <p className="text-2xl font-black text-stone-800">{stats.totalGames}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 flex items-center gap-3">
                    <div className="p-3 bg-orange-50 text-orange-600 rounded-lg">
                        <CheckCircle size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-stone-500 font-bold uppercase">Maior Vencedor</p>
                        <p className="text-lg font-bold text-stone-800 leading-tight">
                            {players.length > 0 ? getPlayerName(stats.topWinner.name) : '-'}
                        </p>
                        <p className="text-xs text-stone-400">{stats.topWinner.count} vitórias</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-stone-100 overflow-hidden">
                {/* Player Selection */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-stone-50 border-b border-stone-100">
                    {/* Player A */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-saibro-600 uppercase">Atleta A</label>
                        <select
                            value={playerAId}
                            onChange={(e) => setPlayerAId(e.target.value)}
                            className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-300 outline-none text-lg font-medium"
                        >
                            <option value="">Selecione...</option>
                            {sortedPlayersList.filter(p => p.id !== playerBId).map(p => (
                                <option key={p.id} value={p.id}>
                                    {todayPlayers.includes(p.id) ? '🎾 ' : ''}{p.name}
                                </option>
                            ))}
                        </select>
                        {playerAId && (
                            <div className="flex items-center gap-3 mt-2">
                                <img src={players.find(p => p.id === playerAId)?.avatar || ''} className="w-12 h-12 rounded-full bg-stone-200 object-cover" />
                                <span className="font-bold text-stone-700">{players.find(p => p.id === playerAId)?.name}</span>
                            </div>
                        )}
                    </div>

                    {/* VS */}
                    <div className="flex justify-center md:rotate-0 rotate-90">
                        <span className="text-STONE-300 font-black text-2xl">VS</span>
                    </div>

                    {/* Player B */}
                    <div className="space-y-2 text-right">
                        <label className="text-xs font-bold text-saibro-600 uppercase w-full block">Atleta B</label>
                        <select
                            value={playerBId}
                            onChange={(e) => setPlayerBId(e.target.value)}
                            className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-300 outline-none text-lg font-medium text-right"
                            dir="rtl"
                        >
                            <option value="">Selecione...</option>
                            {sortedPlayersList.filter(p => p.id !== playerAId).map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name} {todayPlayers.includes(p.id) ? ' 🎾' : ''}
                                </option>
                            ))}
                        </select>
                        {playerBId && (
                            <div className="flex items-center gap-3 mt-2 justify-end">
                                <span className="font-bold text-stone-700">{players.find(p => p.id === playerBId)?.name}</span>
                                <img src={players.find(p => p.id === playerBId)?.avatar || ''} className="w-12 h-12 rounded-full bg-stone-200 object-cover" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Scoreboard */}
                {playerAId && playerBId && (
                    <div className="p-8 flex flex-col items-center gap-8">
                        <div className="flex items-center gap-12">
                            {/* Score A */}
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    onClick={() => setScoreA(s => Math.min(s + 1, 7))}
                                    className="w-16 h-16 rounded-full bg-saibro-100 text-saibro-600 flex items-center justify-center text-3xl font-bold hover:bg-saibro-200 transition-colors"
                                >+</button>
                                <span className="text-8xl font-black text-stone-800 tabular-nums leading-none">{scoreA}</span>
                                <button
                                    onClick={() => setScoreA(s => Math.max(s - 1, 0))}
                                    className="w-12 h-12 rounded-full bg-stone-100 text-stone-400 flex items-center justify-center text-xl font-bold hover:bg-stone-200 transition-colors"
                                >-</button>
                            </div>

                            <div className="h-32 w-px bg-stone-200"></div>

                            {/* Score B */}
                            <div className="flex flex-col items-center gap-2">
                                <button
                                    onClick={() => setScoreB(s => Math.min(s + 1, 7))}
                                    className="w-16 h-16 rounded-full bg-saibro-100 text-saibro-600 flex items-center justify-center text-3xl font-bold hover:bg-saibro-200 transition-colors"
                                >+</button>
                                <span className="text-8xl font-black text-stone-800 tabular-nums leading-none">{scoreB}</span>
                                <button
                                    onClick={() => setScoreB(s => Math.max(s - 1, 0))}
                                    className="w-12 h-12 rounded-full bg-stone-100 text-stone-400 flex items-center justify-center text-xl font-bold hover:bg-stone-200 transition-colors"
                                >-</button>
                            </div>
                        </div>

                        {/* Status Message */}
                        <div className="h-8 flex items-center justify-center">
                            {winner ? (
                                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-full font-bold animate-pulse">
                                    <CheckCircle size={20} />
                                    Vencedor: {winner === 'A' ? players.find(p => p.id === playerAId)?.name : players.find(p => p.id === playerBId)?.name}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-stone-400 bg-stone-50 px-4 py-2 rounded-full text-sm">
                                    <AlertCircle size={16} />
                                    Jogue até definir o vencedor (6-x, 7-5 ou 7-6)
                                </div>
                            )}
                        </div>

                        {/* Save Button */}
                        {winner && (
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full max-w-md py-4 bg-saibro-600 hover:bg-saibro-700 text-white rounded-xl font-bold text-xl shadow-lg shadow-saibro-200 hover:shadow-saibro-300 transition-all flex items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-4"
                            >
                                {saving ? 'Salvando...' : (
                                    <>
                                        <Save size={24} /> Confirmar SuperSet
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* History List */}
            <div className="space-y-4">
                <h3 className="font-bold text-stone-600 text-lg">Últimos Jogos</h3>
                {history.map((match) => {
                    const playerA = players.find(p => p.id === match.player_a_id);
                    const playerB = players.find(p => p.id === match.player_b_id);
                    const isWinnerA = match.winner_id === match.player_a_id;

                    return (
                        <div key={match.id} className="bg-white p-4 rounded-xl border border-stone-100 flex items-center justify-between">
                            <div className="flex items-center gap-4 flex-1">
                                {/* Player A */}
                                <div className={`flex items-center gap-2 flex-1 justify-end ${isWinnerA ? 'font-bold text-saibro-700' : 'text-stone-600'}`}>
                                    <span>{playerA?.name || '...'}</span>
                                    <img src={playerA?.avatar} className="w-8 h-8 rounded-full bg-stone-200" />
                                </div>

                                {/* Score */}
                                <div className="bg-stone-100 px-3 py-1 rounded-lg font-mono font-bold text-stone-800 text-sm">
                                    {match.score_a[0]} - {match.score_b[0]}
                                </div>

                                {/* Player B */}
                                <div className={`flex items-center gap-2 flex-1 ${!isWinnerA ? 'font-bold text-saibro-700' : 'text-stone-600'}`}>
                                    <img src={playerB?.avatar} className="w-8 h-8 rounded-full bg-stone-200" />
                                    <span>{playerB?.name || '...'}</span>
                                </div>
                            </div>
                            <div className="text-xs text-stone-400 ml-4 font-mono">
                                {new Date(match.date).toLocaleDateString()}
                            </div>
                        </div>
                    );
                })}
                {history.length === 0 && (
                    <p className="text-center text-stone-400 py-8 italic">Nenhum SuperSet registrado ainda. Seja o primeiro!</p>
                )}
            </div>
        </div>
    );
};
