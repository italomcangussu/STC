import React, { useState, useEffect, useRef } from 'react';
import { Trophy, Calendar, History, ListOrdered, GitMerge, ChevronDown, Loader2, Download, Share2, Users, Shirt } from 'lucide-react';
import { Championship, Match, User } from '../types';
import { getMatchWinner } from '../utils';
import { supabase } from '../lib/supabase';
import { LiveScoreboard } from './LiveScoreboard';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Interface for championship with participants
interface ChampionshipWithParticipants extends Omit<Championship, 'participantIds'> {
    participantIds: string[];
    registration_open?: boolean;
}

// Registration interface
interface Registration {
    id: string;
    championship_id: string;
    participant_type: 'socio' | 'guest';
    user_id: string | null;
    guest_name: string | null;
    class: string;
    shirt_size: string;
    created_at: string;
    user?: { name: string; avatar_url: string };
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

export const Championships: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    // Supabase States
    const [championships, setChampionships] = useState<ChampionshipWithParticipants[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    // Registration state
    const [registrationChamp, setRegistrationChamp] = useState<ChampionshipWithParticipants | null>(null);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const tableRef = useRef<HTMLDivElement>(null);

    const [selectedChampId, setSelectedChampId] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'jogos' | 'classificacao' | 'chaveamento' | 'proximos' | 'inscritos'>('proximos');
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);

    // Fetch data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // 1. Fetch championships (ongoing first, then others)
            const { data: champsData, error: champsError } = await supabase
                .from('championships')
                .select('*')
                .order('status', { ascending: true }); // ongoing comes before finished alphabetically

            if (champsError) {
                console.error('Error fetching championships:', champsError);
                setLoading(false);
                return;
            }

            // 2. Fetch participants for each championship
            const champsWithParticipants: ChampionshipWithParticipants[] = [];
            for (const champ of champsData || []) {
                const { data: participants } = await supabase
                    .from('championship_participants')
                    .select('user_id')
                    .eq('championship_id', champ.id);

                champsWithParticipants.push({
                    id: champ.id,
                    name: champ.name,
                    status: champ.status || 'draft',
                    format: champ.format,
                    startDate: champ.start_date,
                    endDate: champ.end_date,
                    ptsVictory: champ.pts_victory,
                    ptsSet: champ.pts_set,
                    ptsGame: champ.pts_game,
                    participantIds: (participants || []).map(p => p.user_id),
                    registration_open: champ.registration_open
                });
            }

            setChampionships(champsWithParticipants);

            // Check for championship with registration open first
            const regOpen = champsWithParticipants.find(c => c.registration_open === true);
            if (regOpen) {
                setRegistrationChamp(regOpen);
                setSelectedChampId(regOpen.id);
                setActiveTab('inscritos');

                // Fetch registrations
                const { data: regsData } = await supabase
                    .from('championship_registrations')
                    .select('*, user:profiles!user_id(name, avatar_url)')
                    .eq('championship_id', regOpen.id)
                    .order('class', { ascending: true });

                setRegistrations(regsData || []);
            } else {
                // Select first ongoing championship, or first available
                const ongoing = champsWithParticipants.filter(c => c.status === 'ongoing');
                if (ongoing.length > 0) {
                    setSelectedChampId(ongoing[0].id);
                } else if (champsWithParticipants.length > 0) {
                    setSelectedChampId(champsWithParticipants[0].id);
                }
            }

            // 3. Fetch all profiles for player lookup
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, category, role')
                .in('role', ['socio', 'admin'])
                .eq('is_active', true);

            setProfiles((profilesData || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                category: p.category,
                role: p.role,
                isActive: true
            } as User)));

            setLoading(false);
        };

        fetchData();
    }, []);

    // Fetch matches when championship changes
    useEffect(() => {
        if (!selectedChampId) return;

        const fetchMatches = async () => {
            const { data: matchesData, error: matchesError } = await supabase
                .from('matches')
                .select('*')
                .eq('championship_id', selectedChampId);

            if (matchesError) {
                console.error('Error fetching matches:', matchesError);
                return;
            }

            setMatches((matchesData || []).map(m => ({
                id: m.id,
                championshipId: m.championship_id,
                type: m.type || 'Campeonato',
                phase: m.phase,
                playerAId: m.player_a_id,
                playerBId: m.player_b_id,
                scoreA: m.score_a || [],
                scoreB: m.score_b || [],
                winnerId: m.winner_id,
                date: m.date,
                scheduledTime: m.scheduled_time,
                status: m.status || 'pending'
            })));
        };

        fetchMatches();
    }, [selectedChampId]);

    const ongoingChamps = championships.filter(c => c.status === 'ongoing');
    const selectedChamp = championships.find(c => c.id === selectedChampId);

    // Automatic tab selection based on format if current tab isn't applicable
    // This must be before early returns to maintain consistent hook order
    useEffect(() => {
        if (selectedChamp?.format === 'pontos-corridos' && activeTab === 'chaveamento') {
            setActiveTab('classificacao');
        } else if (selectedChamp?.format === 'mata-mata' && activeTab === 'classificacao') {
            setActiveTab('chaveamento');
        }
    }, [selectedChamp?.format, activeTab]);

    // Loading state
    if (loading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-center min-h-[50vh]">
                <Loader2 size={48} className="animate-spin text-saibro-600 mb-4" />
                <p className="text-stone-400">Carregando competições...</p>
            </div>
        );
    }

    if (!selectedChamp) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-center min-h-[50vh]">
                <Trophy size={64} className="text-saibro-200 mb-4" />
                <h2 className="text-xl font-bold text-stone-600">Sem competições ativas</h2>
                <p className="text-stone-400 mt-2">Aguarde o próximo campeonato!</p>
            </div>
        );
    }

    // RANKING CALCULATION (For Pontos Corridos)
    const calculateStandings = () => {
        const stats: Record<string, {
            id: string;
            name: string;
            pts: number;
            v: number;
            sets: number;
            games: number;
            avatar?: string;
            groupName?: string;
        }> = {};

        selectedChamp.participantIds.forEach(pId => {
            const u = profiles.find(user => user.id === pId);
            let gName = 'Geral';
            if (selectedChamp.groups) {
                const g = selectedChamp.groups.find(grp => grp.participantIds.includes(pId));
                if (g) gName = g.name;
            }
            stats[pId] = { id: pId, name: u?.name || 'TBD', pts: 0, v: 0, sets: 0, games: 0, avatar: u?.avatar, groupName: gName };
        });

        matches.filter(m => m.status === 'finished').forEach(m => {
            const sA = m.scoreA.reduce((a, b) => a + b, 0);
            const sB = m.scoreB.reduce((a, b) => a + b, 0);
            const setsA = m.scoreA.filter((s, i) => s > m.scoreB[i]).length;
            const setsB = m.scoreB.filter((s, i) => s > m.scoreA[i]).length;

            if (stats[m.playerAId]) {
                stats[m.playerAId].games += sA;
                stats[m.playerAId].sets += setsA;
                if (m.winnerId === m.playerAId) {
                    stats[m.playerAId].v += 1;
                    stats[m.playerAId].pts += (selectedChamp.ptsVictory || 0);
                }
                stats[m.playerAId].pts += (setsA * (selectedChamp.ptsSet || 0)) + (sA * (selectedChamp.ptsGame || 0));
            }

            if (stats[m.playerBId]) {
                stats[m.playerBId].games += sB;
                stats[m.playerBId].sets += setsB;
                if (m.winnerId === m.playerBId) {
                    stats[m.playerBId].v += 1;
                    stats[m.playerBId].pts += (selectedChamp.ptsVictory || 0);
                }
                stats[m.playerBId].pts += (setsB * (selectedChamp.ptsSet || 0)) + (sB * (selectedChamp.ptsGame || 0));
            }
        });

        return Object.values(stats).sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            // Simplified Tiebreaker: Head-to-head would go here
            if (b.v !== a.v) return b.v - a.v; // Number of wins (often proxy for H2H in round robin if unique winners)
            if (b.sets !== a.sets) return b.sets - a.sets;
            return b.games - a.games;
        });
    };

    const handleSaveResult = async (matchId: string, scoreA: number[], scoreB: number[]) => {
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        const winner = getMatchWinner(scoreA, scoreB);
        if (!winner) return; // Invalid match, don't save

        const winnerId = winner === 'A' ? match.playerAId : match.playerBId;

        // Update match in Supabase
        const { error } = await supabase
            .from('matches')
            .update({
                score_a: scoreA,
                score_b: scoreB,
                winner_id: winnerId,
                status: 'finished',
                date: new Date().toISOString().split('T')[0]
            })
            .eq('id', matchId);

        if (error) {
            console.error('Error saving result:', error);
            alert('Erro ao salvar resultado. Tente novamente.');
            return;
        }

        // Update local state
        setMatches(prev => prev.map(m =>
            m.id === matchId
                ? { ...m, scoreA, scoreB, winnerId, status: 'finished' as const, date: new Date().toISOString().split('T')[0] }
                : m
        ));

        // If it's mata-mata, we might need to update the next round
        if (selectedChamp.format === 'mata-mata' && match.phase) {
            const currentPhase = match.phase;
            const nextPhase = currentPhase === 'Oitavas' ? 'Quartas' : currentPhase === 'Quartas' ? 'Semi' : currentPhase === 'Semi' ? 'Final' : null;

            if (nextPhase) {
                // Find next match waiting for opponents
                const nextMatch = matches.find(m =>
                    m.championshipId === selectedChamp.id &&
                    m.phase === nextPhase &&
                    (!m.playerAId || !m.playerBId)
                );

                if (nextMatch) {
                    const updateField = !nextMatch.playerAId ? 'player_a_id' : 'player_b_id';
                    await supabase
                        .from('matches')
                        .update({ [updateField]: winnerId })
                        .eq('id', nextMatch.id);
                }
            }
        }

        setEditingMatch(null);
    };

    const standings = calculateStandings();

    // Helper functions for registrations
    const getRegistrationsByClass = (className: string) => {
        return registrations.filter(r => r.class === className);
    };

    const getParticipantName = (reg: Registration) => {
        if (reg.participant_type === 'guest') return reg.guest_name || 'Convidado';
        return reg.user?.name || 'Sócio';
    };

    // PDF Export
    const handleExportPDF = async () => {
        if (!tableRef.current || !registrationChamp) return;

        const canvas = await html2canvas(tableRef.current, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 190;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        pdf.setFontSize(18);
        pdf.text(registrationChamp.name, 105, 15, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text('Lista de Inscritos', 105, 22, { align: 'center' });

        pdf.addImage(imgData, 'PNG', 10, 30, imgWidth, imgHeight);
        pdf.save(`${registrationChamp.name}-inscritos.pdf`);
    };

    // WhatsApp Share
    const handleShareWhatsApp = () => {
        if (!registrationChamp) return;

        let message = `🏆 *${registrationChamp.name}*\n📝 Lista de Inscritos\n\n`;

        CLASSES.forEach(cls => {
            const classRegs = getRegistrationsByClass(cls);
            if (classRegs.length > 0) {
                message += `*${cls}* (${classRegs.length})\n`;
                classRegs.forEach((reg, i) => {
                    const name = getParticipantName(reg);
                    const type = reg.participant_type === 'guest' ? '🎫' : '✅';
                    message += `${i + 1}. ${type} ${name} - ${reg.shirt_size}\n`;
                });
                message += '\n';
            }
        });

        message += `📊 Total: ${registrations.length} inscritos`;

        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    // If there's a championship in registration period, show that view
    if (registrationChamp) {
        return (
            <div className="p-4 space-y-6 pb-24">
                {/* Header */}
                <div className="bg-gradient-to-br from-saibro-600 to-saibro-500 p-6 rounded-3xl shadow-xl text-white relative overflow-hidden">
                    <div className="absolute right-[-10px] top-[-10px] opacity-10 rotate-12">
                        <Trophy size={160} />
                    </div>
                    <div className="relative z-10">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full animate-pulse">
                            📝 Inscrições Abertas
                        </span>
                        <h1 className="text-2xl font-black mt-2">{registrationChamp.name}</h1>
                        <p className="text-saibro-100 text-sm mt-1">
                            <Users size={14} className="inline mr-1" />
                            {registrations.length} inscritos
                        </p>
                    </div>
                </div>

                {/* Export Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={handleExportPDF}
                        className="flex-1 py-3 bg-white border border-stone-200 rounded-xl font-bold text-sm text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-2 shadow-sm"
                    >
                        <Download size={18} />
                        Exportar PDF
                    </button>
                    <button
                        onClick={handleShareWhatsApp}
                        className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold text-sm hover:bg-green-600 flex items-center justify-center gap-2 shadow-sm"
                    >
                        <Share2 size={18} />
                        WhatsApp
                    </button>
                </div>

                {/* Registrations Table */}
                <div ref={tableRef} className="space-y-4">
                    {CLASSES.map(cls => {
                        const classRegs = getRegistrationsByClass(cls);
                        if (classRegs.length === 0) return null;

                        return (
                            <div key={cls} className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
                                <div className="bg-saibro-50 px-4 py-3 flex justify-between items-center border-b border-saibro-100">
                                    <h3 className="font-bold text-saibro-800">{cls}</h3>
                                    <span className="text-xs font-bold text-saibro-600 bg-saibro-100 px-2 py-1 rounded-full">
                                        {classRegs.length} inscritos
                                    </span>
                                </div>
                                <div className="divide-y divide-stone-50">
                                    {classRegs.map((reg, idx) => (
                                        <div key={reg.id} className="flex items-center justify-between px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-bold text-stone-400 w-6">{idx + 1}</span>
                                                <div>
                                                    <p className="font-semibold text-stone-800 text-sm">
                                                        {getParticipantName(reg)}
                                                    </p>
                                                    <p className="text-[10px] text-stone-400 uppercase">
                                                        {reg.participant_type === 'guest' ? '🎫 Convidado' : '✅ Sócio'}
                                                        {' • '} <Shirt size={10} className="inline" /> {reg.shirt_size}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Empty State */}
                {registrations.length === 0 && (
                    <div className="text-center py-12">
                        <Users size={48} className="mx-auto text-stone-200 mb-4" />
                        <p className="text-stone-400">Nenhuma inscrição ainda</p>
                        <p className="text-stone-300 text-sm mt-1">As inscrições começarão em breve!</p>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="p-4 space-y-6 pb-24">
            {/* 1. HEADER PREMIUM */}
            <div className="bg-gradient-to-br from-saibro-600 to-saibro-500 p-6 rounded-3xl shadow-xl text-white relative overflow-hidden">
                {/* Decorative Trophy Icon */}
                <div className="absolute right-[-10px] top-[-10px] opacity-10 rotate-12">
                    <Trophy size={160} />
                </div>

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full border border-white/30">
                            Em andamento
                        </span>
                        {ongoingChamps.length > 1 && (
                            <div className="relative group">
                                <button className="flex items-center gap-1 text-[10px] font-bold bg-stone-900/20 px-2 py-0.5 rounded-full hover:bg-stone-900/40 transition-all">
                                    Trocar <ChevronDown size={12} />
                                </button>
                                <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-stone-100 hidden group-hover:block transition-all z-50">
                                    {ongoingChamps.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => setSelectedChampId(c.id)}
                                            className="w-full text-left px-4 py-3 text-xs font-bold text-stone-700 hover:bg-saibro-50 first:rounded-t-xl last:rounded-b-xl transition-colors"
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <h2 className="text-2xl font-black italic uppercase tracking-tight ">{selectedChamp.name}</h2>
                    <p className="text-saibro-50 text-xs font-medium flex items-center gap-1.5 mt-2 opacity-90">
                        <Calendar size={14} />
                        {selectedChamp.endDate ? `Finais em ${new Date(selectedChamp.endDate).toLocaleDateString('pt-BR')}` : 'Finais em breve'}
                    </p>
                </div>
            </div>

            {/* 2. TABS */}
            <div className="flex bg-white p-1 rounded-2xl shadow-sm border border-stone-100 overflow-x-auto scrollbar-hide">
                <button
                    onClick={() => setActiveTab('proximos')}
                    className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${activeTab === 'proximos' ? 'bg-saibro-500 text-white shadow-md' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    <Calendar size={16} /> Próximos
                </button>
                <button
                    onClick={() => setActiveTab('jogos')}
                    className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${activeTab === 'jogos' ? 'bg-saibro-500 text-white shadow-md' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    <History size={16} /> Últimos Jogos
                </button>
                {selectedChamp.format === 'pontos-corridos' && (
                    <button
                        onClick={() => setActiveTab('classificacao')}
                        className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${activeTab === 'classificacao' ? 'bg-saibro-500 text-white shadow-md' : 'text-stone-400 hover:text-stone-600'}`}
                    >
                        <ListOrdered size={16} /> Classificação
                    </button>
                )}
                {selectedChamp.format === 'mata-mata' && (
                    <button
                        onClick={() => setActiveTab('chaveamento')}
                        className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${activeTab === 'chaveamento' ? 'bg-saibro-500 text-white shadow-md' : 'text-stone-400 hover:text-stone-600'}`}
                    >
                        <GitMerge size={16} /> Chaveamento
                    </button>
                )}
            </div>

            {/* 3. TAB CONTENT */}
            <div className="space-y-4 animate-in fade-in duration-500">
                {activeTab === 'proximos' && (() => {
                    const today = new Date().toISOString().split('T')[0];
                    const pendingMatches = matches.filter(m => m.status === 'pending' || m.status === 'waiting_opponents');
                    const todayMatches = pendingMatches.filter(m => m.date === today);
                    const futureMatches = pendingMatches.filter(m => m.date !== today);

                    const handleScoreSaved = async () => {
                        // Refresh matches from Supabase
                        const { data: matchesData } = await supabase
                            .from('matches')
                            .select('*')
                            .eq('championship_id', selectedChampId);

                        if (matchesData) {
                            setMatches(matchesData.map(m => ({
                                id: m.id,
                                championshipId: m.championship_id,
                                type: m.type || 'Campeonato',
                                phase: m.phase,
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
                    };

                    return (
                        <div className="space-y-4">
                            {/* Today's Matches with Live Scoreboard */}
                            {todayMatches.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-xs font-black text-saibro-600 uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        Jogos de Hoje
                                    </h3>
                                    {todayMatches.map(match => (
                                        <LiveScoreboard
                                            key={match.id}
                                            match={match}
                                            profiles={profiles}
                                            currentUser={currentUser}
                                            onScoreSaved={handleScoreSaved}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Future Matches */}
                            {futureMatches.length > 0 && (
                                <div className="space-y-3">
                                    {todayMatches.length > 0 && (
                                        <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mt-6">
                                            Próximos Jogos
                                        </h3>
                                    )}
                                    {futureMatches.map(match => (
                                        <MatchCard key={match.id} match={match} profiles={profiles} onEdit={() => currentUser.role === 'admin' && setEditingMatch(match)} isAdmin={currentUser.role === 'admin'} />
                                    ))}
                                </div>
                            )}

                            {/* Empty state */}
                            {pendingMatches.length === 0 && (
                                <div className="py-20 text-center space-y-4">
                                    <div className="inline-block p-4 bg-stone-50 rounded-full text-stone-300">
                                        <Calendar size={48} />
                                    </div>
                                    <p className="text-stone-400 font-medium italic">Não há jogos agendados no momento.</p>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {activeTab === 'jogos' && (
                    <div className="space-y-3">
                        {matches.filter(m => m.status === 'finished').length === 0 ? (
                            <div className="py-20 text-center space-y-4">
                                <div className="inline-block p-4 bg-stone-50 rounded-full text-stone-300">
                                    <History size={48} />
                                </div>
                                <p className="text-stone-400 font-medium italic">Ainda não há jogos finalizados neste campeonato.</p>
                            </div>
                        ) : (
                            matches.filter(m => m.status === 'finished').sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(match => (
                                <MatchCard key={match.id} match={match} profiles={profiles} onEdit={() => currentUser.role === 'admin' && setEditingMatch(match)} isAdmin={currentUser.role === 'admin'} />
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'classificacao' && (
                    <div className="space-y-6">
                        {selectedChamp.format === 'grupo-mata-mata' && selectedChamp.groups ? (
                            selectedChamp.groups.map(group => {
                                const groupStats = standings.filter(s => s.groupName === group.name);
                                return (
                                    <div key={group.name} className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
                                        <div className="bg-saibro-50 px-4 py-2 border-b border-saibro-100">
                                            <h4 className="text-saibro-800 font-bold text-sm uppercase">{group.name}</h4>
                                        </div>
                                        <div className="bg-stone-50 px-4 py-2 grid grid-cols-[30px_1fr_40px_40px_40px] gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest border-b border-stone-100">
                                            <span>#</span>
                                            <span>Atleta</span>
                                            <span className="text-center">Pts</span>
                                            <span className="text-center">V</span>
                                            <span className="text-center">G</span>
                                        </div>
                                        <div className="divide-y divide-stone-50">
                                            {groupStats.map((stat, idx) => (
                                                <div key={stat.id} className={`grid grid-cols-[30px_1fr_40px_40px_40px] gap-2 items-center px-4 py-3 text-sm ${idx < 2 ? 'bg-green-50/50' : ''}`}>
                                                    <span className={`font-black ${idx < 2 ? 'text-green-600' : 'text-stone-400'}`}>{idx + 1}</span>
                                                    <div className="flex items-center gap-2">
                                                        <img src={stat.avatar} className="w-6 h-6 rounded-full bg-stone-100" />
                                                        <span className="font-bold text-stone-700 truncate">{stat.name}</span>
                                                    </div>
                                                    <span className="font-black text-saibro-700 text-center">{stat.pts}</span>
                                                    <span className="font-bold text-stone-500 text-center">{stat.v}</span>
                                                    <span className="text-stone-400 text-center text-xs">{stat.games}</span>
                                                </div>
                                            ))}
                                            {groupStats.length === 0 && <p className="p-4 text-center text-xs text-stone-400">Nenhum jogador</p>}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
                                <div className="bg-stone-50 px-4 py-3 grid grid-cols-[30px_1fr_40px_40px_40px] gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest border-b border-stone-100">
                                    <span>#</span>
                                    <span>Atleta</span>
                                    <span className="text-center">Pts</span>
                                    <span className="text-center">V</span>
                                    <span className="text-center">G</span>
                                </div>
                                <div className="divide-y divide-stone-50">
                                    {standings.map((stat, idx) => (
                                        <div key={stat.id} className={`grid grid-cols-[30px_1fr_40px_40px_40px] gap-2 items-center px-4 py-4 text-sm ${idx < 4 ? 'bg-saibro-50/30' : ''}`}>
                                            <span className={`font-black ${idx === 0 ? 'text-saibro-600' : 'text-stone-400'}`}>{idx + 1}</span>
                                            <div className="flex items-center gap-2">
                                                <img src={stat.avatar} className="w-6 h-6 rounded-full bg-stone-100" />
                                                <span className="font-bold text-stone-700 truncate">{stat.name}</span>
                                            </div>
                                            <span className="font-black text-saibro-700 text-center">{stat.pts}</span>
                                            <span className="font-bold text-stone-500 text-center">{stat.v}</span>
                                            <span className="text-stone-400 text-center text-xs">{stat.games}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'chaveamento' && (
                    <div className="space-y-8 pb-10">
                        {['Oitavas', 'Quartas', 'Semi', 'Final'].map(phase => {
                            const phaseMatches = matches.filter(m => m.phase === phase);
                            if (phaseMatches.length === 0) return null;

                            return (
                                <div key={phase} className="space-y-4">
                                    <h4 className="text-[10px] font-black text-saibro-600 uppercase tracking-widest ml-1 border-l-2 border-saibro-500 pl-2">
                                        {phase}
                                    </h4>
                                    <div className="space-y-3">
                                        {phaseMatches.map(match => (
                                            <BracketMatchCard key={match.id} match={match} profiles={profiles} onEdit={() => setEditingMatch(match)} isAdmin={currentUser.role === 'admin'} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 4. MODAL EDIT RESULT */}
            {editingMatch && (
                <ResultModal
                    match={editingMatch}
                    profiles={profiles}
                    onClose={() => setEditingMatch(null)}
                    onSave={(sA, sB) => handleSaveResult(editingMatch.id, sA, sB)}
                />
            )}
        </div>
    );
};

export const ResultModal: React.FC<{ match: Match; profiles: User[]; onClose: () => void; onSave: (sA: number[], sB: number[]) => void }> = ({ match, profiles, onClose, onSave }) => {
    const pA = profiles.find(u => u.id === match.playerAId);
    const pB = profiles.find(u => u.id === match.playerBId);

    // Initialize with 3 sets (we'll show/hide the 3rd based on need)
    const [scoreA, setScoreA] = useState<number[]>(
        match.scoreA.length > 0 ? [...match.scoreA, ...(match.scoreA.length < 3 ? [0] : [])] : [0, 0, 0]
    );
    const [scoreB, setScoreB] = useState<number[]>(
        match.scoreB.length > 0 ? [...match.scoreB, ...(match.scoreB.length < 3 ? [0] : [])] : [0, 0, 0]
    );

    const updateScore = (player: 'A' | 'B', index: number, val: string) => {
        const n = Math.max(0, Math.min(7, parseInt(val) || 0)); // Clamp 0-7
        if (player === 'A') {
            const newScore = [...scoreA];
            newScore[index] = n;
            setScoreA(newScore);
        } else {
            const newScore = [...scoreB];
            newScore[index] = n;
            setScoreB(newScore);
        }
    };

    // Import validation functions
    const isValidSetLocal = (gA: number, gB: number) => {
        const winner = Math.max(gA, gB);
        const loser = Math.min(gA, gB);
        if (winner === 6 && loser <= 4) return true;
        if (winner === 7 && loser === 5) return true;
        if (winner === 7 && loser === 6) return true;
        return false;
    };

    const getSetWinnerLocal = (gA: number, gB: number): 'A' | 'B' | null => {
        if (!isValidSetLocal(gA, gB)) return null;
        if (gA > gB) return 'A';
        if (gB > gA) return 'B';
        return null;
    };

    // Calculate current state
    const set1Valid = isValidSetLocal(scoreA[0], scoreB[0]);
    const set2Valid = isValidSetLocal(scoreA[1], scoreB[1]);
    const set1Winner = getSetWinnerLocal(scoreA[0], scoreB[0]);
    const set2Winner = getSetWinnerLocal(scoreA[1], scoreB[1]);

    // Need 3rd set if 1-1
    const setsWonA = (set1Winner === 'A' ? 1 : 0) + (set2Winner === 'A' ? 1 : 0);
    const setsWonB = (set1Winner === 'B' ? 1 : 0) + (set2Winner === 'B' ? 1 : 0);
    const showThirdSet = setsWonA === 1 && setsWonB === 1;

    const set3Valid = showThirdSet ? isValidSetLocal(scoreA[2], scoreB[2]) : true;
    const set3Winner = showThirdSet ? getSetWinnerLocal(scoreA[2], scoreB[2]) : null;

    // Calculate match winner
    let matchWinner: 'A' | 'B' | null = null;
    if (setsWonA >= 2) matchWinner = 'A';
    else if (setsWonB >= 2) matchWinner = 'B';
    else if (showThirdSet && set3Winner) matchWinner = set3Winner;

    const canSave = matchWinner !== null;

    const handleSave = () => {
        if (!canSave) return;
        // Only include played sets
        const finalScoreA = showThirdSet ? scoreA : scoreA.slice(0, 2);
        const finalScoreB = showThirdSet ? scoreB : scoreB.slice(0, 2);
        onSave(finalScoreA, finalScoreB);
    };

    const getInputBorderClass = (isValid: boolean, playerWon: boolean) => {
        if (!isValid && (scoreA[0] > 0 || scoreB[0] > 0)) {
            return 'border-red-300 bg-red-50';
        }
        if (isValid && playerWon) {
            return 'border-green-400 bg-green-50';
        }
        return 'border-stone-200';
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 bg-saibro-600 text-white flex justify-between items-center">
                    <h3 className="text-xl font-bold">Lançar Resultado</h3>
                    <button onClick={onClose}><ChevronDown size={24} className="rotate-180" /></button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                        <div className="text-center space-y-2">
                            <div className={`relative ${matchWinner === 'A' ? 'ring-2 ring-green-400 ring-offset-2' : ''} rounded-full inline-block`}>
                                <img src={pA?.avatar} className="w-16 h-16 rounded-full border-2 border-saibro-100" />
                            </div>
                            <p className="text-sm font-bold text-stone-800">{pA?.name}</p>
                            {matchWinner === 'A' && <span className="text-xs font-bold text-green-600">🏆 Vencedor</span>}
                        </div>
                        <div className="text-stone-300 font-black italic">VS</div>
                        <div className="text-center space-y-2">
                            <div className={`relative ${matchWinner === 'B' ? 'ring-2 ring-green-400 ring-offset-2' : ''} rounded-full inline-block`}>
                                <img src={pB?.avatar} className="w-16 h-16 rounded-full border-2 border-stone-100" />
                            </div>
                            <p className="text-sm font-bold text-stone-800">{pB?.name}</p>
                            {matchWinner === 'B' && <span className="text-xs font-bold text-green-600">🏆 Vencedor</span>}
                        </div>
                    </div>

                    <div className="space-y-3">
                        {[0, 1, 2].map(setIdx => {
                            // Hide 3rd set if not needed
                            if (setIdx === 2 && !showThirdSet) return null;

                            const setValid = setIdx === 0 ? set1Valid : setIdx === 1 ? set2Valid : set3Valid;
                            const setWinner = setIdx === 0 ? set1Winner : setIdx === 1 ? set2Winner : set3Winner;

                            return (
                                <div key={setIdx} className={`flex items-center justify-between p-4 rounded-2xl border transition-colors ${setValid ? 'bg-stone-50 border-stone-100' : 'bg-red-50 border-red-200'}`}>
                                    <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">{setIdx + 1}º Set</span>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            value={scoreA[setIdx]}
                                            onChange={(e) => updateScore('A', setIdx, e.target.value)}
                                            className={`w-12 h-12 text-center text-xl font-black bg-white rounded-xl border-2 focus:border-saibro-500 outline-none transition-colors ${getInputBorderClass(setValid, setWinner === 'A')}`}
                                            min={0}
                                            max={7}
                                        />
                                        <span className="text-stone-300 font-black">x</span>
                                        <input
                                            type="number"
                                            value={scoreB[setIdx]}
                                            onChange={(e) => updateScore('B', setIdx, e.target.value)}
                                            className={`w-12 h-12 text-center text-xl font-black bg-white rounded-xl border-2 focus:border-saibro-500 outline-none transition-colors ${getInputBorderClass(setValid, setWinner === 'B')}`}
                                            min={0}
                                            max={7}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {!canSave && (scoreA[0] > 0 || scoreB[0] > 0) && (
                        <p className="text-xs text-red-500 text-center font-medium">
                            {!set1Valid || !set2Valid ? 'Placar de set inválido (ex: 6-4, 7-5, 7-6)' : 'Complete o 3º set para definir o vencedor'}
                        </p>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className={`w-full py-4 font-bold rounded-2xl shadow-lg transition-all ${canSave ? 'bg-saibro-600 text-white hover:bg-saibro-700 shadow-orange-100' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}
                    >
                        Confirmar Resultado
                    </button>
                </div>
            </div>
        </div>
    );
}

const MatchCard: React.FC<{ match: Match; profiles: User[]; isAdmin?: boolean; onEdit?: () => void }> = ({ match, profiles, isAdmin, onEdit }) => {
    const pA = profiles.find(u => u.id === match.playerAId);
    const pB = profiles.find(u => u.id === match.playerBId);
    const totalGA = match.scoreA.reduce((a, b) => a + b, 0);
    const totalGB = match.scoreB.reduce((a, b) => a + b, 0);

    return (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 relative group transition-all hover:border-saibro-200">
            <div className="absolute top-[-8px] right-4 bg-stone-100 px-2 py-0.5 rounded-full text-[9px] font-black text-stone-400 uppercase tracking-tighter">
                {match.phase || 'Pontos Corridos'}
            </div>

            <div className="flex items-center justify-between gap-4">
                {/* Player A */}
                <div className="flex-1 flex flex-col items-center gap-2">
                    <img src={pA?.avatar} className={`w-12 h-12 rounded-full border-2 ${match.winnerId === match.playerAId ? 'border-saibro-500 shadow-lg shadow-orange-100' : 'border-stone-100'}`} />
                    <span className="text-xs font-bold text-stone-800 text-center truncate w-full">{pA?.name || 'TBD'}</span>
                </div>

                {/* Score */}
                <div className="flex flex-col items-center">
                    {match.status === 'finished' ? (
                        <>
                            <div className="flex gap-1.5 items-center mb-1">
                                <span className={`text-2xl font-black italic ${match.winnerId === match.playerAId ? 'text-saibro-600' : 'text-stone-300'}`}>{match.winnerId === match.playerAId ? 2 : match.winnerId === match.playerBId ? 1 : 0}</span>
                                <span className="text-stone-300 font-black self-center mt-1">/</span>
                                <span className={`text-2xl font-black italic ${match.winnerId === match.playerBId ? 'text-saibro-600' : 'text-stone-300'}`}>{match.winnerId === match.playerBId ? 2 : match.winnerId === match.playerAId ? 1 : 0}</span>
                            </div>
                            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{totalGA} - {totalGB} Games</div>
                        </>
                    ) : (
                        <div className="text-center">
                            <div className="text-stone-200 font-black italic text-xl mb-1">VS</div>
                            {isAdmin && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
                                    className="text-[9px] font-black text-saibro-600 uppercase border border-saibro-200 px-2 py-0.5 rounded-lg hover:bg-saibro-50"
                                >
                                    Lançar
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Player B */}
                <div className="flex-1 flex flex-col items-center gap-2">
                    <img src={pB?.avatar} className={`w-12 h-12 rounded-full border-2 ${match.winnerId === match.playerBId ? 'border-saibro-500 shadow-lg shadow-orange-100' : 'border-stone-100'}`} />
                    <span className="text-xs font-bold text-stone-800 text-center truncate w-full">{pB?.name || 'TBD'}</span>
                </div>
            </div>
        </div>
    );
};

const BracketMatchCard: React.FC<{ match: Match; profiles: User[]; isAdmin?: boolean; onEdit?: () => void }> = ({ match, profiles, isAdmin, onEdit }) => {
    const pA = profiles.find(u => u.id === match.playerAId);
    const pB = profiles.find(u => u.id === match.playerBId);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden transition-all hover:border-saibro-300 relative">
            {match.status === 'pending' && isAdmin && (
                <button
                    onClick={onEdit}
                    className="absolute z-10 top-1 right-1 p-1 bg-saibro-100 text-saibro-600 rounded-lg hover:bg-saibro-200"
                >
                    <Trophy size={14} />
                </button>
            )}

            {/* Player A */}
            <div className={`flex justify-between items-center p-3 border-b border-stone-100 ${match.winnerId === match.playerAId ? 'bg-saibro-50/50' : ''}`}>
                <div className="flex items-center gap-2 flex-1">
                    <img src={pA?.avatar || 'https://via.placeholder.com/40'} className={`w-7 h-7 rounded-full bg-stone-100 border-2 ${match.winnerId === match.playerAId ? 'border-saibro-500' : 'border-transparent'}`} />
                    <span className={`text-sm font-bold truncate ${match.winnerId === match.playerAId ? 'text-saibro-700' : 'text-stone-600'}`}>
                        {pA?.name || 'Vencedor Mxx'}
                    </span>
                </div>
                <div className="flex gap-1 ml-4">
                    {match.scoreA.length > 0 ? match.scoreA.map((s, i) => (
                        <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.scoreA[i] > match.scoreB[i] ? 'bg-saibro-600 text-white' : 'bg-stone-50 text-stone-400'}`}>
                            {s}
                        </span>
                    )) : [1, 2].map(i => <span key={i} className="w-7 h-7 flex items-center justify-center bg-stone-50 rounded-lg text-xs text-stone-300">-</span>)}
                </div>
            </div>
            {/* Player B */}
            <div className={`flex justify-between items-center p-3 ${match.winnerId === match.playerBId ? 'bg-saibro-50/50' : ''}`}>
                <div className="flex items-center gap-2 flex-1">
                    <img src={pB?.avatar || 'https://via.placeholder.com/40'} className={`w-7 h-7 rounded-full bg-stone-100 border-2 ${match.winnerId === match.playerBId ? 'border-saibro-500' : 'border-transparent'}`} />
                    <span className={`text-sm font-bold truncate ${match.winnerId === match.playerBId ? 'text-saibro-700' : 'text-stone-600'}`}>
                        {pB?.name || 'Vencedor Myy'}
                    </span>
                </div>
                <div className="flex gap-1 ml-4">
                    {match.scoreB.length > 0 ? match.scoreB.map((s, i) => (
                        <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.scoreB[i] > match.scoreA[i] ? 'bg-saibro-600 text-white' : 'bg-stone-50 text-stone-400'}`}>
                            {s}
                        </span>
                    )) : [1, 2].map(i => <span key={i} className="w-7 h-7 flex items-center justify-center bg-stone-50 rounded-lg text-xs text-stone-300">-</span>)}
                </div>
            </div>
        </div>
    );
};