import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PhasePoints {
    phase: string;
    points: number;
}

/** Todas as fases que final_phase aceita, na ordem de importância. */
const PHASE_LABELS: [string, string][] = [
    ['champion', 'Campeão'],
    ['finalist', 'Vice'],
    ['semifinal', 'Semifinal'],
    ['quarterfinal', 'Quartas'],
    ['round_of_16', 'Oitavas'],
    ['round_of_32', '16 avos'],
    ['qualifying', 'Qualificatória'],
    ['participation', 'Participação'],
];

/**
 * Valor que apply_championship_edition_points usa quando
 * get_championship_phase_points devolve NULL (fase sem linha).
 */
const FALLBACK_POINTS = 5;

export const PhasePointsEditor: React.FC = () => {
    const [rows, setRows] = useState<PhasePoints[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingPhase, setSavingPhase] = useState<string | null>(null);
    const [erro, setErro] = useState('');
    const [rascunho, setRascunho] = useState<Record<string, string>>({});

    const carregar = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('championship_phase_points')
            .select('phase, points')
            .order('points', { ascending: false });

        if (error) setErro(`Erro ao carregar pontuação: ${error.message}`);
        const carregadas = (data ?? []) as PhasePoints[];
        setRows(carregadas);
        setRascunho(Object.fromEntries(carregadas.map(r => [r.phase, String(r.points)])));
        setLoading(false);
    };

    useEffect(() => { carregar(); }, []);

    const salvar = async (phase: string) => {
        const valor = Number(rascunho[phase]);
        if (!Number.isFinite(valor)) return;

        const atual = rows.find(r => r.phase === phase);
        if (atual && atual.points === valor) return;

        setSavingPhase(phase);
        setErro('');
        const { error } = await supabase
            .from('championship_phase_points')
            .upsert({ phase, points: valor }, { onConflict: 'phase' });

        if (error) setErro(`Erro ao salvar ${phase}: ${error.message}`);
        else await carregar();
        setSavingPhase(null);
    };

    const definidas = new Set(rows.map(r => r.phase));
    const semPontuacao = PHASE_LABELS.filter(([phase]) => !definidas.has(phase));
    const labelDe = (phase: string) => PHASE_LABELS.find(([p]) => p === phase)?.[1] ?? phase;

    if (loading) {
        return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-saibro-600" /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                <AlertTriangle size={20} className="text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">
                    Mudanças aqui valem a partir da próxima apuração. Campeonatos já finalizados
                    mantêm os pontos que receberam — não há recálculo retroativo.
                </p>
            </div>

            {erro && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                    <p className="text-sm text-red-700">{erro}</p>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <h3 className="font-black text-stone-800">Pontuação por fase alcançada</h3>
                <ul className="space-y-2">
                    {rows.map(row => (
                        <li key={row.phase} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-stone-100">
                            <label htmlFor={`points-${row.phase}`} className="font-bold text-sm text-stone-700">
                                {labelDe(row.phase)}
                                <span className="ml-2 text-xs font-medium text-stone-400 uppercase">{row.phase}</span>
                            </label>
                            <div className="flex items-center gap-2">
                                {savingPhase === row.phase && <Loader2 size={14} className="animate-spin text-saibro-600" />}
                                <input
                                    id={`points-${row.phase}`}
                                    type="number"
                                    value={rascunho[row.phase] ?? ''}
                                    onChange={e => setRascunho(prev => ({ ...prev, [row.phase]: e.target.value }))}
                                    onBlur={() => salvar(row.phase)}
                                    className="w-24 p-2 border border-stone-200 rounded-xl font-bold text-right"
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>

            {semPontuacao.length > 0 && (
                <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                    <h3 className="font-black text-stone-800">Sem pontuação definida</h3>
                    <p className="text-xs text-stone-500">
                        Estas fases valem {FALLBACK_POINTS} pontos por padrão, o mesmo que participação.
                        Defina um valor para diferenciá-las.
                    </p>
                    <ul className="space-y-2">
                        {semPontuacao.map(([phase, label]) => (
                            <li key={phase} className="flex items-center justify-between p-3 rounded-xl border border-dashed border-stone-200">
                                <span className="font-bold text-sm text-stone-500">
                                    {label}
                                    <span className="ml-2 text-xs font-medium text-stone-400 uppercase">{phase}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRascunho(prev => ({ ...prev, [phase]: String(FALLBACK_POINTS) }));
                                        salvar(phase);
                                    }}
                                    disabled={savingPhase === phase}
                                    className="px-3 py-2 bg-stone-900 text-white text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-1"
                                >
                                    {savingPhase === phase
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Plus size={12} />} Definir
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
