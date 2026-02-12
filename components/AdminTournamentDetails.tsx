import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship, ChampionshipRegistration, Match, User } from '../types';
import { ArrowLeft, Users, Trophy, Settings, Loader2, Plus, Trash2, Shuffle, AlertCircle } from 'lucide-react';
import { getNowInFortaleza } from '../utils';

interface TournamentManagerProps {
    tournamentId: string;
    onBack: () => void;
}

export const TournamentManager: React.FC<TournamentManagerProps> = ({ tournamentId, onBack }) => {
    const [activeTab, setActiveTab] = useState<'registrations' | 'brackets' | 'matches'>('registrations');
    const [tournament, setTournament] = useState<Championship | null>(null);
    const [registrations, setRegistrations] = useState<ChampionshipRegistration[]>([]);
    const [matches, setMatches] = useState<Match[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        fetchDetails();
    }, [tournamentId]);

    const fetchDetails = async () => {
        setLoading(true);
        // Fetch Tournament Info
        const { data: tData } = await supabase.from('championships').select('*').eq('id', tournamentId).single();
        if (tData) setTournament(tData);

        // Fetch Registrations
        const { data: rData } = await supabase
            .from('championship_registrations')
            .select(`*, user:profiles(*)`)
            .eq('championship_id', tournamentId);

        if (rData) {
            setRegistrations(rData.map((r: any) => ({
                id: r.id,
                championship_id: r.championship_id,
                participant_type: r.participant_type,
                user_id: r.user_id,
                guest_name: r.guest_name,
                class: r.class,
                shirt_size: r.shirt_size,
                user: r.user
            })));
        }

        // Fetch Matches
        const { data: mData } = await supabase
            .from('matches')
            .select('*')
            .eq('championship_id', tournamentId)
            .order('scheduled_time', { ascending: true });

        if (mData) {
            // Map matches if necessary, or use as is if types match
            setMatches(mData as any);
        }

        setLoading(false);
    };

    const handleGenerateBrackets = async () => {
        if (!confirm('Isso apagará chaves existentes e gerará novas aleatoriamente. Continuar?')) return;
        setGenerating(true);

        try {
            // 1. Delete existing matches for this championship
            await supabase.from('matches').delete().eq('championship_id', tournamentId);

            // 2. Shuffle Players
            const shuffled = [...registrations].sort(() => Math.random() - 0.5);

            // 3. Create Pairs (Simple Knockout Logic)
            const matchesToInsert = [];
            for (let i = 0; i < shuffled.length; i += 2) {
                const playerA = shuffled[i];
                const playerB = shuffled[i + 1]; // Might be undefined if odd number

                if (playerB) {
                    matchesToInsert.push({
                        championship_id: tournamentId,
                        phase: 'round_of_16', // Hardcoded phase 1 for MVP
                        type: 'Campeonato',
                        status: 'pending',
                        player_a_id: playerA.user_id,
                        player_b_id: playerB.user_id,
                        registration_a_id: playerA.id,
                        registration_b_id: playerB.id,
                        scheduled_date: getNowInFortaleza().toISOString().split('T')[0] // Default to today
                    });
                } else {
                    // Bye (Free Pass) logic or just leave unmatched for manual
                    console.log('Player left without opponent:', playerA);
                }
            }

            if (matchesToInsert.length > 0) {
                const { error } = await supabase.from('matches').insert(matchesToInsert);
                if (error) throw error;
                alert('Chaves geradas com sucesso!');
                fetchDetails(); // Refresh
                setActiveTab('matches');
            } else {
                alert('Número insuficiente de jogadores para gerar chaves.');
            }

        } catch (error: any) {
            console.error('Error generating brackets:', error);
            alert('Erro ao gerar chaves: ' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-saibro-500" /></div>;
    if (!tournament) return <div className="text-center py-12">Torneio não encontrado.</div>;

    const renderRegistrations = () => (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="font-bold text-stone-700">Inscritos ({registrations.length})</h3>
                <button className="text-saibro-600 text-sm font-bold flex items-center gap-1 hover:underline">
                    <Plus size={16} /> Adicionar Manualmente
                </button>
            </div>

            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-stone-50 text-stone-500 font-bold uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3">Nome</th>
                            <th className="px-4 py-3">Categoria</th>
                            <th className="px-4 py-3">Camisa</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                        {registrations.map(reg => (
                            <tr key={reg.id} className="hover:bg-stone-50">
                                <td className="px-4 py-3 font-medium text-stone-800">
                                    {reg.user?.name || reg.guest_name || 'Desconhecido'}
                                    {reg.participant_type === 'guest' && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Convidado</span>}
                                </td>
                                <td className="px-4 py-3">{reg.class}</td>
                                <td className="px-4 py-3">{reg.shirt_size}</td>
                                <td className="px-4 py-3 text-right">
                                    <button className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                                </td>
                            </tr>
                        ))}
                        {registrations.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-stone-400 italic">Nenhum inscrito ainda.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderBrackets = () => (
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Trophy size={48} className="text-stone-300" />
            <h3 className="text-lg font-bold text-stone-600">Geador de Chaves</h3>
            <p className="text-stone-400 text-sm max-w-md text-center">
                O sorteio automático distribuirá os {registrations.length} inscritos em confrontos diretos (Mata-mata).
            </p>
            <button
                onClick={handleGenerateBrackets}
                disabled={generating || registrations.length < 2}
                className="bg-saibro-600 hover:bg-saibro-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {generating ? <Loader2 className="animate-spin" /> : <Shuffle size={18} />}
                Gerar Chaveamento Aleatório
            </button>
        </div>
    );

    const renderMatches = () => (
        <div className="space-y-4">
            {matches.length === 0 ? (
                <div className="text-center py-12 text-stone-400">
                    Nenhuma partida gerada. Vá para a aba "Chaveamento" para sortear.
                </div>
            ) : (
                <div className="grid gap-3">
                    {matches.map(match => {
                        const playerA = registrations.find(r => r.id === match.registration_a_id);
                        const playerB = registrations.find(r => r.id === match.registration_b_id);
                        return (
                            <div key={match.id} className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex justify-between items-center">
                                <div className="flex-1 text-right font-bold text-stone-800">
                                    {playerA?.user?.name || playerA?.guest_name || 'A definir'}
                                </div>
                                <div className="px-4 text-xs font-bold text-stone-400 uppercase">VS</div>
                                <div className="flex-1 text-left font-bold text-stone-800">
                                    {playerB?.user?.name || playerB?.guest_name || 'A definir'}
                                </div>
                                <div className="ml-4 pl-4 border-l border-stone-100 flex items-center gap-2">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${match.status === 'finished' ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                                        {match.status === 'finished' ? 'Finalizado' : 'Pendente'}
                                    </span>
                                    <button className="p-1 hover:bg-stone-100 rounded text-stone-400">
                                        <Settings size={14} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <button onClick={onBack} className="p-2 hover:bg-stone-200 rounded-full text-stone-500 transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-2xl font-black text-stone-800">{tournament.name}</h2>
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">{tournament.status}</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-stone-200 pb-1">
                <button
                    onClick={() => setActiveTab('registrations')}
                    className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-colors ${activeTab === 'registrations' ? 'bg-saibro-100 text-saibro-700 border-b-2 border-saibro-500' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    Inscrições
                </button>
                <button
                    onClick={() => setActiveTab('brackets')}
                    className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-colors ${activeTab === 'brackets' ? 'bg-saibro-100 text-saibro-700 border-b-2 border-saibro-500' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    Chaveamento
                </button>
                <button
                    onClick={() => setActiveTab('matches')}
                    className={`px-4 py-2 font-bold text-sm rounded-t-lg transition-colors ${activeTab === 'matches' ? 'bg-saibro-100 text-saibro-700 border-b-2 border-saibro-500' : 'text-stone-400 hover:text-stone-600'}`}
                >
                    Partidas
                </button>
            </div>

            {/* Content */}
            <div className="min-h-[400px]">
                {activeTab === 'registrations' && renderRegistrations()}
                {activeTab === 'brackets' && renderBrackets()}
                {activeTab === 'matches' && renderMatches()}
            </div>
        </div>
    );
};
