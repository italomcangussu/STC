import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Trophy, Calendar, CheckCircle2, AlertCircle,
    Save, Upload, Edit3, Trash2, Loader2
} from 'lucide-react';
import { Championship, Match, User } from '../types';
import { ResultModal } from './Championships';
import { supabase } from '../lib/supabase';
import { getMatchWinner } from '../utils';

interface AdminChampionshipDetailProps {
    championship: Championship;
    onBack: () => void;
    onUpdate: (updated: Championship) => void;
}

export const AdminChampionshipDetail: React.FC<AdminChampionshipDetailProps> = ({
    championship, onBack, onUpdate
}) => {
    const [activeTab, setActiveTab] = useState<'matches' | 'rules' | 'participants'>('matches');
    const [data, setData] = useState<Championship>(championship);
    const [matches, setMatches] = useState<Match[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);
    const [rules, setRules] = useState(championship.rules || '');
    const [loading, setLoading] = useState(false);
    const [loadingMatches, setLoadingMatches] = useState(true);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Load matches and profiles
    useEffect(() => {
        const loadData = async () => {
            setLoadingMatches(true);

            // Fetch matches
            const { data: matchesData } = await supabase
                .from('matches')
                .select('*')
                .eq('championship_id', championship.id)
                .order('phase', { ascending: true });

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
                status: m.status || 'pending'
            })));

            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url')
                .eq('is_active', true);

            setProfiles((profilesData || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                role: 'socio',
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));

            setLoadingMatches(false);
        };

        loadData();
    }, [championship.id]);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setUploading(true);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `${championship.id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('championship-logos')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('championship-logos')
                .getPublicUrl(filePath);

            const updated = { ...data, logoUrl: publicUrl };
            setData(updated);
            onUpdate(updated);
        } catch (error) {
            console.error('Error uploading logo:', error);
            alert('Erro ao fazer upload da logo.');
        } finally {
            setUploading(false);
        }
    };

    const handleSaveRules = async () => {
        setLoading(true);

        const { error } = await supabase
            .from('championships')
            .update({ rules })
            .eq('id', championship.id);

        if (error) {
            console.error('Error saving rules:', error);
            alert('Erro ao salvar regras.');
        } else {
            const updated = { ...data, rules };
            setData(updated);
            onUpdate(updated);
        }
        setLoading(false);
    };

    const handleStatusChange = (newStatus: 'draft' | 'ongoing' | 'finished') => {
        const updated = { ...data, status: newStatus };
        setData(updated);
        onUpdate(updated);
    };

    // Save result to Supabase
    const handleSaveResult = async (matchId: string, scoreA: number[], scoreB: number[]) => {
        const match = matches.find(m => m.id === matchId);
        if (!match) return;

        const winner = getMatchWinner(scoreA, scoreB);
        if (!winner) return;

        const winnerId = winner === 'A' ? match.playerAId : match.playerBId;

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
            alert('Erro ao salvar resultado.');
            return;
        }

        // Update local state
        setMatches(matches.map(m => m.id === matchId ? {
            ...m,
            scoreA,
            scoreB,
            winnerId,
            status: 'finished' as const,
            date: new Date().toISOString().split('T')[0]
        } : m));
        setEditingMatch(null);
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 min-h-[600px] flex flex-col">
            {/* HEADER */}
            <div className="p-6 border-b border-stone-100 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 -ml-2 text-stone-400 hover:text-stone-700 hover:bg-stone-50 rounded-full transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    {/* Logo / Avatar */}
                    <div className="relative group">
                        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-saibro-100 to-saibro-50 border-2 border-stone-100 flex items-center justify-center overflow-hidden">
                            {uploading ? (
                                <div className="animate-spin w-6 h-6 border-2 border-saibro-500 border-t-transparent rounded-full" />
                            ) : data.logoUrl ? (
                                <img src={data.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                            ) : (
                                <Trophy className="text-saibro-400" size={32} />
                            )}
                        </div>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white rounded-2xl transition-opacity cursor-pointer"
                        >
                            <Upload size={16} />
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleLogoUpload}
                        />
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
                            {data.name}
                            <button className="text-stone-300 hover:text-stone-500"><Edit3 size={14} /></button>
                        </h2>
                        <div className="flex items-center gap-3 mt-1 text-sm">
                            <span className={`px-2 py-0.5 rounded textxs font-bold ${data.status === 'ongoing' ? 'bg-green-100 text-green-700' :
                                data.status === 'finished' ? 'bg-stone-100 text-stone-600' : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                {data.status === 'ongoing' ? 'Em Andamento' :
                                    data.status === 'finished' ? 'Finalizado' : 'Rascunho'}
                            </span>
                            <span className="text-stone-400 flex items-center gap-1">
                                <Calendar size={12} /> {data.startDate ? new Date(data.startDate).toLocaleDateString() : 'Indefinido'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    {/* Status Toggle Actions */}
                </div>
            </div>

            {/* TABS */}
            <div className="border-b border-stone-100 px-6 flex gap-6">
                <button
                    onClick={() => setActiveTab('matches')}
                    className={`py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'matches' ? 'border-saibro-500 text-saibro-600' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
                >
                    Partidas
                </button>
                <button
                    onClick={() => setActiveTab('rules')}
                    className={`py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'rules' ? 'border-saibro-500 text-saibro-600' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
                >
                    Regras & Info
                </button>
                <button
                    onClick={() => setActiveTab('participants')}
                    className={`py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'participants' ? 'border-saibro-500 text-saibro-600' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
                >
                    Participantes ({data.participantIds.length})
                </button>
            </div>

            {/* CONTENT */}
            <div className="p-6 flex-1 overflow-y-auto">
                {activeTab === 'matches' && (
                    <div className="space-y-4">
                        {loadingMatches ? (
                            <div className="py-12 flex justify-center">
                                <Loader2 className="animate-spin text-saibro-500" size={32} />
                            </div>
                        ) : matches.length === 0 ? (
                            <div className="py-12 text-center text-stone-400 italic">Nenhuma partida gerada ainda.</div>
                        ) : (
                            matches.map(match => {
                                const pA = profiles.find(u => u.id === match.playerAId);
                                const pB = profiles.find(u => u.id === match.playerBId);

                                return (
                                    <div key={match.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl border border-stone-200">
                                        <div className="flex-1 flex justify-end gap-3 items-center">
                                            <span className="font-bold text-stone-700 text-sm">{pA?.name || match.playerAId}</span>
                                            {match.status === 'finished' && <span className="text-lg font-black">{match.scoreA.join('-')}</span>}
                                        </div>
                                        <div className="px-4 text-xs font-black text-stone-300">VS</div>
                                        <div className="flex-1 flex justify-start gap-3 items-center">
                                            {match.status === 'finished' && <span className="text-lg font-black">{match.scoreB.join('-')}</span>}
                                            <span className="font-bold text-stone-700 text-sm">{pB?.name || match.playerBId}</span>
                                        </div>

                                        <div className="w-24 flex justify-end">
                                            {match.status === 'pending' && match.playerAId !== 'TBD' && match.playerBId !== 'TBD' ? (
                                                <button
                                                    onClick={() => setEditingMatch(match)}
                                                    className="px-3 py-1 bg-saibro-500 text-white text-xs font-bold rounded-lg hover:bg-saibro-600"
                                                >
                                                    Lançar
                                                </button>
                                            ) : match.status === 'finished' ? (
                                                <button className="text-xs font-medium text-stone-400 hover:text-saibro-500">
                                                    Editar
                                                </button>
                                            ) : (
                                                <span className="text-[10px] text-stone-400">Aguardando</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {activeTab === 'rules' && (
                    <div className="space-y-4 max-w-2xl">
                        <div>
                            <label className="block text-sm font-bold text-stone-600 mb-2">Regulamento do Torneio</label>
                            <textarea
                                value={rules}
                                onChange={(e) => setRules(e.target.value)}
                                className="w-full h-64 p-4 rounded-xl border border-stone-200 focus:ring-2 focus:ring-saibro-500 focus:outline-none text-sm leading-relaxed"
                                placeholder="Descreva as regras de pontuação, desempate, agendamento..."
                            />
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={handleSaveRules}
                                disabled={loading}
                                className="flex items-center gap-2 px-6 py-2 bg-stone-800 text-white font-bold rounded-xl hover:bg-stone-900 transition-all"
                            >
                                {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                Salvar Alterações
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* MODAL */}
            {editingMatch && (
                <ResultModal
                    match={editingMatch}
                    profiles={profiles}
                    onClose={() => setEditingMatch(null)}
                    onSave={(scoreA, scoreB) => handleSaveResult(editingMatch.id, scoreA, scoreB)}
                />
            )}
        </div>
    );
};
