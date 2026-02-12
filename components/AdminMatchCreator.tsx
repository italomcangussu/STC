import React, { useState, useEffect } from 'react';
import { User, Court } from '../types';
import { supabase } from '../lib/supabase';
import { X, Save, Trophy, Calendar, Clock, User as UserIcon, CheckCircle, AlertCircle, Loader2, Minus, Plus } from 'lucide-react';
import { getNowInFortaleza, formatDate } from '../utils';
import { StandardModal } from './StandardModal';

interface AdminMatchCreatorProps {
    isOpen: boolean;
    onClose: () => void;
    matchType: 'Desafio' | 'SuperSet';
    profiles: User[];
    courts: Court[];
    onSuccess: () => void;
}

export const AdminMatchCreator: React.FC<AdminMatchCreatorProps> = ({ isOpen, onClose, matchType, profiles, courts, onSuccess }) => {
    const [loading, setLoading] = useState(false);

    // Form State
    const [playerAId, setPlayerAId] = useState('');
    const [playerBId, setPlayerBId] = useState('');
    const [date, setDate] = useState(formatDate(getNowInFortaleza()));
    const [time, setTime] = useState('12:00');
    const [courtId, setCourtId] = useState(courts.length > 0 ? courts[0].id : '');

    // Score State
    // Default 1 set for SuperSet, 3 for Desafio (start with 1 empty)
    const [sets, setSets] = useState<{ a: string, b: string }[]>([{ a: '', b: '' }]);

    useEffect(() => {
        if (matchType === 'SuperSet') {
            setSets([{ a: '', b: '' }]); // Always 1 set
        } else {
            setSets([{ a: '', b: '' }]);
        }
    }, [matchType]);

    if (!isOpen) return null;

    const handleSetChange = (index: number, player: 'a' | 'b', value: string) => {
        const newSets = [...sets];
        newSets[index][player] = value;
        setSets(newSets);
    };

    const addSet = () => {
        if (sets.length < 3) setSets([...sets, { a: '', b: '' }]);
    };

    const removeSet = (index: number) => {
        setSets(sets.filter((_, i) => i !== index));
    };

    // LiveScore Helpers (Embedded for consistency)
    const getSetWinner = (scoreA: number, scoreB: number, isSuperTiebreak = false): 'A' | 'B' | null => {
        if (isSuperTiebreak) {
            if (scoreA >= 10 && scoreA - scoreB >= 2) return 'A';
            if (scoreB >= 10 && scoreB - scoreA >= 2) return 'B';
            return null;
        }
        // Standard Win: 6-x where x <= 4
        if (scoreA === 6 && scoreA - scoreB >= 2) return 'A';
        if (scoreB === 6 && scoreB - scoreA >= 2) return 'B';

        // Extended Win / Tiebreak: 7-x (7-5, 7-6)
        if (scoreA === 7) return 'A';
        if (scoreB === 7) return 'B';

        return null;
    };

    const handleSave = async () => {
        // Validation
        if (!playerAId || !playerBId || !date || !time) {
            alert('Preencha todos os campos obrigatórios.');
            return;
        }
        if (playerAId === playerBId) {
            alert('Os jogadores devem ser diferentes.');
            return;
        }

        // Validate Scores
        const validSets = sets.filter(s => s.a !== '' && s.b !== '');
        if (validSets.length === 0) {
            alert('Informe o placar de pelo menos um set.');
            return;
        }

        // Validate Winner logic using LiveScore rules
        let setsWonA = 0;
        let setsWonB = 0;

        validSets.forEach((s, idx) => {
            const valA = parseInt(s.a);
            const valB = parseInt(s.b);
            const isSuperTie = matchType === 'Desafio' && idx === 2; // Only 3rd set of Desafio might be supertie if needed, but SuperSet is NOT supertie. 
            // In Desafio (3 sets), 3rd set might be SuperTiebreak. Let's assume standard set unless explicitly SuperSet type, 
            // BUT LiveScore logic handles 3rd set as SuperTiebreak usually. 
            // For safety in Admin input, let's treat 3rd set as SuperTiebreak if it looks like one (goes to 10)?
            // Or just use the helper which handles "isSuperTiebreak".
            // Let's assume strict set rules based on typical logic:
            const setWinner = getSetWinner(valA, valB, isSuperTie);

            if (setWinner === 'A') setsWonA++;
            if (setWinner === 'B') setsWonB++;
        });

        if (setsWonA === setsWonB) {
            alert('O jogo não pode terminar empatado. Verifique os placares.');
            return;
        }

        setLoading(true);
        try {
            const winnerId = setsWonA > setsWonB ? playerAId : playerBId;
            const scoreA = validSets.map(s => parseInt(s.a));
            const scoreB = validSets.map(s => parseInt(s.b));

            // 1. Create Reservation (Historical placeholder)
            const { data: resData, error: resError } = await supabase
                .from('reservations')
                .insert({
                    type: matchType,
                    date: date,
                    start_time: time,
                    end_time: time,
                    court_id: courtId || null,
                    creator_id: playerAId,
                    participant_ids: [playerAId, playerBId],
                    status: 'active'
                })
                .select()
                .single();

            if (resError) throw resError;

            // 2. Create Match
            const { data: matchData, error: matchError } = await supabase
                .from('matches')
                .insert({
                    type: matchType,
                    player_a_id: playerAId,
                    player_b_id: playerBId,
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: winnerId,
                    date: `${date}T${time}:00`,
                    status: 'finished',
                    championship_id: null
                })
                .select()
                .single();

            if (matchError) throw matchError;

            // 3. Create Challenge
            if (matchType === 'Desafio') {
                const { error: chalError } = await supabase
                    .from('challenges')
                    .insert({
                        challenger_id: playerAId,
                        challenged_id: playerBId,
                        status: 'finished',
                        scheduled_date: date, // Renamed from 'date'
                        month_ref: date.substring(0, 7), // Add month_ref YYYY-MM
                        reservation_id: resData.id,
                        match_id: matchData.id,
                        created_at: `${date}T${time}:00`
                    });
                if (chalError) throw chalError;
            }

            // 4. Points are handled automatically by DB Triggers (trg_calculate_match_points)
            // when match is inserted with status='finished'.

            alert('Partida retroativa registrada com sucesso! Pontos e histórico calculados automaticamente.');
            onSuccess();
            onClose();

        } catch (error: any) {
            console.error('Error creating match:', error);
            alert(`Erro ao registrar partida: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <StandardModal isOpen={isOpen} onClose={onClose} verticalAlign="start">
            <div className="bg-white w-full max-w-lg rounded-[32px] sm:rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh]">

                {/* Header */}
                <div className="px-8 py-6 border-b border-stone-100/50 bg-white/80 backdrop-blur-xl sticky top-0 z-10 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black text-stone-800 tracking-tight flex items-center gap-2">
                            <Trophy className="text-saibro-500" size={24} strokeWidth={2.5} />
                            Lançar {matchType} (Retro)
                        </h2>
                        <p className="text-xs text-stone-400 font-bold uppercase tracking-widest mt-1">
                            Gera pontos no ranking automaticamente.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-3 bg-stone-50 hover:bg-stone-100 text-stone-400 hover:text-stone-600 rounded-full transition-all active:scale-90">
                        <X size={20} strokeWidth={3} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 space-y-8 overflow-y-auto">

                    {/* Date & Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest">
                                <Calendar size={12} /> Data
                            </label>
                            <input
                                type="date"
                                value={date}
                                onChange={e => setDate(e.target.value)}
                                className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl text-sm font-bold text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest">
                                <Clock size={12} /> Hora
                            </label>
                            <input
                                type="time"
                                value={time}
                                onChange={e => setTime(e.target.value)}
                                className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl text-sm font-bold text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none"
                            />
                        </div>
                    </div>

                    {/* Court Selector */}
                    <div className="bg-stone-50/50 p-4 rounded-2xl border border-stone-100">
                        <label className="block text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">
                            Onde ocorreu o jogo? (Opcional)
                        </label>
                        <select
                            value={courtId}
                            onChange={e => setCourtId(e.target.value)}
                            className="w-full px-4 py-3 bg-white border-none rounded-xl text-sm font-bold text-stone-700 outline-none shadow-sm focus:ring-2 focus:ring-saibro-500"
                        >
                            <option value="">Selecione a quadra...</option>
                            {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {/* Matchup & Score Card */}
                    <div className="bg-stone-50 rounded-[32px] p-6 border border-stone-100">
                        <div className="flex justify-between items-center mb-6">
                            {/* Player A */}
                            <div className="flex-1">
                                <label className="block text-[10px] font-black text-blue-500 uppercase tracking-widest mb-2 text-center">Jogador A</label>
                                <select
                                    value={playerAId}
                                    onChange={e => setPlayerAId(e.target.value)}
                                    className="w-full p-3 bg-white border-none rounded-xl text-sm font-bold text-blue-900 shadow-sm text-center appearance-none focus:ring-2 focus:ring-blue-200 outline-none"
                                >
                                    <option value="">Selecionar...</option>
                                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>

                            <div className="px-4 pb-6">
                                <span className="text-2xl font-black text-stone-300 italic">VS</span>
                            </div>

                            {/* Player B */}
                            <div className="flex-1">
                                <label className="block text-[10px] font-black text-red-500 uppercase tracking-widest mb-2 text-center">Jogador B</label>
                                <select
                                    value={playerBId}
                                    onChange={e => setPlayerBId(e.target.value)}
                                    className="w-full p-3 bg-white border-none rounded-xl text-sm font-bold text-red-900 shadow-sm text-center appearance-none focus:ring-2 focus:ring-red-200 outline-none"
                                >
                                    <option value="">Selecionar...</option>
                                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Sets Score Board */}
                        <div className="space-y-4">
                            {matchType === 'SuperSet' ? (
                                // Interactive SuperSet UI
                                <div className="flex flex-col items-center gap-6">
                                    <div className="flex items-center gap-8">
                                        {/* Player A Controls */}
                                        <div className="flex flex-col items-center gap-2">
                                            <button
                                                onClick={() => handleSetChange(0, 'a', Math.min((parseInt(sets[0].a) || 0) + 1, 7).toString())}
                                                className="w-16 h-16 rounded-2xl bg-white border-2 border-blue-100 text-blue-600 flex items-center justify-center text-3xl font-black hover:bg-blue-500 hover:text-white transition-all active:scale-90 shadow-sm"
                                            >+</button>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={sets[0].a}
                                                    readOnly
                                                    className="w-24 h-24 text-center text-6xl font-black text-stone-800 bg-transparent border-none outline-none tabular-nums tracking-tighter [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                />
                                                {getSetWinner(parseInt(sets[0].a), parseInt(sets[0].b)) === 'A' && (
                                                    <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 p-1.5 rounded-full shadow-lg animate-bounce border-2 border-white">
                                                        <Trophy size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleSetChange(0, 'a', Math.max((parseInt(sets[0].a) || 0) - 1, 0).toString())}
                                                className="w-12 h-12 rounded-xl bg-white border border-stone-200 text-stone-400 flex items-center justify-center text-xl font-bold hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                                            >-</button>
                                        </div>

                                        {/* Divider */}
                                        <div className="flex flex-col items-center gap-2 h-32 justify-center">
                                            <div className="w-1 h-full bg-stone-100 rounded-full"></div>
                                        </div>

                                        {/* Player B Controls */}
                                        <div className="flex flex-col items-center gap-2">
                                            <button
                                                onClick={() => handleSetChange(0, 'b', Math.min((parseInt(sets[0].b) || 0) + 1, 7).toString())}
                                                className="w-16 h-16 rounded-2xl bg-white border-2 border-red-100 text-red-600 flex items-center justify-center text-3xl font-black hover:bg-red-500 hover:text-white transition-all active:scale-90 shadow-sm"
                                            >+</button>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={sets[0].b}
                                                    readOnly
                                                    className="w-24 h-24 text-center text-6xl font-black text-stone-800 bg-transparent border-none outline-none tabular-nums tracking-tighter [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                />
                                                {getSetWinner(parseInt(sets[0].a), parseInt(sets[0].b)) === 'B' && (
                                                    <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 p-1.5 rounded-full shadow-lg animate-bounce border-2 border-white">
                                                        <Trophy size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleSetChange(0, 'b', Math.max((parseInt(sets[0].b) || 0) - 1, 0).toString())}
                                                className="w-12 h-12 rounded-xl bg-white border border-stone-200 text-stone-400 flex items-center justify-center text-xl font-bold hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                                            >-</button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {sets.map((set, idx) => (
                                        <div key={idx} className="flex items-center justify-center gap-4 animate-in zoom-in duration-300">
                                            <input
                                                type="number"
                                                value={set.a}
                                                onChange={e => handleSetChange(idx, 'a', e.target.value)}
                                                placeholder="0"
                                                className="w-16 h-16 text-center text-3xl font-black text-blue-600 bg-white rounded-2xl border-none shadow-sm focus:ring-4 focus:ring-blue-100 outline-none placeholder:text-stone-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-[10px] font-black text-stone-300 uppercase tracking-wider">SET {idx + 1}</span>
                                                <div className="w-8 h-1 bg-stone-200 rounded-full"></div>
                                            </div>
                                            <input
                                                type="number"
                                                value={set.b}
                                                onChange={e => handleSetChange(idx, 'b', e.target.value)}
                                                placeholder="0"
                                                className="w-16 h-16 text-center text-3xl font-black text-red-600 bg-white rounded-2xl border-none shadow-sm focus:ring-4 focus:ring-red-100 outline-none placeholder:text-stone-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            {idx > 0 && sets.length > 1 && (
                                                <button onClick={() => removeSet(idx)} className="absolute right-8 text-red-300 hover:text-red-500 p-2">
                                                    <Minus size={16} strokeWidth={3} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {sets.length < 3 && (
                                        <div className="text-center pt-2">
                                            <button
                                                onClick={addSet}
                                                className="px-4 py-2 bg-white text-stone-400 hover:text-saibro-600 hover:bg-saibro-50 font-bold text-xs rounded-full border border-stone-200 transition-all shadow-sm active:scale-95 inline-flex items-center gap-2"
                                            >
                                                <Plus size={14} strokeWidth={3} /> Adicionar 3º Set
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-stone-100 bg-white flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 text-stone-400 font-bold bg-stone-50 hover:bg-stone-100 rounded-2xl transition-colors uppercase tracking-wider text-sm"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-2 py-4 bg-saibro-600 hover:bg-saibro-700 text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-xl shadow-saibro-100 hover:shadow-2xl transition-all active:scale-95 disabled:opacity-70 uppercase tracking-widest text-sm"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                        Confirmar Resultado
                    </button>
                </div>
            </div>
        </StandardModal>
    );
};
