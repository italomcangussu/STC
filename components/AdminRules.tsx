import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { PointRule } from '../types';
import { getNowInFortaleza } from '../utils';
import { Settings, Save, Loader2, Info, Trophy, Target, Award, TrendingUp, CheckCircle2, Sparkles } from 'lucide-react';

export const AdminRules: React.FC = () => {
    const [rules, setRules] = useState<PointRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [edits, setEdits] = useState<Record<string, number>>({});
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

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
                .update({ points: newValue, updated_at: getNowInFortaleza().toISOString() })
                .eq('id', rule.id);

            if (error) throw error;

            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, points: newValue } : r));
            setEdits(prev => {
                const newEdits = { ...prev };
                delete newEdits[rule.id];
                return newEdits;
            });

            setSaveSuccess(rule.id);
            setTimeout(() => setSaveSuccess(null), 2000);

        } catch (error: any) {
            console.error('Error updating rule:', error);
            alert('Erro ao atualizar regra.');
        } finally {
            setSaving(null);
        }
    };

    // Categorize rules
    const categorizedRules = useMemo(() => {
        const categories: Record<string, PointRule[]> = {
            victory: [],
            match: [],
            ranking: [],
            bonus: []
        };

        rules.forEach(rule => {
            const key = rule.rule_key.toLowerCase();
            if (key.includes('victory') || key.includes('defeat') || key.includes('wo')) {
                categories.victory.push(rule);
            } else if (key.includes('set') || key.includes('game')) {
                categories.match.push(rule);
            } else if (key.includes('ranking') || key.includes('final')) {
                categories.ranking.push(rule);
            } else {
                categories.bonus.push(rule);
            }
        });

        return categories;
    }, [rules]);

    // Calculate stats
    const totalRules = rules.length;
    const modifiedRules = Object.keys(edits).length;
    const avgPoints = rules.length > 0
        ? Math.round(rules.reduce((sum, r) => sum + r.points, 0) / rules.length)
        : 0;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="animate-spin text-saibro-600 mb-4" size={40} />
                <p className="text-stone-500 font-medium">Carregando regras de pontuação...</p>
            </div>
        );
    }

    const RuleCard: React.FC<{ rule: PointRule }> = ({ rule }) => {
        const hasChanges = edits[rule.id] !== undefined && edits[rule.id] !== rule.points;
        const isSaved = saveSuccess === rule.id;

        return (
            <div className={`group p-5 rounded-xl border transition-all duration-300 ${hasChanges
                ? 'bg-amber-50 border-amber-200 shadow-md'
                : isSaved
                    ? 'bg-green-50 border-green-200 shadow-md'
                    : 'bg-white border-stone-100 hover:border-saibro-200 hover:shadow-sm'
                }`}>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-black text-stone-800 text-sm tracking-tight uppercase">
                                {rule.rule_key}
                            </h4>
                            {hasChanges && (
                                <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                                    MODIFICADO
                                </span>
                            )}
                            {isSaved && (
                                <CheckCircle2 className="text-green-600 animate-in zoom-in-50 duration-200" size={16} />
                            )}
                        </div>
                        <p className="text-sm text-stone-600 leading-relaxed">{rule.description}</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end">
                            <label className="text-[9px] font-black uppercase text-stone-400 tracking-wider mb-1.5">Pontos</label>
                            <input
                                type="number"
                                value={edits[rule.id] !== undefined ? edits[rule.id] : rule.points}
                                onChange={e => handleEditChange(rule.id, e.target.value)}
                                className={`w-20 px-3 py-2.5 border-2 rounded-xl text-center font-black text-lg transition-all outline-none ${hasChanges
                                    ? 'border-amber-400 bg-white text-amber-700 ring-4 ring-amber-100'
                                    : 'border-stone-200 bg-stone-50 text-stone-800 focus:border-saibro-500 focus:ring-4 focus:ring-saibro-100'
                                    }`}
                            />
                        </div>

                        <button
                            onClick={() => handleSave(rule)}
                            disabled={!hasChanges || saving === rule.id}
                            className={`p-3 rounded-xl transition-all duration-200 font-bold ${hasChanges
                                ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white hover:from-saibro-700 hover:to-saibro-800 shadow-lg shadow-saibro-200 active:scale-95'
                                : 'bg-stone-100 text-stone-300 cursor-not-allowed'
                                }`}
                        >
                            {saving === rule.id ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <Save size={20} />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const CategorySection: React.FC<{ title: string; icon: React.ReactNode; rules: PointRule[]; color: string }> = ({ title, icon, rules, color }) => {
        if (rules.length === 0) return null;

        return (
            <div className="space-y-3">
                <div className="flex items-center gap-3 px-2">
                    <div className={`p-2 rounded-lg ${color}`}>
                        {icon}
                    </div>
                    <div>
                        <h3 className="font-black text-stone-800 text-base">{title}</h3>
                        <p className="text-xs text-stone-500 font-medium">{rules.length} regra{rules.length > 1 ? 's' : ''}</p>
                    </div>
                </div>
                <div className="space-y-3">
                    {rules.map(rule => <RuleCard key={rule.id} rule={rule} />)}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header with Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-linear-to-br from-blue-500 to-blue-600 p-6 rounded-2xl shadow-lg shadow-blue-200 text-white">
                    <div className="flex items-center justify-between mb-3">
                        <Trophy className="opacity-80" size={28} />
                        <Sparkles className="opacity-60" size={20} />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider opacity-90 mb-1">Total de Regras</p>
                    <p className="text-4xl font-black">{totalRules}</p>
                </div>

                <div className="bg-linear-to-br from-amber-500 to-amber-600 p-6 rounded-2xl shadow-lg shadow-amber-200 text-white">
                    <div className="flex items-center justify-between mb-3">
                        <Target className="opacity-80" size={28} />
                        <TrendingUp className="opacity-60" size={20} />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider opacity-90 mb-1">Média de Pontos</p>
                    <p className="text-4xl font-black">{avgPoints}</p>
                </div>

                <div className={`p-6 rounded-2xl shadow-lg text-white transition-all duration-500 ${modifiedRules > 0
                    ? 'bg-linear-to-br from-red-500 to-red-600 shadow-red-200 animate-pulse'
                    : 'bg-linear-to-br from-green-500 to-green-600 shadow-green-200'
                    }`}>
                    <div className="flex items-center justify-between mb-3">
                        <Award className="opacity-80" size={28} />
                        {modifiedRules > 0 && <div className="w-3 h-3 bg-white rounded-full animate-ping" />}
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider opacity-90 mb-1">Alterações Pendentes</p>
                    <p className="text-4xl font-black">{modifiedRules}</p>
                </div>
            </div>

            {/* Alert Info */}
            <div className="bg-linear-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 p-5 rounded-2xl flex gap-4 shadow-sm">
                <Info className="shrink-0 mt-0.5 text-indigo-600" size={24} />
                <div>
                    <h4 className="font-black text-indigo-900 mb-1.5">Configuração Global de Pontuação</h4>
                    <p className="text-sm text-indigo-700 leading-relaxed">
                        Alterar estes valores afetará a pontuação calculada para <strong>novas partidas</strong>.
                        Partidas antigas podem não ser recalculadas automaticamente.
                        Salve cada alteração individualmente clicando no botão <Save className="inline" size={14} />.
                    </p>
                </div>
            </div>

            {/* Categorized Rules */}
            <div className="space-y-8">
                <CategorySection
                    title="Resultados de Partida"
                    icon={<Trophy className="text-green-600" size={20} />}
                    rules={categorizedRules.victory}
                    color="bg-green-100"
                />

                <CategorySection
                    title="Pontuação Durante a Partida"
                    icon={<Target className="text-blue-600" size={20} />}
                    rules={categorizedRules.match}
                    color="bg-blue-100"
                />

                <CategorySection
                    title="Ranking e Classificação"
                    icon={<Award className="text-purple-600" size={20} />}
                    rules={categorizedRules.ranking}
                    color="bg-purple-100"
                />

                <CategorySection
                    title="Regras Especiais"
                    icon={<Sparkles className="text-amber-600" size={20} />}
                    rules={categorizedRules.bonus}
                    color="bg-amber-100"
                />
            </div>
        </div>
    );
};
