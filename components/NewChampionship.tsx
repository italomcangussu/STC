import React, { useState, useEffect } from 'react';
import {
    ChevronRight, ChevronLeft, Trophy, Users, Shield,
    Settings, Play, Save, CheckCircle2, AlertCircle, Info, Plus, Trash2, Search, X, Loader2
} from 'lucide-react';
import { User, Championship, Match, ChampionshipGroup } from '../types';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza } from '../utils';

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
        format: 'mata-mata',
        participantIds: [],
        startDate: getNowInFortaleza().toISOString().split('T')[0],
        ptsVictory: 3,
        ptsDefeat: 0,
        ptsWoVictory: 3,
        ptsSet: 0,
        ptsGame: 0,
        finalRankingPts: 200,
        countInGeneralRanking: true,
        tiebreakEnabled: true,
        groups: []
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [groups, setGroups] = useState<ChampionshipGroup[]>([]);
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
                .in('role', ['socio', 'admin'])
                .eq('is_active', true);

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
        } else if (formData.format === 'grupo-mata-mata') {
            // Group Stage: Round Robin per group
            groups.forEach(group => {
                const gIds = group.participantIds;
                for (let i = 0; i < gIds.length; i++) {
                    for (let j = i + 1; j < gIds.length; j++) {
                        newMatches.push({
                            id: `m_${Date.now()}_${group.name.replace(/\s+/g, '')}_${i}_${j}`,
                            championshipId: champId,
                            type: 'Campeonato',
                            phase: group.name, // Use group name as phase (e.g. "6ª CLASSE")
                            playerAId: gIds[i],
                            playerBId: gIds[j],
                            scoreA: [], scoreB: [],
                            status: 'pending'
                        });
                    }
                }
            });
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
        if (step === 3 && formData.format === 'grupo-mata-mata') {
            // Initialize groups if empty
            if (groups.length === 0) {
                setGroups([
                    { name: '6ª CLASSE', participantIds: [] },
                    { name: '5ª CLASSE', participantIds: [] },
                    { name: '4ª CLASSE', participantIds: [] }
                ]);
            }
            setStep(4); // Go to group config
            return;
        }

        // If coming from group config (4) or normal flow (3->4 if not groups), proceed to generation preview
        const next = step + 1;

        if (step === 4) {
            if (formData.format === 'grupo-mata-mata') {
                // Validate groups
                setFormData({ ...formData, groups });
            }
            generateMatches(); // This was the original logic for step 4
        } else {
            setStep(s => Math.min(s + 1, 5));
        }
    };

    const prevStep = () => setStep(s => Math.max(s - 1, 1));

    const handleToggleParticipant = (userId: string) => {
        const current = formData.participantIds || [];
        if (current.includes(userId)) {
            setFormData({ ...formData, participantIds: current.filter(id => id !== userId) });
        } else {
            setFormData({ ...formData, participantIds: [...current, userId] });
        }
    };

    // Helpler to render Preview (Ready to generate)
    const renderPreviewStep = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 text-center py-8">
            <div className="inline-block p-6 bg-saibro-100 rounded-full text-saibro-600 mb-4 animate-bounce">
                <Play size={48} />
            </div>
            <h3 className="text-xl font-bold text-stone-800">Pronto para gerar a tabela?</h3>
            <p className="text-sm text-stone-500 max-w-xs mx-auto">
                Com base nos {formData.participantIds?.length} participantes e no formato {formData.format}, criaremos todos os confrontos iniciais.
            </p>

            <div className="mt-8 p-4 bg-stone-50 rounded-2xl border border-stone-200 text-left">
                <p className="text-[10px] font-bold text-stone-400 mb-2 uppercase">Prévia do Chaveamento</p>
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-stone-600">Total de Jogos</span>
                        <span className="font-bold">
                            {formData.format === 'mata-mata'
                                ? (formData.participantIds!.length > 0 ? Math.pow(2, Math.ceil(Math.log2(formData.participantIds!.length))) - 1 : 0)
                                : (formData.format === 'grupo-mata-mata'
                                    ? groups.reduce((acc, g) => acc + (g.participantIds.length * (g.participantIds.length - 1) / 2), 0)
                                    : (formData.participantIds!.length * (formData.participantIds!.length - 1) / 2))
                            }
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-stone-600">Fase Inicial</span>
                        <span className="font-bold">{formData.format === 'grupo-mata-mata' ? 'Fase de Grupos' : (formData.participantIds!.length <= 4 ? 'Semifinal' : 'Oitavas')}</span>
                    </div>
                </div>
            </div>
        </div>
    );

    // Helper to render Review (Generated matches)
    const renderReviewStep = () => (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="p-6 bg-green-50 rounded-2xl border border-green-100 text-center">
                <div className="inline-block p-3 bg-green-600 text-white rounded-full mb-4">
                    <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-green-900">Confrontos Gerados</h3>
                <p className="text-sm text-green-700">{generatedMatches.length} partidas criadas com sucesso.</p>
            </div>
            {/* List ... */}
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                {generatedMatches.map((m, idx) => {
                    const pA = profiles.find(u => u.id === m.playerAId);
                    const pB = profiles.find(u => u.id === m.playerBId);
                    return (
                        <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex justify-between items-center">
                            <div className="flex-1 text-sm font-bold text-right pr-3">{pA?.name || m.playerAId}</div>
                            <div className="text-[10px] font-black text-stone-300">VS</div>
                            <div className="flex-1 text-sm font-bold text-left pl-3">{pB?.name || m.playerBId}</div>
                            <span className="text-[10px] text-stone-400 ml-2 bg-stone-100 px-1 rounded">{m.phase}</span>
                        </div>
                    );
                })}
            </div>
            {/* Buttons */}
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
                            <div className="grid grid-cols-3 gap-3">
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
                                    <span className="font-bold text-sm text-center leading-tight">Pontos Corridos</span>
                                </button>
                                <button
                                    onClick={() => setFormData({ ...formData, format: 'grupo-mata-mata' })}
                                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${formData.format === 'grupo-mata-mata' ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100'}`}
                                >
                                    <Users size={24} className={formData.format === 'grupo-mata-mata' ? 'text-saibro-600' : 'text-stone-300'} />
                                    <span className="font-bold text-sm text-center leading-tight">Grupos + Mata-Mata</span>
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
                // If Group Format -> Show Group Config
                if (formData.format === 'grupo-mata-mata') {
                    const unassignedUsers = profiles.filter(u =>
                        formData.participantIds?.includes(u.id) &&
                        !groups.some(g => g.participantIds.includes(u.id))
                    );

                    const handleAddToGroup = (userId: string, groupIndex: number) => {
                        const newGroups = [...groups];
                        newGroups[groupIndex].participantIds.push(userId);
                        setGroups(newGroups);
                    };

                    const handleRemoveFromGroup = (userId: string, groupIndex: number) => {
                        const newGroups = [...groups];
                        newGroups[groupIndex].participantIds = newGroups[groupIndex].participantIds.filter(id => id !== userId);
                        setGroups(newGroups);
                    };

                    return (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3 text-blue-800">
                                <Info size={24} className="shrink-0" />
                                <div className="text-sm">
                                    <p className="font-bold">Distribuição de Grupos</p>
                                    <p>Organize os {formData.participantIds?.length} participantes nos grupos abaixo.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {groups.map((group, gIdx) => (
                                    <div key={gIdx} className="bg-stone-50 rounded-xl border border-stone-200 overflow-hidden">
                                        <div className="bg-stone-100 p-3 border-b border-stone-200 flex justify-between items-center">
                                            <h4 className="font-bold text-stone-700 text-sm">{group.name}</h4>
                                            <span className="text-xs bg-stone-200 px-2 py-0.5 rounded-full text-stone-600">{group.participantIds.length}</span>
                                        </div>
                                        <div className="p-2 space-y-2 min-h-[150px]">
                                            {group.participantIds.map(pid => {
                                                const p = profiles.find(u => u.id === pid);
                                                return (
                                                    <div key={pid} className="flex justify-between items-center bg-white p-2 rounded-lg border border-stone-100 shadow-sm text-xs">
                                                        <span className="font-bold text-stone-700 truncate max-w-[100px]">{p?.name}</span>
                                                        <button onClick={() => handleRemoveFromGroup(pid, gIdx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                                                    </div>
                                                )
                                            })}
                                            {group.participantIds.length === 0 && (
                                                <p className="text-xs text-stone-400 text-center py-4 italic">Arraste ou adicione</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {unassignedUsers.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs font-bold text-stone-500 uppercase">Não Atribuídos ({unassignedUsers.length})</p>
                                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                                        {unassignedUsers.map(u => (
                                            <div key={u.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-stone-200">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <img src={u.avatar} className="w-6 h-6 rounded-full" />
                                                    <span className="text-xs font-bold text-stone-700 truncate">{u.name}</span>
                                                    <span className="text-[10px] text-stone-400 uppercase">{u.category}</span>
                                                </div>
                                                <div className="flex gap-1">
                                                    {groups.map((g, gIdx2) => (
                                                        <button
                                                            key={gIdx2}
                                                            onClick={() => handleAddToGroup(u.id, gIdx2)}
                                                            className="w-6 h-6 flex items-center justify-center bg-saibro-100 text-saibro-700 rounded hover:bg-saibro-200 text-[10px] font-bold"
                                                            title={`Adicionar a ${g.name}`}
                                                        >
                                                            {g.name.split(' ')[0]}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }
                // Fallthrough to Preview logic if NOT group format (or handle sharing)
                // Since I cannot fallthrough in replace, I will copy the preview logic here for the 'else' case (or Step 5 for group)
                // Actually, Step 5 for group is the PREVIEW.
                return renderPreviewStep();

            case 5:
                if (formData.format === 'grupo-mata-mata') return renderPreviewStep();
                return renderReviewStep();

            case 6:
                if (formData.format === 'grupo-mata-mata') return renderReviewStep();
                return null;

            default:
                return null;
        }
    };

    // Helpler to render Preview (Ready to generate)


    return (
        <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 bg-linear-to-r from-stone-900 to-stone-800 text-white flex justify-between items-center">
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
