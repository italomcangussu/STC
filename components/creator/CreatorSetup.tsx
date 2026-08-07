import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Plus, Settings, Trophy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ensureSeries, type ChampionshipSeriesRow, type ScoringRules } from '../../lib/championship/creation';
import type { ChampionshipFormat } from '../../lib/championship/formatConfig';
import { CHAMPIONSHIP_CLASSES, type SetupValues } from '../../lib/championship/setupValues';

const FORMAT_LABELS: Record<ChampionshipFormat, string> = {
    'mata-mata': 'Mata-mata',
    'pontos-corridos': 'Pontos corridos',
    'grupo-mata-mata': 'Grupos + mata-mata',
};

interface Props {
    value: SetupValues;
    onChange: (value: SetupValues) => void;
    onNext: () => void;
}

export const CreatorSetup: React.FC<Props> = ({ value, onChange, onNext }) => {
    const [series, setSeries] = useState<ChampionshipSeriesRow[]>([]);
    const [newSeriesName, setNewSeriesName] = useState('');
    const [creatingSeries, setCreatingSeries] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        supabase
            .from('championship_series')
            .select('id, name, slug')
            .order('name')
            .then(({ data }) => setSeries((data ?? []) as ChampionshipSeriesRow[]));
    }, []);

    const set = <K extends keyof SetupValues>(key: K, v: SetupValues[K]) => onChange({ ...value, [key]: v });

    const setScoring = (key: keyof ScoringRules, v: number) =>
        onChange({ ...value, scoring: { ...value.scoring, [key]: v } });

    const toggleClass = (classe: string) =>
        set('classes', value.classes.includes(classe)
            ? value.classes.filter(c => c !== classe)
            : [...value.classes, classe]);

    const handleCreateSeries = async () => {
        if (!newSeriesName.trim()) return;
        setCreatingSeries(true);
        setError('');
        try {
            const created = await ensureSeries(newSeriesName);
            setSeries(prev => prev.some(s => s.id === created.id) ? prev : [...prev, created]);
            set('seriesId', created.id);
            setNewSeriesName('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreatingSeries(false);
        }
    };

    const missing: string[] = [];
    if (!value.name.trim()) missing.push('nome');
    if (!value.startDate) missing.push('data de início');
    if (value.classes.length === 0) missing.push('ao menos uma classe');

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Trophy size={18} className="text-saibro-600" /> Dados do campeonato
                </h2>

                <div>
                    <label htmlFor="creator-name" className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome</label>
                    <input
                        id="creator-name"
                        value={value.name}
                        onChange={e => set('name', e.target.value)}
                        placeholder="Ex.: Copa de Primavera 2026"
                        className="w-full p-3 border border-stone-200 rounded-xl"
                    />
                </div>

                <div>
                    <label htmlFor="creator-series" className="block text-xs font-bold text-stone-500 uppercase mb-1">
                        Série <span className="font-medium normal-case text-stone-400">(liga as edições para defesa de pontos)</span>
                    </label>
                    <select
                        id="creator-series"
                        value={value.seriesId ?? ''}
                        onChange={e => set('seriesId', e.target.value || null)}
                        className="w-full p-3 border border-stone-200 rounded-xl"
                    >
                        <option value="">Sem série</option>
                        {series.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="flex gap-2 mt-2">
                        <input
                            value={newSeriesName}
                            onChange={e => setNewSeriesName(e.target.value)}
                            placeholder="Criar nova série"
                            className="flex-1 p-2 border border-stone-200 rounded-xl text-sm"
                        />
                        <button
                            type="button"
                            onClick={handleCreateSeries}
                            disabled={!newSeriesName.trim() || creatingSeries}
                            className="px-3 py-2 bg-stone-900 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-1"
                        >
                            {creatingSeries ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar
                        </button>
                    </div>
                </div>

                <div>
                    <span className="block text-xs font-bold text-stone-500 uppercase mb-1">Formato</span>
                    <div className="grid grid-cols-3 gap-2">
                        {(Object.keys(FORMAT_LABELS) as ChampionshipFormat[]).map(f => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => set('format', f)}
                                aria-pressed={value.format === f}
                                className={`p-3 rounded-xl border-2 text-sm font-bold transition-colors ${
                                    value.format === f ? 'border-saibro-500 bg-saibro-50 text-saibro-700' : 'border-stone-100 text-stone-600'
                                }`}
                            >
                                {FORMAT_LABELS[f]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3">
                    <div className="flex-1">
                        <label htmlFor="creator-start" className="block text-xs font-bold text-stone-500 uppercase mb-1">Início</label>
                        <input id="creator-start" type="date" value={value.startDate}
                            onChange={e => set('startDate', e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl" />
                    </div>
                    <div className="flex-1">
                        <label htmlFor="creator-end" className="block text-xs font-bold text-stone-500 uppercase mb-1">Fim</label>
                        <input id="creator-end" type="date" value={value.endDate}
                            onChange={e => set('endDate', e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl" />
                    </div>
                </div>

                <div>
                    <span className="block text-xs font-bold text-stone-500 uppercase mb-1">Classes participantes</span>
                    <div className="flex flex-wrap gap-2">
                        {CHAMPIONSHIP_CLASSES.map(c => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => toggleClass(c)}
                                aria-pressed={value.classes.includes(c)}
                                className={`px-3 py-2 rounded-xl border text-sm font-bold transition-colors ${
                                    value.classes.includes(c) ? 'border-saibro-500 bg-saibro-50 text-saibro-700' : 'border-stone-200 text-stone-600'
                                }`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5">
                <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    aria-expanded={showAdvanced}
                    className="w-full flex items-center justify-between font-black text-stone-800"
                >
                    <span className="flex items-center gap-2"><Settings size={16} className="text-stone-400" /> Avançado — pontuação</span>
                    <span className="text-xs font-bold text-stone-400">{showAdvanced ? 'ocultar' : 'usando padrão'}</span>
                </button>

                {showAdvanced && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        {([
                            ['ptsVictory', 'Vitória'],
                            ['ptsWoVictory', 'Vitória por WO'],
                            ['ptsDefeat', 'Derrota'],
                            ['ptsTechnicalDraw', 'Empate técnico'],
                            ['ptsSet', 'Por set'],
                            ['ptsGame', 'Por game'],
                            ['finalRankingPts', 'Bônus do campeão'],
                        ] as [keyof ScoringRules, string][]).map(([key, label]) => (
                            <div key={key}>
                                <label htmlFor={`scoring-${key}`} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
                                <input
                                    id={`scoring-${key}`}
                                    type="number"
                                    value={value.scoring[key]}
                                    onChange={e => setScoring(key, Number(e.target.value))}
                                    className="w-full p-2 border border-stone-200 rounded-xl font-bold"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

            <button
                type="button"
                onClick={onNext}
                disabled={missing.length > 0}
                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
                Configurar formato <ChevronRight size={18} />
            </button>
            {missing.length > 0 && (
                <p className="text-xs text-stone-500 text-center">Falta preencher: {missing.join(', ')}.</p>
            )}
        </div>
    );
};
