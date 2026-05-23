import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship, Match, ChampionshipRegistration } from '../types';
import { Trophy, Loader2, ListOrdered } from 'lucide-react';
import { GroupStandingsCard } from './GroupStandingsCard';
import { BracketView } from './BracketView';
import { ResenhaOpenBracketView } from './ResenhaOpenBracketView';
import { StandingsDetailModal } from './StandingsDetailModal';
import { ChampionshipStatistics } from './ChampionshipStatistics';
import { ChampionshipOddsSimulator } from './ChampionshipOddsSimulator';
import { calculateGroupStandings } from '../lib/championshipUtils';
import { getGroupStageMatches } from '../lib/groupKnockout';

interface Props {
    slug?: string;
    championshipId?: string;
}

export const PublicChampionshipPage: React.FC<Props> = ({ slug, championshipId }) => {
    const [championship, setChampionship] = useState<Championship | null>(null);
    const [matches, setMatches] = useState<Match[]>([]);
    const [registrations, setRegistrations] = useState<ChampionshipRegistration[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'standings' | 'bracket' | 'stats' | 'odds'>('standings');

    // Standings Detail Modal
    const [showStandingsDetail, setShowStandingsDetail] = useState(false);
    const [selectedGroupForDetail, setSelectedGroupForDetail] = useState<{ group: any, standings: any[] } | null>(null);

    // Bracket tab category
    const [selectedCategory, setSelectedCategory] = useState<string>('');

    useEffect(() => {
        fetchData();
// eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, championshipId]);

    const fetchData = async () => {
        setLoading(true);

        // 1. Get Championship by Slug
        const query = supabase
            .from('championships')
            .select('*');

        const { data: champ, error } = await (championshipId
            ? query.eq('id', championshipId)
            : query.eq('slug', slug || ''))
            .maybeSingle();

        if (error || !champ) {
            setLoading(false);
            return;
        }
        setChampionship(champ);
        const isResenhaOpen = isResenhaOpenChampionship(champ);
        if (isResenhaOpen) {
            setActiveTab('bracket');
        }

        // 2. Fetch Rounds
        const { data: rnds } = await supabase
            .from('championship_rounds')
            .select('*')
            .eq('championship_id', champ.id)
            .order('round_number');
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

        }

        setLoading(false);

        // Set initial bracket category
        if (grps && grps.length > 0) {
            const cats = [...new Set(grps.map((g: any) => g.category))];
            if (cats.length > 0) setSelectedCategory(cats[0]);
        }
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

    const isResenhaOpen = isResenhaOpenChampionship(championship);

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

                {/* Main Tabs: CLASSIFICAÇÃO / CHAVEAMENTO / STATS / ODDS */}
                <div className="flex bg-white/65 p-1.5 rounded-3xl backdrop-blur-md shadow-sm">
                    {!isResenhaOpen && (
                        <button
                            onClick={() => setActiveTab('standings')}
                            className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'standings' ? 'bg-white text-stone-900 shadow-lg' : 'bg-white/25 text-stone-800 hover:bg-white/50 hover:text-stone-950'}`}
                        >
                            CLASSIFICAÇÃO
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab('bracket')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'bracket' ? 'bg-white text-stone-900 shadow-lg' : 'bg-white/25 text-stone-800 hover:bg-white/50 hover:text-stone-950'}`}
                    >
                        CHAVEAMENTO
                    </button>
                    <button
                        onClick={() => setActiveTab('stats')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'stats' ? 'bg-white text-stone-900 shadow-lg' : 'bg-white/25 text-stone-800 hover:bg-white/50 hover:text-stone-950'}`}
                    >
                        STATS
                    </button>
                    <button
                        onClick={() => setActiveTab('odds')}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black tracking-widest transition-all duration-500 ${activeTab === 'odds' ? 'bg-white text-stone-900 shadow-lg' : 'bg-white/25 text-stone-800 hover:bg-white/50 hover:text-stone-950'}`}
                    >
                        ODDS
                    </button>
                </div>

                {activeTab === 'standings' ? (
                    <div className="grid grid-cols-1 gap-6 pb-20">
                        {groups.map((group: any) => {
                            const groupMatches = getGroupStageMatches(matches, group.id);
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
                ) : activeTab === 'bracket' ? (
                    <div className="space-y-6 pb-20">
                        {isResenhaOpen ? (
                            <ResenhaOpenBracketView championshipId={championship.id} />
                        ) : (() => {
                            const categories = [...new Set(groups.map((g: any) => g.category))];

                            return (
                                <>
                                    <div className="flex bg-white p-2 rounded-3xl shadow-sm border border-stone-200 gap-2 overflow-x-auto">
                                        {categories.map(category => (
                                            <button
                                                key={category}
                                                onClick={() => setSelectedCategory(category)}
                                                className={`flex-1 min-w-25 py-3 px-4 rounded-2xl text-xs font-black tracking-wider transition-all ${
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
                ) : activeTab === 'stats' ? (
                    <div className="pb-20">
                        <ChampionshipStatistics matches={matches} registrations={registrations} />
                    </div>
                ) : (
                    <div className="pb-20">
                        <ChampionshipOddsSimulator matches={matches} registrations={registrations} />
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

const isResenhaOpenChampionship = (championship?: Pick<Championship, 'name' | 'slug'> | null): boolean => {
    const name = championship?.name?.toLowerCase() ?? '';
    const slug = championship?.slug?.toLowerCase() ?? '';
    return name.includes('resenha open') || slug.includes('resenha-open');
};
