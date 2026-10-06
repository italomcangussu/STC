import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { PointRule } from '../types';
import { getNowInFortaleza } from '../utils';
import { categoryOf, parsePoints, type PointRuleCategory } from '../lib/pointRules';
import { Save, Loader2, Info, Trophy, Target, Award, CheckCircle2, Sparkles, Undo2 } from 'lucide-react';
import { StatTile, adminBtnGhost, adminBtnPrimary } from './admin/ui';

const CATEGORIES: { id: PointRuleCategory; title: string; hint: string; icon: React.ReactNode; color: string }[] = [
    { id: 'victory', title: 'Resultados de partida', hint: 'Vitória, derrota e W.O.', icon: <Trophy className="text-green-600" size={20} />, color: 'bg-green-100' },
    { id: 'match', title: 'Pontuação durante a partida', hint: 'Sets e games', icon: <Target className="text-blue-600" size={20} />, color: 'bg-blue-100' },
    { id: 'ranking', title: 'Ranking e classificação', hint: 'Fases finais e posição', icon: <Award className="text-purple-600" size={20} />, color: 'bg-purple-100' },
    { id: 'bonus', title: 'Regras especiais', hint: 'Bônus e demais casos', icon: <Sparkles className="text-amber-600" size={20} />, color: 'bg-amber-100' },
];

interface RuleRowProps {
    rule: PointRule;
    /** Texto digitado, se o campo foi mexido. */
    draft: string | undefined;
    saving: boolean;
    justSaved: boolean;
    onChange: (id: string, text: string) => void;
    onSave: (rule: PointRule) => void;
    onUndo: (id: string) => void;
}

// Estes componentes ficam FORA de `AdminRules` de propósito. Declarados dentro dele, cada tecla
// criava um tipo de componente novo, o React desmontava a linha inteira e o campo perdia o foco:
// no iPhone o teclado fechava a cada dígito e não dava para digitar "15".
const RuleRow: React.FC<RuleRowProps> = ({ rule, draft, saving, justSaved, onChange, onSave, onUndo }) => {
    const touched = draft !== undefined;
    const parsed = touched ? parsePoints(draft) : rule.points;
    const invalid = touched && parsed === null;
    const dirty = touched && parsed !== null && parsed !== rule.points;
    const label = rule.description || rule.rule_key;

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && dirty && !saving) { e.preventDefault(); onSave(rule); }
        if (e.key === 'Escape' && touched) { e.preventDefault(); onUndo(rule.id); }
    };

    const tone = dirty
        ? 'border-amber-200 bg-amber-50'
        : justSaved
            ? 'border-green-200 bg-green-50'
            : 'border-stone-100 bg-white';

    return (
        <li className={`rounded-2xl border p-4 transition-colors ${tone}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-snug text-stone-800">{label}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-stone-400">{rule.rule_key}</p>
                    {dirty && <p className="mt-1.5 text-xs font-bold text-amber-700">Era {rule.points} · alterado, falta salvar</p>}
                    {justSaved && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-green-700" role="status">
                            <CheckCircle2 size={14} /> Salvo
                        </p>
                    )}
                </div>
                <label className="shrink-0">
                    <span className="sr-only">Pontos: {label}</span>
                    <input
                        type="number"
                        step={1}
                        value={touched ? draft : rule.points}
                        onChange={e => onChange(rule.id, e.target.value)}
                        onKeyDown={onKeyDown}
                        aria-invalid={invalid}
                        className={`h-12 w-24 rounded-xl border-2 text-center text-lg font-black outline-hidden transition-colors ${invalid
                            ? 'border-red-400 bg-white text-red-700 ring-4 ring-red-100'
                            : dirty
                                ? 'border-amber-400 bg-white text-amber-700 ring-4 ring-amber-100'
                                : 'border-stone-200 bg-stone-50 text-stone-800 focus:border-saibro-500 focus:ring-4 focus:ring-saibro-100'}`}
                    />
                    <span className="mt-1 block text-center text-[10px] font-black uppercase tracking-wider text-stone-400">pontos</span>
                </label>
            </div>

            {invalid && <p role="alert" className="mt-2 text-xs font-medium text-red-600">Digite um número inteiro (ex.: 10 ou -5).</p>}

            {touched && (
                <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => onUndo(rule.id)} className={adminBtnGhost}>
                        <Undo2 size={16} /> Desfazer
                    </button>
                    <button type="button" onClick={() => onSave(rule)} disabled={!dirty || saving} className={`${adminBtnPrimary} sm:w-auto`}>
                        {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar
                    </button>
                </div>
            )}
        </li>
    );
};

export const AdminRules: React.FC = () => {
    const [rules, setRules] = useState<PointRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savedId, setSavedId] = useState<string | null>(null);

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        setLoadFailed(false);
        const { data, error } = await supabase
            .from('point_rules')
            .select('*')
            .order('rule_key');

        if (error) {
            setLoadFailed(true);
            notify.failure(error, 'Não foi possível carregar as regras de pontuação.', { event: 'point_rules_load_failed' });
        } else {
            setRules(data ?? []);
        }
        setLoading(false);
    };

    const handleChange = (id: string, text: string) => {
        setDrafts(prev => {
            const rule = rules.find(r => r.id === id);
            // Voltar ao valor original desfaz a edição: não sobra "alterado" sem diferença nenhuma.
            if (rule && parsePoints(text) === rule.points) {
                const { [id]: _drop, ...rest } = prev;
                return rest;
            }
            return { ...prev, [id]: text };
        });
    };

    const handleUndo = (id: string) => setDrafts(prev => {
        const { [id]: _drop, ...rest } = prev;
        return rest;
    });

    /** Grava uma regra; devolve true se deu certo. Quem chama decide o que dizer ao usuário. */
    const persist = async (rule: PointRule): Promise<boolean> => {
        const newValue = parsePoints(drafts[rule.id] ?? '');
        if (newValue === null || newValue === rule.points) return false;

        setSaving(prev => new Set(prev).add(rule.id));
        try {
            const { error } = await supabase
                .from('point_rules')
                .update({ points: newValue, updated_at: getNowInFortaleza().toISOString() })
                .eq('id', rule.id);
            if (error) throw error;

            setRules(prev => prev.map(r => r.id === rule.id ? { ...r, points: newValue } : r));
            handleUndo(rule.id);
            return true;
        } catch (error) {
            notify.failure(error, `Não foi possível atualizar "${rule.description || rule.rule_key}".`, {
                event: 'point_rule_update_failed',
                ruleId: rule.id,
            });
            return false;
        } finally {
            setSaving(prev => {
                const next = new Set(prev);
                next.delete(rule.id);
                return next;
            });
        }
    };

    const handleSave = async (rule: PointRule) => {
        if (await persist(rule)) {
            setSavedId(rule.id);
            setTimeout(() => setSavedId(current => (current === rule.id ? null : current)), 2500);
        }
    };

    const dirtyRules = rules.filter(r => {
        const p = drafts[r.id] === undefined ? null : parsePoints(drafts[r.id]);
        return p !== null && p !== r.points;
    });
    const invalidCount = Object.keys(drafts).filter(id => parsePoints(drafts[id]) === null).length;

    const handleSaveAll = async () => {
        const results = await Promise.all(dirtyRules.map(persist));
        const ok = results.filter(Boolean).length;
        if (ok > 0) notify.success(ok === 1 ? '1 regra atualizada.' : `${ok} regras atualizadas.`);
    };

    const byCategory = useMemo(() => {
        const groups: Record<PointRuleCategory, PointRule[]> = { victory: [], match: [], ranking: [], bonus: [] };
        rules.forEach(rule => groups[categoryOf(rule.rule_key)].push(rule));
        return groups;
    }, [rules]);

    const avgPoints = rules.length > 0
        ? Math.round(rules.reduce((sum, r) => sum + r.points, 0) / rules.length)
        : 0;
    const anySaving = saving.size > 0;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20" role="status">
                <Loader2 className="mb-4 animate-spin text-saibro-600" size={40} />
                <p className="font-medium text-stone-500">Carregando regras de pontuação...</p>
            </div>
        );
    }

    if (loadFailed) {
        return (
            <div className="space-y-3 rounded-2xl border border-red-100 bg-red-50 p-6 text-center" role="alert">
                <p className="text-sm font-bold text-red-700">Não foi possível carregar as regras de pontuação.</p>
                <button className={adminBtnGhost} onClick={fetchRules}>Tentar de novo</button>
            </div>
        );
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            <div className="grid grid-cols-3 gap-2">
                <StatTile label="Regras" value={rules.length} />
                <StatTile label="Média" value={avgPoints} hint="por regra" />
                <StatTile label="Não salvas" value={dirtyRules.length} hint={dirtyRules.length > 0 ? 'falta salvar' : 'tudo salvo'} />
            </div>

            <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-900">
                <Info className="mt-0.5 shrink-0 text-sky-600" size={20} aria-hidden />
                <p className="text-sm leading-relaxed">
                    Estes valores valem para as <strong>novas partidas</strong>. Partidas antigas podem não ser recalculadas.
                    Mude o número, confira a linha em destaque e toque em <strong>Salvar</strong> (ou Enter).
                </p>
            </div>

            {(dirtyRules.length > 1 || invalidCount > 0) && (
                <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-lg shadow-amber-900/5 sm:flex-row sm:items-center sm:justify-between" role="region" aria-label="Alterações não salvas">
                    <p className="text-sm font-bold text-amber-800">
                        {dirtyRules.length} {dirtyRules.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
                        {invalidCount > 0 && <span className="font-medium text-red-600"> · {invalidCount} com valor inválido</span>}
                    </p>
                    <div className="flex gap-2">
                        <button type="button" className={`${adminBtnGhost} flex-1 sm:flex-none`} onClick={() => setDrafts({})} disabled={anySaving}>
                            Descartar
                        </button>
                        <button type="button" className={`${adminBtnPrimary} flex-1 sm:w-auto sm:flex-none`} onClick={handleSaveAll} disabled={anySaving || dirtyRules.length === 0 || invalidCount > 0}>
                            {anySaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar tudo
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-8">
                {CATEGORIES.map(cat => {
                    const list = byCategory[cat.id];
                    if (list.length === 0) return null;
                    return (
                        <section key={cat.id} className="space-y-3" aria-labelledby={`rules-${cat.id}`}>
                            <div className="flex items-center gap-3 px-1">
                                <div className={`rounded-lg p-2 ${cat.color}`}>{cat.icon}</div>
                                <div className="min-w-0">
                                    <h3 id={`rules-${cat.id}`} className="text-base font-black text-stone-800">{cat.title}</h3>
                                    <p className="text-xs font-medium text-stone-500">{cat.hint} · {list.length} {list.length === 1 ? 'regra' : 'regras'}</p>
                                </div>
                            </div>
                            <ul className="space-y-3">
                                {list.map(rule => (
                                    <RuleRow
                                        key={rule.id}
                                        rule={rule}
                                        draft={drafts[rule.id]}
                                        saving={saving.has(rule.id)}
                                        justSaved={savedId === rule.id}
                                        onChange={handleChange}
                                        onSave={handleSave}
                                        onUndo={handleUndo}
                                    />
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
};
