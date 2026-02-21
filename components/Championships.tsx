import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trophy, Calendar, CalendarCheck, History, ListOrdered, GitMerge, ChevronDown, Loader2, Download, Share2, Users, Shirt, ChevronLeft, ChevronRight, Clock, MapPin, Info, Save, Plus, Minus, X, AlertTriangle } from 'lucide-react';
import { Championship, Match, User, ChampionshipRound } from '../types';
import { getMatchWinner, formatDateBr, getNowInFortaleza, formatDate } from '../utils';
import { supabase } from '../lib/supabase';
import { LiveScoreboard } from './LiveScoreboard';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { GroupStandingsCard } from './GroupStandingsCard';
import { BracketView } from './BracketView';
import { StandingsDetailModal } from './StandingsDetailModal';

import { calculateGroupStandings } from '../lib/championshipUtils';
import { MatchScheduleModal } from './MatchScheduleModal';

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
    const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
    const [activeTab, setActiveTab] = useState<'partidas' | 'classificacao' | 'chaveamento' | 'inscritos'>('partidas');
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);
    const [schedulingMatch, setSchedulingMatch] = useState<Match | null>(null);
    const [adminResultMatch, setAdminResultMatch] = useState<Match | null>(null);
    const [savingAdminResult, setSavingAdminResult] = useState(false);
    const [showChampSelector, setShowChampSelector] = useState(false); // Mobile friendly selector
    const [showAllRounds, setShowAllRounds] = useState(false);
    const selectorRef = useRef<HTMLDivElement>(null);
    const [courts, setCourts] = useState<any[]>([]);

    // Standings Detail Modal State
    const [showStandingsDetail, setShowStandingsDetail] = useState(false);
    const [selectedGroupForDetail, setSelectedGroupForDetail] = useState<{ group: any, standings: any[] } | null>(null);

    // Bracket category selection state
    const [selectedBracketCategory, setSelectedBracketCategory] = useState<string>('');

    // Close selector when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
                setShowChampSelector(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Round navigation
    const [rounds, setRounds] = useState<ChampionshipRound[]>([]);
    const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);
    const [selectedRoundIndexJogos, setSelectedRoundIndexJogos] = useState(0); // For Jogos tab

    // Group matches by Round
    const matchesByRound = rounds.reduce((acc, round) => {
        acc[round.id] = matches.filter(m => m.round_id === round.id);
        return acc;
    }, {} as Record<string, Match[]>);

    // Fetch data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // 1. Fetch championships
            const { data: champsData, error: champsError } = await supabase
                .from('championships')
                .select('*')
                .order('status', { ascending: true });

            if (champsError) {
                console.error('Error fetching championships:', champsError);
                setLoading(false);
                return;
            }

            const initialChamps = champsData?.map(c => ({
                ...c,
                startDate: c.start_date,
                endDate: c.end_date,
                ptsVictory: c.pts_victory,
                ptsDefeat: c.pts_defeat,
                ptsWoVictory: c.pts_wo_victory,
                ptsSet: c.pts_set,
                ptsGame: c.pts_game,
                ptsTechnicalDraw: c.pts_technical_draw,
                participantIds: [],
                registration_open: c.registration_open
            })) || [];

            setChampionships(initialChamps);

            // Auto-select: 1. Ongoing, 2. Registration Open, 3. First Available
            const ongoing = initialChamps.find(c => c.status === 'ongoing');
            const regOpen = initialChamps.find(c => c.registration_open === true);

            if (ongoing) {
                if (!selectedChampId) setSelectedChampId(ongoing.id);
            } else if (regOpen) {
                setRegistrationChamp(regOpen);
                if (!selectedChampId) setSelectedChampId(regOpen.id);
            } else if (initialChamps.length > 0 && !selectedChampId) {
                setSelectedChampId(initialChamps[0].id);
            }

            // 2. Fetch profiles
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, category, role')
                .in('role', ['socio', 'admin'])
                .eq('is_active', true);

            const { data: courtsData } = await supabase.from('courts').select('*');
            setCourts(courtsData || []);

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

    // Realtime subscription for registrations
    useEffect(() => {
        if (!registrationChamp) return;

        const fetchRegistrations = async () => {
            const { data: regsData } = await supabase
                .from('championship_registrations')
                .select('*, user:profiles!user_id(name, avatar_url)')
                .eq('championship_id', registrationChamp.id)
                .order('class', { ascending: true });

            setRegistrations(regsData || []);
        };

        const subscription = supabase
            .channel('public-registrations')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'championship_registrations',
                    filter: `championship_id=eq.${registrationChamp.id}`
                },
                () => {
                    fetchRegistrations();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [registrationChamp?.id]);

    // Fetch matches and rounds when championship changes
    useEffect(() => {
        if (!selectedChampId) return;

        const fetchData = async () => {
            // 1. Fetch Rounds
            const { data: roundsData } = await supabase
                .from('championship_rounds')
                .select('*')
                .eq('championship_id', selectedChampId)
                .order('round_number', { ascending: true });

            // VISIBILITY CHANGE: All rounds visible to everyone
            const mappedRounds = roundsData || [];
            setRounds(mappedRounds);

            // Set current round (active or first)
            const activeIdx = mappedRounds.findIndex(r => r.status === 'active');
            setSelectedRoundIndex(activeIdx !== -1 ? activeIdx : 0);

            // 2. Fetch Matches
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
                registration_a_id: m.registration_a_id,
                registration_b_id: m.registration_b_id,
                scoreA: m.score_a || [],
                scoreB: m.score_b || [],
                winnerId: m.winner_id,
                winner_registration_id: m.winner_registration_id,
                is_walkover: m.is_walkover,
                result_type: m.result_type,
                admin_notes: m.admin_notes,
                result_set_by: m.result_set_by,
                result_set_at: m.result_set_at,
                walkover_winner_id: m.walkover_winner_id,
                walkover_winner_registration_id: m.walkover_winner_registration_id,
                date: m.date,
                scheduled_time: m.scheduled_time,
                scheduled_date: m.scheduled_date,
                scheduledTime: m.scheduled_time,
                scheduledDate: m.scheduled_date,
                court_id: m.court_id,
                status: m.status || 'pending',
                championship_group_id: m.championship_group_id,
                round_id: m.round_id
            })));

            // 3. Fetch registrations for this champ (for names)
            const { data: regsData } = await supabase
                .from('championship_registrations')
                .select('*, user:profiles!user_id(name, avatar_url)')
                .eq('championship_id', selectedChampId);
            setRegistrations(regsData || []);
        };

        fetchData();
    }, [selectedChampId]);

    // Fetch Groups if needed (for Group Stage)
    const [groupsDetail, setGroupsDetail] = useState<any[]>([]);

    useEffect(() => {
        if (!selectedChampId) return;

        const fetchGroups = async () => {
            const { data: grps } = await supabase
                .from('championship_groups')
                .select(`*, members:championship_group_members(*)`)
                .eq('championship_id', selectedChampId);
            setGroupsDetail(grps || []);
        };
        fetchGroups();
    }, [selectedChampId]);

    const ongoingChamps = championships.filter(c => c.status === 'ongoing');
    const selectedChamp = championships.find(c => c.id === selectedChampId);

    // Automatic tab selection based on format if current tab isn't applicable
    // This must be before early returns to maintain consistent hook order
    useEffect(() => {
        if (selectedChamp?.format === 'pontos-corridos' && activeTab === 'chaveamento') {
            setActiveTab('classificacao');
        }
        // Don't auto-switch for mata-mata or grupo-mata-mata formats
        // grupo-mata-mata supports both classificacao and chaveamento
    }, [selectedChamp?.format, activeTab]);

    // Initialize bracket category when groups change
    useEffect(() => {
        if (groupsDetail.length > 0 && !selectedBracketCategory) {
            const categories = [...new Set(groupsDetail.map(g => g.category))];
            setSelectedBracketCategory(categories[0] || '');
        }
    }, [groupsDetail, selectedBracketCategory]);

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

    // SCHEDULING LOGIC
    // Check if a user can schedule a specific match
    const canScheduleMatch = (match: Match, userId: string) => {
        if (!userId) return false;
        
        // 1. Must be a participant
        if (match.playerAId !== userId && match.playerBId !== userId) return false;

        // 2. Find current round number
        const currentRound = rounds.find(r => r.id === match.round_id);
        if (!currentRound) return false; // Should not happen
        
        const roundNumber = currentRound.round_number;

        // 3. If Round 1, always allow
        if (roundNumber === 1) return true;

        // 4. If Round > 1, check previous round match
        const prevRound = rounds.find(r => r.round_number === roundNumber - 1);
        if (!prevRound) return true; // Fallback if no prev round found? Or false? Assuming true to avoid blocking if data issue.

        // Find user's match in previous round
        const prevMatch = matches.find(m => 
            m.round_id === prevRound.id && 
            (m.playerAId === userId || m.playerBId === userId)
        );

        // If no previous match found (e.g. bye, or late entry), allow? 
        // Let's assume strict: need to have finished previous match if one exists.
        // If one doesn't exist, maybe they are new? Let's say yes.
        if (!prevMatch) return true;

        // 5. Allow ONLY if previous match is finished
        return prevMatch.status === 'finished';
    };

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

    const handleSchedule = async (date: string, time: string, courtId: string) => {
        if (!schedulingMatch) return;

        const { error } = await supabase
            .from('matches')
            .update({
                scheduled_date: date,
                scheduled_time: time,
                court_id: courtId,
                status: 'pending' // Ensure status is pending
            })
            .eq('id', schedulingMatch.id);

        if (error) {
            alert('Erro ao agendar: ' + error.message);
            throw error;
        }

        // Update local state
        setMatches(prev => prev.map(m =>
            m.id === schedulingMatch.id
                ? {
                    ...m,
                    scheduledDate: date,
                    scheduledTime: time,
                    scheduled_date: date,
                    scheduled_time: time,
                    status: 'pending'
                }
                : m
        ));

        setSchedulingMatch(null);
    };

    const handleSaveResult = async (matchId: string, scoreA: number[], scoreB: number[]) => {
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        const winner = getMatchWinner(scoreA, scoreB);
        if (!winner) return; // Invalid match, don't save

        const winnerId = winner === 'A' ? match.playerAId : match.playerBId;
        const winnerRegistrationId = winner === 'A' ? match.registration_a_id : match.registration_b_id;
        const resultTimestamp = getNowInFortaleza().toISOString();

        const logAudit = async (action: string, beforeData: any, afterData: any) => {
            if (!selectedChamp || !currentUser?.id) return;
            await supabase.from('championship_admin_audit_logs').insert({
                championship_id: selectedChamp.id,
                entity_type: 'match',
                entity_id: matchId,
                action,
                before_data: beforeData,
                after_data: afterData,
                actor_user_id: currentUser.id
            });
        };

        // Update match in Supabase
        const { error } = await supabase
            .from('matches')
            .update({
                score_a: scoreA,
                score_b: scoreB,
                winner_id: winnerId || null,
                winner_registration_id: winnerRegistrationId || null,
                is_walkover: false,
                walkover_winner_id: null,
                walkover_winner_registration_id: null,
                result_type: 'played',
                result_set_by: currentUser.id,
                result_set_at: resultTimestamp,
                status: 'finished',
                date: formatDate(getNowInFortaleza())
            })
            .eq('id', matchId);

        if (error) {
            console.error('Error saving result:', error);
            alert('Erro ao salvar resultado. Tente novamente.');
            return;
        }

        await logAudit('match_result_played_set', {
            score_a: match.scoreA,
            score_b: match.scoreB,
            winner_id: match.winnerId,
            winner_registration_id: match.winner_registration_id,
            result_type: match.result_type
        }, {
            score_a: scoreA,
            score_b: scoreB,
            winner_id: winnerId,
            winner_registration_id: winnerRegistrationId,
            result_type: 'played'
        });

        // Update local state
        setMatches(prev => prev.map(m =>
            m.id === matchId
                ? {
                    ...m,
                    scoreA,
                    scoreB,
                    winnerId,
                    winner_registration_id: winnerRegistrationId || null,
                    is_walkover: false,
                    walkover_winner_id: null,
                    walkover_winner_registration_id: null,
                    result_type: 'played',
                    status: 'finished' as const,
                    date: formatDate(getNowInFortaleza())
                }
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
                    const isSlotA = !nextMatch.playerAId && !nextMatch.registration_a_id;
                    const updateData: Record<string, any> = {};
                    if (winnerId) {
                        updateData[isSlotA ? 'player_a_id' : 'player_b_id'] = winnerId;
                    }
                    if (winnerRegistrationId) {
                        updateData[isSlotA ? 'registration_a_id' : 'registration_b_id'] = winnerRegistrationId;
                    }
                    if (Object.keys(updateData).length > 0) {
                        await supabase
                            .from('matches')
                            .update(updateData)
                            .eq('id', nextMatch.id);
                    }
                }
            }
        }

        setEditingMatch(null);
    };

    const getRegistrationDisplayName = (reg?: Registration) => {
        if (!reg) return 'Atleta';
        return reg.participant_type === 'guest'
            ? (reg.guest_name || 'Convidado')
            : (reg.user?.name || 'Sócio');
    };

    const handleAdminWalkover = async (match: Match, winnerSide: 'A' | 'B') => {
        if (savingAdminResult) return;

        const regA = registrations.find(r => r.id === match.registration_a_id);
        const regB = registrations.find(r => r.id === match.registration_b_id);
        const winnerRegId = winnerSide === 'A' ? match.registration_a_id : match.registration_b_id;
        const winnerName = winnerSide === 'A' ? getRegistrationDisplayName(regA) : getRegistrationDisplayName(regB);

        if (!winnerRegId) {
            alert('Não foi possível identificar o atleta vencedor.');
            return;
        }

        if (!confirm(`Confirmar W.O. para ${winnerName}?`)) return;

        setSavingAdminResult(true);
        const winnerUserId = winnerSide === 'A' ? match.playerAId : match.playerBId;
        const scoreA = winnerSide === 'A' ? [6, 6] : [0, 0];
        const scoreB = winnerSide === 'A' ? [0, 0] : [6, 6];
        const nowDate = formatDate(getNowInFortaleza());
        const resultTimestamp = getNowInFortaleza().toISOString();

        const { error } = await supabase
            .from('matches')
            .update({
                score_a: scoreA,
                score_b: scoreB,
                winner_id: winnerUserId,
                winner_registration_id: winnerRegId,
                is_walkover: true,
                walkover_winner_id: winnerUserId,
                walkover_winner_registration_id: winnerRegId,
                result_type: 'walkover',
                result_set_by: currentUser.id,
                result_set_at: resultTimestamp,
                status: 'finished',
                date: nowDate
            })
            .eq('id', match.id);

        if (error) {
            console.error('Error setting walkover:', error);
            alert('Erro ao definir W.O.: ' + error.message);
            setSavingAdminResult(false);
            return;
        }

        if (selectedChamp && currentUser?.id) {
            await supabase.from('championship_admin_audit_logs').insert({
                championship_id: selectedChamp.id,
                entity_type: 'match',
                entity_id: match.id,
                action: 'match_result_walkover_set',
                before_data: {
                    score_a: match.scoreA,
                    score_b: match.scoreB,
                    winner_id: match.winnerId,
                    result_type: match.result_type
                },
                after_data: {
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: winnerUserId,
                    result_type: 'walkover'
                },
                actor_user_id: currentUser.id
            });
        }

        setMatches(prev => prev.map(m =>
            m.id === match.id
                ? {
                    ...m,
                    scoreA,
                    scoreB,
                    winnerId: winnerUserId ?? null,
                    is_walkover: true,
                    walkover_winner_id: winnerUserId ?? null,
                    walkover_winner_registration_id: winnerRegId,
                    result_type: 'walkover',
                    status: 'finished',
                    date: nowDate
                }
                : m
        ));

        setAdminResultMatch(null);
        setSavingAdminResult(false);
    };

    const handleAdminCancel = async (match: Match) => {
        if (savingAdminResult) return;
        if (!confirm('Confirmar cancelamento desta partida?')) return;

        setSavingAdminResult(true);
        const nowDate = formatDate(getNowInFortaleza());
        const scoreA = [0, 0];
        const scoreB = [0, 0];
        const resultTimestamp = getNowInFortaleza().toISOString();

        const { error } = await supabase
            .from('matches')
            .update({
                score_a: scoreA,
                score_b: scoreB,
                winner_id: null,
                is_walkover: false,
                walkover_winner_id: null,
                walkover_winner_registration_id: null,
                result_type: 'technical_draw',
                result_set_by: currentUser.id,
                result_set_at: resultTimestamp,
                status: 'finished',
                date: nowDate
            })
            .eq('id', match.id);

        if (error) {
            console.error('Error cancelling match:', error);
            alert('Erro ao cancelar partida: ' + error.message);
            setSavingAdminResult(false);
            return;
        }

        if (selectedChamp && currentUser?.id) {
            await supabase.from('championship_admin_audit_logs').insert({
                championship_id: selectedChamp.id,
                entity_type: 'match',
                entity_id: match.id,
                action: 'match_result_technical_draw_set',
                before_data: {
                    score_a: match.scoreA,
                    score_b: match.scoreB,
                    winner_id: match.winnerId,
                    result_type: match.result_type
                },
                after_data: {
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: null,
                    result_type: 'technical_draw'
                },
                actor_user_id: currentUser.id
            });
        }

        setMatches(prev => prev.map(m =>
            m.id === match.id
                ? {
                    ...m,
                    scoreA,
                    scoreB,
                    winnerId: null,
                    is_walkover: false,
                    walkover_winner_id: null,
                    walkover_winner_registration_id: null,
                    result_type: 'technical_draw',
                    status: 'finished',
                    date: nowDate
                }
                : m
        ));

        setAdminResultMatch(null);
        setSavingAdminResult(false);
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

    // PDF Export with multi-page support
    const handleExportPDF = async () => {
        if (!tableRef.current || !registrationChamp) return;

        const canvas = await html2canvas(tableRef.current, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth - 20;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Header
        pdf.setFontSize(18);
        pdf.text(registrationChamp.name, pageWidth / 2, 15, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text('Lista de Inscritos', pageWidth / 2, 22, { align: 'center' });

        const headerHeight = 30;
        const usableHeight = pageHeight - headerHeight - 10;

        if (imgHeight <= usableHeight) {
            pdf.addImage(imgData, 'PNG', 10, headerHeight, imgWidth, imgHeight);
        } else {
            let remainingHeight = imgHeight;
            let position = 0;
            let page = 1;

            while (remainingHeight > 0) {
                const srcY = position * (canvas.height / imgHeight);
                const srcHeight = Math.min(usableHeight, remainingHeight) * (canvas.height / imgHeight);

                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = srcHeight;
                const ctx = sliceCanvas.getContext('2d');

                if (ctx) {
                    ctx.drawImage(canvas, 0, srcY, canvas.width, srcHeight, 0, 0, canvas.width, srcHeight);
                    const sliceData = sliceCanvas.toDataURL('image/png');
                    const sliceImgHeight = (srcHeight * imgWidth) / canvas.width;

                    if (page > 1) pdf.addPage();
                    pdf.addImage(sliceData, 'PNG', 10, headerHeight, imgWidth, sliceImgHeight);
                }

                remainingHeight -= usableHeight;
                position += usableHeight;
                page++;
            }
        }

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
                <div className="bg-linear-to-br from-saibro-600 to-saibro-500 p-6 rounded-3xl shadow-xl text-white relative overflow-hidden">
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
        <>
        <div className="p-4 space-y-6 pb-24">
            {/* 1. HEADER PREMIUM */}
            <div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 p-8 rounded-4xl shadow-2xl shadow-saibro-300/30 text-white relative overflow-hidden border-2 border-white/10">
                {/* Decorative Trophy Icon */}
                <div className="absolute right-[-20px] top-[-20px] opacity-[0.08] rotate-12">
                    <Trophy size={200} strokeWidth={1.5} />
                </div>
                {/* Decorative Circles */}
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full -ml-16 -mb-16" />
                <div className="absolute top-1/2 right-1/4 w-20 h-20 bg-white/5 rounded-full" />

                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <span className="text-xs font-black uppercase tracking-widest bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full border-2 border-white/30 shadow-lg flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                            Em andamento
                        </span>
                        {ongoingChamps.length > 1 && (
                            <div className="relative" ref={selectorRef}>
                                <button
                                    onClick={() => setShowChampSelector(!showChampSelector)}
                                    className="flex items-center gap-2 text-xs font-black bg-white/15 backdrop-blur-sm px-4 py-1.5 rounded-full hover:bg-white/25 transition-all duration-200 border-2 border-white/20 shadow-lg hover:scale-105"
                                >
                                    Trocar <ChevronDown size={14} className={`transition-transform duration-300 ${showChampSelector ? 'rotate-180' : ''}`} />
                                </button>

                                {showChampSelector && (
                                    <div className="absolute top-full left-0 mt-3 w-64 bg-white rounded-3xl shadow-2xl border-2 border-stone-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <div className="p-2">
                                            {ongoingChamps.map(c => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => {
                                                        setSelectedChampId(c.id);
                                                        setShowChampSelector(false);
                                                    }}
                                                    className={`w-full text-left px-5 py-3.5 rounded-2xl text-sm font-black transition-all duration-200 flex items-center justify-between ${
                                                        selectedChampId === c.id 
                                                            ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 scale-[1.02]' 
                                                            : 'text-stone-700 hover:bg-stone-50'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <Trophy size={16} />
                                                        {c.name}
                                                    </span>
                                                    {selectedChampId === c.id && <div className="w-2 h-2 rounded-full bg-white shadow-lg" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <h2 className="text-3xl font-black uppercase tracking-tight drop-shadow-lg">{selectedChamp.name}</h2>
                    <p className="text-white/90 text-sm font-bold flex items-center gap-2 mt-3 drop-shadow-md">
                        <Calendar size={16} className="drop-shadow" />
                        {selectedChamp.endDate ? `Finais em ${formatDateBr(selectedChamp.endDate)}` : 'Finais em breve'}
                    </p>
                </div>
            </div>

            {/* 1.5 SCHEDULING DASHBOARD (Static Top) */}
            <div className="bg-white rounded-3xl p-6 shadow-lg shadow-stone-200/50 border-2 border-stone-100 flex items-start gap-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-saibro-500/5 rounded-full -mr-20 -mt-20" />
                <div className="absolute bottom-0 left-0 w-28 h-28 bg-blue-500/5 rounded-full -ml-14 -mb-14" />
                <div className="bg-linear-to-br from-saibro-500 to-saibro-600 p-4 rounded-2xl text-white shadow-lg shadow-saibro-200">
                    <Clock size={28} strokeWidth={2.5} />
                </div>
                <div className="flex-1 relative z-10">
                    <h3 className="text-base font-black text-stone-900 uppercase tracking-tight">Painel de Agendamento</h3>
                    <p className="text-xs text-stone-500 mt-1.5 font-bold">Agende e acompanhe suas partidas</p>
                    <div className="flex gap-2 mt-4 text-[10px] flex-wrap">
                        <span className="text-xs font-black bg-linear-to-br from-blue-50 to-blue-100 text-blue-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5 border-2 border-blue-200">
                            <Info size={12} /> 1-3 Classe: Rápida
                        </span>
                        <span className="text-xs font-black bg-linear-to-br from-saibro-50 to-orange-50 text-saibro-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5 border-2 border-saibro-200">
                            <Info size={12} /> 4-5 Classe: Saibro
                        </span>
                        <span className="text-xs font-black bg-linear-to-br from-stone-800 to-stone-900 text-white px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-md">
                            <Info size={12} /> 6 Classe: Rápida
                        </span>
                    </div>
                </div>
            </div>

            {/* 2. TABS */}
            <div className="flex bg-white p-1.5 sm:p-2 rounded-3xl shadow-lg shadow-stone-200/50 border-2 border-stone-100 gap-1.5 sm:gap-2 overflow-hidden">
                <button
                    onClick={() => setActiveTab('partidas')}
                    className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-3 px-2 sm:py-3.5 sm:px-4 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-normal sm:tracking-wider transition-all duration-300 ${
                        activeTab === 'partidas' 
                            ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 sm:scale-105' 
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                    }`}
                >
                    <Trophy size={16} className="hidden sm:block shrink-0" /> <span className="truncate">Partidas</span>
                </button>
                <button
                    onClick={() => setActiveTab('jogos')}
                    className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-3 px-2 sm:py-3.5 sm:px-4 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-normal sm:tracking-wider transition-all duration-300 ${
                        activeTab === 'jogos' 
                            ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 sm:scale-105' 
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                    }`}
                >
                    <CalendarCheck size={16} className="hidden sm:block shrink-0" /> <span className="truncate">Jogos</span>
                </button>
                <button
                    onClick={() => setActiveTab('classificacao')}
                    className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-3 px-2 sm:py-3.5 sm:px-4 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-normal sm:tracking-wider transition-all duration-300 ${
                        activeTab === 'classificacao' 
                            ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 sm:scale-105' 
                            : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                    }`}
                >
                    <ListOrdered size={16} className="hidden sm:block shrink-0" />
                    <span className="truncate sm:hidden">Classif.</span>
                    <span className="truncate hidden sm:inline">Classificação</span>
                </button>
                {(selectedChamp.format === 'mata-mata' || selectedChamp.format === 'grupo-mata-mata') && (
                    <button
                        onClick={() => setActiveTab('chaveamento')}
                        className={`flex-1 min-w-0 flex items-center justify-center gap-1 sm:gap-2 py-3 px-2 sm:py-3.5 sm:px-4 rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-normal sm:tracking-wider transition-all duration-300 ${
                            activeTab === 'chaveamento' 
                                ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 sm:scale-105' 
                                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                        }`}
                    >
                        <GitMerge size={16} className="hidden sm:block shrink-0" />
                        <span className="truncate sm:hidden">Chave</span>
                        <span className="truncate hidden sm:inline">Chaveamento</span>
                    </button>
                )}
            </div>

            {/* 3. TAB CONTENT */}
            <div className="space-y-4 animate-in fade-in duration-500">
                {activeTab === 'partidas' && (() => {
                    const currentRound = rounds[selectedRoundIndex];
                    if (rounds.length === 0) return (
                        <div className="text-center py-10 bg-white rounded-3xl border border-dashed border-stone-200">
                            <p className="text-stone-400">Nenhuma rodada gerada ainda.</p>
                        </div>
                    );

                    if (!currentRound) return null;

                    // Get matches for this round from the grouped object or filter directly
                    const roundMatches = matchesByRound[currentRound.id] || [];

                    return (
                        <div className="space-y-6">
                            {/* Rounds Header & Toggle */}
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest leading-none">
                                    {showAllRounds ? 'Todos os Confrontos' : 'Confrontos por Rodada'}
                                </h3>
                                <button
                                    onClick={() => setShowAllRounds(!showAllRounds)}
                                    className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border transition-all ${showAllRounds ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-500 border-stone-200'}`}
                                >
                                    {showAllRounds ? 'Ver por Rodada' : 'Ver Todos'}
                                </button>
                            </div>

                            {/* Round Navigator (Only if not showing all) */}
                            {!showAllRounds && (
                                <div className="flex items-center justify-between bg-white p-4 rounded-[2.5rem] border border-stone-100 shadow-sm sticky top-2 z-20">
                                    <button
                                        onClick={() => setSelectedRoundIndex(prev => Math.max(0, prev - 1))}
                                        className={`p-2 rounded-xl transition-colors ${selectedRoundIndex > 0 ? 'text-saibro-600 bg-saibro-50' : 'text-stone-200 cursor-not-allowed'}`}
                                        disabled={selectedRoundIndex === 0}
                                    >
                                        <ChevronLeft size={24} />
                                    </button>
                                    <div className="text-center">
                                        <h3 className="font-black text-stone-800 text-sm">{currentRound.name}</h3>
                                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-0.5">
                                            {formatDateBr(currentRound.start_date)} - {formatDateBr(currentRound.end_date)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setSelectedRoundIndex(prev => Math.min(rounds.length - 1, prev + 1))}
                                        className={`p-2 rounded-xl transition-colors ${selectedRoundIndex < rounds.length - 1 ? 'text-saibro-600 bg-saibro-50' : 'text-stone-200 cursor-not-allowed'}`}
                                        disabled={selectedRoundIndex === rounds.length - 1}
                                    >
                                        <ChevronRight size={24} />
                                    </button>
                                </div>
                            )}

                            {/* Category Filter */}
                            {!showAllRounds && (
                                <div className="flex bg-white rounded-2xl p-1.5 shadow-sm border border-stone-100 overflow-x-auto scrollbar-hide">
                                    <button
                                        onClick={() => setSelectedCategory('Todas')}
                                        className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${selectedCategory === 'Todas' ? 'bg-stone-900 text-white shadow-md' : 'text-stone-500 hover:bg-stone-50'}`}
                                    >
                                        Todas
                                    </button>
                                    {CLASSES.filter(cls => registrations.some(r => r.class === cls)).map(cls => (
                                        <button
                                            key={cls}
                                            onClick={() => setSelectedCategory(cls)}
                                            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${selectedCategory === cls ? 'bg-saibro-600 text-white shadow-md' : 'text-stone-500 hover:bg-stone-50'}`}
                                        >
                                            {cls}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Match Lists grouped by category */}
                            {(showAllRounds ? matches : roundMatches).length > 0 ? (
                                <div className="space-y-4">
                                    {(showAllRounds ? matches : roundMatches)
                                        .filter(match => {
                                            if (selectedCategory === 'Todas' || showAllRounds) return true;
                                            // Find registration to check class
                                            const regA = registrations.find(r => r.id === match.registration_a_id);
                                            return regA?.class === selectedCategory;
                                        })
                                        .sort((a, b) => {
                                            if (showAllRounds) {
                                                // Sort by class then date if showing all
                                                const regA1 = registrations.find(r => r.id === a.registration_a_id);
                                                const regA2 = registrations.find(r => r.id === b.registration_a_id);
                                                if (regA1?.class !== regA2?.class) return (regA1?.class || '').localeCompare(regA2?.class || '');
                                            }
                                            return 0;
                                        })
                                        .map(match => (
                                            <MatchCard
                                                key={match.id}
                                                match={match}
                                                profiles={profiles}
                                                registrations={registrations}
                                                onEdit={() => currentUser.role === 'admin' && setEditingMatch(match)}
                                                onSchedule={() => setSchedulingMatch(match)}
                                                isAdmin={currentUser.role === 'admin'}
                                                currentUserId={currentUser.id}
                                                canSchedule={canScheduleMatch(match, currentUser.id)}
                                            />
                                        ))}
                                </div>
                            ) : (
                                <div className="text-center py-10">
                                    <Trophy className="mx-auto text-stone-200 mb-2" size={48} />
                                    <p className="text-stone-400 text-sm font-medium italic">
                                        Partidas ainda não geradas para esta rodada.
                                    </p>
                                </div>
                            )
                            }
                        </div>
                    );
                })()}

                {activeTab === 'jogos' && (() => {
                    // Get selected round for Jogos tab
                    const selectedRound = rounds[selectedRoundIndexJogos];

                    // Filter matches by selected round
                    const filteredMatches = selectedRound
                        ? matches.filter(m => m.round_id === selectedRound.id)
                        : matches;

                    // Group matches by class, then by round
                    const matchesByClass: Record<string, Record<string, typeof matches>> = {};

                    filteredMatches.forEach(match => {
                        const regA = registrations.find(r => r.id === match.registration_a_id);
                        const className = regA?.class || 'Sem Classe';
                        const round = rounds.find(r => r.id === match.round_id);
                        const roundName = round?.name || 'Sem Rodada';

                        if (!matchesByClass[className]) {
                            matchesByClass[className] = {};
                        }
                        if (!matchesByClass[className][roundName]) {
                            matchesByClass[className][roundName] = [];
                        }
                        matchesByClass[className][roundName].push(match);
                    });

                    return (
                        <div className="space-y-6">
                            {/* Round Selector */}
                            {rounds.length > 0 && (
                                <div className="flex items-center justify-between bg-white p-5 rounded-3xl border-2 border-stone-100 shadow-lg shadow-stone-200/50 sticky top-2 z-20">
                                    <button
                                        onClick={() => setSelectedRoundIndexJogos(prev => Math.max(0, prev - 1))}
                                        className={`p-3 rounded-2xl transition-all duration-200 ${
                                            selectedRoundIndexJogos > 0 
                                                ? 'text-white bg-linear-to-br from-saibro-600 to-saibro-700 shadow-lg shadow-saibro-200 hover:scale-110' 
                                                : 'text-stone-300 bg-stone-50 cursor-not-allowed'
                                        }`}
                                        disabled={selectedRoundIndexJogos === 0}
                                    >
                                        <ChevronLeft size={24} strokeWidth={3} />
                                    </button>
                                    <div className="text-center">
                                        <h3 className="font-black text-stone-900 text-lg uppercase tracking-tight">{selectedRound?.name || 'Todas as Rodadas'}</h3>
                                        {selectedRound && (
                                            <p className="text-xs font-bold text-stone-500 uppercase tracking-wide mt-1 flex items-center justify-center gap-1.5">
                                                <Calendar size={12} />
                                                {formatDateBr(selectedRound.start_date)} - {formatDateBr(selectedRound.end_date)}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setSelectedRoundIndexJogos(prev => Math.min(rounds.length - 1, prev + 1))}
                                        className={`p-3 rounded-2xl transition-all duration-200 ${
                                            selectedRoundIndexJogos < rounds.length - 1 
                                                ? 'text-white bg-linear-to-br from-saibro-600 to-saibro-700 shadow-lg shadow-saibro-200 hover:scale-110' 
                                                : 'text-stone-300 bg-stone-50 cursor-not-allowed'
                                        }`}
                                        disabled={selectedRoundIndexJogos === rounds.length - 1}
                                    >
                                        <ChevronRight size={24} strokeWidth={3} />
                                    </button>
                                </div>
                            )}

                            {Object.keys(matchesByClass).length > 0 ? (
                                CLASSES.filter(cls => matchesByClass[cls]).map(className => (
                                    <div key={className} className="space-y-4">
                                        {/* Class Header */}
                                        <div className="sticky top-0 z-10 bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 text-white px-6 py-4 rounded-3xl shadow-xl shadow-saibro-300/30 border-2 border-white/10">
                                            <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-2">
                                                <Trophy size={18} className="drop-shadow" />
                                                {className}
                                            </h3>
                                        </div>

                                        {/* Rounds within this class */}
                                        {Object.keys(matchesByClass[className])
                                            .sort((a, b) => {
                                                // Sort rounds by their index
                                                const roundA = rounds.find(r => r.name === a);
                                                const roundB = rounds.find(r => r.name === b);
                                                if (!roundA || !roundB) return 0;
                                                return rounds.indexOf(roundA) - rounds.indexOf(roundB);
                                            })
                                            .map(roundName => {
                                                const roundMatches = matchesByClass[className][roundName];
                                                const round = rounds.find(r => r.name === roundName);

                                                return (
                                                    <div key={roundName} className="bg-white rounded-3xl shadow-lg shadow-stone-200/50 border-2 border-stone-100 overflow-hidden">
                                                        {/* Round Header */}
                                                        <div className="px-5 py-3.5 bg-linear-to-r from-stone-50 to-stone-100 border-b-2 border-stone-200 flex items-center justify-between">
                                                            <h4 className="text-sm font-black text-stone-800 uppercase tracking-tight flex items-center gap-2">
                                                                <CalendarCheck size={16} className="text-saibro-600" />
                                                                {roundName}
                                                            </h4>
                                                            {round && (
                                                                <span className="text-xs font-bold text-stone-500 uppercase bg-white px-3 py-1 rounded-xl shadow-sm">
                                                                    {formatDateBr(round.start_date)} - {formatDateBr(round.end_date)}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Matches */}
                                                        <div className="divide-y divide-stone-50">
                                                            {roundMatches
                                                                .sort((a, b) => {
                                                                    // Sort: pending first, then by date
                                                                    if (a.status === 'finished' && b.status !== 'finished') return 1;
                                                                    if (a.status !== 'finished' && b.status === 'finished') return -1;
                                                                    if (a.scheduled_date && b.scheduled_date) {
                                                                        return a.scheduled_date.localeCompare(b.scheduled_date);
                                                                    }
                                                                    return 0;
                                                                })
                                                                .map(match => {
                                                                    const regA = registrations.find(r => r.id === match.registration_a_id);
                                                                    const regB = registrations.find(r => r.id === match.registration_b_id);
                                                                    const nameA = regA?.user?.name || regA?.guest_name || '...';
                                                                    const nameB = regB?.user?.name || regB?.guest_name || '...';
                                                                    const avatarA = regA?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameA}&background=random`;
                                                                    const avatarB = regB?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameB}&background=random`;
                                                                    const isFinished = match.status === 'finished';
                                                                    const court = courts.find(c => c.id === match.court_id);
                                                                    const isTechnicalDraw = isTechnicalDrawMatch(match);
                                                                    const hasScores = hasAnyScore(match);
                                                                    const isPastDeadline = round?.end_date
                                                                        ? formatDate(getNowInFortaleza()) > round.end_date
                                                                        : false;
                                                                    const canDefineResult = currentUser.role === 'admin'
                                                                        && !isFinished
                                                                        && !match.scheduled_date
                                                                        && isPastDeadline;

                                                                    return (
                                                                        <div key={match.id} className="p-5 hover:bg-stone-50 transition-all duration-200 border-b-2 border-stone-100 last:border-b-0">
                                                                            <div className="flex items-center justify-between gap-6">
                                                                                {/* Players */}
                                                                                <div className="flex-1 space-y-3">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <img 
                                                                                            src={avatarA} 
                                                                                            className={`w-10 h-10 rounded-full object-cover border-3 transition-all ${
                                                                                                isWinnerSide(match, 'A') 
                                                                                                    ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' 
                                                                                                    : 'border-stone-200'
                                                                                            }`} 
                                                                                        />
                                                                                        <p className={`text-sm font-black transition-colors ${
                                                                                            isWinnerSide(match, 'A') ? 'text-stone-900' : 'text-stone-700'
                                                                                        }`}>
                                                                                            {nameA}
                                                                                            {isWinnerSide(match, 'A') && (
                                                                                                <Trophy className="inline ml-1.5 text-saibro-500 drop-shadow" size={14} />
                                                                                            )}
                                                                                        </p>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-3">
                                                                                        <img 
                                                                                            src={avatarB} 
                                                                                            className={`w-10 h-10 rounded-full object-cover border-3 transition-all ${
                                                                                                isWinnerSide(match, 'B') 
                                                                                                    ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' 
                                                                                                    : 'border-stone-200'
                                                                                            }`} 
                                                                                        />
                                                                                        <p className={`text-sm font-black transition-colors ${
                                                                                            isWinnerSide(match, 'B') ? 'text-stone-900' : 'text-stone-700'
                                                                                        }`}>
                                                                                            {nameB}
                                                                                            {isWinnerSide(match, 'B') && (
                                                                                                <Trophy className="inline ml-1.5 text-saibro-500 drop-shadow" size={14} />
                                                                                            )}
                                                                                        </p>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Score or Schedule Info */}
                                                                                <div className="text-right">
                                                                                    {isFinished ? (
                                                                                        <div className="flex flex-col gap-2.5 items-end">
                                                                                            {!isTechnicalDraw && hasScores && (
                                                                                                <div className="flex gap-2">
                                                                                                    {match.scoreA.map((s, i) => (
                                                                                                        <div key={i} className="flex flex-col items-center gap-1">
                                                                                                            <span className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black shadow-sm transition-all ${
                                                                                                                match.scoreA[i] > match.scoreB[i] 
                                                                                                                    ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                                                                                                    : 'bg-stone-100 text-stone-400'
                                                                                                            }`}>
                                                                                                                {s}
                                                                                                            </span>
                                                                                                            <span className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black shadow-sm transition-all ${
                                                                                                                match.scoreB[i] > match.scoreA[i] 
                                                                                                                    ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                                                                                                    : 'bg-stone-100 text-stone-400'
                                                                                                            }`}>
                                                                                                                {match.scoreB[i]}
                                                                                                            </span>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                </div>
                                                                                            )}
                                                                                            <span className={`text-xs font-black uppercase px-3 py-1.5 rounded-xl border-2 ${
                                                                                                isTechnicalDraw
                                                                                                    ? 'text-blue-700 bg-blue-50 border-blue-200'
                                                                                                    : match.is_walkover
                                                                                                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                                                                                                        : 'text-emerald-700 bg-linear-to-br from-emerald-50 to-green-50 border-emerald-200'
                                                                                            }`}>
                                                                                                {isTechnicalDraw ? 'Empate técnico' : match.is_walkover ? 'W.O.' : 'Disputado'}
                                                                                            </span>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="flex flex-col items-end gap-2">
                                                                                            {match.scheduled_date ? (
                                                                                                <>
                                                                                                    <div className="flex items-center gap-2 text-sm bg-saibro-50 px-3 py-1.5 rounded-xl border-2 border-saibro-200">
                                                                                                        <Calendar size={14} className="text-saibro-600" strokeWidth={2.5} />
                                                                                                        <span className="font-black text-saibro-700">
                                                                                                            {new Date(match.scheduled_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                    {match.scheduled_time && (
                                                                                                        <div className="flex items-center gap-2 text-sm bg-blue-50 px-3 py-1.5 rounded-xl border-2 border-blue-200">
                                                                                                            <Clock size={14} className="text-blue-600" strokeWidth={2.5} />
                                                                                                            <span className="font-black text-blue-700">{match.scheduled_time}</span>
                                                                                                        </div>
                                                                                                    )}
                                                                                                    {court && (
                                                                                                        <div className="flex items-center gap-2 text-sm bg-stone-800 px-3 py-1.5 rounded-xl shadow-md">
                                                                                                            <MapPin size={14} className="text-white" strokeWidth={2.5} />
                                                                                                            <span className="font-black text-white">{court.name}</span>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </>
                                                                                            ) : (
                                                                                                canDefineResult ? (
                                                                                                    <button
                                                                                                        onClick={() => setAdminResultMatch(match)}
                                                                                                        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 hover:bg-amber-100 whitespace-nowrap transition-colors"
                                                                                                    >
                                                                                                        <AlertTriangle size={12} className="text-amber-600" />
                                                                                                        Definir Resultado
                                                                                                    </button>
                                                                                                ) : (
                                                                                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-stone-500 bg-stone-100 px-3 py-1.5 rounded-lg border border-dashed border-stone-300 whitespace-nowrap">
                                                                                                        <Calendar size={12} className="text-stone-400" />
                                                                                                        Sem agendamento
                                                                                                    </span>
                                                                                                )
                                                                                            )}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                ))
                            ) : (
                                <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-8 text-center text-stone-400">
                                    <CalendarCheck size={48} className="mx-auto mb-2 text-stone-200" />
                                    <p className="text-sm font-medium">Nenhum jogo gerado ainda</p>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {activeTab === 'classificacao' && (
                    <div className="space-y-6">
                        {groupsDetail.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {groupsDetail.map(group => {
                                    // Filter matches for this group
                                    const groupMatches = matches.filter(m => m.championship_group_id === group.id);

                                    // Get registrations for this group
                                    const memberRegIds = group.members.map((m: any) => m.registration_id);
                                    const groupRegs = registrations.filter(r => memberRegIds.includes(r.id));

                                    const standings = calculateGroupStandings(groupRegs, groupMatches, {
                                        ptsVictory: selectedChamp?.ptsVictory,
                                        ptsDefeat: selectedChamp?.ptsDefeat,
                                        ptsWoVictory: selectedChamp?.ptsWoVictory,
                                        ptsSet: selectedChamp?.ptsSet,
                                        ptsGame: selectedChamp?.ptsGame,
                                        ptsTechnicalDraw: selectedChamp?.ptsTechnicalDraw
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
                            </div>
                        ) : (
                            <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
                                <div className="p-8 text-center text-stone-400">
                                    <p>Classificação não disponível ou formato não suportado.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'chaveamento' && (
                    <div className="space-y-6 pb-10">
                        {/* Only show bracket for grupo-mata-mata format */}
                        {selectedChamp?.format === 'grupo-mata-mata' && groupsDetail.length > 0 ? (
                            <>
                                {/* Class Sub-Tabs */}
                                {(() => {
                                    const categories = [...new Set(groupsDetail.map(g => g.category))];
                                    
                                    return (
                                        <>
                                            <div className="flex bg-white p-2 rounded-3xl shadow-sm border border-stone-200 gap-2 overflow-x-auto">
                                                {categories.map(category => (
                                                    <button
                                                        key={category}
                                                        onClick={() => setSelectedBracketCategory(category)}
                                                        className={`flex-1 min-w-[100px] py-3 px-4 rounded-2xl text-xs font-black tracking-wider transition-all ${
                                                            selectedBracketCategory === category
                                                                ? 'bg-saibro-600 text-white shadow-md'
                                                                : 'text-stone-400 hover:text-stone-600'
                                                        }`}
                                                    >
                                                        {category}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Bracket View */}
                                            <BracketView
                                                groups={groupsDetail}
                                                registrations={registrations}
                                                matches={matches}
                                                category={selectedBracketCategory}
                                            />
                                        </>
                                    );
                                })()}
                            </>
                        ) : selectedChamp?.format === 'mata-mata' ? (
                            // For pure knockout format, show traditional bracket
                            <div className="space-y-8">
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
                        ) : (
                            <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
                                <div className="p-8 text-center text-stone-400">
                                    <p>Chaveamento não disponível para este formato de campeonato.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 4. MODAL EDIT RESULT */}
        </div>

            {/* Modals rendered outside main container for full-screen overlay */}
            {
                editingMatch && (
                    <ResultModal
                        match={editingMatch}
                        profiles={profiles}
                        registrations={registrations}
                        onClose={() => setEditingMatch(null)}
                        onSave={(sA, sB) => handleSaveResult(editingMatch.id, sA, sB)}
                    />
                )
            }

            {
                adminResultMatch && (
                    <AdminMatchResultModal
                        match={adminResultMatch}
                        registrations={registrations}
                        saving={savingAdminResult}
                        onClose={() => setAdminResultMatch(null)}
                        onWalkover={(winnerSide) => handleAdminWalkover(adminResultMatch, winnerSide)}
                        onCancel={() => handleAdminCancel(adminResultMatch)}
                    />
                )
            }

            {
                schedulingMatch && (
                    <MatchScheduleModal
                        match={schedulingMatch}
                        roundName={rounds.find(r => r.id === schedulingMatch.round_id)?.name || 'Rodada'}
                        roundStartDate={rounds.find(r => r.id === schedulingMatch.round_id)?.start_date || ''}
                        roundEndDate={rounds.find(r => r.id === schedulingMatch.round_id)?.end_date || ''}
                        className={registrations.find(r => r.id === schedulingMatch.registration_a_id)?.class || ''}
                        courts={courts}
                        isAdmin={currentUser.role === 'admin'}
                        onSchedule={handleSchedule}
                        onClose={() => setSchedulingMatch(null)}
                    />
                )
            }

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
        </>
    );
};

export const ResultModal: React.FC<{ match: Match; profiles: User[]; registrations?: Registration[]; onClose: () => void; onSave: (sA: number[], sB: number[]) => void }> = ({ match, profiles, registrations = [], onClose, onSave }) => {
    const pA = profiles.find(u => u.id === match.playerAId);
    const pB = profiles.find(u => u.id === match.playerBId);
    const regA = registrations.find(r => r.id === match.registration_a_id);
    const regB = registrations.find(r => r.id === match.registration_b_id);
    const playerAName = regA?.user?.name || regA?.guest_name || pA?.name || 'Jogador A';
    const playerBName = regB?.user?.name || regB?.guest_name || pB?.name || 'Jogador B';
    const playerAAvatar = regA?.user?.avatar_url || pA?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(playerAName)}&background=random`;
    const playerBAvatar = regB?.user?.avatar_url || pB?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(playerBName)}&background=random`;

    // Initialize with 3 sets (we'll show/hide the 3rd based on need)
    const [scoreA, setScoreA] = useState<number[]>(
        match.scoreA.length > 0 ? [...match.scoreA, ...(match.scoreA.length < 3 ? [0] : [])] : [0, 0, 0]
    );
    const [scoreB, setScoreB] = useState<number[]>(
        match.scoreB.length > 0 ? [...match.scoreB, ...(match.scoreB.length < 3 ? [0] : [])] : [0, 0, 0]
    );

    const updateScore = (player: 'A' | 'B', index: number, val: string) => {
        const n = Math.max(0, Math.min(20, parseInt(val) || 0)); // Allow up to 20 for tiebreaks
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

    // Import validation functions helpers
    const isValidSetLocal = (gA: number, gB: number, isSuperTiebreak = false) => {
        if (isSuperTiebreak) {
            return (gA >= 10 || gB >= 10) && Math.abs(gA - gB) >= 2;
        }
        if (gA === 7 || gB === 7) return true;
        if ((gA === 6 && gB <= 4) || (gB === 6 && gA <= 4)) return true;
        return false;
    };

    const getSetWinnerLocal = (gA: number, gB: number, isSuperTiebreak = false): 'A' | 'B' | null => {
        if (!isValidSetLocal(gA, gB, isSuperTiebreak)) return null;
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

    const set3Valid = showThirdSet ? isValidSetLocal(scoreA[2], scoreB[2], true) : true;
    const set3Winner = showThirdSet ? getSetWinnerLocal(scoreA[2], scoreB[2], true) : null;

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

    return createPortal(
        <div className="fixed inset-0 z-999 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-visible shadow-2xl animate-in zoom-in-95 duration-300 relative">
                <button
                    onClick={onClose}
                    className="absolute -top-12 right-0 bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors text-white"
                >
                    <ChevronDown size={24} />
                </button>

                <div className="px-6 py-5 bg-stone-900 text-white flex justify-between items-center rounded-t-[2.5rem]">
                    <div>
                        <h3 className="text-lg font-black tracking-tight">Resultado</h3>
                        <p className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Lançamento Oficial</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col items-center w-24">
                            <div className={`relative mb-2 ${matchWinner === 'A' ? 'scale-110' : 'opacity-80'} transition-all duration-300`}>
                                <img src={playerAAvatar} className={`w-16 h-16 rounded-full object-cover border-4 ${matchWinner === 'A' ? 'border-saibro-500 shadow-xl shadow-saibro-200' : 'border-stone-100'}`} />
                                {matchWinner === 'A' && <div className="absolute -bottom-2 right-0 bg-saibro-500 text-white p-1 rounded-full border-2 border-white"><Trophy size={12} /></div>}
                            </div>
                            <p className="text-sm font-black text-center leading-tight text-stone-800">{playerAName}</p>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                            <span className="text-xs font-black text-stone-300">VS</span>
                        </div>

                        <div className="flex flex-col items-center w-24">
                            <div className={`relative mb-2 ${matchWinner === 'B' ? 'scale-110' : 'opacity-80'} transition-all duration-300`}>
                                <img src={playerBAvatar} className={`w-16 h-16 rounded-full object-cover border-4 ${matchWinner === 'B' ? 'border-saibro-500 shadow-xl shadow-saibro-200' : 'border-stone-100'}`} />
                                {matchWinner === 'B' && <div className="absolute -bottom-2 right-0 bg-saibro-500 text-white p-1 rounded-full border-2 border-white"><Trophy size={12} /></div>}
                            </div>
                            <p className="text-sm font-black text-center leading-tight text-stone-800">{playerBName}</p>
                        </div>
                    </div>

                    {/* Score Inputs with Increment Buttons */}
                    <div className="space-y-4 bg-stone-50 p-4 rounded-3xl border border-stone-100">
                        {[0, 1, 2].map((idx) => {
                            if (idx === 2 && !showThirdSet) return null;
                            const isSuperTie = idx === 2;
                            const isValid = idx === 0 ? set1Valid : idx === 1 ? set2Valid : set3Valid;
                            const winner = idx === 0 ? set1Winner : idx === 1 ? set2Winner : set3Winner;

                            return (
                                <div key={idx} className={`flex items-center justify-between ${idx > 0 ? 'pt-4 border-t border-stone-100' : ''}`}>
                                    <div className="w-12 text-center">
                                        <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest leading-none">
                                            {isSuperTie ? 'Super' : 'Set'}
                                        </p>
                                        <p className="text-xs font-black text-saibro-600 mt-1">
                                            {isSuperTie ? 'Tie' : idx + 1}
                                        </p>
                                    </div>

                                    <div className="flex gap-6">
                                        {/* Player A Score Control */}
                                        <div className="flex flex-col items-center gap-1.5">
                                            <button
                                                onClick={() => updateScore('A', idx, String(scoreA[idx] + 1))}
                                                className="w-10 h-7 bg-white border border-stone-200 rounded-lg flex items-center justify-center text-stone-400 hover:text-saibro-600 hover:border-saibro-200 transition-all active:scale-95"
                                            >
                                                <Plus size={12} strokeWidth={3} />
                                            </button>
                                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black border-2 transition-all ${getInputBorderClass(isValid, winner === 'A')}`}>
                                                {scoreA[idx]}
                                            </div>
                                            <button
                                                onClick={() => updateScore('A', idx, String(Math.max(0, scoreA[idx] - 1)))}
                                                className="w-10 h-7 bg-white border border-stone-200 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-600 transition-all active:scale-95"
                                            >
                                                <Minus size={12} strokeWidth={3} />
                                            </button>
                                        </div>

                                        {/* Player B Score Control */}
                                        <div className="flex flex-col items-center gap-1.5">
                                            <button
                                                onClick={() => updateScore('B', idx, String(scoreB[idx] + 1))}
                                                className="w-10 h-7 bg-white border border-stone-200 rounded-lg flex items-center justify-center text-stone-400 hover:text-saibro-600 hover:border-saibro-200 transition-all active:scale-95"
                                            >
                                                <Plus size={12} strokeWidth={3} />
                                            </button>
                                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black border-2 transition-all ${getInputBorderClass(isValid, winner === 'B')}`}>
                                                {scoreB[idx]}
                                            </div>
                                            <button
                                                onClick={() => updateScore('B', idx, String(Math.max(0, scoreB[idx] - 1)))}
                                                className="w-10 h-7 bg-white border border-stone-200 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-600 transition-all active:scale-95"
                                            >
                                                <Minus size={12} strokeWidth={3} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 uppercase tracking-wider text-sm shadow-lg ${canSave
                            ? 'bg-saibro-600 text-white hover:bg-saibro-500 hover:scale-[1.02]'
                            : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                            }`}
                    >
                        <Save size={18} />
                        Confirmar Resultado
                    </button>
                    {!canSave && (scoreA[0] > 0 || scoreB[0] > 0) && (
                        <p className="text-[10px] uppercase tracking-widest text-stone-400 text-center font-bold">
                            Placar incompleto ou inválido
                        </p>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

const AdminMatchResultModal: React.FC<{
    match: Match;
    registrations: Registration[];
    saving?: boolean;
    onClose: () => void;
    onWalkover: (winnerSide: 'A' | 'B') => void;
    onCancel: () => void;
}> = ({ match, registrations, saving = false, onClose, onWalkover, onCancel }) => {
    const regA = registrations.find(r => r.id === match.registration_a_id);
    const regB = registrations.find(r => r.id === match.registration_b_id);
    const nameA = regA?.user?.name || regA?.guest_name || 'Jogador A';
    const nameB = regB?.user?.name || regB?.guest_name || 'Jogador B';
    const avatarA = regA?.user?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nameA)}&background=random`;
    const avatarB = regB?.user?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nameB)}&background=random`;

    return createPortal(
        <div className="fixed inset-0 z-999 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-stone-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-black text-stone-800">Definir Resultado</h3>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-stone-400">Administração</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <img src={avatarA} className="w-12 h-12 rounded-full border-2 border-stone-100 object-cover" />
                            <p className="text-sm font-black text-stone-800 truncate">{nameA}</p>
                        </div>
                        <span className="text-xs font-black text-stone-300">VS</span>
                        <div className="flex items-center gap-3 min-w-0">
                            <p className="text-sm font-black text-stone-800 truncate">{nameB}</p>
                            <img src={avatarB} className="w-12 h-12 rounded-full border-2 border-stone-100 object-cover" />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Marcar W.O.</p>
                        <button
                            onClick={() => onWalkover('A')}
                            disabled={saving}
                            className="w-full py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-black text-sm hover:bg-amber-100 transition-all disabled:opacity-50"
                        >
                            W.O. para {nameA}
                        </button>
                        <button
                            onClick={() => onWalkover('B')}
                            disabled={saving}
                            className="w-full py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 font-black text-sm hover:bg-amber-100 transition-all disabled:opacity-50"
                        >
                            W.O. para {nameB}
                        </button>
                    </div>

                    <div className="pt-4 border-t border-stone-100 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Cancelar Partida</p>
                        <button
                            onClick={onCancel}
                            disabled={saving}
                            className="w-full py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 font-black text-sm hover:bg-red-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <AlertTriangle size={16} />
                            Marcar como cancelada
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

// ============================================
// MATCH CARD
// ============================================

// Helpers from LiveScore for consistent set winner logic
const getSetWinner = (scoreA: number, scoreB: number, isSuperTiebreak = false): 'A' | 'B' | null => {
    if (isSuperTiebreak) {
        if (scoreA >= 10 && scoreA - scoreB >= 2) return 'A';
        if (scoreB >= 10 && scoreB - scoreA >= 2) return 'B';
        return null;
    }
    if (scoreA === 7) return 'A';
    if (scoreB === 7) return 'B';
    if (scoreA === 6 && scoreB <= 4) return 'A';
    if (scoreB === 6 && scoreA <= 4) return 'B';
    return null;
};

// Check if user can launch score (same logic as LiveScoreboard)
const canLaunchScore = (match: Match, userId?: string): boolean => {
    if (!userId) return false;
    
    // Must be one of the players
    if (match.playerAId !== userId && match.playerBId !== userId) return false;
    
    // If no scheduled time, allow anytime
    if (!match.scheduled_date || !match.scheduled_time) return true;
    
    // Use Fortaleza time for checks
    const now = getNowInFortaleza();
    const today = formatDate(now);
    
    // Must be match day
    if (match.scheduled_date !== today) return false;
    
    // Check if current time >= scheduled time
    const [hours, minutes] = match.scheduled_time.split(':').map(Number);
    const scheduledDateTime = new Date(now);
    scheduledDateTime.setHours(hours, minutes, 0, 0);
    
    return now >= scheduledDateTime;
};

const hasAnyScore = (match: Match): boolean => {
    const scoreA = match.scoreA || [];
    const scoreB = match.scoreB || [];
    return scoreA.some(s => s > 0) || scoreB.some(s => s > 0);
};

const hasAnyWinner = (match: Match): boolean => {
    return Boolean(match.winnerId || match.winner_registration_id || match.walkover_winner_id || match.walkover_winner_registration_id);
};

const isWinnerSide = (match: Match, side: 'A' | 'B'): boolean => {
    if (match.winner_registration_id) {
        return match.winner_registration_id === (side === 'A' ? match.registration_a_id : match.registration_b_id);
    }
    if (match.winnerId) {
        return match.winnerId === (side === 'A' ? match.playerAId : match.playerBId);
    }
    return false;
};

const isTechnicalDrawMatch = (match: Match): boolean => {
    if (match.result_type === 'technical_draw') return true;
    return match.status === 'finished' && !match.is_walkover && !hasAnyWinner(match) && !hasAnyScore(match);
};

const MatchCard: React.FC<{ match: Match; profiles: User[]; registrations: Registration[]; isAdmin?: boolean; currentUserId?: string; canSchedule?: boolean; onEdit?: () => void; onSchedule?: () => void }> = ({ match, profiles, registrations, isAdmin, currentUserId, canSchedule, onEdit, onSchedule }) => {
    const regA = registrations.find(r => r.id === match.registration_a_id);
    const regB = registrations.find(r => r.id === match.registration_b_id);

    const nameA = regA?.user?.name || regA?.guest_name || '...';
    const nameB = regB?.user?.name || regB?.guest_name || '...';
    const avatarA = regA?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameA}&background=random`;
    const avatarB = regB?.user?.avatar_url || `https://ui-avatars.com/api/?name=${nameB}&background=random`;

    const isFinished = match.status === 'finished';
    const isTechnicalDraw = isTechnicalDrawMatch(match);
    const hasScores = hasAnyScore(match);

    // Calculate set winners using LiveScore logic
    const set1Winner = match.scoreA[0] !== undefined && match.scoreB[0] !== undefined 
        ? getSetWinner(match.scoreA[0], match.scoreB[0]) 
        : null;
    const set2Winner = match.scoreA[1] !== undefined && match.scoreB[1] !== undefined 
        ? getSetWinner(match.scoreA[1], match.scoreB[1]) 
        : null;
    
    // Only show 3rd set if split sets (1-1)
    const setsWonA = (set1Winner === 'A' ? 1 : 0) + (set2Winner === 'A' ? 1 : 0);
    const setsWonB = (set1Winner === 'B' ? 1 : 0) + (set2Winner === 'B' ? 1 : 0);
    const showThirdSet = setsWonA === 1 && setsWonB === 1;
    
    const set3Winner = showThirdSet && match.scoreA[2] !== undefined && match.scoreB[2] !== undefined
        ? getSetWinner(match.scoreA[2], match.scoreB[2], true)
        : null;

    // Determine which scores to display
    const displayScoresA = showThirdSet ? match.scoreA : match.scoreA.slice(0, 2);
    const displayScoresB = showThirdSet ? match.scoreB : match.scoreB.slice(0, 2);

    return (
        <div className="bg-white rounded-3xl p-4 sm:p-6 shadow-lg shadow-stone-200/50 border-2 border-stone-100 relative overflow-hidden group transition-all duration-300 hover:shadow-xl hover:shadow-saibro-100/30 hover:border-saibro-300 hover:scale-[1.01]">
            {/* Class Tag */}
            <div className="absolute top-0 left-0 bg-linear-to-br from-stone-800 to-stone-900 px-4 py-1.5 rounded-br-3xl text-[10px] font-black text-white uppercase tracking-wider shadow-md">
                {regA?.class || 'S/C'}
            </div>

            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 md:gap-6 mt-3">
                {/* Players Column */}
                <div className="flex-1 min-w-0 space-y-4 sm:space-y-5">
                    {/* Player A */}
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="relative">
                                <img src={avatarA} className={`w-12 h-12 rounded-full border-3 object-cover transition-all duration-300 ${isWinnerSide(match, 'A') ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' : 'border-stone-200 group-hover:border-stone-300'}`} />
                                {isWinnerSide(match, 'A') && (
                                    <div className="absolute -top-1 -right-1 bg-linear-to-br from-saibro-500 to-saibro-600 text-white rounded-full p-1 border-2 border-white shadow-lg">
                                        <Trophy size={8} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className={`text-base font-black transition-colors leading-tight wrap-break-word ${isWinnerSide(match, 'A') ? 'text-stone-900' : 'text-stone-600'}`}>
                                    {nameA}
                                </p>
                                <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wide">{regA?.participant_type === 'guest' ? '🎫 Convidado' : '⭐ Sócio'}</p>
                            </div>
                        </div>
                        {isFinished && (
                            <div className="flex gap-2">
                                {displayScoresA.map((s, i) => {
                                    const isSetWinner = (i === 0 && set1Winner === 'A') ||
                                                       (i === 1 && set2Winner === 'A') ||
                                                       (i === 2 && set3Winner === 'A');
                                    return (
                                        <span key={i} className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black shadow-sm transition-all ${
                                            isSetWinner
                                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                                : 'bg-stone-100 text-stone-400'
                                        }`}>
                                            {s}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Player B */}
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="relative">
                                <img src={avatarB} className={`w-12 h-12 rounded-full border-3 object-cover transition-all duration-300 ${isWinnerSide(match, 'B') ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' : 'border-stone-200 group-hover:border-stone-300'}`} />
                                {isWinnerSide(match, 'B') && (
                                    <div className="absolute -top-1 -right-1 bg-linear-to-br from-saibro-500 to-saibro-600 text-white rounded-full p-1 border-2 border-white shadow-lg">
                                        <Trophy size={8} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className={`text-base font-black transition-colors leading-tight wrap-break-word ${isWinnerSide(match, 'B') ? 'text-stone-900' : 'text-stone-600'}`}>
                                    {nameB}
                                </p>
                                <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wide">{regB?.participant_type === 'guest' ? '🎫 Convidado' : '⭐ Sócio'}</p>
                            </div>
                        </div>
                        {isFinished && (
                            <div className="flex gap-2">
                                {displayScoresB.map((s, i) => {
                                    const isSetWinner = (i === 0 && set1Winner === 'B') ||
                                                       (i === 1 && set2Winner === 'B') ||
                                                       (i === 2 && set3Winner === 'B');
                                    return (
                                        <span key={i} className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black shadow-sm transition-all ${
                                            isSetWinner
                                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                                : 'bg-stone-100 text-stone-400'
                                        }`}>
                                            {s}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Status/Scheduling Column */}
                <div className="w-full md:w-auto flex flex-col items-stretch md:items-end gap-3 shrink-0">
                    {match.status === 'finished' ? (
                        <div className={`px-4 py-2.5 rounded-2xl border-2 shadow-sm text-center md:w-auto ${
                            isTechnicalDraw
                                ? 'bg-blue-50 border-blue-200'
                                : match.is_walkover || !hasScores
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-linear-to-br from-emerald-50 to-green-50 border-emerald-200'
                        }`}>
                            <p className={`text-[9px] font-black uppercase tracking-wider mb-0.5 ${
                                isTechnicalDraw
                                    ? 'text-blue-600'
                                    : match.is_walkover || !hasScores
                                        ? 'text-amber-600'
                                        : 'text-emerald-600'
                            }`}>
                                {isTechnicalDraw ? 'Empate técnico' : 'Finalizado'}
                            </p>
                            <span className={`text-sm font-black ${
                                isTechnicalDraw
                                    ? 'text-blue-700'
                                    : match.is_walkover || !hasScores
                                        ? 'text-amber-700'
                                        : 'text-emerald-700'
                            }`}>
                                {isTechnicalDraw ? '0 pts' : match.is_walkover || !hasScores ? 'W.O.' : 'FIM'}
                            </span>
                        </div>
                    ) : match.scheduledDate ? (
                        <div className="bg-linear-to-br from-saibro-50 to-orange-50 px-4 py-2.5 rounded-2xl border-2 border-saibro-200 shadow-md md:w-auto">
                            <p className="text-[9px] font-black text-saibro-700 uppercase tracking-wider mb-1.5">Agendado</p>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-saibro-800 mb-0.5">
                                <Calendar size={12} /> {formatDateBr(match.scheduledDate)}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-saibro-800">
                                <Clock size={12} /> {match.scheduledTime?.substring(0, 5)}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-stone-50 px-4 py-3 rounded-2xl border-2 border-dashed border-stone-200 text-center">
                            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-stone-300 mb-2 mx-auto">
                                <Calendar size={18} />
                            </div>
                            <p className="text-[10px] font-black text-stone-400 uppercase tracking-wider">Pendente</p>
                        </div>
                    )}

                    {/* Botão Lançar - Admin sempre pode, Sócio só após horário agendado */}
                    {!isFinished && (isAdmin || canLaunchScore(match, currentUserId)) && (
                        <button
                            onClick={onEdit}
                            className="w-full md:w-auto bg-linear-to-br from-saibro-600 to-saibro-700 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200"
                        >
                            Lançar
                        </button>
                    )}

                    {/* Botão Agendar - para partidas sem agendamento */}
                    {!isFinished && !match.scheduledDate && (isAdmin || match.playerAId === currentUserId || match.playerBId === currentUserId) && (
                        <button
                            onClick={onSchedule}
                            className="w-full md:w-auto bg-linear-to-br from-stone-800 to-stone-900 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-stone-300 hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
                        >
                            <Calendar size={12} />
                            Agendar
                        </button>
                    )}

                    {/* Botão Reagendar - para partidas já agendadas */}
                    {!isFinished && match.scheduledDate && (isAdmin || match.playerAId === currentUserId || match.playerBId === currentUserId) && (
                        <button
                            onClick={onSchedule}
                            className="w-full md:w-auto bg-linear-to-br from-blue-600 to-blue-700 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-blue-200 hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
                        >
                            <Clock size={12} />
                            Reagendar
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const BracketMatchCard: React.FC<{ match: Match; profiles: User[]; isAdmin?: boolean; onEdit?: () => void }> = ({ match, profiles, isAdmin, onEdit }) => {
    const pA = profiles.find(u => u.id === match.playerAId);
    const pB = profiles.find(u => u.id === match.playerBId);

    return (
        <div className="bg-white rounded-3xl shadow-lg shadow-stone-200/50 border-2 border-stone-100 overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-saibro-300 hover:scale-[1.01] relative group">
            {match.status === 'pending' && isAdmin && (
                <button
                    onClick={onEdit}
                    className="absolute z-10 top-3 right-3 p-2.5 bg-linear-to-br from-saibro-600 to-saibro-700 hover:from-saibro-700 hover:to-saibro-800 text-white rounded-xl transition-all duration-200 hover:scale-110 shadow-lg shadow-saibro-200"
                >
                    <Trophy size={14} />
                </button>
            )}

            {/* Player A */}
            <div className={`flex justify-between items-center px-5 py-4 border-b-2 transition-colors ${isWinnerSide(match, 'A') ? 'bg-linear-to-r from-saibro-50/40 to-orange-50/20 border-saibro-200' : 'border-stone-100'}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <img src={pA?.avatar || 'https://ui-avatars.com/api/?background=random'} className={`w-10 h-10 rounded-full object-cover border-3 shrink-0 transition-all ${isWinnerSide(match, 'A') ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' : 'border-stone-200'}`} />
                    <span className={`text-sm font-black truncate transition-colors ${isWinnerSide(match, 'A') ? 'text-stone-900' : 'text-stone-600'}`}>
                        {pA?.name || 'Aguardando...'}
                    </span>
                </div>
                <div className="flex gap-1.5 ml-2 shrink-0">
                    {match.scoreA && match.scoreA.length > 0 ? match.scoreA.map((s, i) => (
                        <span key={i} className={`w-8 h-8 flex items-center justify-center rounded-xl text-xs font-black shadow-sm transition-all ${
                            match.scoreA[i] > match.scoreB[i] 
                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                : 'bg-stone-100 text-stone-400'
                        }`}>
                            {s}
                        </span>
                    )) : [1, 2].map(i => <span key={i} className="w-8 h-8 flex items-center justify-center bg-stone-50 border-2 border-dashed border-stone-200 rounded-xl text-xs text-stone-300 font-black">-</span>)}
                </div>
            </div>
            {/* Player B */}
            <div className={`flex justify-between items-center px-5 py-4 transition-colors ${isWinnerSide(match, 'B') ? 'bg-linear-to-r from-saibro-50/40 to-orange-50/20' : ''}`}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <img src={pB?.avatar || 'https://ui-avatars.com/api/?background=random'} className={`w-10 h-10 rounded-full object-cover border-3 shrink-0 transition-all ${isWinnerSide(match, 'B') ? 'border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100' : 'border-stone-200'}`} />
                    <span className={`text-sm font-black truncate transition-colors ${isWinnerSide(match, 'B') ? 'text-stone-900' : 'text-stone-600'}`}>
                        {pB?.name || 'Aguardando...'}
                    </span>
                </div>
                <div className="flex gap-1.5 ml-2 shrink-0">
                    {match.scoreB && match.scoreB.length > 0 ? match.scoreB.map((s, i) => (
                        <span key={i} className={`w-8 h-8 flex items-center justify-center rounded-xl text-xs font-black shadow-sm transition-all ${
                            match.scoreB[i] > match.scoreA[i] 
                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200' 
                                : 'bg-stone-100 text-stone-400'
                        }`}>
                            {s}
                        </span>
                    )) : [1, 2].map(i => <span key={i} className="w-8 h-8 flex items-center justify-center bg-stone-50 border-2 border-dashed border-stone-200 rounded-xl text-xs text-stone-300 font-black">-</span>)}
                </div>
            </div>
        </div>
    );
};
