import React, { useState } from 'react';
import { Trophy, XCircle, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { Challenge } from '../types';

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
        <div className="fixed inset-0 bg-stone-900/70 flex items-center justify-center z-100 p-4 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 shadow-2xl">
                <div className="bg-saibro-500 p-4 text-white flex justify-between items-center">
                    <h3 className="font-bold flex items-center gap-2"><Trophy size={18} /> Lançar Resultado</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-lg"><XCircle size={20} /></button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex justify-between items-center text-sm font-bold text-stone-500 uppercase px-4">
                        <span>{challengerName}</span>
                        <span>{challengedName}</span>
                    </div>

                    <div className="space-y-3">
                        {sets.map((set, idx) => (
                            <div key={idx} className="flex items-center gap-4 bg-stone-50 p-3 rounded-xl">
                                <span className="text-xs font-bold text-stone-400 w-8">Set {idx + 1}</span>
                                <input
                                    type="number"
                                    value={set.a}
                                    onChange={(e) => handleSetChange(idx, 'a', e.target.value)}
                                    className="w-12 h-12 text-center text-xl font-bold rounded-lg border border-stone-200 focus:ring-2 focus:ring-saibro-500 outline-none"
                                />
                                <span className="text-stone-300 font-bold">x</span>
                                <input
                                    type="number"
                                    value={set.b}
                                    onChange={(e) => handleSetChange(idx, 'b', e.target.value)}
                                    className="w-12 h-12 text-center text-xl font-bold rounded-lg border border-stone-200 focus:ring-2 focus:ring-saibro-500 outline-none"
                                />
                                {idx > 0 && (
                                    <button onClick={() => removeSet(idx)} className="text-red-400 hover:text-red-500"><Trash2 size={16} /></button>
                                )}
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
        </div>
    );
};
