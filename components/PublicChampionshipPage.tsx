import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship, ChampionshipGroup, ChampionshipRound, Match, ChampionshipRegistration } from '../types';
import { Trophy, Calendar, Filter, Share2, Loader2, Search, ChevronLeft, ChevronRight, Clock, MapPin, Info, ListOrdered, ChevronDown } from 'lucide-react';
import { GroupStandingsCard } from './GroupStandingsCard';
import { LiveScoreboard } from './LiveScoreboard';
import { calculateGroupStandings } from '../lib/championshipUtils';
import { formatDateBr } from '../utils';

interface Props {
    slug: string; // The URL slug
}

export const PublicChampionshipPage: React.FC<Props> = ({ slug }) => {
    const [championship, setChampionship] = useState<Championship | null>(null);
    const [rounds, setRounds] = useState<ChampionshipRound[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [registrations, setRegistrations] = useState<ChampionshipRegistration[]>([]);
    const [groups, setGroups] = useState<ChampionshipGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'matches' | 'standings'>('matches');
    const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);

    // For LiveScore modal
    const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);

    useEffect(() => {
        fetchData();
    }, [slug]);

    const fetchData = async () => {
        setLoading(true);

        // 1. Get Championship by Slug
        const { data: champ, error } = await supabase
            .from('championships')
            .select('*')
            .eq('slug', slug)
            .maybeSingle();

        if (error || !champ) {
            setLoading(false);
            return;
        }

        setChampionship(champ);

        // 2. Get Rounds
        const { data: rnds } = await supabase
            .from('championship_rounds')
            .select('*')
            .eq('championship_id', champ.id)
            .order('round_number');

        const mappedRnds = rnds || [];
        setRounds(mappedRnds);

        // Set current round (active or first)
        const activeIdx = mappedRnds.findIndex(r => r.status === 'active');
        setSelectedRoundIndex(activeIdx !== -1 ? activeIdx : 0);

        // 3. Get Registrations (for names)
        const { data: regs } = await supabase
            .from('championship_registrations')
            .select('*, user:profiles!user_id(name, avatar_url)')
            .eq('championship_id', champ.id);
        setRegistrations(regs || []);

        // 4. Get Matches
        const { data: mtchs } = await supabase
            .from('matches')
            .select('*')
            .in('round_id', mappedRnds.map(r => r.id));
        setMatches(mtchs || []);

        // Set default class if available
        if (regs && regs.length > 0) {
            // Find first available class
            const classes = Array.from(new Set(regs.map((r: any) => r.class))).sort();
            if (classes.length > 0) setSelectedClass(classes[0]);
        }

        // 5. Get Groups
        const { data: grps } = await supabase
            .from('championship_groups')
            .select(`*, members:championship_group_members(*)`)
            .eq('championship_id', champ.id);
        setGroups(grps || []);

        setLoading(false);
    };

    const getPlayerName = (regId?: string) => {
        if (!regId) return 'TBA';
        const reg = registrations.find(r => r.id === regId);
        if (!reg) return 'Desconhecido';
        if (reg.participant_type === 'guest') return reg.guest_name;
        return reg.user?.name || 'Sócio';
    };

    const getPlayerAvatar = (regId?: string) => {
        const reg = registrations.find(r => r.id === regId);
        return reg?.user?.avatar_url;
    }

    const filteredMatches = matches.filter(m => {
        if (!selectedClass) return true;
        // Filter by joining with registration class
        // We need to know which group/class this match belongs to.
        // Match has championship_group_id. 
        // We can interpret class from registration_a_id -> registration -> class
        const regA = registrations.find(r => r.id === m.registration_a_id);
        return regA?.class === selectedClass;
    });

    const uniqueClasses = Array.from(new Set(registrations.map(r => r.class))).sort();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-stone-900">
                <Loader2 className="animate-spin text-saibro-500" size={48} />
            </div>
        );
    }

    if (!championship) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-stone-900 text-white">
                <div className="text-center">
                    <Trophy size={64} className="mx-auto text-stone-700 mb-4" />
                    <h1 className="text-2xl font-bold">Campeonato não encontrado</h1>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 pb-20 font-sans selection:bg-saibro-100">
            {/* Header */}
            <div className="bg-stone-900 text-white pt-10 pb-16 px-6 relative overflow-hidden rounded-b-[3.5rem] shadow-2xl">
                <div className="absolute top-0 left-0 w-full h-full bg-linear-to-b from-saibro-600/30 to-transparent" />
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-saibro-500/10 rounded-full blur-3xl" />

                <div className="relative z-10 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-saibro-600 shadow-2xl shadow-saibro-900/40 transform -rotate-3 transition-transform hover:rotate-0">
                        <Trophy size={40} className="text-white drop-shadow-md" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight leading-none">{championship.name}</h1>
                        <p className="text-saibro-200 text-xs font-black uppercase tracking-[0.2em] mt-2 opacity-80">Ranking Oficial SCT</p>
                    </div>
                </div>
            </div>

            <div className="max-w-md mx-auto px-4 -mt-8 relative z-20 space-y-6">

                {/* Scheduling Dashboard (iPhone Premium Style) */}
                <div className="rounded-[2.5rem] p-6 shadow-xl shadow-stone-200/50 border border-stone-100 flex items-start gap-5 backdrop-blur-sm bg-white/90">
                    <div className="bg-saibro-100 p-4 rounded-3xl text-saibro-600 shadow-inner">
                        <Clock size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-black text-stone-900 uppercase tracking-tighter">Painel de Agendamento</h3>
                        <p className="text-[11px] text-stone-500 mt-1 leading-relaxed font-medium">
                            Marque seu jogo via WhatsApp e reserve sua quadra. Fique atento às regras de piso por categoria.
                        </p>
                        <div className="flex gap-2 mt-4 text-[9px] font-black uppercase tracking-widest">
                            <span className="bg-saibro-50 text-saibro-600 px-3 py-1.5 rounded-full border border-saibro-100">Saibro (4-5ª)</span>
                            <span className="bg-stone-900 text-white px-3 py-1.5 rounded-full shadow-lg">Rápida (6ª)</span>
                        </div>
                    </div>
                </div>

                {/* Class Filter Horizontal Scroll */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth pb-1 -mx-2 px-2">
                    {uniqueClasses.map(cls => (
                        <button
                            key={cls}
                            onClick={() => setSelectedClass(cls)}
                            className={`px-5 py-3 rounded-2xl text-xs font-black whitespace-nowrap transition-all duration-300 ${selectedClass === cls
                                ? 'bg-saibro-600 text-white shadow-xl shadow-saibro-100 scale-105'
                                : 'bg-white text-stone-400 hover:text-stone-600 border border-stone-100'
                                }`}
                        >
                            {cls}
                        </button>
                    ))}
                </div>

                {/* Main Navigation Tabs */}
                <div className="flex bg-stone-200/50 p-1.5 rounded-3xl backdrop-blur-md">
                    <button
                        onClick={() => setActiveTab('matches')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'matches' ? 'bg-white text-stone-900 shadow-lg' : 'text-stone-400'}`}
                    >
                        RODADAS
                    </button>
                    <button
                        onClick={() => setActiveTab('standings')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'standings' ? 'bg-white text-stone-900 shadow-lg' : 'text-stone-400'}`}
                    >
                        CLASSIFICAÇÃO
                    </button>
                </div>

                {activeTab === 'matches' ? (
                    <div className="space-y-6">
                        {/* Round Navigator (Floating Card Style) */}
                        {rounds.length > 0 && (
                            <div className="flex items-center justify-between bg-white p-4 rounded-[2.5rem] border border-stone-100 shadow-lg shadow-stone-200/40">
                                <button
                                    onClick={() => setSelectedRoundIndex(prev => Math.max(0, prev - 1))}
                                    className={`p-3 rounded-2xl transition-all ${selectedRoundIndex > 0 ? 'text-saibro-600 bg-saibro-50 active:scale-90 hover:bg-saibro-100 shadow-sm' : 'text-stone-200'}`}
                                    disabled={selectedRoundIndex === 0}
                                >
                                    <ChevronLeft size={24} />
                                </button>
                                <div className="text-center">
                                    <h3 className="font-black text-stone-900 text-sm tracking-tight">{rounds[selectedRoundIndex].name}</h3>
                                    <p className="text-[9px] font-black text-saibro-600 uppercase tracking-[0.2em] mt-1 space-x-1">
                                        <span>{formatDateBr(rounds[selectedRoundIndex].start_date)}</span>
                                        <span className="text-stone-300">/</span>
                                        <span>{formatDateBr(rounds[selectedRoundIndex].end_date)}</span>
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSelectedRoundIndex(prev => Math.min(rounds.length - 1, prev + 1))}
                                    className={`p-3 rounded-2xl transition-all ${selectedRoundIndex < rounds.length - 1 ? 'text-saibro-600 bg-saibro-50 active:scale-90 hover:bg-saibro-100 shadow-sm' : 'text-stone-200'}`}
                                    disabled={selectedRoundIndex === rounds.length - 1}
                                >
                                    <ChevronRight size={24} />
                                </button>
                            </div>
                        )}

                        <div className="space-y-4 pb-20">
                            {rounds[selectedRoundIndex] && matches.filter(m => m.round_id === rounds[selectedRoundIndex].id).filter(m => {
                                if (selectedClass) {
                                    const regA = registrations.find(r => r.id === m.registration_a_id);
                                    return regA?.class === selectedClass;
                                }
                                return true;
                            }).map(match => {
                                const regA = registrations.find(r => r.id === match.registration_a_id);
                                const regB = registrations.find(r => r.id === match.registration_b_id);
                                const nameA = regA?.user?.name || regA?.guest_name || '...';
                                const nameB = regB?.user?.name || regB?.guest_name || '...';
                                const avatarA = regA?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameA}&background=random`;
                                const avatarB = regB?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameB}&background=random`;
                                const isFinished = match.status === 'finished';

                                return (
                                    <div key={match.id} className="bg-white rounded-[2.5rem] p-7 shadow-sm border border-stone-100 relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-saibro-200 group">
                                        <div className="absolute top-0 left-0 bg-stone-50 px-4 py-1.5 rounded-br-3xl text-[9px] font-black text-stone-400 uppercase tracking-widest border-b border-r border-stone-100">
                                            {regA?.class || 'PRO'}
                                        </div>

                                        <div className="flex items-center gap-6 mt-4">
                                            <div className="flex-1 space-y-6">
                                                {/* Player A */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="relative">
                                                            <img src={avatarA} className={`w-12 h-12 rounded-full object-cover border-2 transition-transform group-hover:scale-105 ${match.winner_id === regA?.user_id ? 'border-saibro-500 shadow-lg shadow-saibro-100' : 'border-stone-50'}`} />
                                                            {match.winner_id === regA?.user_id && (
                                                                <div className="absolute -top-1 -right-1 bg-saibro-500 text-white rounded-full p-1 border-2 border-white shadow-sm">
                                                                    <Trophy size={10} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className={`text-sm font-black ${match.winner_id === regA?.user_id ? 'text-stone-900' : 'text-stone-400'}`}>{nameA}</p>
                                                            <p className="text-[9px] font-bold text-stone-300 uppercase leading-none mt-1">SCT Athlete</p>
                                                        </div>
                                                    </div>
                                                    {isFinished && (
                                                        <div className="flex gap-1">
                                                            {match.score_a.map((s, i) => (
                                                                <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-xl text-xs font-black transition-colors ${match.score_a[i] > match.score_b[i] ? 'bg-saibro-600 text-white shadow-md' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Player B */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="relative">
                                                            <img src={avatarB} className={`w-12 h-12 rounded-full object-cover border-2 transition-transform group-hover:scale-105 ${match.winner_id === regB?.user_id ? 'border-saibro-500 shadow-lg shadow-saibro-100' : 'border-stone-50'}`} />
                                                            {match.winner_id === regB?.user_id && (
                                                                <div className="absolute -top-1 -right-1 bg-saibro-500 text-white rounded-full p-1 border-2 border-white shadow-sm">
                                                                    <Trophy size={10} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className={`text-sm font-black ${match.winner_id === regB?.user_id ? 'text-stone-900' : 'text-stone-500'}`}>{nameB}</p>
                                                            <p className="text-[9px] font-bold text-stone-300 uppercase leading-none mt-1">SCT Athlete</p>
                                                        </div>
                                                    </div>
                                                    {isFinished && (
                                                        <div className="flex gap-1">
                                                            {match.score_b.map((s, i) => (
                                                                <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-xl text-xs font-black transition-colors ${match.score_b[i] > match.score_a[i] ? 'bg-saibro-600 text-white shadow-md' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Side Info */}
                                            <div className="flex flex-col items-center shrink-0 border-l border-stone-50 pl-6 space-y-2">
                                                {isFinished ? (
                                                    <div className="bg-stone-900 text-white rounded-2xl px-3 py-2 text-center shadow-lg transform rotate-3">
                                                        <p className="text-[10px] font-black uppercase tracking-tighter">Fim</p>
                                                        <p className="text-[8px] font-bold text-saibro-400">Match</p>
                                                    </div>
                                                ) : match.scheduled_date ? (
                                                    <div className="bg-saibro-50 rounded-2xl px-3 py-3 text-center border border-saibro-100 shadow-inner">
                                                        <Calendar size={14} className="text-saibro-600 mx-auto mb-1.5" />
                                                        <p className="text-[10px] font-black text-stone-900 leading-tight">{formatDateBr(match.scheduled_date).substring(0, 5)}</p>
                                                        <p className="text-[10px] font-black text-saibro-600 leading-tight">{match.scheduled_time?.substring(0, 5)}</p>
                                                    </div>
                                                ) : (
                                                    <div className="w-12 h-12 rounded-3xl bg-stone-50 flex items-center justify-center text-stone-100 group-hover:text-saibro-200 transition-colors">
                                                        <Clock size={20} />
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => setSelectedMatch(match)}
                                                    className="p-2.5 bg-white border border-stone-100 rounded-2xl shadow-sm text-stone-400 hover:text-saibro-600 hover:border-saibro-100 transition-all active:scale-95"
                                                >
                                                    <Info size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8 pb-32 px-1">
                        {groups.filter(g => !selectedClass || g.class === selectedClass).map(group => {
                            const groupStandings = calculateGroupStandings(
                                matches.filter(m => m.championship_group_id === group.id),
                                registrations.filter(r => (group.members || []).some((m: any) => m.registration_id === r.id))
                            );

                            return (
                                <GroupStandingsCard
                                    key={group.id}
                                    groupName={group.name}
                                    standings={groupStandings}
                                    registrations={registrations}
                                />
                            );
                        })}

                        {groups.filter(g => !selectedClass || g.class === selectedClass).length === 0 && (
                            <div className="py-20 text-center space-y-4 bg-white rounded-[3rem] border border-dashed border-stone-200 shadow-inner">
                                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto text-stone-200">
                                    <ListOrdered size={32} />
                                </div>
                                <p className="text-stone-400 font-black text-xs uppercase tracking-[0.2em]">Sem grupos para esta categoria</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* LiveScore Modal */}
            {selectedMatch && (
                <div className="fixed inset-0 z-100 bg-stone-900/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-stone-900 rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500">
                        <div className="flex justify-between items-center px-8 py-6 border-b border-white/5">
                            <h3 className="text-white font-black text-xs uppercase tracking-widest">Painel do Jogo</h3>
                            <button onClick={() => setSelectedMatch(null)} className="bg-white/10 hover:bg-white/20 text-white w-10 h-10 rounded-2xl flex items-center justify-center transition-all">
                                <ChevronDown size={20} />
                            </button>
                        </div>
                        <div className="p-4">
                            <LiveScoreboard
                                match={selectedMatch}
                                profiles={[
                                    { id: selectedMatch.playerAId!, name: getPlayerName(selectedMatch.registration_a_id), role: 'socio', isActive: true, email: '', phone: '', balance: 0 },
                                    { id: selectedMatch.playerBId!, name: getPlayerName(selectedMatch.registration_b_id), role: 'socio', isActive: true, email: '', phone: '', balance: 0 }
                                ]}
                                currentUser={{ id: 'public', name: 'Public', role: 'socio', email: '', phone: '', balance: 0, isActive: true }}
                                onScoreSaved={() => fetchData()}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
