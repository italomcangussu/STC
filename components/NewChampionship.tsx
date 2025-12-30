import React, { useState, useEffect } from 'react';
import {
    ChevronRight, ChevronLeft, Trophy, Users, Shield,
    Settings, Play, Save, CheckCircle2, AlertCircle, Info, Plus, Trash2, Search, X, Loader2
} from 'lucide-react';
import { User, Championship, Match } from '../types';
import { supabase } from '../lib/supabase';

interface NewChampionshipProps {
    onClose: () => void;
    onSave: (champ: Championship, matches: Match[]) => void;
}

export const NewChampionship: React.FC<NewChampionshipProps> = ({ onClose, onSave }) => {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<Partial<Championship>>({
        name: '',
        season: '',
        description: '',
        status: 'draft',
        format: 'mata-mata',
        ptsVictory: 100,
        ptsSet: 10,
        ptsGame: 1,
        countInGeneralRanking: true,
        bestOfSets: 3,
        tiebreakEnabled: true,
        autoSummary: true,
        participantIds: [],
        rules: ''
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [generatedMatches, setGeneratedMatches] = useState<Match[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [loadingProfiles, setLoadingProfiles] = useState(true);

    // Fetch profiles from Supabase
    useEffect(() => {
        const fetchProfiles = async () => {
            setLoadingProfiles(true);
            const { data } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, category, role')
                .in('role', ['socio', 'admin']);

            setProfiles((data || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                category: p.category,
                role: p.role,
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));
            setLoadingProfiles(false);
        };
        fetchProfiles();
    }, []);

    const steps = [
        { id: 1, label: 'Básico', icon: <Info size={18} /> },
        { id: 2, label: 'Regras', icon: <Settings size={18} /> },
        { id: 3, label: 'Participantes', icon: <Users size={18} /> },
        { id: 4, label: 'Geração', icon: <Shield size={18} /> },
        { id: 5, label: 'Publicar', icon: <CheckCircle2 size={18} /> },
    ];

    const generateMatches = () => {
        const ids = formData.participantIds || [];
        if (ids.length < 2) return;

        let newMatches: Match[] = [];
        const champId = 'champ_' + Date.now();

        if (formData.format === 'mata-mata') {
            // Simple Single Elimination logic
            // Round 1: Pair up players. Handle odd number with a "BYE" or placeholder
            const numParticipants = ids.length;
            const powerOf2 = Math.pow(2, Math.ceil(Math.log2(numParticipants)));

            // To keep it simple for this mock: generate first round matches
            // If 4 players: 2 matches in Semi, 1 Final (placeholder)
            if (numParticipants <= 4) {
                // Semi 1
                newMatches.push({
                    id: `m_${Date.now()}_1`,
                    championshipId: champId,
                    type: 'Campeonato',
                    phase: 'Semi',
                    playerAId: ids[0],
                    playerBId: ids[1] || 'BYE',
                    scoreA: [], scoreB: [],
                    status: ids[1] ? 'pending' : 'finished',
                    winnerId: ids[1] ? undefined : ids[0]
                });
                // Semi 2
                newMatches.push({
                    id: `m_${Date.now()}_2`,
                    championshipId: champId,
                    type: 'Campeonato',
                    phase: 'Semi',
                    playerAId: ids[2] || 'BYE',
                    playerBId: ids[3] || 'BYE',
                    scoreA: [], scoreB: [],
                    status: (ids[2] && ids[3]) ? 'pending' : 'finished',
                    winnerId: (!ids[3] && ids[2]) ? ids[2] : undefined
                });
                // Final Placeholder
                newMatches.push({
                    id: `m_${Date.now()}_3`,
                    championshipId: champId,
                    type: 'Campeonato',
                    phase: 'Final',
                    playerAId: 'TBD',
                    playerBId: 'TBD',
                    scoreA: [], scoreB: [],
                    status: 'waiting_opponents'
                });
            } else {
                // Basic round-robin if more than 4 for now to avoid complex tree logic in mock
                // Or just show Quartas placeholders
                for (let i = 0; i < ids.length; i += 2) {
                    newMatches.push({
                        id: `m_${Date.now()}_${i}`,
                        championshipId: champId,
                        type: 'Campeonato',
                        phase: 'Quartas',
                        playerAId: ids[i],
                        playerBId: ids[i + 1] || 'BYE',
                        scoreA: [], scoreB: [],
                        status: ids[i + 1] ? 'pending' : 'finished',
                        winnerId: ids[i + 1] ? undefined : ids[i]
                    });
                }
            }
        } else {
            // Pontos Corridos: Round Robin
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    newMatches.push({
                        id: `m_${Date.now()}_${i}_${j}`,
                        championshipId: champId,
                        type: 'Campeonato',
                        playerAId: ids[i],
                        playerBId: ids[j],
                        scoreA: [], scoreB: [],
                        status: 'pending'
                    });
                }
            }
        }

        setGeneratedMatches(newMatches);
        setStep(5); // Go to final review
    };

    const nextStep = () => {
        if (step === 4) {
            generateMatches();
        } else {
            setStep(s => Math.min(s + 1, 5));
        }
    };
    const prevStep = () => setStep(s => Math.max(s - 1, 1));

    const handleToggleParticipant = (userId: string) => {
        const ids = [...(formData.participantIds || [])];
        if (ids.includes(userId)) {
            setFormData({ ...formData, participantIds: ids.filter(id => id !== userId) });
        } else {
            setFormData({ ...formData, participantIds: [...ids, userId] });
        }
    };

    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-500 uppercase">Nome do Campeonato</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none"
                                placeholder="Ex: Torneio de Verão"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-stone-500 uppercase">Temporada/Edição</label>
                                <input
                                    type="text"
                                    value={formData.season}
                                    onChange={e => setFormData({ ...formData, season: e.target.value })}
                                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none"
                                    placeholder="Ex: 2026.1"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-stone-500 uppercase">Data Início</label>
                                <input
                                    type="date"
                                    value={formData.startDate}
                                    onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-500 uppercase">Descrição</label>
                            <textarea
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none h-24"
                                placeholder="Breve descrição do campeonato..."
                            />
                        </div>
                    </div>
                );
            case 2:
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-stone-500 uppercase">Formato do Campeonato</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setFormData({ ...formData, format: 'mata-mata' })}
                                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${formData.format === 'mata-mata' ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100'}`}
                                >
                                    <Shield size={24} className={formData.format === 'mata-mata' ? 'text-saibro-600' : 'text-stone-300'} />
                                    <span className="font-bold text-sm">Mata-Mata</span>
                                </button>
                                <button
                                    onClick={() => setFormData({ ...formData, format: 'pontos-corridos' })}
                                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${formData.format === 'pontos-corridos' ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100'}`}
                                >
                                    <Trophy size={24} className={formData.format === 'pontos-corridos' ? 'text-saibro-600' : 'text-stone-300'} />
                                    <span className="font-bold text-sm">Pontos Corridos</span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-xs font-bold text-stone-500 uppercase">Regras de Pontuação (Ranking)</label>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                                    <p className="text-[10px] font-bold text-stone-400 mb-1">VITÓRIA</p>
                                    <input type="number" value={formData.ptsVictory} onChange={e => setFormData({ ...formData, ptsVictory: Number(e.target.value) })} className="bg-transparent font-bold w-full outline-none" />
                                </div>
                                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                                    <p className="text-[10px] font-bold text-stone-400 mb-1">SET</p>
                                    <input type="number" value={formData.ptsSet} onChange={e => setFormData({ ...formData, ptsSet: Number(e.target.value) })} className="bg-transparent font-bold w-full outline-none" />
                                </div>
                                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                                    <p className="text-[10px] font-bold text-stone-400 mb-1">GAME</p>
                                    <input type="number" value={formData.ptsGame} onChange={e => setFormData({ ...formData, ptsGame: Number(e.target.value) })} className="bg-transparent font-bold w-full outline-none" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 pt-2">
                            <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer">
                                <input type="checkbox" checked={formData.countInGeneralRanking} onChange={e => setFormData({ ...formData, countInGeneralRanking: e.target.checked })} className="w-5 h-5 accent-saibro-500" />
                                <span className="text-sm font-medium text-stone-700">Contabilizar no ranking geral do clube</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer">
                                <input type="checkbox" checked={formData.tiebreakEnabled} onChange={e => setFormData({ ...formData, tiebreakEnabled: e.target.checked })} className="w-5 h-5 accent-saibro-500" />
                                <span className="text-sm font-medium text-stone-700">Habilitar Super Tiebreak (3º set)</span>
                            </label>
                        </div>
                    </div>
                );
            case 3:
                const filteredUsers = profiles.filter(u => u.role === 'socio' && u.name.toLowerCase().includes(searchTerm.toLowerCase()));
                return (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar sócios..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-saibro-500"
                            />
                        </div>

                        <div className="text-xs font-bold text-stone-500 uppercase flex justify-between">
                            <span>Selecionar Participantes</span>
                            <span>{formData.participantIds?.length} selecionados</span>
                        </div>

                        <div className="space-y-2 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                            {filteredUsers.map(u => (
                                <button
                                    key={u.id}
                                    onClick={() => handleToggleParticipant(u.id)}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${formData.participantIds?.includes(u.id) ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100 bg-white'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <img src={u.avatar} className="w-8 h-8 rounded-full" alt="" />
                                        <div className="text-left">
                                            <p className="text-sm font-bold text-stone-700">{u.name}</p>
                                            <p className="text-[10px] text-stone-400 uppercase">{u.category}</p>
                                        </div>
                                    </div>
                                    {formData.participantIds?.includes(u.id) && <CheckCircle2 size={18} className="text-saibro-500" />}
                                </button>
                            ))}
                        </div>

                        {formData.participantIds!.length < 2 && (
                            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex gap-3 text-amber-700">
                                <AlertCircle size={20} className="shrink-0" />
                                <p className="text-xs leading-relaxed">Mínimo de 2 participantes para iniciar o campeonato.</p>
                            </div>
                        )}
                    </div>
                );
            case 4:
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 text-center py-8">
                        <div className="inline-block p-6 bg-saibro-100 rounded-full text-saibro-600 mb-4 animate-bounce">
                            <Play size={48} />
                        </div>
                        <h3 className="text-xl font-bold text-stone-800">Pronto para gerar a tabela?</h3>
                        <p className="text-sm text-stone-500 max-w-xs mx-auto">
                            Com base nos {formData.participantIds?.length} participantes e no formato {formData.format === 'mata-mata' ? 'Mata-Mata' : 'Pontos Corridos'}, criaremos todos os confrontos iniciais.
                        </p>

                        <div className="mt-8 p-4 bg-stone-50 rounded-2xl border border-stone-200 text-left">
                            <p className="text-[10px] font-bold text-stone-400 mb-2 uppercase">Prévia do Chaveamento</p>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-stone-600">Total de Jogos</span>
                                    <span className="font-bold">
                                        {formData.format === 'mata-mata'
                                            ? (formData.participantIds!.length > 0 ? Math.pow(2, Math.ceil(Math.log2(formData.participantIds!.length))) - 1 : 0)
                                            : (formData.participantIds!.length * (formData.participantIds!.length - 1) / 2)
                                        }
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-stone-600">Fase Inicial</span>
                                    <span className="font-bold">{formData.participantIds!.length <= 4 ? 'Semifinal' : formData.participantIds!.length <= 8 ? 'Quartas' : 'Oitavas'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 5:
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="p-6 bg-green-50 rounded-2xl border border-green-100 text-center">
                            <div className="inline-block p-3 bg-green-600 text-white rounded-full mb-4">
                                <CheckCircle2 size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-green-900">Confrontos Gerados</h3>
                            <p className="text-sm text-green-700">{generatedMatches.length} partidas criadas com sucesso.</p>
                        </div>

                        <div className="space-y-3 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                            {generatedMatches.map((m, idx) => {
                                const pA = profiles.find(u => u.id === m.playerAId);
                                const pB = profiles.find(u => u.id === m.playerBId);
                                return (
                                    <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex justify-between items-center">
                                        <div className="flex-1 text-sm font-bold text-right pr-3">{pA?.name || m.playerAId}</div>
                                        <div className="text-[10px] font-black text-stone-300">VS</div>
                                        <div className="flex-1 text-sm font-bold text-left pl-3">{pB?.name || m.playerBId}</div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-4">
                            <button
                                onClick={() => {
                                    const champId = generatedMatches[0]?.championshipId || 'champ_' + Date.now();
                                    const finalChamp = { ...formData, id: champId, status: 'draft' } as Championship;
                                    onSave(finalChamp, generatedMatches);
                                }}
                                className="py-4 bg-white border-2 border-stone-200 text-stone-600 font-bold rounded-2xl hover:bg-stone-50 transition-all flex items-center justify-center gap-2"
                            >
                                <Save size={20} /> Rascunho
                            </button>
                            <button
                                onClick={() => {
                                    const champId = generatedMatches[0]?.championshipId || 'champ_' + Date.now();
                                    const finalChamp = { ...formData, id: champId, status: 'ongoing' } as Championship;
                                    onSave(finalChamp, generatedMatches);
                                }}
                                className="py-4 bg-saibro-600 text-white font-bold rounded-2xl shadow-lg shadow-orange-200 hover:bg-saibro-700 transition-all flex items-center justify-center gap-2"
                            >
                                <Play size={20} /> Iniciar
                            </button>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 bg-gradient-to-r from-stone-900 to-stone-800 text-white flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold">Novo Campeonato</h2>
                        <p className="text-stone-400 text-xs">Configure os detalhes da competição</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Steps Indicator */}
                <div className="px-6 py-4 bg-stone-50 border-b border-stone-100 flex justify-between">
                    {steps.map(s => (
                        <div key={s.id} className="flex flex-col items-center gap-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${step === s.id ? 'bg-saibro-500 text-white shadow-md' : step > s.id ? 'bg-green-500 text-white' : 'bg-stone-200 text-stone-400'}`}>
                                {step > s.id ? <CheckCircle2 size={16} /> : s.icon}
                            </div>
                            <span className={`text-[9px] font-bold uppercase transition-colors ${step === s.id ? 'text-saibro-600' : 'text-stone-400'}`}>{s.label}</span>
                        </div>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {renderStepContent()}
                </div>

                {/* Footer */}
                {step < 5 && (
                    <div className="p-6 border-t border-stone-100 flex justify-between bg-white pt-4">
                        <button
                            disabled={step === 1}
                            onClick={prevStep}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${step === 1 ? 'text-transparent' : 'text-stone-500 hover:bg-stone-50'}`}
                        >
                            <ChevronLeft size={20} /> Voltar
                        </button>
                        <button
                            disabled={(step === 1 && !formData.name) || (step === 3 && formData.participantIds!.length < 2)}
                            onClick={nextStep}
                            className="flex items-center gap-2 px-8 py-3 bg-stone-900 text-white font-bold rounded-xl hover:bg-black transition-all disabled:opacity-50"
                        >
                            {step === 4 ? 'Gerar Tabela' : 'Próximo'} <ChevronRight size={20} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
