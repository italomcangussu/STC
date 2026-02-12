import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship, ChampionshipRound, Match, ChampionshipGroup, ChampionshipRegistration } from '../types';
import { Play, Calendar, Trophy, AlertTriangle, Loader2, Check, Clock, ChevronLeft, ChevronRight, Info, MapPin, Trash2, Shuffle, Target } from 'lucide-react';
import { generateRoundRobinMatches, getRoundDates } from '../lib/championshipUtils';
import { MatchScheduleModal } from './MatchScheduleModal';
import { GroupStandingsCard } from './GroupStandingsCard';
import { calculateGroupStandings } from '../lib/championshipUtils';
import { formatDateBr } from '../utils';
import { MatchGenerationModal } from './MatchGenerationModal';
import { MatchExportPreview } from './MatchExportPreview';
import { BracketView } from './BracketView';
import { StandingsDetailModal } from './StandingsDetailModal';
import html2canvas from 'html2canvas';
import { Share2, Download, X } from 'lucide-react';
import { getNowInFortaleza } from '../utils';


interface Props {
    championship: Championship;
    currentUser: any;
    onUpdate?: () => void;
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

export const ChampionshipInProgress: React.FC<Props> = ({ championship, currentUser, onUpdate }) => {
    const [loading, setLoading] = useState(true);
    const [rounds, setRounds] = useState<ChampionshipRound[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [registrations, setRegistrations] = useState<ChampionshipRegistration[]>([]);
    const [groups, setGroups] = useState<any[]>([]); // Need detailed group info
    const [processing, setProcessing] = useState(false);
    const [selectedRoundIndex, setSelectedRoundIndex] = useState(0);

    // Tab for navigation
    const [activeTab, setActiveTab] = useState<'matches' | 'standings' | 'bracket'>('matches');

    // Scheduling State
    const [schedulingMatch, setSchedulingMatch] = useState<Match | null>(null);
    const [courts, setCourts] = useState<any[]>([]);

    // Confirmation Modal State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showGenModal, setShowGenModal] = useState(false);
    const [resetting, setResetting] = useState(false);

    // Export State
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportDate, setExportDate] = useState<string>('');
    const [exportGroupId, setExportGroupId] = useState<string>('');
    const exportRef = React.useRef<HTMLDivElement>(null);
    const [exporting, setExporting] = useState(false);

    // Standings Detail Modal State
    const [showStandingsDetail, setShowStandingsDetail] = useState(false);
    const [selectedGroupForDetail, setSelectedGroupForDetail] = useState<{ group: any, standings: any[] } | null>(null);

    useEffect(() => {
        fetchData();
        fetchCourts();
    }, [championship.id]);

    const fetchCourts = async () => {
        const { data } = await supabase.from('courts').select('*');
        setCourts(data || []);
    };

    const fetchData = async () => {
        setLoading(true);

        // 1. Fetch Rounds
        const { data: rnds } = await supabase
            .from('championship_rounds')
            .select('*')
            .eq('championship_id', championship.id)
            .order('round_number');

        setRounds(rnds || []);

        // 2. Fetch Groups & Members
        const { data: grps } = await supabase
            .from('championship_groups')
            .select(`
                *,
                members:championship_group_members(*)
            `)
            .eq('championship_id', championship.id);
        setGroups(grps || []);

        // 3. Fetch Registrations
        const { data: regs } = await supabase
            .from('championship_registrations')
            .select('*, user:profiles!user_id(name, avatar_url)')
            .eq('championship_id', championship.id);

        setRegistrations(regs || []);

        // 4. Fetch Matches
        if (rnds && rnds.length > 0) {
            const { data: mtchs } = await supabase
                .from('matches')
                .select('*')
                .in('round_id', rnds.map(r => r.id));
            setMatches(mtchs || []);

            // Set current round (active or first)
            const activeIdx = (rnds || []).findIndex(r => r.status === 'active');
            setSelectedRoundIndex(activeIdx !== -1 ? activeIdx : 0);
        }

        setLoading(false);
    };

    const handleStartChampionship = async () => {
        console.log('🎾 Starting championship initialization...');
        setProcessing(true);

        try {
            console.log('📅 Step 1: Creating rounds...');
            // 1. Create Rounds (3 rounds fixed for now based on rules)
            const roundsToCreate = [1, 2, 3].map(num => ({
                championship_id: championship.id,
                round_number: num,
                name: `Rodada ${num}`,
                phase: 'classificatoria',
                start_date: getRoundDates(num).start,
                end_date: getRoundDates(num).end,
                status: num === 1 ? 'active' : 'pending' // First round active
            }));

            console.log('Rounds to create:', roundsToCreate);

            const { data: createdRounds, error: roundError } = await supabase
                .from('championship_rounds')
                .insert(roundsToCreate)
                .select();

            if (roundError) {
                console.error('❌ Error creating rounds:', roundError);
                throw roundError;
            }
            if (!createdRounds) {
                console.error('❌ No rounds were created');
                throw new Error('Failed to create rounds');
            }

            console.log('✅ Rounds created:', createdRounds);

            // 2. Generate Matches for each Group
            console.log('🎯 Step 2: Generating matches for', groups.length, 'groups...');
            let allMatches: any[] = [];

            for (const group of groups) {
                console.log(`Processing group: ${group.category} - Grupo ${group.group_name}`);

                // Prepare members with drawOrder
                const members = group.members.map((m: any) => ({
                    id: m.registration_id, // We use registration ID as player ID for logic
                    drawOrder: m.draw_order,
                    registrationId: m.registration_id
                }));

                console.log(`  Members (${members.length}):`, members);

                // If seed (drawOrder 0), ensure it's handled. logic handles 0,1,2,3
                const generated = generateRoundRobinMatches(members, group.id, createdRounds);
                console.log(`  Generated ${generated.length} matches for this group`);

                // IMPORTANT: map generateRoundRobinMatches result to DB schema
                // generateRoundRobinMatches now returns Partial<Match> with registration_id set
                // We need to resolve playerAId/playerBId if possible (for existing logic compatibility)
                const resolvedMatches = generated.map(gm => {
                    const regA = registrations.find(r => r.id === gm.registration_a_id);
                    const regB = registrations.find(r => r.id === gm.registration_b_id);

                    return {
                        ...gm,
                        player_a_id: regA?.user_id || null, // Guest -> null
                        player_b_id: regB?.user_id || null
                    };
                });

                allMatches = [...allMatches, ...resolvedMatches];
            }

            console.log(`✅ Total matches generated: ${allMatches.length}`);



            // 3. Insert Matches
            // Convert to database schema (snake_case)
            const matchesForDB = allMatches.map(m => ({
                type: m.type,
                championship_id: championship.id,
                championship_group_id: m.championship_group_id,
                round_id: m.round_id,
                player_a_id: m.player_a_id,
                player_b_id: m.player_b_id,
                registration_a_id: m.registration_a_id,
                registration_b_id: m.registration_b_id,
                score_a: m.scoreA || [0, 0, 0],
                score_b: m.scoreB || [0, 0, 0],
                status: m.status
            }));

            console.log('💾 Step 3: Inserting matches...', matchesForDB.length, 'matches');
            console.log('Sample match:', matchesForDB[0]);

            const { data: insertedMatches, error: matchError } = await supabase
                .from('matches')
                .insert(matchesForDB)
                .select();

            if (matchError) {
                console.error('❌ Match insertion error:', matchError);
                throw matchError;
            }

            console.log('✅ Matches inserted successfully:', insertedMatches?.length);

            // 4. Update status? Already ongoing. maybe set slug if not set?
            // (Slug logic can be done separately or auto-generated)

            console.log('🎉 Championship initialization complete!');
            alert('Campeonato iniciado com sucesso! Partidas geradas.');
            fetchData();
            onUpdate?.();

        } catch (error: any) {
            console.error('💥 Championship start error:', error);
            console.error('Error details:', error);
            alert('Erro ao iniciar campeonato: ' + (error.message || JSON.stringify(error)));
        }
        setProcessing(false);
    };

    const handleSchedule = async (date: string, time: string, courtId: string) => {
        if (!schedulingMatch) return;

        const { error } = await supabase
            .from('matches')
            .update({
                scheduled_date: date,
                scheduled_time: time,
                court_id: courtId,
                status: 'pending' // Ensure status is pending (not waiting)
            })
            .eq('id', schedulingMatch.id);

        if (error) {
            alert('Erro ao agendar: ' + error.message);
            throw error;
        }

        // Notification logic would go here (Push Notification)

        fetchData();
    };

    const handleResetMatches = async () => {
        if (!confirm('ATENÇÃO: Isso irá apagar TODOS os confrontos deste campeonato. Os grupos serão mantidos. Deseja continuar?')) return;

        setResetting(true);
        try {
            const roundIds = rounds.map(r => r.id);
            if (roundIds.length === 0) {
                // If no rounds yet, nothing to delete (or delete by championship_id if matches exist without rounds)
                const { error } = await supabase
                    .from('matches')
                    .delete()
                    .eq('championship_id', championship.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('matches')
                    .delete()
                    .in('round_id', roundIds);
                if (error) throw error;
            }

            alert('Confrontos apagados com sucesso!');
            fetchData();
        } catch (error: any) {
            console.error('Error resetting matches:', error);
            alert('Erro ao resetar confrontos: ' + error.message);
        }
        setResetting(false);
    };

    const handleExportImage = async () => {
        if (!exportRef.current) return;
        setExporting(true);
        try {
            const canvas = await html2canvas(exportRef.current, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#1c1917',
            });

            const link = document.createElement('a');
            link.download = `agenda-${championship.name.replace(/\s+/g, '-').toLowerCase()}-${exportDate}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('Export failed:', err);
            alert('Erro ao gerar imagem.');
        } finally {
            setExporting(false);
        }
    };

    // Prepare data for Export Preview
    // We map Registration IDs to Profiles for consistency (handling Guests)
    const exportProfiles = registrations.map(r => ({
        id: r.id,
        name: r.participant_type === 'guest' ? (r.guest_name || 'Convidado') : (r.user?.name || 'Sócio'),
        avatar: r.user?.avatar_url,
        // Mock required fields for User type
        role: 'socio', isActive: true, email: '', phone: '', balance: 0
    } as any));

    const exportMatches = matches
        .filter(m => {
            if (!exportDate) return false;
            // Match date logic: use scheduled_date
            return m.scheduled_date === exportDate &&
                (exportGroupId ? m.championship_group_id === exportGroupId : true);
        })
        .map(m => ({
            id: m.id,
            playerAId: m.registration_a_id, // Map to Registration ID
            playerBId: m.registration_b_id, // Map to Registration ID
            scoreA: m.score_a,
            scoreB: m.score_b,
            date: m.scheduled_date,
            scheduledTime: m.scheduled_time?.substring(0, 5),
            status: m.status,
            // ...
        } as any));

    const availableDates = Array.from(new Set(matches.map(m => m.scheduled_date).filter(Boolean))).sort();

    // Group matches by Round
    const matchesByRound = rounds.reduce((acc, round) => {
        acc[round.id] = matches.filter(m => m.round_id === round.id);
        return acc;
    }, {} as Record<string, Match[]>);

    if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto text-saibro-600" /></div>;

    // View: Start Button (if no rounds)
    if (rounds.length === 0) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[40vh] bg-stone-50 rounded-3xl border border-stone-200">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <Play size={40} className="text-green-600 ml-1" />
                </div>
                <h2 className="text-2xl font-black text-stone-800 mb-2">Pronto para Iniciar!</h2>
                <p className="text-stone-500 text-center max-w-md mb-8">
                    Os grupos foram sorteados. Ao iniciar, o sistema irá gerar automaticamente todas as rodadas e partidas da fase classificatória.
                </p>
                <button
                    onClick={() => setShowConfirmModal(true)}
                    disabled={processing}
                    className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-200 transition-all flex items-center gap-2 text-lg"
                >
                    {processing ? <Loader2 className="animate-spin" /> : <Play size={24} />}
                    Iniciar Campeonato Agora
                </button>

                {/* Confirm Modal Overlay */}
                {showConfirmModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                            <div className="p-8 text-center">
                                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <AlertTriangle size={32} className="text-amber-500" />
                                </div>
                                <h3 className="text-xl font-black text-stone-800 mb-2">Tem certeza?</h3>
                                <p className="text-stone-500 leading-relaxed">
                                    Isso irá gerar todas as partidas e o cronograma inicial para todos os grupos.
                                </p>
                            </div>
                            <div className="flex border-t border-stone-100">
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="flex-1 py-4 text-stone-500 font-bold hover:bg-stone-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => {
                                        setShowConfirmModal(false);
                                        handleStartChampionship();
                                    }}
                                    className="flex-1 py-4 text-green-600 font-black hover:bg-green-50 transition-colors border-l border-stone-100"
                                >
                                    Sim, Iniciar!
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // View: Dashboard
    return (
        <div className="space-y-6">
            {/* Scheduling Dashboard (Static Top) */}
            <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-stone-100 flex items-start gap-4">
                <div className="bg-saibro-100 p-3 rounded-2xl text-saibro-600">
                    <Clock size={20} />
                </div>
                <div className="flex-1">
                    <h3 className="text-sm font-black text-stone-800 uppercase tracking-tighter">Regras de Agendamento</h3>
                    <p className="text-[10px] text-stone-400 mt-1 leading-relaxed">
                        Jogos devem ser agendados via WhatsApp. Verifique as restrições:
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <span className="text-[9px] font-bold bg-saibro-50 text-saibro-600 px-2 py-1 rounded-lg border border-saibro-100">4-5ª: Saibro</span>
                        <span className="text-[9px] font-bold bg-stone-900 text-white px-2 py-1 rounded-lg">6ª: Rápida</span>
                        <span className="text-[9px] font-bold bg-stone-100 text-stone-600 px-2 py-1 rounded-lg">1-3ª: Livre</span>
                    </div>
                </div>
            </div>

            {/* Match Management Actions (Admin Only) */}
            {currentUser?.role === 'admin' && (
                <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-stone-100">
                    <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-4 px-2">Gerenciamento de Confrontos</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            onClick={() => setShowGenModal(true)}
                            className="flex items-center justify-center gap-2 py-4 bg-amber-50 text-amber-700 font-bold rounded-2xl border border-amber-100 hover:bg-amber-100 transition-all active:scale-[0.98]"
                        >
                            <Shuffle size={18} />
                            Gerar Manualmente
                        </button>
                        <button
                            onClick={handleResetMatches}
                            disabled={resetting}
                            className="flex items-center justify-center gap-2 py-4 bg-red-50 text-red-700 font-bold rounded-2xl border border-red-100 hover:bg-red-100 transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {resetting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                            Limpar Confrontos
                        </button>
                        <button
                            onClick={() => setShowExportModal(true)}
                            className="col-span-1 sm:col-span-2 flex items-center justify-center gap-2 py-4 bg-saibro-50 text-saibro-700 font-bold rounded-2xl border border-saibro-100 hover:bg-saibro-100 transition-all active:scale-[0.98]"
                        >
                            <Share2 size={18} />
                            Exportar Agenda (WhatsApp)
                        </button>
                    </div>
                </div>
            )}

            {/* Main Tabs */}
            <div className="flex bg-stone-100 p-1.5 rounded-3xl shadow-inner">
                <button
                    onClick={() => setActiveTab('matches')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black tracking-widest transition-all ${activeTab === 'matches' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}
                >
                    RODADAS
                </button>
                <button
                    onClick={() => setActiveTab('standings')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black tracking-widest transition-all ${activeTab === 'standings' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}
                >
                    CLASSIFICAÇÃO
                </button>
                <button
                    onClick={() => setActiveTab('bracket')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black tracking-widest transition-all ${activeTab === 'bracket' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}
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
                                <div className="flex items-center justify-between bg-white p-4 rounded-[2.5rem] border border-stone-100 shadow-sm">
                                    <button
                                        onClick={() => setSelectedRoundIndex(prev => Math.max(0, prev - 1))}
                                        className={`p-3 rounded-2xl transition-colors ${selectedRoundIndex > 0 ? 'text-saibro-600 bg-saibro-50' : 'text-stone-200 cursor-not-allowed'}`}
                                        disabled={selectedRoundIndex === 0}
                                    >
                                        <ChevronLeft size={24} />
                                    </button>
                                    <div className="text-center">
                                        <h3 className="font-black text-stone-900 text-sm">{currentRound.name}</h3>
                                        <p className="text-[9px] font-black text-saibro-600 uppercase tracking-widest mt-1">
                                            {formatDateBr(currentRound.start_date)} - {formatDateBr(currentRound.end_date)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setSelectedRoundIndex(prev => Math.min(rounds.length - 1, prev + 1))}
                                        className={`p-3 rounded-2xl transition-colors ${selectedRoundIndex < rounds.length - 1 ? 'text-saibro-600 bg-saibro-50' : 'text-stone-200 cursor-not-allowed'}`}
                                        disabled={selectedRoundIndex === rounds.length - 1}
                                    >
                                        <ChevronRight size={24} />
                                    </button>
                                </div>

                                {/* Publish Round Button (Admin Only) */}
                                {currentUser?.role === 'admin' && currentRound.status === 'pending' && (
                                    <div className="bg-amber-50 border border-amber-100 p-5 rounded-4xl flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
                                        <div className="flex-1">
                                            <h4 className="text-sm font-black text-amber-900 leading-tight">Rodada em Rascunho</h4>
                                            <p className="text-[10px] text-amber-700 font-bold mt-1">Os matches não estão visíveis para os sócios.</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setProcessing(true);
                                                const { error } = await supabase
                                                    .from('championship_rounds')
                                                    .update({ status: 'active' })
                                                    .eq('id', currentRound.id);

                                                if (error) {
                                                    alert('Erro ao publicar: ' + error.message);
                                                } else {
                                                    await fetchData();
                                                }
                                                setProcessing(false);
                                            }}
                                            disabled={processing}
                                            className="px-6 py-3 bg-amber-500 text-white text-[11px] font-black uppercase rounded-xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-200 flex items-center gap-2"
                                        >
                                            {processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="white" />}
                                            Publicar Rodada
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-4">
                                    {(matchesByRound[currentRound.id] || []).map(match => {
                                        const regA = registrations.find(r => r.id === match.registration_a_id);
                                        const regB = registrations.find(r => r.id === match.registration_b_id);
                                        const nameA = regA?.user?.name || regA?.guest_name || '...';
                                        const nameB = regB?.user?.name || regB?.guest_name || '...';
                                        const isFinished = match.status === 'finished';

                                        return (
                                            <div key={match.id} className="bg-white rounded-4xl p-6 shadow-sm border border-stone-100 relative overflow-hidden transition-all hover:border-saibro-200">
                                                <div className="absolute top-0 left-0 bg-stone-50 px-3 py-1 rounded-br-2xl text-[9px] font-black text-stone-400 uppercase tracking-tighter">
                                                    {regA?.class || 'N/A'}
                                                </div>

                                                <div className="flex items-center gap-6 mt-2">
                                                    <div className="flex-1 space-y-4">
                                                        <div className="flex items-center justify-between">
                                                            <span className={`text-sm font-bold ${match.winner_id === regA?.user_id ? 'text-stone-900' : 'text-stone-500'}`}>{nameA}</span>
                                                            {isFinished && (
                                                                <div className="flex gap-1">
                                                                    {match.score_a.map((s, i) => (
                                                                        <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.score_a[i] > match.score_b[i] ? 'bg-saibro-600 text-white shadow-sm' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className={`text-sm font-bold ${match.winner_id === regB?.user_id ? 'text-stone-900' : 'text-stone-500'}`}>{nameB}</span>
                                                            {isFinished && (
                                                                <div className="flex gap-1">
                                                                    {match.score_b.map((s, i) => (
                                                                        <span key={i} className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black ${match.score_b[i] > match.score_a[i] ? 'bg-saibro-600 text-white shadow-sm' : 'bg-stone-50 text-stone-300'}`}>{s}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-col items-center shrink-0 border-l border-stone-50 pl-4">
                                                        {match.scheduled_date ? (
                                                            <button
                                                                onClick={() => setSchedulingMatch(match)}
                                                                className="text-center group"
                                                            >
                                                                <div className="bg-saibro-50 p-2 rounded-xl text-saibro-600 group-hover:bg-saibro-100 transition-colors">
                                                                    <Clock size={16} />
                                                                </div>
                                                                <p className="text-[10px] font-black text-stone-800 mt-1">{match.scheduled_time?.substring(0, 5)}</p>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => setSchedulingMatch(match)}
                                                                className="w-10 h-10 rounded-2xl bg-stone-50 flex items-center justify-center text-stone-300 hover:text-saibro-600 transition-colors"
                                                            >
                                                                <Calendar size={18} />
                                                            </button>
                                                        )}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                    {groups.map(group => {
                        const groupMatches = matches.filter(m => m.championship_group_id === group.id);
                        const groupMemberIds = group.members.map((m: any) => m.registration_id);
                        const groupRegistrations = registrations.filter(r => groupMemberIds.includes(r.id));
                        const standings = calculateGroupStandings(groupRegistrations, groupMatches);

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
                // Bracket Tab - Sub-tabs by class
                <div className="space-y-6 pb-20">
                    {/* Class Sub-Tabs */}
                    {(() => {
                        const categories = [...new Set(groups.map(g => g.category))];
                        const [selectedCategory, setSelectedCategory] = React.useState(categories[0] || '');

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

                                {/* Bracket View */}
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
            {/* Modals */}
            {schedulingMatch && (
                <MatchScheduleModal
                    match={schedulingMatch}
                    roundName={rounds.find(r => r.id === schedulingMatch.round_id)?.name || 'Rodada'}
                    roundStartDate={rounds.find(r => r.id === schedulingMatch.round_id)?.start_date || ''}
                    roundEndDate={rounds.find(r => r.id === schedulingMatch.round_id)?.end_date || ''}
                    className={registrations.find(r => r.id === schedulingMatch.registration_a_id)?.class || ''}
                    courts={courts}
                    onSchedule={handleSchedule}
                    onClose={() => setSchedulingMatch(null)}
                />
            )}

            {showGenModal && (
                <MatchGenerationModal
                    championship={championship}
                    rounds={rounds}
                    groups={groups}
                    registrations={registrations}
                    onClose={() => setShowGenModal(false)}
                    onGenerated={fetchData}
                />
            )}

            {/* EXPORT MODAL */}
            {showExportModal && (
                <div className="fixed inset-0 bg-black/80 z-200 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row">
                        {/* CONTROLS */}
                        <div className="p-6 md:w-80 border-r border-stone-100 bg-stone-50 flex flex-col gap-6 overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-stone-800 text-lg tracking-tight">Exportar Agenda</h3>
                                <button onClick={() => setShowExportModal(false)} className="text-stone-400 hover:text-stone-700">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-stone-500 uppercase mb-2 block">Data dos Jogos</label>
                                    <select
                                        value={exportDate}
                                        onChange={(e) => setExportDate(e.target.value)}
                                        className="w-full p-3 rounded-xl border border-stone-200 bg-white font-bold text-stone-700 outline-none focus:border-saibro-500 transition-colors"
                                    >
                                        <option value="">Selecione uma data</option>
                                        {availableDates.map(d => (
                                            <option key={d} value={d}>
                                                {new Date(d! + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {groups.length > 0 && (
                                    <div>
                                        <label className="text-xs font-bold text-stone-500 uppercase mb-2">Filtrar por Grupo (Opcional)</label>
                                        <select
                                            value={exportGroupId}
                                            onChange={(e) => setExportGroupId(e.target.value)}
                                            className="w-full p-3 rounded-xl border border-stone-200 bg-white font-bold text-stone-700 outline-none focus:border-saibro-500 transition-colors"
                                        >
                                            <option value="">Todos os Grupos</option>
                                            {groups.map(g => (
                                                <option key={g.id} value={g.id}>{g.category} - {g.group_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="mt-auto">
                                <button
                                    onClick={handleExportImage}
                                    disabled={!exportDate || exporting}
                                    className="w-full py-4 bg-saibro-600 hover:bg-saibro-700 text-white rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-saibro-200 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                                >
                                    {exporting ? <Loader2 className="animate-spin" /> : <Download size={20} />}
                                    Baixar Imagem
                                </button>
                                <p className="text-[10px] text-stone-400 text-center mt-3">
                                    A imagem será gerada com os jogos filtrados ao lado.
                                </p>
                            </div>
                        </div>

                        {/* PREVIEW AREA */}
                        <div className="flex-1 bg-stone-900 p-8 overflow-auto flex items-start justify-center">
                            {exportDate ? (
                                <div className="scale-[0.6] md:scale-[0.7] origin-top shadow-2xl rounded-lg overflow-hidden ring-4 ring-black/50">
                                    <MatchExportPreview
                                        ref={exportRef}
                                        championship={championship}
                                        date={exportDate}
                                        groupName={groups.find(g => g.id === exportGroupId) ? `${groups.find(g => g.id === exportGroupId).category} - ${groups.find(g => g.id === exportGroupId).group_name}` : undefined}
                                        profiles={exportProfiles}
                                        matches={exportMatches}
                                    />
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-stone-600 gap-4">
                                    <Calendar size={48} className="opacity-20" />
                                    <p className="font-bold">Selecione uma data para visualizar</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
    );
};
