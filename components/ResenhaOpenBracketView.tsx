import React, { useEffect, useState } from 'react';
import { Trophy, Loader2, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBracket, type BracketMatchWithPhase } from '../lib/resenhaOpenService';

interface Props {
    championshipId: string;
}

const PHASE_ORDER = ['qualify', 'oitavas', 'primeira_fase', 'segunda_fase', 'quartas', 'semifinal', 'final'];

const PHASE_LABELS: Record<string, string> = {
    qualify: 'Qualify',
    oitavas: 'Oitavas de Final',
    primeira_fase: '1ª Fase',
    segunda_fase: '2ª Fase',
    quartas: 'Quartas de Final',
    semifinal: 'Semifinais',
    final: 'Final',
};

const PHASE_COLORS: Record<string, string> = {
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

    const presentPhases = PHASE_ORDER.filter(p => bracket.some(m => m.round_phase === p));
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

            {/* Phases */}
            {presentPhases.map(phase => {
                const phaseMatches = bracket.filter(m => m.round_phase === phase);
                const colorClass = PHASE_COLORS[phase] ?? 'bg-stone-100 text-stone-600';

                return (
                    <div key={phase} className="bg-white rounded-2xl border border-stone-100 overflow-hidden shadow-sm">
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
        <div className="px-4 py-3">
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-stone-300 w-7">J{match.match_number}</span>
                <div className="flex-1 space-y-1.5">
                    <PlayerRow label={match.player_a_label} won={aWon} lost={bWon && isFinished} pending={!match.registration_a_id} isWalkover={match.is_walkover && bWon} />
                    <PlayerRow label={match.player_b_label} won={bWon} lost={aWon && isFinished} pending={!match.registration_b_id} isWalkover={match.is_walkover && aWon} />
                </div>
                {isFinished && <Trophy size={14} className="text-yellow-400 shrink-0" />}
                {pending && <span className="text-xs text-stone-300 font-bold shrink-0">aguarda</span>}
            </div>
        </div>
    );
};

interface PlayerRowProps {
    label: string;
    won: boolean;
    lost: boolean;
    pending: boolean;
    isWalkover?: boolean;
}

const PlayerRow: React.FC<PlayerRowProps> = ({ label, won, lost, pending, isWalkover }) => (
    <div className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${won ? 'bg-green-50 font-black text-green-800' : lost ? 'text-stone-400' : pending ? 'text-stone-300 italic' : 'font-medium text-stone-700'}`}>
        {won && <Trophy size={10} className="text-yellow-500 shrink-0" />}
        <span className="flex-1 truncate">{label}</span>
        {isWalkover && <span className="text-xs text-orange-500 font-bold shrink-0">W.O.</span>}
    </div>
);
