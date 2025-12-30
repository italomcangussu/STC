import React, { useState, useMemo } from 'react';
import { Match, User } from '../types';
import { Trophy, Clock, Save, Loader2, Plus, Minus, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getMatchWinner } from '../utils';

interface LiveScoreboardProps {
    match: Match;
    profiles: User[];
    currentUser: User;
    onScoreSaved?: () => void;
}

// Set validation helper for regular sets (6-0 to 6-4, 7-5, 7-6)
const isValidSet = (gA: number, gB: number): boolean => {
    const winner = Math.max(gA, gB);
    const loser = Math.min(gA, gB);
    if (winner === 6 && loser <= 4) return true;
    if (winner === 7 && loser === 5) return true;
    if (winner === 7 && loser === 6) return true;
    if (winner === 0 && loser === 0) return true; // Empty set
    return false;
};

// Super tie-break validation (first to 10 with 2-point lead)
const isValidSuperTiebreak = (gA: number, gB: number): boolean => {
    const winner = Math.max(gA, gB);
    const loser = Math.min(gA, gB);
    const diff = winner - loser;

    if (winner === 0 && loser === 0) return true; // Empty
    if (winner >= 10 && diff >= 2) return true; // Valid win (10-8, 11-9, 15-13, etc.)
    return false;
};

// Get set winner - isTiebreak flag for 3rd set rules
const getSetWinner = (gA: number, gB: number, isTiebreak: boolean = false): 'A' | 'B' | null => {
    if (gA === 0 && gB === 0) return null;

    if (isTiebreak) {
        // Super tie-break: first to 10 with 2-point lead
        const winner = Math.max(gA, gB);
        const diff = Math.abs(gA - gB);
        if (winner >= 10 && diff >= 2) {
            return gA > gB ? 'A' : 'B';
        }
        return null; // Not yet decided
    }

    // Regular set validation
    if (!isValidSet(gA, gB)) return null;
    if (gA > gB) return 'A';
    if (gB > gA) return 'B';
    return null;
};

export const LiveScoreboard: React.FC<LiveScoreboardProps> = ({
    match,
    profiles,
    currentUser,
    onScoreSaved
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

    // Check if editing is allowed (after scheduled time)
    const canEdit = useMemo(() => {
        // Admin can always edit
        if (currentUser.role === 'admin') return true;

        // Socio can edit if it's after the scheduled time
        if (currentUser.role !== 'socio' && currentUser.role !== 'admin') return false;

        if (!match.date || !match.scheduledTime) return true; // No time restriction

        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Must be match day
        if (match.date !== today) return false;

        // Check scheduled time
        const [hours, minutes] = match.scheduledTime.split(':').map(Number);
        const scheduledDateTime = new Date();
        scheduledDateTime.setHours(hours, minutes, 0, 0);

        return now >= scheduledDateTime;
    }, [match.date, match.scheduledTime, currentUser.role]);

    // Calculate set winners and match state
    const set1Winner = getSetWinner(scoreA[0], scoreB[0]);
    const set2Winner = getSetWinner(scoreA[1], scoreB[1]);
    const setsWonA = (set1Winner === 'A' ? 1 : 0) + (set2Winner === 'A' ? 1 : 0);
    const setsWonB = (set1Winner === 'B' ? 1 : 0) + (set2Winner === 'B' ? 1 : 0);
    const showThirdSet = setsWonA === 1 && setsWonB === 1;
    const set3Winner = showThirdSet ? getSetWinner(scoreA[2], scoreB[2], true) : null; // true = super tiebreak

    // Match winner
    let matchWinner: 'A' | 'B' | null = null;
    if (setsWonA >= 2) matchWinner = 'A';
    else if (setsWonB >= 2) matchWinner = 'B';
    else if (showThirdSet && set3Winner) matchWinner = set3Winner;

    const canSave = matchWinner !== null && canEdit;

    const updateScore = (player: 'A' | 'B', setIndex: number, delta: number) => {
        if (!canEdit) return;

        const setScore = player === 'A' ? [...scoreA] : [...scoreB];
        // Sets 1-2: max 7; Set 3 (tiebreak): max 30
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
            .update({
                score_a: finalScoreA,
                score_b: finalScoreB,
                winner_id: winnerId,
                status: 'finished',
                date: new Date().toISOString().split('T')[0]
            })
            .eq('id', match.id);

        setSaving(false);

        if (updateError) {
            console.error('Error saving score:', updateError);
            setError('Erro ao salvar. Tente novamente.');
            return;
        }

        setSuccess(true);
        onScoreSaved?.();
    };

    // Format time for display
    const formatScheduledTime = () => {
        if (!match.scheduledTime) return null;
        return match.scheduledTime;
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg border border-stone-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-saibro-600 to-saibro-500 p-4 text-white">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Trophy size={20} />
                        <span className="font-bold text-sm uppercase tracking-wide">
                            {match.type === 'Desafio Ranking' ? 'Desafio' : 'Campeonato'}
                        </span>
                    </div>
                    {formatScheduledTime() && (
                        <div className="flex items-center gap-1 text-xs bg-white/20 px-2 py-1 rounded-full">
                            <Clock size={12} />
                            <span>{formatScheduledTime()}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Not editable message */}
            {!canEdit && (
                <div className="bg-amber-50 border-b border-amber-100 p-3 flex items-center gap-2 text-amber-700 text-sm">
                    <AlertCircle size={16} />
                    <span>
                        {match.scheduledTime
                            ? `Edição disponível após ${match.scheduledTime}`
                            : 'Edição não disponível ainda'}
                    </span>
                </div>
            )}

            {/* Players and Score */}
            <div className="p-4 space-y-4">
                {/* Set column headers */}
                <div className="flex justify-end gap-2 px-3">
                    <span className="w-10 text-center text-[10px] font-bold text-stone-400 uppercase">1º Set</span>
                    <span className="w-10 text-center text-[10px] font-bold text-stone-400 uppercase">2º Set</span>
                    {showThirdSet && (
                        <span className="w-10 text-center text-[10px] font-bold text-saibro-500 uppercase">Tie</span>
                    )}
                </div>

                {/* Player A */}
                <div className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${matchWinner === 'A' ? 'bg-green-50 border border-green-200' : 'bg-stone-50'}`}>
                    <img
                        src={playerA?.avatar || 'https://via.placeholder.com/48'}
                        alt={playerA?.name}
                        className={`w-12 h-12 rounded-full border-2 ${matchWinner === 'A' ? 'border-green-500' : 'border-stone-200'}`}
                    />
                    <div className="flex-1">
                        <p className={`font-bold ${matchWinner === 'A' ? 'text-green-700' : 'text-stone-800'}`}>
                            {playerA?.name || 'Jogador A'}
                        </p>
                        {matchWinner === 'A' && (
                            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <Trophy size={12} /> Vencedor
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {[0, 1, 2].map(setIdx => {
                            if (setIdx === 2 && !showThirdSet) return null;
                            const setWin = setIdx === 0 ? set1Winner : setIdx === 1 ? set2Winner : set3Winner;
                            return (
                                <div key={setIdx} className="flex flex-col items-center gap-1">
                                    <button
                                        onClick={() => updateScore('A', setIdx, 1)}
                                        disabled={!canEdit}
                                        className="w-6 h-6 rounded bg-saibro-100 text-saibro-600 flex items-center justify-center disabled:opacity-30 hover:bg-saibro-200 transition-colors"
                                    >
                                        <Plus size={14} />
                                    </button>
                                    <span className={`w-10 h-10 flex items-center justify-center text-lg font-black rounded-lg ${setWin === 'A' ? 'bg-saibro-600 text-white' : 'bg-white border border-stone-200 text-stone-700'
                                        }`}>
                                        {scoreA[setIdx]}
                                    </span>
                                    <button
                                        onClick={() => updateScore('A', setIdx, -1)}
                                        disabled={!canEdit}
                                        className="w-6 h-6 rounded bg-stone-100 text-stone-500 flex items-center justify-center disabled:opacity-30 hover:bg-stone-200 transition-colors"
                                    >
                                        <Minus size={14} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* VS Divider */}
                <div className="flex items-center justify-center">
                    <div className="bg-stone-100 px-3 py-1 rounded-full text-xs font-black text-stone-400 uppercase">
                        vs
                    </div>
                </div>

                {/* Player B */}
                <div className={`flex items-center gap-4 p-3 rounded-xl transition-colors ${matchWinner === 'B' ? 'bg-green-50 border border-green-200' : 'bg-stone-50'}`}>
                    <img
                        src={playerB?.avatar || 'https://via.placeholder.com/48'}
                        alt={playerB?.name}
                        className={`w-12 h-12 rounded-full border-2 ${matchWinner === 'B' ? 'border-green-500' : 'border-stone-200'}`}
                    />
                    <div className="flex-1">
                        <p className={`font-bold ${matchWinner === 'B' ? 'text-green-700' : 'text-stone-800'}`}>
                            {playerB?.name || 'Jogador B'}
                        </p>
                        {matchWinner === 'B' && (
                            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <Trophy size={12} /> Vencedor
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {[0, 1, 2].map(setIdx => {
                            if (setIdx === 2 && !showThirdSet) return null;
                            const setWin = setIdx === 0 ? set1Winner : setIdx === 1 ? set2Winner : set3Winner;
                            return (
                                <div key={setIdx} className="flex flex-col items-center gap-1">
                                    <button
                                        onClick={() => updateScore('B', setIdx, 1)}
                                        disabled={!canEdit}
                                        className="w-6 h-6 rounded bg-saibro-100 text-saibro-600 flex items-center justify-center disabled:opacity-30 hover:bg-saibro-200 transition-colors"
                                    >
                                        <Plus size={14} />
                                    </button>
                                    <span className={`w-10 h-10 flex items-center justify-center text-lg font-black rounded-lg ${setWin === 'B' ? 'bg-saibro-600 text-white' : 'bg-white border border-stone-200 text-stone-700'
                                        }`}>
                                        {scoreB[setIdx]}
                                    </span>
                                    <button
                                        onClick={() => updateScore('B', setIdx, -1)}
                                        disabled={!canEdit}
                                        className="w-6 h-6 rounded bg-stone-100 text-stone-500 flex items-center justify-center disabled:opacity-30 hover:bg-stone-200 transition-colors"
                                    >
                                        <Minus size={14} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Footer / Save Button */}
            <div className="p-4 border-t border-stone-100 bg-stone-50">
                {error && (
                    <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center gap-2">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm flex items-center gap-2">
                        <CheckCircle size={16} />
                        Placar salvo com sucesso!
                    </div>
                )}
                <button
                    onClick={handleSave}
                    disabled={!canSave || saving}
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${canSave && !saving
                        ? 'bg-saibro-600 text-white hover:bg-saibro-700 shadow-lg shadow-orange-100'
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
                            Salvar Placar
                        </>
                    )}
                </button>
                {!matchWinner && canEdit && (scoreA[0] > 0 || scoreB[0] > 0) && (
                    <p className="text-xs text-stone-400 text-center mt-2">
                        Complete um placar válido para salvar
                    </p>
                )}
            </div>
        </div>
    );
};
