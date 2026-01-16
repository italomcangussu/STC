import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Match, User } from '../types';
import { Clock, Save, Trophy, Loader2, AlertCircle, CheckCircle, Plus, Minus } from 'lucide-react';
import { getNowInFortaleza, formatDate } from '../utils';

interface LiveScoreboardProps {
    match: Match;
    profiles: User[];
    currentUser: User;
    onScoreSaved?: () => void;
    readOnly?: boolean;
}

// Helpers outside component to avoid recreation
const isValidSet = (scoreA: number, scoreB: number, isSuperTiebreak = false) => {
    if (isSuperTiebreak) {
        return (scoreA >= 10 || scoreB >= 10) && Math.abs(scoreA - scoreB) >= 2;
    }
    if (scoreA === 7 || scoreB === 7) return true;
    if ((scoreA === 6 && scoreB <= 4) || (scoreB === 6 && scoreA <= 4)) return true;
    return false;
};

const getSetWinner = (scoreA: number, scoreB: number, isSuperTiebreak = false): 'A' | 'B' | null => {
    if (isSuperTiebreak) {
        if (scoreA >= 10 && scoreA - scoreB >= 2) return 'A';
        if (scoreB >= 10 && scoreB - scoreA >= 2) return 'B';
        return null;
    }
    if (scoreA === 7) return 'A';
    if (scoreB === 7) return 'B';
    if (scoreA === 6 && scoreB <= 4) return 'A';
    if (scoreB === 6 && scoreA <= 4) return 'B';
    return null;
};

export const LiveScoreboard: React.FC<LiveScoreboardProps> = ({
    match,
    profiles,
    currentUser,
    onScoreSaved,
    readOnly = false
}) => {
    const [scoreA, setScoreA] = useState<number[]>(
        match.scoreA.length > 0 ? [...match.scoreA] : [0, 0, 0]
    );
    const [scoreB, setScoreB] = useState<number[]>(
        match.scoreB.length > 0 ? [...match.scoreB] : [0, 0, 0]
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const playerA = profiles.find(p => p.id === match.playerAId);
    const playerB = profiles.find(p => p.id === match.playerBId);

    const isFinished = match.status === 'finished';
    // Admin can edit even if finished? Maybe restriction needed. 
    // For now, if passed readOnly=true, strictly read only.
    // If not readOnly, respect normal rules + status check.
    const effectiveReadOnly = readOnly || (isFinished && currentUser.role !== 'admin');

    // Check if editing is allowed
    const canEdit = useMemo(() => {
        if (effectiveReadOnly) return false;

        // Admin can always edit (unless forcefully readOnly passed which we handled)
        if (currentUser.role === 'admin') return true;

        // Socio can edit if it's after the scheduled time
        if (currentUser.role !== 'socio' && currentUser.role !== 'admin') return false;

        if (!match.date || !match.scheduledTime) return true; // No time restriction

        // Use Fortaleza time for checks
        const now = getNowInFortaleza();
        const today = formatDate(now);

        // Must be match day
        if (match.date !== today) return false;

        // Check scheduled time
        const [hours, minutes] = match.scheduledTime.split(':').map(Number);
        const scheduledDateTime = new Date(now);
        scheduledDateTime.setHours(hours, minutes, 0, 0);

        return now >= scheduledDateTime;
    }, [match.date, match.scheduledTime, currentUser.role, effectiveReadOnly]);

    // Calculate set winners and match state
    const set1Winner = getSetWinner(scoreA[0], scoreB[0]);
    const set2Winner = getSetWinner(scoreA[1], scoreB[1]);
    const setsWonA = (set1Winner === 'A' ? 1 : 0) + (set2Winner === 'A' ? 1 : 0);
    const setsWonB = (set1Winner === 'B' ? 1 : 0) + (set2Winner === 'B' ? 1 : 0);
    const showThirdSet = setsWonA === 1 && setsWonB === 1;
    const set3Winner = showThirdSet ? getSetWinner(scoreA[2], scoreB[2], true) : null;

    // Match winner
    let matchWinner: 'A' | 'B' | null = null;
    if (setsWonA >= 2) matchWinner = 'A';
    else if (setsWonB >= 2) matchWinner = 'B';
    else if (showThirdSet && set3Winner) matchWinner = set3Winner;

    const canSave = matchWinner !== null && canEdit;

    const updateScore = (player: 'A' | 'B', setIndex: number, delta: number) => {
        if (!canEdit) return;

        const setScore = player === 'A' ? [...scoreA] : [...scoreB];
        const maxValue = setIndex === 2 ? 30 : 7;
        setScore[setIndex] = Math.max(0, Math.min(maxValue, setScore[setIndex] + delta));

        if (player === 'A') {
            setScoreA(setScore);
        } else {
            setScoreB(setScore);
        }
        setError(null);
        setSuccess(false);
    };

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);

        const winnerId = matchWinner === 'A' ? match.playerAId : match.playerBId;
        const finalScoreA = showThirdSet ? scoreA : scoreA.slice(0, 2);
        const finalScoreB = showThirdSet ? scoreB : scoreB.slice(0, 2);

        const { error: updateError } = await supabase
            .from('matches')
            .upsert({
                id: match.id,
                player_a_id: match.playerAId,
                player_b_id: match.playerBId,
                type: match.type || 'Desafio Ranking',
                score_a: finalScoreA,
                score_b: finalScoreB,
                winner_id: winnerId,
                status: 'finished',
                date: formatDate(getNowInFortaleza())
            })
            .select();

        setSaving(false);

        if (updateError) {
            console.error('Error saving score:', updateError);
            setError('Erro ao salvar. Tente novamente.');
            return;
        }

        setSuccess(true);
        onScoreSaved?.();
    };

    const formatScheduledTime = () => {
        if (!match.scheduledTime) return null;
        return match.scheduledTime;
    };

    const renderPlayerRow = (player: any, isWinner: boolean, score: number[], updateFn: (idx: number, d: number) => void) => (
        <div className={`relative flex items-center justify-between p-3 rounded-xl border transition-all duration-300 ${isWinner ? 'bg-saibro-50 border-saibro-200' : 'bg-white border-stone-100 shadow-sm'}`}>
            <div className="flex items-center gap-3 flex-1 min-w-0 mr-4">
                <div className="relative">
                    <img
                        src={player?.avatar || 'https://via.placeholder.com/48'}
                        className={`w-12 h-12 rounded-full border-2 object-cover shadow-sm ${isWinner ? 'border-saibro-500' : 'border-stone-200'}`}
                        alt={player?.name}
                    />
                    {isWinner && (
                        <div className="absolute -top-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow-lg z-10">
                            <Trophy size={10} fill="currentColor" strokeWidth={3} />
                        </div>
                    )}
                </div>
                <div className="flex flex-col min-w-0">
                    <span className={`font-bold text-sm sm:text-base truncate leading-tight ${isWinner ? 'text-stone-900' : 'text-stone-600'}`}>
                        {player?.name || 'Jogador'}
                    </span>
                    {isWinner && <span className="text-[10px] text-saibro-600 font-bold uppercase tracking-wider">Vencedor</span>}
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {[0, 1, 2].map(idx => {
                    if (idx === 2 && !showThirdSet) return null;
                    const isSetWinner = (idx === 0 && set1Winner === (player === playerA ? 'A' : 'B')) ||
                        (idx === 1 && set2Winner === (player === playerA ? 'A' : 'B')) ||
                        (idx === 2 && set3Winner === (player === playerA ? 'A' : 'B'));

                    return (
                        <div key={idx} className="flex flex-col items-center gap-1">
                            {canEdit && (
                                <button
                                    onClick={() => updateFn(idx, 1)}
                                    className="p-1 text-stone-300 hover:text-saibro-600 hover:bg-saibro-50 rounded active:scale-90 transition-all"
                                >
                                    <Plus size={12} strokeWidth={3} />
                                </button>
                            )}
                            <div className={`w-10 h-10 flex items-center justify-center rounded-lg font-mono text-xl font-bold transition-all ${isSetWinner
                                ? 'bg-saibro-600 text-white shadow-md'
                                : 'bg-stone-100 text-stone-600 border border-stone-200'
                                }`}>
                                {score[idx]}
                            </div>
                            {canEdit && (
                                <button
                                    onClick={() => updateFn(idx, -1)}
                                    className="p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded active:scale-90 transition-all"
                                >
                                    <Minus size={12} strokeWidth={3} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="relative overflow-hidden rounded-3xl bg-white border border-stone-200 shadow-xl ring-1 ring-black/5 group max-w-md mx-auto">
            {/* Header */}
            <div className="relative z-10 bg-stone-50 p-4 flex items-center justify-between border-b border-stone-100 px-5">
                <div className="flex items-center gap-3">
                    {isFinished ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-stone-200 border border-stone-300 rounded text-[10px] font-bold text-stone-600 uppercase tracking-widest">
                            Finalizado
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-100 border border-red-200 rounded text-[10px] font-bold text-red-600 uppercase tracking-widest animate-pulse">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Ao Vivo
                        </div>
                    )}
                    <span className="text-stone-400 text-xs font-bold tracking-wider uppercase hidden sm:block">
                        {match.type === 'Desafio Ranking' ? 'Desafio STC' : 'Torneio STC'}
                    </span>
                </div>
                {formatScheduledTime() && (
                    <div className="flex items-center gap-1.5 text-xs text-stone-500 bg-white px-3 py-1 rounded-full border border-stone-200 shadow-sm">
                        <Clock size={12} className="text-saibro-500" />
                        <span className="font-mono tracking-wide">{formatScheduledTime()}</span>
                    </div>
                )}
            </div>

            {/* Main Scoreboard Area */}
            <div className="relative z-10 p-5 space-y-2">
                {/* Headers */}
                <div className="flex justify-end px-3 gap-2 pb-1 pr-[9px]">
                    <span className="w-10 text-[10px] text-stone-500 text-center font-extrabold uppercase tracking-wider">Set 1</span>
                    <span className="w-10 text-[10px] text-stone-500 text-center font-extrabold uppercase tracking-wider">Set 2</span>
                    {showThirdSet && <span className="w-10 text-[10px] text-saibro-600 text-center font-bold uppercase tracking-wider animate-pulse">Tie</span>}
                </div>

                {renderPlayerRow(playerA, matchWinner === 'A', scoreA, (idx, d) => updateScore('A', idx, d))}
                {renderPlayerRow(playerB, matchWinner === 'B', scoreB, (idx, d) => updateScore('B', idx, d))}
            </div>

            {/* Footer - Only show if editable */}
            {!effectiveReadOnly && (
                <div className="relative z-10 p-4 border-t border-stone-100 bg-stone-50/50">
                    {error && (
                        <div className="mb-3 p-2 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm flex items-center gap-2 animate-in slide-in-from-bottom-2">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="mb-3 p-2 bg-green-50 border border-green-100 rounded-lg text-green-600 text-sm flex items-center gap-2 animate-in slide-in-from-bottom-2">
                            <CheckCircle size={16} />
                            Placar salvo com sucesso!
                        </div>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={!canSave || saving}
                        className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 uppercase tracking-wider text-sm shadow-md ${canSave && !saving
                            ? 'bg-saibro-600 text-white hover:bg-saibro-500 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]'
                            : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                            }`}
                    >
                        {saving ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Salvando...
                            </>
                        ) : (
                            <>
                                <Save size={18} />
                                SALVAR RESULTADO
                            </>
                        )}
                    </button>
                    {!matchWinner && canEdit && (scoreA[0] > 0 || scoreB[0] > 0) && (
                        <p className="text-[10px] uppercase tracking-widest text-stone-400 text-center mt-3 font-bold">
                            Defina um vencedor para salvar
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
