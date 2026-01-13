import React, { useState, useMemo } from 'react';
import { Match, User } from '../types';
import { Trophy, Clock, Save, Loader2, Plus, Minus, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

import { getMatchWinner, getNowInFortaleza, formatDate } from '../utils';

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

        // Use Fortaleza time for checks
        const now = getNowInFortaleza();
        const today = formatDate(now);

        // Must be match day
        if (match.date !== today) return false;

        // Check scheduled time
        const [hours, minutes] = match.scheduledTime.split(':').map(Number);

        // Create scheduled datetime based on the "shifted" now object
        const scheduledDateTime = new Date(now);
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
                date: formatDate(getNowInFortaleza())
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
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl ring-1 ring-white/10 group">
            {/* TV Gloss/Reflection Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none z-0" />

            {/* Header - Broadcast Bar */}
            <div className="relative z-10 bg-black/20 backdrop-blur-md p-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] font-bold text-red-500 uppercase tracking-widest animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_5px_currentColor]" />
                        Ao Vivo
                    </div>
                    <span className="text-white/40 text-xs font-bold tracking-wider uppercase hidden sm:block">
                        {match.type === 'Desafio Ranking' ? 'Desafio STC' : 'Torneio STC'}
                    </span>
                </div>
                {formatScheduledTime() && (
                    <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                        <Clock size={12} className="text-saibro-500" />
                        <span className="font-mono tracking-wide">{formatScheduledTime()}</span>
                    </div>
                )}
            </div>

            {/* Main Scoreboard Area */}
            <div className="relative z-10 p-6 sm:p-8 grid grid-cols-[1fr_auto_1fr] gap-4 items-center justify-items-center">
                {/* Player A */}
                <div className={`flex flex-col items-center gap-3 transition-all duration-500 ${matchWinner && matchWinner !== 'A' ? 'opacity-30 grayscale scale-95' : 'opacity-100'}`}>
                    <div className="relative group/avatar">
                        <div className={`absolute inset-0 rounded-full bg-saibro-500 blur-md opacity-0 transition-opacity duration-500 ${matchWinner === 'A' ? 'opacity-40' : 'group-hover/avatar:opacity-20'}`} />
                        <img
                            src={playerA?.avatar || 'https://via.placeholder.com/48'}
                            alt={playerA?.name}
                            className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 shadow-2xl object-cover transition-colors duration-300 ${matchWinner === 'A' ? 'border-saibro-500' : 'border-slate-700'}`}
                        />
                        {matchWinner === 'A' && (
                            <div className="absolute -top-3 -right-2 bg-gradient-to-br from-yellow-300 to-amber-500 text-yellow-900 p-1.5 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.5)] z-20 animate-in zoom-in spin-in-12 duration-500">
                                <Trophy size={14} fill="currentColor" strokeWidth={3} />
                            </div>
                        )}
                    </div>
                    <h3 className="text-white font-bold text-sm sm:text-lg leading-tight text-center max-w-[100px] sm:max-w-[140px] truncate drop-shadow-md">
                        {playerA?.name || 'Jogador A'}
                    </h3>
                </div>

                {/* Scores Center */}
                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-2 sm:gap-4 bg-black/40 p-2 sm:p-3 rounded-2xl border border-white/5 shadow-inner">
                        {/* Loop through sets */}
                        {[0, 1, 2].map(idx => {
                            if (idx === 2 && !showThirdSet) return null;
                            const isCurrentSet = (idx === 0 && !set1Winner) || (idx === 1 && set1Winner && !set2Winner) || (idx === 2);

                            return (
                                <div key={idx} className={`relative flex flex-col items-center p-2 sm:p-3 rounded-xl transition-all duration-300 ${isCurrentSet ? 'bg-white/10 ring-1 ring-white/20 shadow-lg' : 'opacity-60'}`}>
                                    <span className="text-[9px] text-white/30 font-black uppercase mb-2 tracking-widest">{idx === 2 ? 'TIE' : `${idx + 1}º SET`}</span>

                                    <div className="flex items-center gap-2 sm:gap-4 font-mono text-2xl sm:text-4xl font-black text-white leading-none tracking-wider">
                                        {/* P1 Score */}
                                        <div className="flex flex-col items-center gap-1">
                                            {canEdit && (
                                                <button onClick={() => updateScore('A', idx, 1)} className="text-white/10 hover:text-saibro-400 hover:bg-white/5 rounded-full p-1 transition-all active:scale-90"><Plus size={12} strokeWidth={4} /></button>
                                            )}
                                            <span className={`transition-colors duration-300 ${scoreA[idx] > scoreB[idx] ? 'text-white' : 'text-white/40'}`}>{scoreA[idx]}</span>
                                            {canEdit && (
                                                <button onClick={() => updateScore('A', idx, -1)} className="text-white/10 hover:text-red-400 hover:bg-white/5 rounded-full p-1 transition-all active:scale-90"><Minus size={12} strokeWidth={4} /></button>
                                            )}
                                        </div>

                                        <span className="text-white/10 text-xl font-light mb-1">:</span>

                                        {/* P2 Score */}
                                        <div className="flex flex-col items-center gap-1">
                                            {canEdit && (
                                                <button onClick={() => updateScore('B', idx, 1)} className="text-white/10 hover:text-saibro-400 hover:bg-white/5 rounded-full p-1 transition-all active:scale-90"><Plus size={12} strokeWidth={4} /></button>
                                            )}
                                            <span className={`transition-colors duration-300 ${scoreB[idx] > scoreA[idx] ? 'text-white' : 'text-white/40'}`}>{scoreB[idx]}</span>
                                            {canEdit && (
                                                <button onClick={() => updateScore('B', idx, -1)} className="text-white/10 hover:text-red-400 hover:bg-white/5 rounded-full p-1 transition-all active:scale-90"><Minus size={12} strokeWidth={4} /></button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Player B */}
                <div className={`flex flex-col items-center gap-3 transition-opacity duration-500 ${matchWinner && matchWinner !== 'B' ? 'opacity-30 grayscale scale-95' : 'opacity-100'}`}>
                    <div className="relative group/avatar">
                        <div className={`absolute inset-0 rounded-full bg-saibro-500 blur-md opacity-0 transition-opacity duration-500 ${matchWinner === 'B' ? 'opacity-40' : 'group-hover/avatar:opacity-20'}`} />
                        <img
                            src={playerB?.avatar || 'https://via.placeholder.com/48'}
                            alt={playerB?.name}
                            className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-4 shadow-2xl object-cover transition-colors duration-300 ${matchWinner === 'B' ? 'border-saibro-500' : 'border-slate-700'}`}
                        />
                        {matchWinner === 'B' && (
                            <div className="absolute -top-3 -right-2 bg-gradient-to-br from-yellow-300 to-amber-500 text-yellow-900 p-1.5 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.5)] z-20 animate-in zoom-in spin-in-12 duration-500">
                                <Trophy size={14} fill="currentColor" strokeWidth={3} />
                            </div>
                        )}
                    </div>
                    <h3 className="text-white font-bold text-sm sm:text-lg leading-tight text-center max-w-[100px] sm:max-w-[140px] truncate drop-shadow-md">
                        {playerB?.name || 'Jogador B'}
                    </h3>
                </div>
            </div>

            {/* Footer / Save Button */}
            <div className="relative z-10 p-4 border-t border-white/5 bg-black/20 backdrop-blur-sm">
                {error && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm flex items-center gap-2">
                        <CheckCircle size={16} />
                        Placar salvo com sucesso!
                    </div>
                )}
                <button
                    onClick={handleSave}
                    disabled={!canSave || saving}
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 uppercase tracking-wider text-sm ${canSave && !saving
                        ? 'bg-gradient-to-r from-saibro-600 to-saibro-500 text-white hover:shadow-[0_0_20px_rgba(234,88,12,0.4)] hover:scale-[1.02]'
                        : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
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
                            SALVAR PLACAR
                        </>
                    )}
                </button>
                {!matchWinner && canEdit && (scoreA[0] > 0 || scoreB[0] > 0) && (
                    <p className="text-[10px] uppercase tracking-widest text-white/30 text-center mt-3 font-bold">
                        Defina um vencedor para salvar
                    </p>
                )}
            </div>
        </div>
    );
};
