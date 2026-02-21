import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship, ChampionshipRound, Match, ChampionshipRegistration } from '../types';
import { Trophy, Loader2, ChevronLeft, ChevronRight, Clock, ListOrdered } from 'lucide-react';
import { GroupStandingsCard } from './GroupStandingsCard';
import { BracketView } from './BracketView';
import { StandingsDetailModal } from './StandingsDetailModal';
import { calculateGroupStandings } from '../lib/championshipUtils';
import { formatDateBr } from '../utils';

interface Props {
    slug: string;
}

export const PublicChampionshipPage: React.FC<Props> = ({ slug }) => {
    const [championship, setChampionship] = useState<Championship | null>(null);
    const [rounds, setRounds] = useState<ChampionshipRound[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [registrations, setRegistrations] = useState<ChampionshipRegistration[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<'matches' | 'standings' | 'bracket'>('matches');

    // Standings Detail Modal
    const [showStandingsDetail, setShowStandingsDetail] = useState(false);
    const [selectedGroupForDetail, setSelectedGroupForDetail] = useState<{ group: any, standings: any[] } | null>(null);

    // Bracket tab category
    const [selectedCategory, setSelectedCategory] = useState<string>('');

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

        // 2. Fetch Rounds
        const { data: rnds } = await supabase
            .from('championship_rounds')
            .select('*')
            .eq('championship_id', champ.id)
            .order('round_number');
        setRounds(rnds || []);

        // 3. Fetch Groups & Members
        const { data: grps } = await supabase
            .from('championship_groups')
            .select(`*, members:championship_group_members(*)`)
            .eq('championship_id', champ.id);
        setGroups(grps || []);

        // 4. Fetch Registrations
        const { data: regs } = await supabase
            .from('championship_registrations')
            .select('*, user:profiles!user_id(name, avatar_url)')
            .eq('championship_id', champ.id);
        setRegistrations(regs || []);

        // 5. Fetch Matches (with camelCase mapping like ChampionshipInProgress)
        if (rnds && rnds.length > 0) {
            const { data: mtchs } = await supabase
                .from('matches')
                .select('*')
                .in('round_id', rnds.map(r => r.id));
            setMatches((mtchs || []).map((m: any) => ({
                ...m,
                scoreA: m.score_a || [],
                scoreB: m.score_b || [],
                winnerId: m.winner_id,
                playerAId: m.player_a_id,
                playerBId: m.player_b_id,
                result_type: m.result_type,
            })));

            // Set current round (active or first)
            const activeIdx = (rnds || []).findIndex(r => r.status === 'active');
            setSelectedRoundIndex(activeIdx !== -1 ? activeIdx : 0);
        }

        setLoading(false);

        // Set initial bracket category
        if (grps && grps.length > 0) {
            const cats = [...new Set(grps.map((g: any) => g.category))];
            if (cats.length > 0) setSelectedCategory(cats[0]);
        }
    };

    // Group matches by Round
    const matchesByRound = rounds.reduce((acc, round) => {
        acc[round.id] = matches.filter(m => m.round_id === round.id);
        return acc;
    }, {} as Record<string, Match[]>);

    // Winner check helper (guest-aware)
    const isWinnerSide = (match: Match, side: 'A' | 'B'): boolean => {
        if (match.winner_registration_id) {
            return match.winner_registration_id === (side === 'A' ? match.registration_a_id : match.registration_b_id);
        }
        if (match.winnerId) {
            return match.winnerId === (side === 'A' ? match.playerAId : match.playerBId);
        }
        return false;
    };

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
        <div className="h-screen overflow-y-auto">
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

                {/* Scheduling Info Card */}
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

                {/* Main Tabs: RODADAS / CLASSIFICAÇÃO / CHAVEAMENTO */}
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
                    <button
                        onClick={() => setActiveTab('bracket')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'bracket' ? 'bg-white text-stone-900 shadow-lg' : 'text-stone-400'}`}
                    >
                        CHAVEAMENTO
                    </button>
                </div>

                {activeTab === 'matches' ? (
                    <div className="space-y-6">
                        {/* Round Navigator */}
                        {rounds.length > 0 && (() => {
                            const currentRound = rounds[selectedRoundIndex];
                            return (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between bg-white p-4 rounded-[2.5rem] border border-stone-100 shadow-lg shadow-stone-200/40">
                                        <button
                                            onClick={() => setSelectedRoundIndex(prev => Math.max(0, prev - 1))}
                                            className={`p-3 rounded-2xl transition-all ${selectedRoundIndex > 0 ? 'text-saibro-600 bg-saibro-50 active:scale-90 hover:bg-saibro-100 shadow-sm' : 'text-stone-200'}`}
                                            disabled={selectedRoundIndex === 0}
                                        >
                                            <ChevronLeft size={24} />
                                        </button>
                                        <div className="text-center">
                                            <h3 className="font-black text-stone-900 text-sm tracking-tight">{currentRound.name}</h3>
                                            <p className="text-[9px] font-black text-saibro-600 uppercase tracking-[0.2em] mt-1 space-x-1">
                                                <span>{formatDateBr(currentRound.start_date)}</span>
                                                <span className="text-stone-300">/</span>
                                                <span>{formatDateBr(currentRound.end_date)}</span>
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

                                    {/* Match Cards */}
                                    <div className="space-y-4 pb-20">
                                        {(matchesByRound[currentRound.id] || []).map(match => {
                                            const regA = registrations.find(r => r.id === match.registration_a_id);
                                            const regB = registrations.find(r => r.id === match.registration_b_id);
                                            const nameA = regA?.user?.name || regA?.guest_name || '...';
                                            const nameB = regB?.user?.name || regB?.guest_name || '...';
                                            const isFinished = match.status === 'finished';
                                            const resultType = match.result_type || (match.is_walkover ? 'walkover' : 'played');
                                            const resultLabel = isFinished
                                                ? (resultType === 'technical_draw' ? 'Empate técnico' : resultType === 'walkover' ? 'W.O.' : 'Disputado')
                                                : match.scheduled_date
                                                    ? `${formatDateBr(match.scheduled_date)} ${match.scheduled_time?.substring(0, 5) || ''}`
                                                    : 'Pendente';

                                            return (
                                                <div key={match.id} className="bg-white rounded-4xl p-6 shadow-sm border border-stone-100 relative overflow-hidden transition-all hover:border-saibro-200 group">
                                                    <div className="absolute top-0 left-0 bg-stone-50 px-3 py-1 rounded-br-2xl text-[9px] font-black text-stone-400 uppercase tracking-tighter">
                                                        {regA?.class || 'N/A'}
                                                    </div>

                                                    <div className="flex items-center gap-6 mt-2">
                                                        <div className="flex-1 space-y-4">
                                                            <div className="flex items-center justify-between">
                                                                <span className={`text-[9px] uppercase tracking-widest font-black ${isFinished ? 'text-stone-400' : 'text-saibro-500'}`}>
                                                                    {resultLabel}
                                                                </span>
                                                            </div>
                                                            {/* Player A */}
                                                            <div className="flex items-center justify-between">
                                                                <span className={`text-sm font-bold ${isWinnerSide(match, 'A') ? 'text-stone-900' : 'text-stone-500'}`}>{nameA}</span>
                                                                {isFinished && (
                                                                    <div className="flex gap-1">
                                                                        {match.score_a.map((s: number, i: number) => (
                                                                            <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.score_a[i] > match.score_b[i] ? 'bg-saibro-600 text-white shadow-sm' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* Player B */}
                                                            <div className="flex items-center justify-between">
                                                                <span className={`text-sm font-bold ${isWinnerSide(match, 'B') ? 'text-stone-900' : 'text-stone-500'}`}>{nameB}</span>
                                                                {isFinished && (
                                                                    <div className="flex gap-1">
                                                                        {match.score_b.map((s: number, i: number) => (
                                                                            <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.score_b[i] > match.score_a[i] ? 'bg-saibro-600 text-white shadow-sm' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                ) : activeTab === 'standings' ? (
                    <div className="grid grid-cols-1 gap-6 pb-20">
                        {groups.map((group: any) => {
                            const groupMatches = matches.filter(m => m.championship_group_id === group.id);
                            const groupMemberIds = (group.members || []).map((m: any) => m.registration_id);
                            const groupRegistrations = registrations.filter(r => groupMemberIds.includes(r.id));
                            const standings = calculateGroupStandings(groupRegistrations, groupMatches, {
                                ptsVictory: championship.ptsVictory,
                                ptsDefeat: championship.ptsDefeat,
                                ptsWoVictory: championship.ptsWoVictory,
                                ptsSet: championship.ptsSet,
                                ptsGame: championship.ptsGame,
                                ptsTechnicalDraw: championship.ptsTechnicalDraw
                            });

                            return (
                                <GroupStandingsCard
                                    key={group.id}
                                    groupName={`${group.category} - Grupo ${group.group_name}`}
                                    standings={standings}
                                    registrations={registrations}
                                    onShowDetails={() => {
                                        setSelectedGroupForDetail({ group, standings });
                                        setShowStandingsDetail(true);
                                    }}
                                />
                            );
                        })}

                        {groups.length === 0 && (
                            <div className="py-20 text-center space-y-4 bg-white rounded-[3rem] border border-dashed border-stone-200 shadow-inner">
                                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto text-stone-200">
                                    <ListOrdered size={32} />
                                </div>
                                <p className="text-stone-400 font-black text-xs uppercase tracking-[0.2em]">Sem grupos cadastrados</p>
                            </div>
                        )}
                    </div>
                ) : (
                    // Bracket Tab
                    <div className="space-y-6 pb-20">
                        {(() => {
                            const categories = [...new Set(groups.map((g: any) => g.category))];

                            return (
                                <>
                                    <div className="flex bg-white p-2 rounded-3xl shadow-sm border border-stone-200 gap-2 overflow-x-auto">
                                        {categories.map(category => (
                                            <button
                                                key={category}
                                                onClick={() => setSelectedCategory(category)}
                                                className={`flex-1 min-w-[100px] py-3 px-4 rounded-2xl text-xs font-black tracking-wider transition-all ${
                                                    selectedCategory === category
                                                        ? 'bg-saibro-600 text-white shadow-md'
                                                        : 'text-stone-400 hover:text-stone-600'
                                                }`}
                                            >
                                                {category}
                                            </button>
                                        ))}
                                    </div>

                                    <BracketView
                                        groups={groups}
                                        registrations={registrations}
                                        matches={matches}
                                        category={selectedCategory}
                                    />
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Standings Detail Modal */}
            {showStandingsDetail && selectedGroupForDetail && (
                <StandingsDetailModal
                    isOpen={showStandingsDetail}
                    onClose={() => {
                        setShowStandingsDetail(false);
                        setSelectedGroupForDetail(null);
                    }}
                    standings={selectedGroupForDetail.standings}
                    registrations={registrations}
                    groupName={selectedGroupForDetail.group.group_name}
                    category={selectedGroupForDetail.group.category}
                />
            )}
        </div>
        </div>
    );
};
