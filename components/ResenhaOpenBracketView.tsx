import React, { useEffect, useState } from 'react';
import { Trophy, Loader2, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBracket, type BracketMatchWithPhase } from '../lib/resenhaOpenService';

interface Props {
    championshipId: string;
}

const PHASE_ORDER = ['preliminar', 'qualify', 'oitavas', 'primeira_fase', 'segunda_fase', 'quartas', 'semifinal', 'final'];

const PHASE_LABELS: Record<string, string> = {
    preliminar: 'Preliminar',
    qualify: 'Qualify',
    oitavas: 'Oitavas de Final',
    primeira_fase: '1ª Fase',
    segunda_fase: '2ª Fase',
    quartas: 'Quartas de Final',
    semifinal: 'Semifinais',
    final: 'Final',
};

const PHASE_COLORS: Record<string, string> = {
    preliminar: 'bg-stone-100 text-stone-600',
    qualify: 'bg-stone-100 text-stone-600',
    oitavas: 'bg-sky-100 text-sky-700',
    primeira_fase: 'bg-sky-100 text-sky-700',
    segunda_fase: 'bg-blue-100 text-blue-700',
    quartas: 'bg-violet-100 text-violet-700',
    semifinal: 'bg-orange-100 text-orange-700',
    final: 'bg-yellow-100 text-yellow-700',
};

export const ResenhaOpenBracketView: React.FC<Props> = ({ championshipId }) => {
    const [bracket, setBracket] = useState<BracketMatchWithPhase[]>([]);
    const [champName, setChampName] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [bData, champData] = await Promise.all([
                    fetchBracket(championshipId),
                    supabase.from('championships').select('name').eq('id', championshipId).single(),
                ]);
                setBracket(bData);
                setChampName(champData.data?.name ?? 'Resenha Open');
            } finally {
                setLoading(false);
            }
        })();
    }, [championshipId]);

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-saibro-600" size={32} />
            </div>
        );
    }

    const presentClasses = [...new Set(bracket.map(m => m.bracket_class).filter(Boolean))].sort();
    const classesToRender = presentClasses.length > 0 ? presentClasses : [''];
    const champion = bracket.find(
        m => m.round_phase === 'final' && m.status === 'finished'
    );
    const championName = champion
        ? (champion.player_a_label && champion.winner_registration_id === champion.registration_a_id
            ? champion.player_a_label
            : champion.player_b_label)
        : null;

    return (
        <div className="p-4 space-y-6 max-w-2xl mx-auto">
            {/* Header */}
            <div className="bg-linear-to-br from-saibro-700 to-saibro-500 p-6 rounded-3xl text-white shadow-lg text-center">
                <p className="text-saibro-200 text-xs font-bold uppercase tracking-widest mb-1">Tabela de Confrontos</p>
                <h1 className="text-2xl font-black">{champName}</h1>
                {championName && (
                    <div className="mt-3 flex items-center justify-center gap-2 bg-white/20 rounded-2xl px-4 py-2">
                        <Trophy size={16} className="text-yellow-300" />
                        <span className="font-black text-white">{championName}</span>
                        <span className="text-saibro-200 text-sm">Campeão</span>
                    </div>
                )}
            </div>

            {/* Classes and phases */}
            {classesToRender.map(bracketClass => {
                const classMatches = bracketClass ? bracket.filter(m => m.bracket_class === bracketClass) : bracket;
                const presentPhases = PHASE_ORDER.filter(p => classMatches.some(m => m.round_phase === p));

                return (
                    <div key={bracketClass || 'all'} className="space-y-3">
                        {bracketClass && (
                            <h2 className="px-1 text-lg font-black text-stone-800">{bracketClass}</h2>
                        )}
                        {presentPhases.map(phase => {
                            const phaseMatches = classMatches.filter(m => m.round_phase === phase);
                            const colorClass = PHASE_COLORS[phase] ?? 'bg-stone-100 text-stone-600';

                            return (
                                <div key={`${bracketClass}-${phase}`} className="bg-white rounded-2xl border border-stone-100 overflow-hidden shadow-sm">
                                    <div className={`px-4 py-2 font-black text-sm uppercase tracking-wide ${colorClass}`}>
                                        {PHASE_LABELS[phase] ?? phase}
                                    </div>
                                    <div className="divide-y divide-stone-50">
                                        {phaseMatches.map(m => (
                                            <BracketMatchRow key={m.id} match={m} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}

            {bracket.length === 0 && (
                <div className="text-center py-12 text-stone-400">
                    <Trophy size={32} className="mx-auto mb-3 opacity-30" />
                    <p>Sorteio ainda não realizado.</p>
                </div>
            )}
        </div>
    );
};

// ── BracketMatchRow ───────────────────────────────────────────────────────────

const BracketMatchRow: React.FC<{ match: BracketMatchWithPhase }> = ({ match }) => {
    const isFinished = match.status === 'finished';
    const aWon = isFinished && match.winner_registration_id === match.registration_a_id;
    const bWon = isFinished && match.winner_registration_id === match.registration_b_id;
    const pending = !match.registration_a_id || !match.registration_b_id;

    return (
        <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
                <span className="bg-stone-800 text-white text-xs font-black px-2 py-1 rounded-lg">
                    J{match.match_number}
                </span>
                {match.is_walkover && (
                    <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">W.O.</span>
                )}
                {isFinished && (
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-1 rounded-lg">Encerrado</span>
                )}
                {pending && !isFinished && (
                    <span className="text-xs font-bold text-stone-500 bg-stone-50 px-2 py-1 rounded-lg">Aguardando</span>
                )}
            </div>

            <div className="space-y-2">
                <PlayerLine label={match.player_a_label} won={aWon} pending={!match.registration_a_id} />
                <div className="text-center text-xs font-bold text-stone-300">vs</div>
                <PlayerLine label={match.player_b_label} won={bWon} pending={!match.registration_b_id} />
            </div>
        </div>
    );
};

const PlayerLine: React.FC<{ label: string; won: boolean; pending: boolean }> = ({ label, won, pending }) => (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${won ? 'bg-green-50 text-green-800' : pending ? 'bg-stone-50 text-stone-400' : 'bg-white text-stone-800 border border-stone-100'}`}>
        <span className={`font-bold text-sm ${pending ? 'italic' : ''}`}>{label}</span>
        {won && <Star size={14} className="text-yellow-500 fill-yellow-500" />}
    </div>
);
