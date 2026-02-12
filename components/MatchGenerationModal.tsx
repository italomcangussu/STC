import React, { useState } from 'react';
import { X, Trophy, Calendar, Check, Loader2, AlertTriangle, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Championship, ChampionshipRound, ChampionshipRegistration } from '../types';
import { generateRoundRobinMatches } from '../lib/championshipUtils';

interface Props {
    championship: Championship;
    rounds: ChampionshipRound[];
    groups: any[];
    registrations: ChampionshipRegistration[];
    onClose: () => void;
    onGenerated: () => void;
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

export const MatchGenerationModal: React.FC<Props> = ({
    championship,
    rounds,
    groups,
    registrations,
    onClose,
    onGenerated
}) => {
    const [selectedClass, setSelectedClass] = useState(CLASSES[0]);
    const [selectedRoundId, setSelectedRoundId] = useState(rounds[0]?.id || '');
    const [processing, setProcessing] = useState(false);
    const [step, setStep] = useState<'selection' | 'preview' | 'confirm'>('selection');
    const [previewMatches, setPreviewMatches] = useState<any[]>([]);

    const handleGeneratePreview = () => {
        try {
            const selectedRound = rounds.find(r => r.id === selectedRoundId);
            if (!selectedRound) throw new Error('Rodada não encontrada');

            const classGroups = groups.filter(g => g.category === selectedClass);
            if (classGroups.length === 0) {
                alert(`Nenhum grupo encontrado para a categoria ${selectedClass}`);
                return;
            }

            let matchesToPreview: any[] = [];
            for (const group of classGroups) {
                const members = group.members.map((m: any) => ({
                    id: m.registration_id,
                    drawOrder: m.draw_order,
                    registrationId: m.registration_id
                }));

                const allGroupMatches = generateRoundRobinMatches(members, group.id, [selectedRound]);
                const roundMatches = allGroupMatches.filter(m => m.round_id === selectedRoundId);

                const dbMatches = roundMatches.map(m => {
                    const regA = registrations.find(r => r.id === m.registration_a_id);
                    const regB = registrations.find(r => r.id === m.registration_b_id);

                    return {
                        type: 'Campeonato',
                        championship_group_id: m.championship_group_id,
                        round_id: m.round_id,
                        player_a_id: regA?.user_id || null,
                        player_b_id: regB?.user_id || null,
                        registration_a_id: m.registration_a_id,
                        registration_b_id: m.registration_b_id,
                        championship_id: championship.id,
                        score_a: [0, 0, 0],
                        score_b: [0, 0, 0],
                        status: 'pending',
                        // Extra field for preview display
                        _nameA: regA?.user?.name || regA?.guest_name || '...',
                        _nameB: regB?.user?.name || regB?.guest_name || '...',
                        _groupName: group.group_name
                    };
                });
                matchesToPreview = [...matchesToPreview, ...dbMatches];
            }

            if (matchesToPreview.length === 0) {
                alert('Nenhum confronto gerado para os critérios selecionados.');
                return;
            }

            setPreviewMatches(matchesToPreview);
            setStep('preview');
        } catch (error: any) {
            alert('Erro ao gerar preview: ' + error.message);
        }
    };

    const handleGenerate = async () => {
        setProcessing(true);
        try {
            const classGroups = groups.filter(g => g.category === selectedClass);

            // 1. Clear existing matches for this category AND round
            const { error: deleteError } = await supabase
                .from('matches')
                .delete()
                .eq('round_id', selectedRoundId)
                .in('championship_group_id', classGroups.map(g => g.id));

            if (deleteError) throw deleteError;

            // 2. Insert Previewed Matches (removing preview-only fields)
            const cleanMatches = previewMatches.map(({ _nameA, _nameB, _groupName, ...m }) => m);

            const { error: insertError } = await supabase
                .from('matches')
                .insert(cleanMatches);

            if (insertError) throw insertError;

            alert(`${cleanMatches.length} confrontos gerados com sucesso!`);
            onGenerated();
            onClose();
        } catch (error: any) {
            console.error('Error saving matches:', error);
            alert('Erro ao salvar confrontos: ' + error.message);
        }
        setProcessing(false);
    };

    return (
        <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center p-0 sm:p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[90vh] flex flex-col pt-safe pb-safe">
                {/* Header */}
                <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-saibro-50/50 flex-none">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-saibro-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-200">
                            <Trophy size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-stone-800">Gerar Confrontos</h3>
                            <p className="text-[10px] font-bold text-saibro-600 uppercase tracking-widest">Geração Manual por Rodada</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
                        <X size={20} className="text-stone-400" />
                    </button>
                </div>

                <div className="p-6 sm:p-8 overflow-y-auto flex-1 custom-scrollbar">
                    {step === 'selection' ? (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-3 px-1">Selecione a Categoria</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {CLASSES.map(cls => (
                                        <button
                                            key={cls}
                                            onClick={() => setSelectedClass(cls)}
                                            className={`py-3 px-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all border ${selectedClass === cls
                                                ? 'bg-saibro-600 text-white border-saibro-600 shadow-md transform scale-[1.02]'
                                                : 'bg-white text-stone-600 border-stone-100 hover:border-saibro-200'
                                                }`}
                                        >
                                            {cls}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-3 px-1">Selecione a Rodada</label>
                                <div className="space-y-2">
                                    {rounds.map(round => (
                                        <button
                                            key={round.id}
                                            onClick={() => setSelectedRoundId(round.id)}
                                            className={`w-full p-4 rounded-2xl text-left transition-all border flex items-center justify-between ${selectedRoundId === round.id
                                                ? 'bg-saibro-50 border-saibro-200 shadow-inner'
                                                : 'bg-white border-stone-100 hover:border-saibro-100'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Calendar size={18} className={selectedRoundId === round.id ? 'text-saibro-600' : 'text-stone-300'} />
                                                <div>
                                                    <p className={`text-sm font-bold ${selectedRoundId === round.id ? 'text-saibro-700' : 'text-stone-700'}`}>{round.name}</p>
                                                    <p className="text-[10px] text-stone-400">{round.start_date} até {round.end_date}</p>
                                                </div>
                                            </div>
                                            {selectedRoundId === round.id && <Check size={18} className="text-saibro-600" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : step === 'preview' ? (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between pb-2">
                                <h4 className="text-xs font-black text-stone-400 uppercase tracking-widest">Preview dos Confrontos</h4>
                                <span className="bg-saibro-100 text-saibro-600 text-[10px] font-black px-2 py-0.5 rounded-full">{previewMatches.length} JOGOS</span>
                            </div>
                            <div className="space-y-3">
                                {previewMatches.map((m, i) => (
                                    <div key={i} className="p-4 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-between gap-4">
                                        <div className="flex-1 text-xs">
                                            <p className="font-bold text-stone-800">{m._nameA}</p>
                                            <p className="text-[10px] text-stone-300 font-black my-1">VS</p>
                                            <p className="font-bold text-stone-800">{m._nameB}</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[9px] font-black text-stone-400 uppercase">Grupo {m._groupName}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center space-y-6 py-4">
                            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                                <AlertTriangle size={40} className="text-amber-500" />
                            </div>
                            <div>
                                <h4 className="text-xl font-black text-stone-800">Confirmar Geração</h4>
                                <p className="text-sm text-stone-500 mt-2 px-4">
                                    Gerar <strong>{previewMatches.length} confrontos</strong> para <strong>{selectedClass}</strong> na <strong>{rounds.find(r => r.id === selectedRoundId)?.name}</strong>.
                                </p>
                                <div className="mt-4 p-4 bg-red-50 rounded-2xl border border-red-100">
                                    <p className="text-[11px] text-red-600 font-bold leading-relaxed px-2">
                                        Atenção: Os jogos existentes para esta categoria e rodada serão removidos e substituídos por estes novos.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex-none pb-safe-extra">
                    {step === 'selection' ? (
                        <button
                            onClick={handleGeneratePreview}
                            className="w-full py-4 bg-stone-900 text-white font-bold rounded-2xl hover:bg-stone-800 transition-all flex items-center justify-center gap-2"
                        >
                            Ver Preview
                            <Play size={16} fill="white" />
                        </button>
                    ) : step === 'preview' ? (
                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep('selection')}
                                className="flex-1 py-4 bg-white border border-stone-200 text-stone-600 font-bold rounded-2xl hover:bg-stone-50 transition-all text-sm"
                            >
                                Reconfigurar
                            </button>
                            <button
                                onClick={() => setStep('confirm')}
                                className="flex-2 py-4 bg-saibro-600 text-white font-bold rounded-2xl hover:bg-saibro-700 shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                <Play size={16} fill="white" />
                                Salvar Confrontos
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep('preview')}
                                disabled={processing}
                                className="flex-1 py-4 bg-white border border-stone-200 text-stone-600 font-bold rounded-2xl hover:bg-stone-50 transition-all text-sm"
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={processing}
                                className="flex-2 py-4 bg-saibro-600 text-white font-bold rounded-2xl hover:bg-saibro-700 shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                {processing ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                                {processing ? 'Salvando...' : 'Confirmar e Salvar'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
