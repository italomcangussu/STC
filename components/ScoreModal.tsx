import React, { useState } from 'react';
import { Trophy, XCircle, Trash2, CheckCircle, Loader2, Plus, Minus } from 'lucide-react';
import { Challenge } from '../types';
import { StandardModal } from './StandardModal';

interface ScoreModalProps {
    challenge: Challenge;
    challengerName: string;
    challengedName: string;
    onClose: () => void;
    onSave: (scores: { a: number, b: number }[]) => Promise<void>;
}

export const ScoreModal: React.FC<ScoreModalProps> = ({ challenge, challengerName, challengedName, onClose, onSave }) => {
    const [sets, setSets] = useState<{ a: string, b: string }[]>([{ a: '', b: '' }]);
    const [saving, setSaving] = useState(false);

    const handleSetChange = (index: number, player: 'a' | 'b', value: string) => {
        const newSets = [...sets];
        newSets[index][player] = value;
        setSets(newSets);
    };

    const addSet = () => {
        if (sets.length < 3) setSets([...sets, { a: '', b: '' }]);
    };

    const removeSet = (index: number) => {
        setSets(sets.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        setSaving(true);
        // Convert to numbers
        const numericSets = sets
            .filter(s => s.a !== '' && s.b !== '')
            .map(s => ({ a: parseInt(s.a), b: parseInt(s.b) }));

        await onSave(numericSets);
        setSaving(false);
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="bg-saibro-500 p-4 text-white flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2"><Trophy size={18} /> Lançar Resultado</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-lg"><XCircle size={20} /></button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex justify-between items-center text-sm font-bold text-stone-500 uppercase px-4">
                        <span>{challengerName}</span>
                        <span>{challengedName}</span>
                    </div>

                    <div className="space-y-4">
                        {sets.map((set, idx) => (
                            <div key={idx} className="bg-stone-50 p-4 rounded-2xl border border-stone-100 animate-in slide-in-from-left duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                                <div className="flex items-center justify-between mb-3 border-b border-stone-100 pb-2">
                                    <span className="text-xs font-black text-saibro-500 uppercase tracking-widest">Set {idx + 1}</span>
                                    {idx > 0 && (
                                        <button onClick={() => removeSet(idx)} className="text-red-400 hover:text-red-500 p-1 hover:bg-red-50 rounded-lg transition-colors">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    {/* Player A Controls */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleSetChange(idx, 'a', (Math.max(0, parseInt(set.a || '0') - 1)).toString())}
                                            className="w-10 h-10 flex items-center justify-center bg-white border border-stone-200 rounded-xl text-stone-600 shadow-sm active:scale-95 transition-transform"
                                        >
                                            <Minus size={16} strokeWidth={3} />
                                        </button>
                                        <input
                                            type="number"
                                            value={set.a}
                                            onChange={(e) => handleSetChange(idx, 'a', e.target.value)}
                                            className="w-14 h-14 text-center text-3xl font-black rounded-2xl border-2 border-stone-100 bg-white text-stone-800 focus:border-saibro-500 outline-none transition-all"
                                            placeholder="0"
                                        />
                                        <button
                                            onClick={() => handleSetChange(idx, 'a', (parseInt(set.a || '0') + 1).toString())}
                                            className="w-10 h-10 flex items-center justify-center bg-saibro-50 text-saibro-600 border border-saibro-100 rounded-xl shadow-sm active:scale-95 transition-transform"
                                        >
                                            <Plus size={16} strokeWidth={3} />
                                        </button>
                                    </div>

                                    <span className="text-stone-300 font-black text-xl italic mx-1">vs</span>

                                    {/* Player B Controls */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleSetChange(idx, 'b', (parseInt(set.b || '0') + 1).toString())}
                                            className="w-10 h-10 flex items-center justify-center bg-saibro-50 text-saibro-600 border border-saibro-100 rounded-xl shadow-sm active:scale-95 transition-transform"
                                        >
                                            <Plus size={16} strokeWidth={3} />
                                        </button>
                                        <input
                                            type="number"
                                            value={set.b}
                                            onChange={(e) => handleSetChange(idx, 'b', e.target.value)}
                                            className="w-14 h-14 text-center text-3xl font-black rounded-2xl border-2 border-stone-100 bg-white text-stone-800 focus:border-saibro-500 outline-none transition-all"
                                            placeholder="0"
                                        />
                                        <button
                                            onClick={() => handleSetChange(idx, 'b', (Math.max(0, parseInt(set.b || '0') - 1)).toString())}
                                            className="w-10 h-10 flex items-center justify-center bg-white border border-stone-200 rounded-xl text-stone-600 shadow-sm active:scale-95 transition-transform"
                                        >
                                            <Minus size={16} strokeWidth={3} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {sets.length < 3 && (
                        <button onClick={addSet} className="text-sm text-saibro-600 font-bold hover:underline py-2 block w-full text-center">
                            + Adicionar Set
                        </button>
                    )}

                    <div className="flex gap-3 pt-4 border-t border-stone-100">
                        <button onClick={onClose} className="flex-1 py-3 text-stone-500 font-medium hover:bg-stone-50 rounded-xl">Cancelar</button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-1 py-3 bg-saibro-500 text-white font-bold rounded-xl hover:bg-saibro-600 disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {saving ? <Loader2 className="animate-spin" /> : <><CheckCircle size={18} /> Salvar Placar</>}
                        </button>
                    </div>
                </div>
            </div>
        </StandardModal>
    );
};
