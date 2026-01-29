import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PointRule } from '../types';
import { Settings, Save, Loader2, Info } from 'lucide-react';

export const AdminRules: React.FC = () => {
    const [rules, setRules] = useState<PointRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [edits, setEdits] = useState<Record<string, number>>({});

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('point_rules')
            .select('*')
            .order('rule_key');

        if (data) setRules(data);
        if (error) console.error('Error fetching rules:', error);
        setLoading(false);
    };

    const handleEditChange = (id: string, value: string) => {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
            setEdits(prev => ({ ...prev, [id]: numValue }));
        }
    };

    const handleSave = async (rule: PointRule) => {
        const newValue = edits[rule.id];
        if (newValue === undefined || newValue === rule.points) return;

        setSaving(rule.id);
        try {
            const { error } = await supabase
                .from('point_rules')
                .update({ points: newValue, updated_at: new Date().toISOString() })
                .eq('id', rule.id);

            if (error) throw error;

            // Update local state
            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, points: newValue } : r));
            setEdits(prev => {
                const newEdits = { ...prev };
                delete newEdits[rule.id];
                return newEdits;
            });
            alert('Regra atualizada com sucesso!');

        } catch (error: any) {
            console.error('Error updating rule:', error);
            alert('Erro ao atualizar regra.');
        } finally {
            setSaving(null);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-saibro-500" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800">
                <Info className="shrink-0 mt-0.5" />
                <div>
                    <h4 className="font-bold text-sm">Configuração Global de Pontuação</h4>
                    <p className="text-xs mt-1 opacity-90">
                        Alterar estes valores afetará a pontuação calculada para novas partidas. Partidas antigas podem não ser recalculadas automaticamente.
                    </p>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
                <div className="p-6 border-b border-stone-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                        <Settings className="text-saibro-600" />
                        Regras de Pontos
                    </h2>
                </div>

                <div className="divide-y divide-stone-100">
                    {rules.map(rule => {
                        const hasChanges = edits[rule.id] !== undefined && edits[rule.id] !== rule.points;

                        return (
                            <div key={rule.id} className="p-6 flex items-center justify-between hover:bg-stone-50 transition-colors">
                                <div>
                                    <h4 className="font-bold text-stone-800 font-mono text-base">{rule.rule_key}</h4>
                                    <p className="text-sm text-stone-500 mt-1">{rule.description}</p>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col items-end">
                                        <label className="text-[10px] font-bold uppercase text-stone-400 mb-1">Pontos</label>
                                        <input
                                            type="number"
                                            value={edits[rule.id] !== undefined ? edits[rule.id] : rule.points}
                                            onChange={e => handleEditChange(rule.id, e.target.value)}
                                            className="w-24 px-3 py-2 border border-stone-200 rounded-lg text-right font-bold text-stone-800 focus:ring-2 focus:ring-saibro-500 outline-none transition-all"
                                        />
                                    </div>

                                    <button
                                        onClick={() => handleSave(rule)}
                                        disabled={!hasChanges || saving === rule.id}
                                        className={`p-3 rounded-lg transition-all ${hasChanges
                                                ? 'bg-saibro-600 text-white hover:bg-saibro-700 shadow-md'
                                                : 'bg-stone-100 text-stone-300 cursor-not-allowed'
                                            }`}
                                    >
                                        {saving === rule.id ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
