
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, Reservation, ReservationType, NonSocioStudent, PlanType, Professor, Match } from '../types';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, X, Calendar, Clock, MapPin, Users, Check, AlertCircle, Search, Filter, Loader2, Save, Trash2, Edit2, Play, Trophy, UserCog, ArrowRight, Info, UserPlus, LogOut, Wallet, Pencil, UserMinus, Share2, ArrowLeft, Minus, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ScoreModal } from './ScoreModal';
import { LiveScoreboard } from './LiveScoreboard';
import { StandardModal } from './StandardModal';
import { TennisCourtAnimation } from './ui/TennisCourtAnimation';
import { Challenge } from '../types';
import { getNowInFortaleza, formatDate, addDays, formatDateBr } from '../utils';

// Court type
interface Court {
    id: string;
    name: string;
    type: string;
    isActive: boolean;
}

// --- HELPERS ---
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

// Check if user can launch score (same logic as LiveScoreboard)
const canLaunchScore = (match: Match, userId?: string, isAdmin?: boolean): boolean => {
    if (isAdmin) return true;
    if (!userId) return false;
    
    // Must be one of the players
    if (match.playerAId !== userId && match.playerBId !== userId) return false;
    // If no scheduled time, allow anytime if created
    if (!match.scheduled_date || !match.scheduled_time) return true;
    
    // Use Fortaleza time for checks
    const now = getNowInFortaleza();
    const today = formatDate(now);
    
    // Must be on/after match day (allowing past days if pending?? Logic in Championships was strict 'today')
    // Let's keep strict 'today' or allow if status is not finished?
    // User request: "se horário for após inicio do jogo"
    // Championship logic was:
    if (match.scheduled_date !== today) return false;
    
    // Check if current time >= scheduled time
    const [hours, minutes] = match.scheduled_time.split(':').map(Number);
    const scheduledDateTime = new Date(now); // now is Fortaleza time
    scheduledDateTime.setHours(hours, minutes, 0, 0);
    
    return now >= scheduledDateTime;
};

const getDayName = (dateStr: string) => {
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    // Interpret dateStr as YYYY-MM-DD in local time (which matches our shifted strategy)
    const d = new Date(dateStr + 'T12:00:00'); // Keep this for now as it's date parsing only
    // Ideally we'd parse timezone aware but 'T12:00:00' hack is usually safe for pure date logic if consistent.
    // Let's leave this one alone if it's just parsing the date string from the URL/State.
    return days[d.getDay()];
};

// Use shared helper or local override if needed
// const formatDate = ... (imported from utils)
// const formatDateBr = ... (imported from utils)



const addMinutes = (time: string, minutes: number) => {
    const [h, m] = time.split(':').map(Number);
    // Create a dummy date for calculation
    const date = getNowInFortaleza();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + minutes);
    return date.toTimeString().slice(0, 5);
};

// Check if two time ranges overlap (conflict logic)
const checkOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    return (startA < endB) && (endA > startB);
};

// --- CLASS HELPERS ---
const getClassNonSocioIds = (res: Reservation): string[] => {
    if (res.nonSocioStudentIds && res.nonSocioStudentIds.length > 0) return res.nonSocioStudentIds;
    if (res.nonSocioStudentId) return [res.nonSocioStudentId];
    // Legacy: non-socio classes stored student ids in participantIds
    if (res.type === 'Aula' && res.studentType === 'non-socio' && res.participantIds.length > 0) {
        return res.participantIds;
    }
    return [];
};

const getClassSocioIds = (res: Reservation): string[] => {
    // Legacy: if no non-socio arrays and type marked as non-socio, participantIds were non-socio
    if (res.type === 'Aula' && res.studentType === 'non-socio') {
        if ((!res.nonSocioStudentIds || res.nonSocioStudentIds.length === 0) && !res.nonSocioStudentId) {
            return [];
        }
    }
    return res.participantIds || [];
};

// --- VISUAL MAPPINGS ---
const TYPE_STYLES: Record<ReservationType, { bg: string, border: string, text: string, label: string }> = {
    'Campeonato': { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-800', label: 'Camp' },
    'Desafio': { bg: 'bg-indigo-50', border: 'border-indigo-500', text: 'text-indigo-800', label: 'Desafio' },
    'Play': { bg: 'bg-green-50', border: 'border-court-green', text: 'text-green-800', label: 'Play' },
    'Aula': { bg: 'bg-orange-50', border: 'border-saibro-500', text: 'text-saibro-800', label: 'Aula' },
};

// --- COMPONENT: Manage Participants Modal ---
const ManageParticipantsModal: React.FC<{
    currentParticipants: string[];
    profiles: User[];
    onClose: () => void;
    onUpdate: (newIds: string[]) => void;
}> = ({ currentParticipants, profiles, onClose, onUpdate }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>(currentParticipants);

    const availableSocios = profiles.filter(u => (u.role === 'socio' || u.role === 'admin') && u.isActive !== false);

    const filteredSocios = availableSocios.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.phone && u.phone.includes(searchTerm))
    );

    const toggleId = (id: string) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) return prev.filter(i => i !== id);
            if (prev.length >= 8) return prev; // Limit to 8 for example
            return [...prev, id];
        });
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-stone-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-stone-800">Gerenciar Atletas</h3>
                    <button onClick={onClose} className="p-2 text-stone-400 hover:bg-stone-50 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nome ou número..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {filteredSocios.map(user => {
                            const isSelected = selectedIds.includes(user.id);
                            return (
                                <button
                                    key={user.id}
                                    onClick={() => toggleId(user.id)}
                                    className={`w - full flex items - center justify - between p - 3 rounded - 2xl border - 2 transition - all ${isSelected ? 'bg-saibro-50 border-saibro-500' : 'bg-white border-stone-50 hover:border-stone-200'
                                        } `}
                                >
                                    <div className="flex items-center gap-3 text-left">
                                        <img src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`} className="w-10 h-10 rounded-full border border-stone-100" />
                                        <div>
                                            <p className="font-bold text-stone-800 text-sm">{user.name}</p>
                                            <p className="text-[10px] text-stone-400">{user.phone ? `+${user.phone}` : user.email}</p>
                                        </div>
                                    </div >
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors ${isSelected ? 'bg-saibro-500 border-saibro-500 text-white' : 'border-stone-200'
                                        }`}>
                                        {isSelected && <Check size={14} strokeWidth={3} />}
                                    </div>
                                </button >
                            );
                        })}
                    </div>
                </div>
                <div className="p-4 border-t border-stone-100 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-stone-500 font-bold text-sm bg-stone-50 rounded-2xl hover:bg-stone-100 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => {
                            if (selectedIds.length === 0) return;
                            onUpdate(selectedIds);
                        }}
                        disabled={selectedIds.length === 0}
                        className={`flex-1 py-3 font-bold text-sm rounded-2xl transition-all shadow-md ${selectedIds.length > 0 ? 'bg-saibro-600 text-white hover:bg-saibro-700' : 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none'
                            }`}
                    >
                        Confirmar ({selectedIds.length})
                    </button>
                </div>
            </div>
        </StandardModal>
    );
};


// --- COMPONENT: Manage Guest Modal ---
const ManageGuestModal: React.FC<{
    res: Reservation;
    profiles: User[];
    onClose: () => void;
    onUpdate: (res: Reservation) => void;
    currentUser: User;
}> = ({ res, profiles, onClose, onUpdate, currentUser }) => {
    const [name, setName] = useState(res.guestName || '');
    const [responsibleId, setResponsibleId] = useState(res.guestResponsibleId || currentUser.id);

    const availablePartners = profiles.filter(u => (u.role === 'socio' || u.role === 'admin') && (u.id === currentUser.id || res.participantIds.includes(u.id)));

    const handleSave = () => {
        if (!name.trim()) return;
        onUpdate({
            ...res,
            guestName: name,
            guestResponsibleId: responsibleId
        });
        onClose();
    };

    const handleRemove = () => {
        onUpdate({
            ...res,
            guestName: undefined,
            guestResponsibleId: undefined
        });
        onClose();
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex justify-between items-center border-b border-stone-100 pb-3">
                    <h3 className="text-lg font-bold text-stone-800">{res.guestName ? 'Editar Convidado' : 'Adicionar Convidado'}</h3>
                    <button onClick={onClose} className="p-2 text-stone-400 hover:bg-stone-50 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Nome do Convidado</label>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Nome completo"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Sócio Responsável</label>
                        <select
                            value={responsibleId}
                            onChange={(e) => setResponsibleId(e.target.value)}
                            className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm appearance-none"
                        >
                            {availablePartners.map(u => (
                                <option key={u.id} value={u.id}>{u.name} (Sócio)</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                    <button
                        onClick={handleSave}
                        disabled={!name.trim()}
                        className="w-full py-3 bg-saibro-600 text-white font-bold rounded-2xl hover:bg-saibro-700 transition-colors shadow-lg shadow-orange-100 disabled:opacity-50"
                    >
                        {res.guestName ? 'Salvar Alterações' : 'Confirmar Convidado'}
                    </button>
                    {res.guestName && (
                        <button
                            onClick={handleRemove}
                            className="w-full py-3 text-red-500 font-bold hover:bg-red-50 rounded-2xl transition-colors"
                        >
                            Remover Convidado
                        </button>
                    )}
                </div>
            </div>
        </StandardModal>
    );
};

// --- HELPERS ---
const isMatchLive = (res: Reservation) => {
    if (res.type !== 'Campeonato' || res.status !== 'active') return false;
    const now = getNowInFortaleza();
    const matchStart = new Date(res.date + 'T' + res.startTime);
    // Allow live HUD until 3 hours after start
    const matchEnd = new Date(matchStart.getTime() + 180 * 60000);
    return now >= matchStart && now <= matchEnd;
};

// --- COMPONENT: Live Score HUD ---
const LiveScoreSection: React.FC<{
    res: Reservation;
    profiles: User[];
    onFinish: (winnerId: string, scoreA: number[], scoreB: number[]) => Promise<void>;
}> = ({ res, profiles, onFinish }) => {
    const [scoreA, setScoreA] = useState<number[]>(res.scoreA || [0]);
    const [scoreB, setScoreB] = useState<number[]>(res.scoreB || [0]);
    const [saving, setSaving] = useState(false);

    const playerA = profiles.find(p => p.id === res.participantIds[0]);
    const playerB = profiles.find(p => p.id === res.participantIds[1]);

    const handleUpdate = (player: 'a' | 'b', setIdx: number, delta: number) => {
        if (player === 'a') {
            const newScore = [...scoreA];
            newScore[setIdx] = Math.max(0, (newScore[setIdx] || 0) + delta);
            setScoreA(newScore);
        } else {
            const newScore = [...scoreB];
            newScore[setIdx] = Math.max(0, (newScore[setIdx] || 0) + delta);
            setScoreB(newScore);
        }
    };

    const addSet = () => {
        if (scoreA.length < 3) {
            setScoreA([...scoreA, 0]);
            setScoreB([...scoreB, 0]);
        }
    };

    const removeSet = (idx: number) => {
        if (scoreA.length <= 1) return;
        setScoreA(scoreA.filter((_, i) => i !== idx));
        setScoreB(scoreB.filter((_, i) => i !== idx));
    };

    const handleConfirm = async () => {
        if (!res.participantIds[0] || !res.participantIds[1]) return;
        setSaving(true);
        try {
            let winsA = 0;
            let winsB = 0;
            scoreA.forEach((s, i) => {
                if (s > scoreB[i]) winsA++;
                else if (scoreB[i] > s) winsB++;
            });
            const winnerId = winsA > winsB ? res.participantIds[0] : res.participantIds[1];
            await onFinish(winnerId, scoreA, scoreB);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-stone-900 rounded-[32px] p-6 shadow-2xl border border-white/10 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-4">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/20 border border-red-500/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Live</span>
                </div>
            </div>

            <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 flex flex-col items-center">
                        <img src={playerA?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerA?.id}`} className="w-14 h-14 rounded-full border-2 border-white/20 mb-2 object-cover" />
                        <span className="text-white font-black text-[10px] uppercase tracking-tighter truncate w-24 text-center">{playerA?.name.split(' ')[0]}</span>
                    </div>
                    <div className="text-stone-600 font-black italic text-xl">VS</div>
                    <div className="flex-1 flex flex-col items-center">
                        <img src={playerB?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerB?.id}`} className="w-14 h-14 rounded-full border-2 border-white/20 mb-2 object-cover" />
                        <span className="text-white font-black text-[10px] uppercase tracking-tighter truncate w-24 text-center">{playerB?.name.split(' ')[0]}</span>
                    </div>
                </div>

                <div className="space-y-4">
                    {scoreA.map((_, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-4 bg-white/5 p-3 rounded-2xl border border-white/5">
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleUpdate('a', idx, -1)} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white active:scale-90"><Minus size={14} /></button>
                                <span className="text-3xl font-black text-white w-8 text-center tabular-nums">{scoreA[idx]}</span>
                                <button onClick={() => handleUpdate('a', idx, 1)} className="w-8 h-8 rounded-lg bg-saibro-500 flex items-center justify-center text-white active:scale-90"><Plus size={14} /></button>
                            </div>

                            <div className="text-[10px] font-black text-white/30 uppercase tracking-widest">Set {idx + 1}</div>

                            <div className="flex items-center gap-2">
                                <button onClick={() => handleUpdate('b', idx, 1)} className="w-8 h-8 rounded-lg bg-saibro-500 flex items-center justify-center text-white active:scale-90"><Plus size={14} /></button>
                                <span className="text-3xl font-black text-white w-8 text-center tabular-nums">{scoreB[idx]}</span>
                                <button onClick={() => handleUpdate('b', idx, -1)} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white active:scale-90"><Minus size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex gap-2">
                    {scoreA.length < 3 && (
                        <button onClick={addSet} className="flex-1 py-3 border border-white/10 rounded-2xl text-[10px] font-black text-white uppercase tracking-widest hover:bg-white/5 transition-colors">
                            + Set
                        </button>
                    )}
                    {scoreA.length > 1 && (
                        <button onClick={() => removeSet(scoreA.length - 1)} className="py-3 px-4 border border-white/10 rounded-2xl text-red-500 hover:bg-red-500/10 transition-colors">
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={saving}
                    className="w-full py-4 bg-saibro-600 text-white font-black rounded-2xl shadow-xl shadow-saibro-900/40 flex items-center justify-center gap-2 uppercase tracking-widest text-xs hover:bg-saibro-500 transition-all active:scale-[0.98]"
                >
                    {saving ? <Loader2 className="animate-spin" /> : <><CheckCircle size={18} /> Confirmar Resultado</>}
                </button>
            </div>
        </div>
    );
};

// --- COMPONENT: Reservation Details View ---
const ReservationDetails: React.FC<{
    res: Reservation;
    currentUser: User;
    profiles: User[];
    courts: Court[];
    professors: Professor[];
    nonSocioStudents: NonSocioStudent[];
    onClose: () => void;
    onEdit: (res: Reservation) => void;
    onCancel: (id: string) => void;
    onJoin: (id: string) => void;
    onLeave: (id: string) => void;
    onUpdate: (res: Reservation) => void;
    onFinishMatch: (matchId: string, winnerId: string, scoreA: number[], scoreB: number[]) => Promise<void>;
    onDataRefresh?: () => void;
}> = ({ res, currentUser, profiles, courts, professors, nonSocioStudents, onClose, onEdit, onCancel, onJoin, onLeave, onUpdate, onFinishMatch, onDataRefresh }) => {
    const [showManageParticipants, setShowManageParticipants] = useState(false);
    const [showGuestModal, setShowGuestModal] = useState(false);
    const court = courts.find(c => c.id === res.courtId);
    const professor = professors.find(p => p.id === res.professorId);
    const socioParticipantIds = res.type === 'Aula' ? getClassSocioIds(res) : res.participantIds;
    const participants = socioParticipantIds.map(id => profiles.find(u => u.id === id)).filter(Boolean);
    const creator = profiles.find(u => u.id === res.creatorId);

    // Non-Socio Logic (classes can be mixed)
    const nonSocioIds = res.type === 'Aula' ? getClassNonSocioIds(res) : [];
    const nonSocioStudentsList: NonSocioStudent[] = nonSocioIds
        .map(id => nonSocioStudents.find(s => s.id === id))
        .filter(Boolean) as NonSocioStudent[];

    const style = TYPE_STYLES[res.type] || TYPE_STYLES['Play'];

    // Permissions
    const isCreator = res.creatorId === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    const isParticipant = res.participantIds.includes(currentUser.id);
    const isActive = res.status === 'active';
    const isFuture = new Date(res.date + 'T' + res.startTime) > getNowInFortaleza();
    const isNotFinished = new Date(res.date + 'T' + res.endTime) > getNowInFortaleza();

    const canManageParticipants = isActive && (isAdmin || currentUser.role === 'socio' || currentUser.role === 'admin') && isFuture && res.type === 'Play';
    const canEdit = isActive && (isAdmin || (isFuture && isCreator)) && res.type !== 'Campeonato';
    const canCancel = isActive && isFuture && (isAdmin || isCreator) && res.type !== 'Campeonato';
    const canJoin = res.type === 'Play' && isActive && isNotFinished && !isParticipant && (currentUser.role === 'socio' || isAdmin) && res.participantIds.length < 8;
    const canLeave = res.type === 'Play' && isActive && isNotFinished && isParticipant;
    const canShare = isActive;

    const handleShareWhatsapp = () => {
        const dateBr = formatDateBr(res.date);
        const dayWeek = getDayName(res.date);
        const emoji = res.type === 'Aula' ? '🎓' : res.type === 'Campeonato' ? '🏆' : '🎾';

        let text = `*SCT TÊNIS - ${res.type === 'Campeonato' ? 'JOGO DE CAMPEONATO' : 'RESERVA CONFIRMADA'}*\n`;
        text += `------------------------------------\n`;
        text += `${emoji} *TIPO:* ${res.type.toUpperCase()}\n`;
        text += `📅 *DATA:* ${dateBr} (${dayWeek})\n`;
        text += `⏰ *HORÁRIO:* ${res.startTime} - ${res.endTime}\n`;
        text += `📍 *QUADRA:* ${court?.name} (${court?.type})\n`;
        text += `------------------------------------\n\n`;

        if (res.type === 'Aula') {
            text += `🎓 *PROFESSOR:* ${professor?.name || 'N/A'}\n`;
            const socioNames = participants.map(p => p?.name).filter(Boolean) as string[];
            const nonSocioNames = nonSocioStudentsList.map(s => s.name);
            if (socioNames.length > 0) text += `👥 *SÓCIOS:* ${socioNames.join(', ')}\n`;
            if (nonSocioNames.length > 0) text += `👥 *ALUNOS:* ${nonSocioNames.join(', ')}\n`;
            if (socioNames.length === 0 && nonSocioNames.length === 0) text += `👥 *ALUNOS:* TBD\n`;
        } else if (res.type === 'Campeonato') {
            text += `🏆 *CAMPEONATO:* ${res.observation?.split('|')[0] || 'Oficial'}\n`;
            text += `⚔️ *CONFRONTO:*\n`;
            text += `🎾 ${participants[0]?.name || 'TBD'} vs ${participants[1]?.name || 'TBD'}\n`;
        } else {
            text += `👥 *ATLETAS:* \n`;
            participants.forEach(p => {
                text += `👤 ${p?.name}\n`;
            });
            if (res.guestName) {
                text += `👤 ${res.guestName} (Convidado)\n`;
            }
        }

        if (res.observation) {
            text += `\n📝 *OBS:* ${res.observation}`;
        }

        text += `\n\n_Gerado via SCT App_`;

        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <>
                <div className="bg-stone-50 w-full max-w-lg rounded-[40px] flex flex-col max-h-[92vh] overflow-hidden shadow-2xl">
                {/* 1. Header with Glass effect */}
                <div className="bg-white/80 backdrop-blur-xl px-6 py-5 border-b border-stone-200/60 flex items-center justify-between sticky top-0 z-10">
                    <button onClick={onClose} className="p-2.5 -ml-2 text-stone-600 hover:bg-stone-100 rounded-full transition-all active:scale-90">
                        <ArrowLeft size={22} strokeWidth={2.5} />
                    </button>
                    <h2 className="text-xl font-black text-stone-800 tracking-tight">Detalhes do {res.type}</h2>
                    {canShare ? (
                        <button onClick={handleShareWhatsapp} className="p-2.5 -mr-2 text-green-600 hover:bg-green-50 rounded-full transition-all active:scale-90">
                            <Share2 size={22} strokeWidth={2.5} />
                        </button>
                    ) : <div className="w-10" />}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                    {/* 2. Main Info Card - High Visual Impact */}
                    <div className="relative group">
                        <div className={`absolute -inset-1 bg-linear-to-r ${res.type === 'Play' ? 'from-court-green/30 to-saibro-500/30' : res.type === 'Campeonato' ? 'from-yellow-400/30 to-orange-500/30' : 'from-saibro-500/30 to-orange-400/30'} rounded-[32px] blur-xl opacity-50 group-hover:opacity-75 transition duration-1000 group-hover:duration-200`}></div>
                        <div className={`relative bg-white rounded-[28px] p-6 shadow-xl border border-stone-100/50 overflow-hidden`}>
                            {/* Visual Stripe */}
                            <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full ${style.bg} opacity-20 blur-3xl`} />

                            <div className="flex justify-between items-start mb-6">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-2 ${style.border} ${style.bg} ${style.text} shadow-sm`}>
                                            {style.label}
                                        </span>
                                        {res.status === 'cancelled' ? (
                                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-100 text-red-600 border-2 border-red-200 shadow-sm">Cancelada</span>
                                        ) : !isFuture ? (
                                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-stone-100 text-stone-500 border-2 border-stone-200 shadow-sm">Finalizada</span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-green-50 text-green-600 border-2 border-green-100 shadow-sm">
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Ativa
                                            </span>
                                        )}
                                    </div>
                                    <h1 className="text-4xl font-black text-stone-800 tracking-tighter pt-2 tabular-nums">
                                        {res.startTime} <span className="text-stone-300 font-light mx-1">/</span> <span className="text-2xl text-stone-400">{res.endTime}</span>
                                    </h1>
                                    <p className="text-stone-500 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 opacity-80">
                                        <Calendar size={14} className="text-saibro-500" /> {getDayName(res.date)}, {formatDateBr(res.date)}
                                    </p>
                                </div>
                                <div className="w-16 h-16 rounded-2xl bg-stone-50 border border-stone-100 flex flex-col items-center justify-center shadow-inner mt-2">
                                    <span className="text-[10px] font-black text-stone-400 uppercase leading-none mb-1">Quadra</span>
                                    <span className="text-xl font-black text-stone-800 leading-none">{court?.name.split(' ')[1] || '0'}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 bg-stone-50/80 rounded-2xl border border-stone-100 mb-6 group/court hover:bg-saibro-50 hover:border-saibro-100 transition-all duration-300">
                                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center border border-stone-200 shadow-sm text-saibro-600 group-hover/court:scale-110 group-hover/court:text-saibro-700 transition-transform">
                                    <MapPin size={24} strokeWidth={2.5} />
                                </div>
                                <div>
                                    <p className="font-black text-stone-800 text-lg tracking-tight leading-tight">{court?.name}</p>
                                    <p className="text-[10px] text-stone-400 uppercase font-black tracking-widest">{court?.type}</p>
                                </div>
                            </div>

                            {/* PRIMARY ACTION BUTTONS INSIDE CARD */}
                            {(canJoin || canLeave) && (
                                <div className="mt-4 pt-4 border-t border-stone-100/80">
                                    {canJoin && (
                                        <button
                                            onClick={() => onJoin(res.id)}
                                            className="w-full py-4.5 bg-linear-to-r from-saibro-600 to-saibro-500 text-white font-black rounded-[20px] shadow-lg shadow-saibro-200 flex items-center justify-center gap-3 transition-all active:scale-[0.97] hover:brightness-110 uppercase tracking-widest text-sm"
                                        >
                                            <UserPlus size={20} strokeWidth={3} /> Entrar no Jogo
                                        </button>
                                    )}
                                    {canLeave && (
                                        <button
                                            onClick={() => onLeave(res.id)}
                                            className="w-full py-4 bg-stone-100 text-stone-700 font-black rounded-[20px] hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center gap-3 active:scale-[0.97] uppercase tracking-widest text-sm"
                                        >
                                            <LogOut size={20} strokeWidth={3} /> Sair do Jogo
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. Live Score Section (Only during match time for championships) */}
                    {isMatchLive(res) && res.matchId && (
                        <div className="animate-in zoom-in-95 duration-500">
                            <LiveScoreSection
                                res={res}
                                profiles={profiles}
                                onFinish={async (winnerId, sA, sB) => {
                                    await onFinishMatch(res.matchId!, winnerId, sA, sB);
                                }}
                            />
                        </div>
                    )}

                    {/* 4. Participants / Students Section */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center px-1">
                            <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest flex items-center gap-2.5">
                                <Users size={18} className="text-saibro-500" />
                                {res.type === 'Aula' ? 'Alunos da Aula' : res.type === 'Campeonato' ? 'Jogadores' : 'Lista de Atletas'}
                            </h3>
                            {res.type === 'Play' && (
                                <span className={`text-[10px] font-black px-3 py-1 rounded-full ${participants.length + (res.guestName ? 1 : 0) === 8 ? 'bg-orange-100 text-orange-600' : 'bg-stone-100 text-stone-500'}`}>
                                    {participants.length + (res.guestName ? 1 : 0)} / 8 VAGAS
                                </span>
                            )}
                        </div>

                        {res.type === 'Play' ? (
                            <div className="grid grid-cols-1 gap-3">
                                {participants.map(p => (
                                    <div key={p?.id} className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-stone-200/60 shadow-sm hover:shadow-md transition-shadow group/item">
                                        <div className="flex items-center gap-4">
                                            <div className="relative">
                                                <img src={p?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p?.id}`} className="w-12 h-12 rounded-full border-2 border-stone-100 object-cover shadow-sm group-hover/item:border-saibro-200 transition-colors" alt={p?.name} />
                                                {p?.id === res.creatorId && (
                                                    <div className="absolute -top-1 -left-1 w-5 h-5 bg-saibro-500 rounded-full border-2 border-white flex items-center justify-center text-white" title="Criador">
                                                        <Trophy size={10} strokeWidth={3} />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-black text-stone-800 text-sm leading-tight group-hover/item:text-saibro-700 transition-colors uppercase tracking-tight">{p?.name}</p>
                                                <p className="text-[10px] uppercase font-black text-stone-400 tracking-wider">Atleta Sócio</p>
                                            </div>
                                        </div>
                                        {isAdmin && p?.id !== res.creatorId && (
                                            <button
                                                onClick={() => onUpdate({ ...res, participantIds: res.participantIds.filter(id => id !== p?.id) })}
                                                className="p-2.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                            >
                                                <UserMinus size={18} />
                                            </button>
                                        )}
                                    </div>
                                ))}

                                {res.guestName && (
                                    <div className="flex items-center justify-between bg-white border-2 border-saibro-100 p-3.5 rounded-2xl shadow-saibro-50/50 shadow-lg">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full bg-linear-to-br from-saibro-200 to-saibro-300 flex items-center justify-center text-saibro-700 font-extrabold text-xs shadow-inner uppercase">
                                                GUEST
                                            </div>
                                            <div>
                                                <p className="font-black text-stone-800 text-sm leading-tight uppercase tracking-tight">{res.guestName}</p>
                                                <p className="text-[10px] uppercase font-black text-saibro-600 tracking-wider">
                                                    Convidado: {profiles.find(u => u.id === res.guestResponsibleId)?.name.split(' ')[0]}
                                                </p>
                                            </div>
                                        </div>
                                        {canManageParticipants && (
                                            <button
                                                onClick={() => setShowGuestModal(true)}
                                                className="p-2.5 text-saibro-300 hover:text-saibro-600 hover:bg-saibro-50 rounded-xl transition-all"
                                            >
                                                <Pencil size={18} />
                                            </button>
                                        )}
                                    </div>
                                )}

                                {canManageParticipants && participants.length + (res.guestName ? 1 : 0) < 8 && !res.guestName && (
                                    <button
                                        onClick={() => setShowGuestModal(true)}
                                        className="w-full h-16 flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 hover:border-saibro-400 hover:text-saibro-600 hover:bg-saibro-50/50 transition-all text-xs font-black uppercase tracking-widest"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 group-hover:bg-saibro-100 transition-colors">
                                            <UserPlus size={18} strokeWidth={2.5} />
                                        </div>
                                        Convidado (Day Use)
                                    </button>
                                )}
                            </div>
                        ) : res.type === 'Campeonato' ? (
                            (() => {
                                const hasScore = res.scoreA && res.scoreA.length > 0 && (res.scoreA[0] > 0 || (res.scoreB && res.scoreB.length > 0 && res.scoreB[0] > 0));

                                if (hasScore) {
                                    // Calculate winners
                                    const set1Winner = getSetWinner(res.scoreA![0], res.scoreB![0]);
                                    const set2Winner = res.scoreA![1] !== undefined && res.scoreB![1] !== undefined ? getSetWinner(res.scoreA![1], res.scoreB![1]) : null;

                                    const setsWonA = (set1Winner === 'A' ? 1 : 0) + (set2Winner === 'A' ? 1 : 0);
                                    const setsWonB = (set1Winner === 'B' ? 1 : 0) + (set2Winner === 'B' ? 1 : 0);
                                    const showThirdSet = setsWonA === 1 && setsWonB === 1;

                                    const set3Winner = showThirdSet && res.scoreA![2] !== undefined && res.scoreB![2] !== undefined ? getSetWinner(res.scoreA![2], res.scoreB![2], true) : null;

                                    const displayScoresA = showThirdSet ? res.scoreA : res.scoreA!.slice(0, 2);
                                    const displayScoresB = showThirdSet ? res.scoreB : res.scoreB!.slice(0, 2);

                                    const isWinnerA = setsWonA >= 2 || (showThirdSet && set3Winner === 'A');
                                    const isWinnerB = setsWonB >= 2 || (showThirdSet && set3Winner === 'B');

                                    return (
                                        <div className="bg-white rounded-2xl p-6 border border-yellow-200 shadow-sm flex flex-col gap-6">
                                            {/* Player A Row */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        <img src={participants[0]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[0]?.id || 'p1'}`} className={`w-14 h-14 rounded-full border-4 object-cover ${isWinnerA ? 'border-saibro-500 shadow-md ring-2 ring-saibro-100' : 'border-stone-100'}`} alt="" />
                                                        {isWinnerA && <div className="absolute -top-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow-lg"><Trophy size={10} fill="currentColor" /></div>}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className={`font-black text-lg ${isWinnerA ? 'text-stone-900' : 'text-stone-600'}`}>{participants[0]?.name || 'Jogador 1'}</span>
                                                        {isWinnerA && <span className="text-[10px] font-black uppercase text-saibro-600 tracking-wider">Vencedor</span>}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    {displayScoresA?.map((s, i) => (
                                                        <span key={i} className={`w-10 h-10 flex items-center justify-center rounded-xl text-lg font-black shadow-sm transition-all ${
                                                            (i === 0 && set1Winner === 'A') || (i === 1 && set2Winner === 'A') || (i === 2 && set3Winner === 'A')
                                                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200'
                                                                : 'bg-stone-100 text-stone-400'
                                                        }`}>
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Player B Row */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        <img src={participants[1]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[1]?.id || 'p2'}`} className={`w-14 h-14 rounded-full border-4 object-cover ${isWinnerB ? 'border-saibro-500 shadow-md ring-2 ring-saibro-100' : 'border-stone-100'}`} alt="" />
                                                        {isWinnerB && <div className="absolute -top-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow-lg"><Trophy size={10} fill="currentColor" /></div>}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className={`font-black text-lg ${isWinnerB ? 'text-stone-900' : 'text-stone-600'}`}>{participants[1]?.name || 'Jogador 2'}</span>
                                                        {isWinnerB && <span className="text-[10px] font-black uppercase text-saibro-600 tracking-wider">Vencedor</span>}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    {displayScoresB?.map((s, i) => (
                                                        <span key={i} className={`w-10 h-10 flex items-center justify-center rounded-xl text-lg font-black shadow-sm transition-all ${
                                                            (i === 0 && set1Winner === 'B') || (i === 1 && set2Winner === 'B') || (i === 2 && set3Winner === 'B')
                                                                ? 'bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200'
                                                                : 'bg-stone-100 text-stone-400'
                                                        }`}>
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="w-full h-px bg-stone-100 mt-2"></div>
                                            <div className="text-center">
                                                <p className="text-[10px] font-black text-yellow-600 uppercase tracking-widest">Campeonato</p>
                                                <p className="font-black text-stone-800 text-lg uppercase tracking-tight">{res.observation?.split('|')[0]}</p>
                                                <p className="text-xs text-stone-500 font-bold mt-1">{res.observation?.split('|')[1]}</p>
                                            </div>
                                        </div>
                                    );
                                }



                                return (
                                    <div className="bg-white rounded-2xl p-6 border border-yellow-200 shadow-sm flex flex-col items-center gap-6">
                                        <div className="flex items-center justify-center w-full gap-8">
                                            <div className="flex flex-col items-center gap-2">
                                                <img src={participants[0]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[0]?.id || 'p1'}`} className="w-20 h-20 rounded-full border-4 border-stone-100 shadow-lg object-cover" alt="" />
                                                <span className="font-black text-stone-800 text-sm">{participants[0]?.name || 'Jogador 1'}</span>
                                            </div>
                                            <div className="text-3xl font-black text-stone-300 italic">VS</div>
                                            <div className="flex flex-col items-center gap-2">
                                                <img src={participants[1]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[1]?.id || 'p2'}`} className="w-20 h-20 rounded-full border-4 border-stone-100 shadow-lg object-cover" alt="" />
                                                <span className="font-black text-stone-800 text-sm">{participants[1]?.name || 'Jogador 2'}</span>
                                            </div>
                                        </div>
                                        <div className="w-full h-px bg-stone-100"></div>
                                        <div className="text-center">
                                            <p className="text-[10px] font-black text-yellow-600 uppercase tracking-widest">Campeonato</p>
                                            <p className="font-black text-stone-800 text-lg uppercase tracking-tight">{res.observation?.split('|')[0]}</p>
                                            <p className="text-xs text-stone-500 font-bold mt-1">{res.observation?.split('|')[1]}</p>
                                        </div>
                                    </div>
                                );
                            })()
                        ) : (
                            /* AULA INFO Stylization */
                            <div className="space-y-3">
                                <div className="bg-white rounded-2xl p-4 border border-stone-200/60 shadow-sm flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-2xl bg-saibro-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-saibro-100">
                                        {professor?.name[0]}
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-0.5">Professor Titular</p>
                                        <p className="font-black text-stone-800 text-lg uppercase leading-tight tracking-tight">{professor?.name}</p>
                                    </div>
                                </div>

                                {(participants.length > 0 || nonSocioStudentsList.length > 0) ? (
                                    <div className="space-y-3">
                                        {participants.length > 0 && (
                                            <div className="space-y-2">
                                                {participants.map(p => (
                                                    <div key={p?.id} className="bg-white rounded-2xl p-4 border border-stone-200/60 shadow-sm flex items-center gap-4">
                                                        <img src={p?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p?.id}`} className="w-14 h-14 rounded-full border-4 border-saibro-50 p-0.5 object-cover" alt="" />
                                                        <div>
                                                            <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-0.5">Aluno Sócio</p>
                                                            <p className="font-black text-stone-800 text-lg uppercase leading-tight tracking-tight">{p?.name}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {nonSocioStudentsList.length > 0 && (
                                            <div className="space-y-2">
                                                {nonSocioStudentsList.map(s => {
                                                    const isDependent = s.studentType === 'dependent';
                                                    const isExpired = !isDependent && new Date(s.masterExpirationDate || '') < getNowInFortaleza();
                                                    return (
                                                        <div key={s.id} className="bg-white rounded-2xl p-4 border border-stone-200/60 shadow-sm flex items-center gap-4">
                                                            <div className={`w-14 h-14 rounded-2xl ${isDependent ? 'bg-blue-500' : 'bg-blue-600'} flex items-center justify-center text-white shadow-lg shadow-blue-50`}>
                                                                <Wallet size={28} />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-0.5">
                                                                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                                                                        {isDependent ? 'Dependente' : s.planType}
                                                                    </span>
                                                                    {!isDependent && (
                                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-black border ${isExpired ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                                                                            {isExpired ? 'VENCIDO' : 'ATIVO'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="font-black text-stone-800 text-lg uppercase leading-tight tracking-tight">{s.name}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-stone-400 italic text-center text-sm py-4">Nenhum aluno vinculado.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 4. Observations */}
                    {res.observation && (
                        <div className="bg-saibro-50/50 rounded-2xl p-5 border border-saibro-100/50">
                            <h3 className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <Info size={14} strokeWidth={2.5} /> Informações Adicionais
                            </h3>
                            <p className="text-stone-700 text-sm font-medium leading-relaxed italic caret-saibro-500">
                                "{res.observation}"
                            </p>
                        </div>
                    )}

                    {/* 5. Meta Info */}
                    <div className="text-center pt-2 pb-8 border-t border-stone-100">
                        <p className="text-[10px] text-stone-400 font-bold uppercase tracking-tighter">
                            Protocolo: {res.id.slice(0, 8).toUpperCase()}
                        </p>
                        <p className="text-[10px] text-stone-300 mt-0.5 font-medium">
                            Criado por {creator?.name} • SCT Play Cloud
                        </p>
                    </div>
                </div>

                {/* 6. Secondary Actions Bar (Compact Bottom) */}
                {(canManageParticipants || canEdit || canCancel) && (
                    <div className="bg-white border-t border-stone-100 p-5 pb-safe-offset-4 flex gap-3 shadow-[0_-10px_20px_-15px_rgba(0,0,0,0.1)]">
                        {canManageParticipants && (
                            <button
                                onClick={() => setShowManageParticipants(true)}
                                className="flex-1 h-14 bg-stone-50 text-stone-800 font-black rounded-2xl hover:bg-stone-100 flex items-center justify-center gap-2.5 transition-all active:scale-95 border border-stone-200/50 text-xs uppercase tracking-widest"
                            >
                                <UserCog size={20} /> <span className="hidden xs:inline">Atletas</span>
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={() => onEdit(res)}
                                className="flex-1 h-14 bg-stone-50 text-stone-800 font-black rounded-2xl hover:bg-saibro-50 hover:text-saibro-700 hover:border-saibro-100 flex items-center justify-center gap-2.5 transition-all active:scale-95 border border-stone-200/50 text-xs uppercase tracking-widest"
                            >
                                <Pencil size={20} /> <span className="hidden xs:inline">Editar</span>
                            </button>
                        )}
                        {canCancel && (
                            <button
                                onClick={() => onCancel(res.id)}
                                className="flex-1 h-14 bg-stone-50 text-red-500 font-black rounded-2xl hover:bg-red-50 hover:border-red-100 flex items-center justify-center gap-2.5 transition-all active:scale-95 border border-stone-200/50 text-xs uppercase tracking-widest"
                            >
                                <Trash2 size={20} /> <span className="hidden xs:inline">Cancelar</span>
                            </button>
                        )}
                </div>
            )}
        </div>

        {showManageParticipants && (
                <ManageParticipantsModal
                    currentParticipants={res.participantIds}
                    profiles={profiles}
                    onClose={() => setShowManageParticipants(false)}
                    onUpdate={(newIds) => {
                        onUpdate({ ...res, participantIds: newIds });
                        setShowManageParticipants(false);
                    }}
                />
            )}

            {showGuestModal && (
                <ManageGuestModal
                    res={res}
                    profiles={profiles}
                    currentUser={currentUser}
                    onClose={() => setShowGuestModal(false)}
                    onUpdate={(updatedRes) => {
                        onUpdate(updatedRes);
                        setShowGuestModal(false);
                    }}
                />
            )}
            </>
        </StandardModal>
    );
};


// --- COMPONENT: Reservation Card ---
// --- COMPONENT: Reservation Card ---
const ReservationCard: React.FC<{
    res: Reservation;
    currentUser: User;
    profiles: User[];
    courts: Court[];
    professors: Professor[];
    nonSocioStudents: NonSocioStudent[];
    onSelect: (res: Reservation) => void;
    challenges: Challenge[];
    onLaunchScore: (challenge: Challenge) => void;
}> = ({ res, currentUser, profiles, courts, professors, nonSocioStudents, onSelect, challenges, onLaunchScore }) => {
    const court = courts.find(c => c.id === res.courtId);
    const style = TYPE_STYLES[res.type] || TYPE_STYLES['Play'];

    // Participants logic
    const socioParticipantIds = res.type === 'Aula' ? getClassSocioIds(res) : res.participantIds;
    const participants = socioParticipantIds.map(id => profiles.find(u => u.id === id)).filter(Boolean);
    const professor = professors.find(p => p.id === res.professorId);

    // Non-Socio Logic (Multi)
    const nonSocioIds = res.type === 'Aula' ? getClassNonSocioIds(res) : [];
    const nonSocioStudentsList: NonSocioStudent[] = nonSocioIds
        .map(id => nonSocioStudents.find(s => s.id === id))
        .filter(Boolean) as NonSocioStudent[];

    return (
        <div
            onClick={() => onSelect(res)}
            className={`relative rounded-2xl border-l-[6px] bg-linear-to-br from-white to-stone-50/50 p-5 shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer ${style.border} group border-t border-r border-b border-stone-100/50`}
        >
            {/* ANIMAÇÃO DE QUADRA (apenas para Campeonatos) */}
            {res.type === 'Campeonato' && <TennisCourtAnimation />}

            {/* Header */}
            <div className="relative z-10 flex justify-between items-start mb-3">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${style.text} bg-white border-current shadow-sm`}>
                            {style.label}
                        </span>
                        {res.status === 'cancelled' && <span className="text-[10px] font-bold text-red-500 uppercase bg-red-100 px-1.5 py-0.5 rounded-md">Cancelada</span>}
                    </div>
                    <h4 className="font-bold text-stone-800 text-base leading-tight">
                        {court?.name} <span className="text-stone-400 font-normal text-xs block sm:inline">({court?.type})</span>
                    </h4>
                </div>
                <div className="text-right">
                    <div className="flex items-center gap-3 bg-stone-50/80 rounded-xl p-1.5 pl-3 border border-stone-100 shadow-sm backdrop-blur-sm">
                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider mb-0.5">Início</span>
                            <span className="text-sm font-black text-stone-800 tabular-nums leading-none tracking-tight">{res.startTime.slice(0, 5)}</span>
                        </div>

                        <div className="relative h-6 w-px bg-stone-200">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border border-stone-200 flex items-center justify-center shadow-sm z-10">
                                <ArrowRight size={10} className="text-stone-400" />
                            </div>
                        </div>

                        <div className="flex flex-col items-center">
                            <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider mb-0.5">Fim</span>
                            <span className="text-sm font-bold text-stone-500 tabular-nums leading-none tracking-tight">{res.endTime.slice(0, 5)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="relative z-10 space-y-2 min-h-[40px]">
                {res.type === 'Aula' ? (
                    <div className="text-sm text-stone-600 space-y-1">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                                <UserCog size={14} />
                            </div>
                            <span className="font-medium">{professor?.name}</span>
                        </div>

                        <div className="flex items-start gap-2 pt-1">
                            <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 mt-0.5">
                                <Users size={14} />
                            </div>
                            <div className="flex-1">
                                <div className="space-y-2">
                                    {participants.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {participants.map(p => (
                                                <span key={p?.id} className="text-stone-700 font-bold bg-stone-100 border border-stone-200 px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 shadow-sm">
                                                    {p?.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {nonSocioStudentsList.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {nonSocioStudentsList.map(s => {
                                                const isDependent = s.studentType === 'dependent';
                                                return (
                                                    <span key={s.id} className="text-blue-700 font-bold bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 shadow-sm">
                                                        {s.name}{isDependent ? ' (Dep.)' : ''}
                                                        {!isDependent && s.planType === 'Card Mensal' && (
                                                            <span className="text-[9px] bg-purple-100 text-purple-700 w-4 h-4 flex items-center justify-center rounded-full ml-1">M</span>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {participants.length === 0 && nonSocioStudentsList.length === 0 && (
                                        <span className="text-stone-400 text-xs italic">Nenhum aluno</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : res.type === 'Campeonato' ? (
                    <div className="flex items-center justify-center">
                        <div className="flex items-center gap-3 max-w-[65%] mx-auto">
                            <div className="flex items-center justify-between bg-yellow-50/70 rounded-xl p-2 border border-yellow-100 shadow-sm backdrop-blur-sm gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-white border border-stone-100 shadow-sm overflow-hidden shrink-0">
                                        <img src={participants[0]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[0]?.id}`} className="w-full h-full object-cover" alt="" />
                                    </div>
                                    <span className="text-xs font-bold text-stone-700 max-w-[70px] truncate">{participants[0]?.name.split(' ')[0]}</span>
                                </div>
                                <span className="text-[10px] font-black text-yellow-600 italic px-1">VS</span>
                                <div className="flex items-center gap-2 flex-row-reverse">
                                    <div className="w-7 h-7 rounded-full bg-white border border-stone-100 shadow-sm overflow-hidden shrink-0">
                                        <img src={participants[1]?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${participants[1]?.id}`} className="w-full h-full object-cover" alt="" />
                                    </div>
                                    <span className="text-xs font-bold text-stone-700 max-w-[70px] truncate">{participants[1]?.name.split(' ')[0]}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center -space-x-3 pl-1">
                                {participants.map((p, i) => (
                                    <div
                                        key={p?.id || i}
                                        title={p?.name}
                                        className="w-8 h-8 rounded-full bg-linear-to-br from-stone-100 to-stone-200 border-2 border-white flex items-center justify-center text-stone-600 text-[10px] font-black shadow-sm relative z-0 hover:z-10 transition-all hover:scale-110 hover:shadow-md cursor-help"
                                    >
                                        {p?.avatar ? <img src={p.avatar} className="w-full h-full rounded-full object-cover" alt={p.name} /> : p?.name.charAt(0)}
                                    </div>
                                ))}
                                {res.guestName && (
                                    <div title={res.guestName} className="w-8 h-8 rounded-full bg-linear-to-br from-yellow-100 to-amber-200 border-2 border-white flex items-center justify-center text-yellow-700 text-[10px] font-bold shadow-sm relative z-0 hover:z-10 transition-all hover:scale-110 cursor-help">
                                        <Users size={12} />
                                    </div>
                                )}
                            </div>

                            {(participants.length > 0 || res.guestName) && (
                                <span className="text-sm font-bold text-stone-700 tracking-tight truncate max-w-[120px] sm:max-w-[180px]">
                                    {participants.map(p => p?.name.split(' ')[0]).concat(res.guestName ? [res.guestName.split(' ')[0]] : []).join(', ')}
                                </span>
                            )}
                        </div>

                        {participants.length === 0 && !res.guestName && (
                            <span className="text-stone-400 text-xs italic pl-1">Sem participantes</span>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Hint or Action */}
            <div className="relative z-10 mt-4 pt-3 border-t border-stone-100 flex justify-between items-center">
                <div className="flex gap-2 items-center">
                    {/* Time-based Status Tag */}
                    {(() => {
                        const now = getNowInFortaleza();
                        const start = new Date(`${res.date}T${res.startTime}`);
                        const end = new Date(`${res.date}T${res.endTime}`);
                        const todayStr = formatDate(now);
                        const isToday = res.date === todayStr;

                        let statusText = '';
                        let statusColor = 'text-stone-400';
                        let dotColor = 'bg-stone-300';
                        let pulse = false;

                        if (now > end) {
                            statusText = 'Finalizada';
                            statusColor = 'text-stone-400';
                            dotColor = 'bg-stone-300';
                        } else if (now >= start && now <= end) {
                            statusText = 'Em andamento';
                            statusColor = 'text-green-600';
                            dotColor = 'bg-green-500';
                            pulse = true;
                        } else {
                            // Future
                            const diffMinutes = (start.getTime() - now.getTime()) / 60000;
                            const diffHours = diffMinutes / 60;

                            const tomorrow = addDays(now, 1);
                            const isTomorrow = res.date === formatDate(tomorrow);

                            if (isToday) {
                                if (diffMinutes < 30) {
                                    statusText = 'Inicia em instantes';
                                    statusColor = 'text-green-600';
                                    dotColor = 'bg-green-500';
                                    pulse = true;
                                } else {
                                    statusText = 'Inicia hoje';
                                    statusColor = 'text-saibro-600';
                                    dotColor = 'bg-saibro-500';
                                }
                            } else if (isTomorrow) {
                                statusText = 'Começa amanhã';
                                statusColor = 'text-blue-600';
                                dotColor = 'bg-blue-500';
                            } else {
                                const dayName = getDayName(res.date);
                                statusText = `Em breve (${dayName})`;
                                statusColor = 'text-stone-500';
                                dotColor = 'bg-stone-400';
                            }
                        }

                        if (!statusText) return null;

                        return (
                            <div className={`flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider ${statusColor} bg-white/50 px-2.5 py-1 rounded-full border border-stone-100 shadow-sm mr-2`}>
                                <div className={`w-2 h-2 rounded-full ${dotColor} ${pulse ? 'animate-pulse shadow-[0_0_8px_currentColor]' : ''}`} />
                                {statusText}
                            </div>
                        );
                    })()}

                    {res.type === 'Desafio' && res.status !== 'finished' && res.status !== 'cancelled' && (
                        (() => {
                            const challenge = challenges.find(c => c.reservationId === res.id);
                            if (!challenge) return null;

                            const now = getNowInFortaleza();
                            const startDate = new Date(`${res.date}T${res.startTime}`);
                            const canLaunch = now >= startDate;

                            if (canLaunch && challenge.status !== 'finished') {
                                return (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onLaunchScore(challenge);
                                        }}
                                        className="px-3 py-1.5 bg-saibro-500 text-white text-xs font-bold rounded-lg shadow-md shadow-orange-200 hover:bg-saibro-600 flex items-center gap-1.5 transition-all active:scale-95"
                                    >
                                        <Trophy size={14} /> Lançar Placar
                                    </button>
                                );
                            }
                            return null;
                        })()
                    )}
                </div>

                <div className="flex items-center gap-1 text-[10px] font-bold text-stone-500 uppercase tracking-widest group-hover:text-saibro-600 transition-colors ml-auto">
                    VER DETALHES <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300" />
                </div>
            </div>
        </div>
    );
};

// --- COMPONENT: Agenda ---
export const Agenda: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const [currentDate, setCurrentDate] = useState(getNowInFortaleza());
    const [view, setView] = useState<'day' | 'week' | 'month'>('day');
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [nonSocioStudents, setNonSocioStudents] = useState<NonSocioStudent[]>([]);

    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCancelled, setShowCancelled] = useState(false);

    // --- CHAMPIONSHIP DATA ---
    // We will merge matches into reservations, but we can also store them if needed separately
    // For now, we fetch and map them directly into the reservations array logic.

    // Modal States
    const [showAddModal, setShowAddModal] = useState(false);
    const [reservationToEdit, setReservationToEdit] = useState<Reservation | undefined>(undefined);
    const [selectedReservation, setSelectedReservation] = useState<Reservation | undefined>(undefined);
    const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

    // Stable fetchData function
    const fetchData = React.useCallback(async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            // Fetch profiles
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('*')
                .eq('is_active', true);

            if (profilesError) throw profilesError;

            if (profilesData) {
                const mappedProfiles: User[] = profilesData.map(p => ({
                    id: p.id,
                    name: p.name || 'Sem Nome',
                    email: p.email || '',
                    phone: p.phone || '',
                    role: p.role || 'socio',
                    category: p.category,
                    avatar: p.avatar_url,
                    balance: 0,
                    isActive: p.is_active !== false
                }));
                setProfiles(mappedProfiles);
            }

            // Fetch reservations from Supabase
            const { data: reservationsData, error: reservationsError } = await supabase
                .from('reservations')
                .select('*')
                .order('date', { ascending: true })
                .order('start_time', { ascending: true });

            let mappedReservations: Reservation[] = [];
            if (reservationsError) {
                console.log('Reservations table may not exist yet, using empty array');
            } else if (reservationsData) {
                mappedReservations = reservationsData.map(r => ({
                    id: r.id,
                    type: r.type,
                    date: r.date,
                    startTime: r.start_time,
                    endTime: r.end_time,
                    courtId: r.court_id,
                    creatorId: r.creator_id,
                    participantIds: r.participant_ids || [],
                    guestName: r.guest_name,
                    guestResponsibleId: r.guest_responsible_id,
                    professorId: r.professor_id,
                    studentType: r.student_type,
                    nonSocioStudentId: r.non_socio_student_id,
                    nonSocioStudentIds: r.non_socio_student_ids || [],
                    observation: r.observation,
                    status: r.status || 'active'
                }));
            }

            // Store all in a temporary array
            let allCombined = [...mappedReservations];

            // Fetch Championship Matches
            const { data: matchesData } = await supabase
                .from('matches')
                .select(`
                    *,
                    championships(name),
                    championship_rounds(name)
                `)
                .not('scheduled_date', 'is', null)
                .not('scheduled_time', 'is', null);

            if (matchesData) {
                const mappedMatches: Reservation[] = matchesData.map(m => {
                    const [hours, minutes] = (m.scheduled_time || '00:00').split(':').map(Number);
                    const endDate = getNowInFortaleza();
                    endDate.setHours(hours, minutes + 90, 0);
                    const endTime = endDate.toTimeString().slice(0, 5);

                    return {
                        id: `match_${m.id}`,
                        matchId: m.id,
                        type: 'Campeonato',
                        date: m.scheduled_date!,
                        startTime: (m.scheduled_time || '').slice(0, 5),
                        endTime: endTime,
                        courtId: m.court_id!,
                        creatorId: 'system',
                        participantIds: [m.player_a_id, m.player_b_id].filter(Boolean) as string[],
                        scoreA: m.score_a || [0],
                        scoreB: m.score_b || [0],
                        guestName: null,
                        guestResponsibleId: null,
                        professorId: null,
                        studentType: null,
                        nonSocioStudentId: null,
                        nonSocioStudentIds: [],
                        observation: `${(m.championships as any)?.name || 'Campeonato'} | ${(m.championship_rounds as any)?.name || 'Rodada'}`,
                        status: 'active'
                    };
                });
                allCombined = [...allCombined, ...mappedMatches];
            }

            // Deduplicate by slot (date, time, court)
            const uniqueReservations = Array.from(
                allCombined.reduce((map, item) => {
                    const key = `${item.date}_${item.startTime}_${item.courtId}`;
                    const existing = map.get(key);

                    // Keep 'match_' items over standard ones if same slot
                    if (!existing || item.id.startsWith('match_')) {
                        map.set(key, item);
                    }
                    return map;
                }, new Map<string, Reservation>()).values()
            );

            setReservations(uniqueReservations);

            // Fetch courts
            const { data: courtsData } = await supabase
                .from('courts')
                .select('id, name, type, is_active');

            setCourts((courtsData || []).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                isActive: c.is_active
            })));

            // Fetch professors
            const { data: professorsData } = await supabase
                .from('professors')
                .select('id, user_id, bio, is_active, profiles(name)');

            setProfessors((professorsData || []).map(p => ({
                id: p.id,
                userId: p.user_id,
                name: (p.profiles as any)?.name || 'Professor',
                isActive: p.is_active,
                bio: p.bio
            })));

            // Fetch non-socio students
            const { data: studentsData } = await supabase
                .from('non_socio_students')
                .select('*');

            setNonSocioStudents((studentsData || []).map(s => ({
                id: s.id,
                name: s.name,
                phone: s.phone,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id,
                studentType: s.student_type || 'regular',
                responsibleSocioId: s.responsible_socio_id,
                relationshipType: s.relationship_type
            })));

            // Fetch Challenges
            const { data: challengesData } = await supabase.from('challenges').select('*');
            setChallenges((challengesData || []).map(c => ({
                id: c.id,
                status: c.status,
                monthRef: c.month_ref,
                createdAt: c.created_at,
                challengerId: c.challenger_id,
                challengedId: c.challenged_id,
                reservationId: c.reservation_id,
                matchId: c.match_id
            })));
        } catch (err) {
            console.error('Error fetching data:', err);
            setReservations([]);
        } finally {
            if (showLoading) setLoading(false);
        }
    }, []);

    // Initial Fetch
    useEffect(() => {
        fetchData(true);
    }, [fetchData]);

    // Supabase Real-time Subscription
    useEffect(() => {
        const channel = supabase
            .channel('agenda-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
                fetchData(false);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
                fetchData(false);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' }, () => {
                fetchData(false);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchData]);

    // Helper to get user by ID from fetched profiles
    const getUserById = (id: string): User | undefined => {
        return profiles.find(p => p.id === id);
    };


    // --- Actions ---
    const handleJoin = async (id: string) => {
        try {
            const res = reservations.find(r => r.id === id);
            if (!res) return;

            if (res.participantIds.length >= 8) {
                alert('Limite de 8 participantes atingido.');
                return;
            }

            const newParticipants = [...res.participantIds, currentUser.id];

            // 1. Update in Supabase
            const { error } = await supabase
                .from('reservations')
                .update({ participant_ids: newParticipants })
                .eq('id', id);

            if (error) throw error;

            // 2. Update local state
            setReservations(prev => {
                const newRes = prev.map(r => r.id === id ? { ...r, participantIds: newParticipants } : r);
                if (selectedReservation?.id === id) setSelectedReservation(newRes.find(r => r.id === id));
                return newRes;
            });
        } catch (error) {
            console.error('Error joining reservation:', error);
            alert('Erro ao entrar na reserva. Tente novamente.');
        }
    };

    const handleLeave = async (id: string) => {
        try {
            const res = reservations.find(r => r.id === id);
            if (!res) return;

            const newParticipants = res.participantIds.filter(pid => pid !== currentUser.id);

            // If it was the last Sócio and no guest, the reservation should be cancelled
            if (newParticipants.length === 0 && !res.guestName) {
                if (confirm('Você é o último atleta da partida. Ao sair, o agendamento será cancelado. Confirmar?')) {
                    // 1. Update status to cancelled in Supabase
                    const { error } = await supabase
                        .from('reservations')
                        .update({ status: 'cancelled' })
                        .eq('id', id);

                    if (error) throw error;

                    // 2. Update local state
                    setReservations(prev => {
                        const newResList = prev.map(r => r.id === id ? { ...r, status: 'cancelled' as const } : r);
                        if (selectedReservation?.id === id) setSelectedReservation(newResList.find(r => r.id === id));
                        return newResList;
                    });
                    return;
                } else {
                    return; // User cancelled the confirmation
                }
            }

            // Normal flow: just remove the participant
            const { error } = await supabase
                .from('reservations')
                .update({ participant_ids: newParticipants })
                .eq('id', id);

            if (error) throw error;

            setReservations(prev => {
                const newRes = prev.map(r => r.id === id ? { ...r, participantIds: newParticipants } : r);
                if (selectedReservation?.id === id) setSelectedReservation(newRes.find(r => r.id === id));
                return newRes;
            });
        } catch (error) {
            console.error('Error leaving reservation:', error);
            alert('Erro ao sair da reserva.');
        }
    };

    const handleCancel = async (id: string) => {
        if (confirm('Tem certeza que deseja cancelar esta reserva?')) {
            try {
                // Update in Supabase
                const { error } = await supabase
                    .from('reservations')
                    .update({ status: 'cancelled' })
                    .eq('id', id);

                if (error) throw error;

                // Update local state
                setReservations(prev => {
                    const newRes = prev.map(r => r.id === id ? { ...r, status: 'cancelled' as const } : r);
                    if (selectedReservation?.id === id) setSelectedReservation(newRes.find(r => r.id === id));
                    return newRes;
                });
            } catch (err) {
                console.error('Error cancelling reservation:', err);
                alert('Erro ao cancelar reserva');
            }
        }
    };

    const handleFinishChampionshipMatch = async (matchId: string, winnerId: string, scoreA: number[], scoreB: number[]) => {
        try {
            const { error: matchError } = await supabase
                .from('matches')
                .update({
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: winnerId,
                    status: 'finished'
                })
                .eq('id', matchId);

            if (matchError) throw matchError;

            const internalId = `match_${matchId}`;
            setReservations(prev => prev.filter(r => r.id !== internalId));
            setSelectedReservation(null);

            alert('Resultado confirmado com sucesso!');
        } catch (err) {
            console.error('Error saving match result:', err);
            alert('Erro ao salvar resultado. Tente novamente.');
        }
    };

    const handleSaveReservation = async (res: Reservation) => {
        try {
            const exists = reservations.some(r => r.id === res.id);

            const normalizedNonSocioIds = Array.from(new Set(
                res.nonSocioStudentIds && res.nonSocioStudentIds.length > 0
                    ? res.nonSocioStudentIds
                    : (res.nonSocioStudentId ? [res.nonSocioStudentId] : [])
            ));

            // --- CONVERSÃO AUTOMÁTICA: Day Card Experimental → Day Card ---
            // Se o aluno Day Card Experimental está sendo adicionado a uma 2ª aula, converter para Day Card normal
            for (const studentId of normalizedNonSocioIds) {
                const student = nonSocioStudents.find(s => s.id === studentId);
                if (student && student.planType === 'Day Card Experimental' && student.planStatus === 'active') {
                    // Contar quantos agendamentos o aluno já teve
                    const { data: existingReservations, error: countError } = await supabase
                        .from('reservations')
                        .select('id')
                        .contains('non_socio_student_ids', [studentId])
                        .eq('status', 'active');

                    if (countError) {
                        console.error('Erro ao contar agendamentos:', countError);
                        continue;
                    }

                    // Se já tem 1+ agendamento (primeira aula) e está sendo adicionado a outro, converter
                    if (existingReservations && existingReservations.length >= 1) {
                        console.log(`Converting ${student.name} from Day Card Experimental to Day Card (2nd class)`);
                        
                        const { error: updateError } = await supabase
                            .from('non_socio_students')
                            .update({ plan_type: 'Day Card' })
                            .eq('id', studentId);

                        if (updateError) {
                            console.error('Erro ao converter aluno:', updateError);
                        } else {
                            // Atualizar estado local
                            setNonSocioStudents(prev => prev.map(s => 
                                s.id === studentId 
                                    ? { ...s, planType: 'Day Card' as any }
                                    : s
                            ));
                        }
                    }
                }
            }

            const socioCount = res.participantIds?.length || 0;
            const derivedStudentType = res.type === 'Aula'
                ? (socioCount > 0 && normalizedNonSocioIds.length === 0
                    ? 'socio'
                    : (socioCount === 0 && normalizedNonSocioIds.length > 0 ? 'non-socio' : null))
                : null;
            const derivedNonSocioStudentId = res.type === 'Aula' && normalizedNonSocioIds.length === 1
                ? normalizedNonSocioIds[0]
                : null;

            const normalizedReservation: Reservation = {
                ...res,
                studentType: derivedStudentType || undefined,
                nonSocioStudentId: derivedNonSocioStudentId || undefined,
                nonSocioStudentIds: normalizedNonSocioIds
            };

            // Prepare data for Supabase (snake_case)
            const supabaseData = {
                type: normalizedReservation.type,
                date: normalizedReservation.date,
                start_time: normalizedReservation.startTime,
                end_time: normalizedReservation.endTime,
                court_id: normalizedReservation.courtId,
                creator_id: normalizedReservation.creatorId,
                participant_ids: normalizedReservation.participantIds,
                guest_name: normalizedReservation.guestName || null,
                guest_responsible_id: normalizedReservation.guestResponsibleId || null,
                professor_id: normalizedReservation.professorId || null,
                student_type: normalizedReservation.studentType || null,
                non_socio_student_id: normalizedReservation.nonSocioStudentId || null,
                non_socio_student_ids: normalizedReservation.nonSocioStudentIds || [],
                observation: normalizedReservation.observation || null,
                status: normalizedReservation.status
            };

            let savedReservation = normalizedReservation;
            if (exists) {
                // Update existing
                const { error } = await supabase
                    .from('reservations')
                    .update(supabaseData)
                    .eq('id', normalizedReservation.id);

                if (error) throw error;
            } else {
                // Create new
                const { data, error } = await supabase
                    .from('reservations')
                    .insert(supabaseData)
                    .select()
                    .single();

                if (error) throw error;

                // Update res with the new ID from database
                savedReservation = { ...normalizedReservation, id: data.id };
            }

            // Update local state
            setReservations(prev => {
                let newResList: Reservation[];
                const existsLocal = prev.some(r => r.id === savedReservation.id);

                if (existsLocal) {
                    newResList = prev.map(r => r.id === savedReservation.id ? savedReservation : r);
                } else {
                    newResList = [...prev, savedReservation];
                }

                newResList.sort((a, b) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date);
                    return a.startTime.localeCompare(b.startTime);
                });

                if (selectedReservation?.id === savedReservation.id) setSelectedReservation(savedReservation);

                return newResList;
            });

            setShowAddModal(false);
            setReservationToEdit(undefined);
        } catch (err) {
            console.error('Error saving reservation:', err);
            alert('Erro ao salvar reserva. Verifique se a tabela reservations existe no banco.');
        }
    };

    const handleOpenAdd = () => {
        setReservationToEdit(undefined);
        setShowAddModal(true);
    };

    const handleOpenEdit = (res: Reservation) => {
        setReservationToEdit(res);
        setShowAddModal(true);
        // Note: We don't close the details modal yet, effectively layering the edit modal on top or replacing it. 
        // Better UX: Close details or let Edit modal z-index cover it.
    };

    const handleSelectReservation = (res: Reservation) => {
        setSelectedReservation(res);
    };

    const handleLaunchScore = (challenge: Challenge) => {
        setSelectedChallenge(challenge);
    };

    const handleSaveScore = async (scores: { a: number, b: number }[]) => {
        if (!selectedChallenge) return;

        try {
            // 1. Calculate Winner
            let setsA = 0;
            let setsB = 0;
            const scoreA: number[] = [];
            const scoreB: number[] = [];

            scores.forEach(s => {
                scoreA.push(s.a);
                scoreB.push(s.b);
                if (s.a > s.b) setsA++;
                else if (s.b > s.a) setsB++;
            });

            const winnerId = setsA > setsB ? selectedChallenge.challengerId : selectedChallenge.challengedId;

            // 2. Insert Match
            const { data: matchData, error: matchError } = await supabase
                .from('matches')
                .insert({
                    type: 'Desafio',
                    player_a_id: selectedChallenge.challengerId,
                    player_b_id: selectedChallenge.challengedId,
                    score_a: scoreA,
                    score_b: scoreB,
                    winner_id: winnerId,
                    date: getNowInFortaleza().toISOString(),
                    status: 'finished'
                })
                .select()
                .single();

            if (matchError) throw matchError;

            // 3. Update Challenge
            const { error: chalError } = await supabase
                .from('challenges')
                .update({ status: 'finished', match_id: matchData.id })
                .eq('id', selectedChallenge.id);

            if (chalError) throw chalError;

            // 4. Update Reservation
            if (selectedChallenge.reservationId) {
                await supabase.from('reservations').update({ status: 'finished' }).eq('id', selectedChallenge.reservationId);
            }

            // Update Local State
            setChallenges(challenges.map(c =>
                c.id === selectedChallenge.id ? { ...c, status: 'finished', matchId: matchData.id } : c
            ));

            // Also update reservation status locally
            if (selectedChallenge.reservationId) {
                setReservations(reservations.map(r =>
                    r.id === selectedChallenge.reservationId ? { ...r, status: 'finished' } : r
                ));
            }

            setSelectedChallenge(null);
            alert('Placar salvo com sucesso!');

        } catch (error) {
            console.error('Error saving score:', error);
            alert('Erro ao salvar placar.');
        }
    };

    // --- Navigation ---
    const goToToday = () => setCurrentDate(getNowInFortaleza());
    const navigate = (direction: 'prev' | 'next') => {
        const diff = view === 'week' ? 7 : 1;
        setCurrentDate(addDays(currentDate, direction === 'next' ? diff : -diff));
    };

    // --- Filter Data ---
    const filteredReservations = useMemo(() => {
        const sorted = [...reservations].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.startTime.localeCompare(b.startTime);
        }).filter(r => showCancelled ? true : r.status !== 'cancelled');

        if (view === 'day') {
            return sorted.filter(r => r.date === formatDate(currentDate));
        } else if (view === 'week') {
            const startOfWeek = addDays(currentDate, -currentDate.getDay()); // Sunday
            const endOfWeek = addDays(startOfWeek, 6);
            return sorted.filter(r => r.date >= formatDate(startOfWeek) && r.date <= formatDate(endOfWeek));
        } else {
            // Month view gets all to show dots, filtering happens in render
            const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
            return sorted.filter(r => r.date >= formatDate(startOfMonth) && r.date <= formatDate(endOfMonth));
        }
    }, [reservations, currentDate, view]);

    // --- Renders ---
    const renderDayView = () => (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <h3 className="text-lg font-bold text-saibro-800 capitalize flex items-center gap-2 section-header">
                <CalendarIcon date={currentDate} />
                {getDayName(formatDate(currentDate))}, {currentDate.getDate()}
            </h3>
            <div className="space-y-3">
                {filteredReservations.length === 0 ? (
                    <div className="text-center py-10 text-stone-600 section-header animate-fade-in">Nenhuma reserva para este dia.</div>
                ) : (
                    filteredReservations.map((res, index) => (
                        <div key={res.id} className={`animate-slide-in opacity-0`} style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'forwards' }}>
                            <ReservationCard
                                res={res}
                                currentUser={currentUser}
                                profiles={profiles}
                                courts={courts}
                                professors={professors}
                                nonSocioStudents={nonSocioStudents}
                                onSelect={handleSelectReservation}
                                challenges={challenges}
                                onLaunchScore={handleLaunchScore}
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderWeekView = () => {
        const startOfWeek = addDays(currentDate, -currentDate.getDay());
        const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));

        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2">
                {days.map(day => {
                    const dayStr = formatDate(day);
                    const dayRes = filteredReservations.filter(r => r.date === dayStr);
                    const isToday = dayStr === formatDate(getNowInFortaleza());

                    return (
                        <div key={dayStr} className={`rounded-xl border ${isToday ? 'bg-orange-50/50 border-orange-200' : 'bg-transparent border-transparent'}`}>
                            <div className="sticky top-0 bg-white/95 backdrop-blur z-10 p-2 border-b border-stone-100 flex items-center gap-2">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${isToday ? 'bg-saibro-500 text-white' : 'bg-stone-100 text-stone-500'}`}>
                                    {day.getDate()}
                                </div>
                                <span className={`text-sm font-semibold capitalize ${isToday ? 'text-saibro-700' : 'text-stone-600'}`}>
                                    {getDayName(dayStr)}
                                </span>
                            </div>
                            <div className="p-2 space-y-2 pl-4 border-l-2 border-stone-100 ml-4 my-2">
                                {dayRes.length === 0 ? (
                                    <p className="text-xs text-stone-400 py-1 italic">Sem reservas</p>
                                ) : (
                                    dayRes.map(res => (
                                        <ReservationCard
                                            key={res.id} res={res} currentUser={currentUser} profiles={profiles}
                                            courts={courts} professors={professors} nonSocioStudents={nonSocioStudents}
                                            onSelect={handleSelectReservation}
                                            challenges={challenges}
                                            onLaunchScore={handleLaunchScore}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderMonthView = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const blanks = Array.from({ length: firstDay }, (_, i) => i);

        return (
            <div className="animate-in zoom-in-95 duration-200">
                <div className="grid grid-cols-7 mb-2 text-center">
                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                        <span key={i} className="text-xs font-bold text-stone-400 py-2">{d}</span>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {blanks.map(i => <div key={`blank-${i}`} className="h-10" />)}
                    {days.map(d => {
                        const dateStr = formatDate(new Date(year, month, d));
                        const dayRes = filteredReservations.filter(r => r.date === dateStr);
                        const hasEvent = dayRes.length > 0;
                        const isToday = dateStr === formatDate(getNowInFortaleza());

                        // Check for special types to color the dot
                        const hasComp = dayRes.some(r => r.type === 'Campeonato');
                        const hasRank = dayRes.some(r => r.type === 'Desafio');

                        return (
                            <button
                                key={d}
                                onClick={() => { setCurrentDate(new Date(year, month, d)); setView('day'); }}
                                className={`h-12 rounded-lg flex flex-col items-center justify-center relative border transition-all active:scale-95
                                    ${isToday ? 'bg-saibro-100 border-saibro-300 text-saibro-800 font-bold' : 'bg-white border-stone-100 text-stone-600 hover:border-saibro-200'}
                                `}
                            >
                                <span className="text-sm">{d}</span>
                                <div className="flex gap-0.5 mt-0.5">
                                    {hasComp && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                                    {hasRank && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                                    {!hasComp && !hasRank && hasEvent && <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-6 border-t pt-4">
                    <h4 className="text-sm font-bold text-stone-700 mb-3">Reservas do dia {currentDate.getDate()}</h4>
                    <div className="space-y-3">
                        {filteredReservations.filter(r => r.date === formatDate(currentDate)).map(res => (
                            <ReservationCard
                                key={res.id} res={res} currentUser={currentUser} profiles={profiles}
                                courts={courts} professors={professors} nonSocioStudents={nonSocioStudents}
                                onSelect={handleSelectReservation}
                                challenges={challenges}
                                onLaunchScore={handleLaunchScore}
                            />
                        ))}
                        {filteredReservations.filter(r => r.date === formatDate(currentDate)).length === 0 && (
                            <p className="text-stone-400 text-sm text-center">Selecione um dia com marcações.</p>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 space-y-4 pb-40">
            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Loader2 className="animate-spin text-saibro-600" size={48} />
                </div>
            )}

            {!loading && (
                <>
                    {/* Header Controls */}
                    <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-saibro-900">Agenda</h2>
                            {currentUser.role !== 'lanchonete' && (
                                <button onClick={handleOpenAdd} className="bg-saibro-600 text-white px-3 py-2 rounded-xl shadow-lg shadow-orange-200 flex items-center gap-2 text-sm font-bold active:scale-95 transition-transform">
                                    <Plus size={18} /> <span className="hidden md:inline">Nova Reserva</span>
                                </button>
                            )}
                        </div>

                        {/* View Switcher */}
                        <div className="bg-stone-100 p-1 rounded-lg flex text-sm font-medium">
                            {['day', 'week', 'month'].map((v) => (
                                <button
                                    key={v}
                                    onClick={() => setView(v as any)}
                                    className={`flex-1 py-1.5 rounded-md transition-all ${view === v ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                                >
                                    {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
                                </button>
                            ))}
                        </div>

                        {/* Date Navigator */}
                        {/* Date Navigator & Filters Container */}
                        <div className="flex flex-col gap-4 mb-2">
                            <div className="flex items-center justify-between gap-4">
                                <button
                                    onClick={() => navigate('prev')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-saibro-600 transition-all active:scale-95"
                                >
                                    <ChevronLeft size={20} strokeWidth={2.5} />
                                </button>

                                <div className="flex flex-col items-center cursor-pointer group" onClick={goToToday}>
                                    <div className="flex items-baseline gap-1.5 transition-transform group-active:scale-95">
                                        <span className="text-2xl font-black text-stone-800 capitalize tracking-tight leading-none">
                                            {currentDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')},
                                        </span>
                                        <span className="text-2xl font-black text-saibro-600 leading-none">
                                            {currentDate.getDate()}
                                        </span>
                                    </div>
                                    <span className="text-xs font-black text-stone-500 uppercase tracking-widest group-hover:text-saibro-600 transition-colors mt-0.5">
                                        {currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                                    </span>
                                </div>

                                <button
                                    onClick={() => navigate('next')}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-saibro-600 transition-all active:scale-95"
                                >
                                    <ChevronRight size={20} strokeWidth={2.5} />
                                </button>
                            </div>

                            {/* Filters Toggle */}
                            <div className="flex justify-end">
                                <div
                                    onClick={() => setShowCancelled(!showCancelled)}
                                    className={`
                                        flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border cursor-pointer transition-all select-none
                                        ${showCancelled ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-stone-200 hover:border-stone-300'}
                                    `}
                                >
                                    <div className={`
                                        w-8 h-5 rounded-full relative transition-colors duration-300 ease-in-out
                                        ${showCancelled ? 'bg-red-500' : 'bg-stone-200'}
                                    `}>
                                        <div className={`
                                            absolute top-1 left-1 bg-white w-3 h-3 rounded-full shadow-sm transition-transform duration-300
                                            ${showCancelled ? 'translate-x-3' : 'translate-x-0'}
                                        `} />
                                    </div>
                                    <span className={`text-[10px] uppercase font-bold tracking-wider ${showCancelled ? 'text-red-600' : 'text-stone-400'}`}>
                                        Ver Canceladas
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="min-h-[400px]">
                        {view === 'day' && renderDayView()}
                        {view === 'week' && renderWeekView()}
                        {view === 'month' && renderMonthView()}
                    </div>

                    {/* Modals */}
                    {selectedReservation && (
                        <ReservationDetails
                            res={selectedReservation}
                            currentUser={currentUser}
                            profiles={profiles}
                            courts={courts}
                            professors={professors}
                            nonSocioStudents={nonSocioStudents}
                            onClose={() => setSelectedReservation(undefined)}
                            onEdit={handleOpenEdit}
                            onCancel={handleCancel}
                            onJoin={handleJoin}
                            onLeave={handleLeave}
                            onUpdate={handleSaveReservation}
                            onFinishMatch={handleFinishChampionshipMatch}
                            onDataRefresh={() => fetchData(false)}
                        />
                    )}

                    {showAddModal && (
                        <AddReservationModal
                            onClose={() => setShowAddModal(false)}
                            onSave={handleSaveReservation}
                            currentUser={currentUser}
                            profiles={profiles}
                            courts={courts}
                            professors={professors}
                            nonSocioStudents={nonSocioStudents}
                            existingReservations={reservations}
                            initialData={reservationToEdit}
                        />
                    )}

                    {selectedChallenge && (
                        <ScoreModal
                            challenge={selectedChallenge}
                            challengerName={profiles.find(p => p.id === selectedChallenge.challengerId)?.name || 'Desafiante'}
                            challengedName={profiles.find(p => p.id === selectedChallenge.challengedId)?.name || 'Desafiado'}
                            onClose={() => setSelectedChallenge(null)}
                            onSave={handleSaveScore}
                        />
                    )}
                </>
            )}
        </div>
    );
};

// --- SUB-COMPONENT: Calendar Icon ---
const CalendarIcon: React.FC<{ date: Date }> = ({ date }) => (
    <div className="w-8 h-8 bg-white border border-stone-200 rounded-lg flex flex-col items-center justify-center shadow-sm overflow-hidden">
        <div className="w-full h-2.5 bg-red-500" />
        <span className="text-xs font-bold text-stone-800 leading-none mt-0.5">{date.getDate()}</span>
    </div>
);

// --- SUB-COMPONENT: Add/Edit Reservation Modal ---
const AddReservationModal: React.FC<{
    onClose: () => void;
    onSave: (res: Reservation) => void;
    currentUser: User;
    profiles: User[];
    courts: Court[];
    professors: Professor[];
    nonSocioStudents: NonSocioStudent[];
    existingReservations: Reservation[];
    initialData?: Reservation;
}> = ({ onClose, onSave, currentUser, profiles, courts, professors, nonSocioStudents, existingReservations, initialData }) => {
    const isEdit = !!initialData;
    const [step, setStep] = useState(1);
    const initialReservationType: ReservationType = initialData?.type || 'Play';

    // Helper to calculate duration from start/end
    const getInitialDuration = () => {
        if (!initialData) return 60;
        const start = new Date(`2000-01-01T${initialData.startTime}`);
        const end = new Date(`2000-01-01T${initialData.endTime}`);
        return (end.getTime() - start.getTime()) / 60000;
    };

    // 1. Basic Fields
    const [type, setType] = useState<ReservationType>(initialReservationType);
    const [date, setDate] = useState(initialData?.date || formatDate(getNowInFortaleza()));
    const [courtId, setCourtId] = useState(initialData?.courtId || (courts.length > 0 ? courts[0].id : ''));
    const [startTime, setStartTime] = useState(initialData?.startTime || '');
    const [duration, setDuration] = useState(getInitialDuration());

    // 2. Participants
    const getInitialSocioIds = () => {
        if (!initialData) return initialReservationType === 'Play' ? [currentUser.id] : [];
        if (initialData.type === 'Aula') return getClassSocioIds(initialData);
        return initialData.participantIds || [];
    };
    const getInitialNonSocioIds = () => {
        if (!initialData) return [];
        if (initialData.type === 'Aula') return getClassNonSocioIds(initialData);
        return [];
    };
    const [participantIds, setParticipantIds] = useState<string[]>(getInitialSocioIds());
    const [nonSocioStudentIds, setNonSocioStudentIds] = useState<string[]>(getInitialNonSocioIds());
    const [observation, setObservation] = useState(initialData?.observation || '');

    // 3. Guest Logic
    const [hasGuest, setHasGuest] = useState(!!initialData?.guestName);
    const [guestName, setGuestName] = useState(initialData?.guestName || '');
    const [guestResponsibleId, setGuestResponsibleId] = useState(initialData?.guestResponsibleId || currentUser.id);

    // 4. Professor/Class Logic
    const [selectedProfessorId, setSelectedProfessorId] = useState(initialData?.professorId || '');

    const [error, setError] = useState<string | null>(null);

    // Context Data
    const availablePartners = profiles.filter(u => (u.role === 'socio' || u.role === 'admin') && u.id !== currentUser.id);
    const availableSocios = profiles.filter(u => (u.role === 'socio' || u.role === 'admin') && u.isActive !== false);
    const professorRecord = professors.find(p => p.userId === currentUser.id);

    // Use nonSocioStudents from props
    const [localNonSocioStudents, setLocalNonSocioStudents] = useState(nonSocioStudents);
    const currentProfessorId = currentUser.role === 'admin' ? selectedProfessorId : professorRecord?.id;
    const availableNonSocioStudents = currentUser.role === 'admin'
        ? localNonSocioStudents
        : localNonSocioStudents.filter(s => s.studentType === 'dependent' || s.professorId === currentProfessorId);

    // Only Admin or Professor can create 'Aula'
    const canCreateAula = currentUser.role === 'admin' || !!professorRecord;

    // Initial Setup & Defaults
    useEffect(() => {
        if (!isEdit) {
            // STEP 2 Defaults logic
            if (step === 2) {
                if (type === 'Play') {
                    // Default to Saibro
                    const saibro = courts.find(c => c.type.toLowerCase().includes('saibro') && c.isActive);
                    if (saibro && !initialData) setCourtId(saibro.id);
                    // Standard duration 60
                    if (!initialData) setDuration(60);
                } else if (type === 'Aula') {
                    // Default to Rapida
                    const rapida = courts.find(c => c.type.toLowerCase().includes('rápida') && c.isActive);
                    if (rapida && !initialData) setCourtId(rapida.id);
                    // Default duration 30 logic
                    if (!initialData) setDuration(30);
                }
            }

            // Sync prof selection
            if (currentUser.isProfessor && professorRecord) setSelectedProfessorId(professorRecord.id);
            if (currentUser.role === 'admin' && type === 'Aula' && !selectedProfessorId && professors.length > 0) {
                setSelectedProfessorId(professors[0].id);
            }
        }

        // Logic to clear start time if unavailable on new date/type
        if (!isEdit || (isEdit && date !== initialData.date)) {
            // We don't verify strict availability here to avoid clearing user selection while browsing, 
            // but we could. For now, let user pick.
        }
    }, [step, type, courts, isEdit, currentUser, professorRecord]);

    // Generate Available Times based on rules
    const getAvailableTimes = (resType: ReservationType, resDate: string, restrictNonSocioTimes: boolean) => {
        const times: string[] = [];
        const dayOfWeek = new Date(resDate + 'T12:00:00').getDay(); // 0 = Sun

        let startHour = 5;
        const endHour = 22;

        // NEW RULES FOR AULA:
        // - If there are only non-socio/dependent students: morning (5h-12h) OR night (20h+)
        // - If there's at least one socio: any time allowed
        if (resType === 'Aula' && dayOfWeek !== 0 && restrictNonSocioTimes) {
            // Non-socio only: morning (5h-11h59) OR night (20h+)
            const morningTimes: string[] = [];
            const nightTimes: string[] = [];

            // Morning slots: 5:00 to 11:30
            for (let h = 5; h <= 11; h++) {
                ['00', '30'].forEach(m => {
                    morningTimes.push(`${String(h).padStart(2, '0')}:${m}`);
                });
            }

            // Night slots: 20:00 to 22:30
            for (let h = 20; h <= 22; h++) {
                ['00', '30'].forEach(m => {
                    if (h === 23) return;
                    nightTimes.push(`${String(h).padStart(2, '0')}:${m}`);
                });
            }

            return [...morningTimes, ...nightTimes];
        }

        // Default logic for Play, Campeonato, or socio Aula
        for (let h = startHour; h <= endHour; h++) {
            ['00', '30'].forEach(m => {
                if (h === 23) return;
                times.push(`${String(h).padStart(2, '0')}:${m}`);
            });
        }
        return times;
    };

    const shouldRestrictNonSocioTimes = type === 'Aula' && participantIds.length === 0 && nonSocioStudentIds.length > 0;
    const availableTimes = useMemo(() => getAvailableTimes(type, date, shouldRestrictNonSocioTimes), [type, date, shouldRestrictNonSocioTimes]);

    // Helper: Toggle user in participant list
    const toggleParticipant = (uid: string) => {
        setParticipantIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };

    const toggleSocio = (uid: string) => {
        setParticipantIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };

    const toggleNonSocio = (sid: string) => {
        setNonSocioStudentIds(prev => prev.includes(sid) ? prev.filter(id => id !== sid) : [...prev, sid]);
    };

    // Validation
    const validateStep2 = () => {
        if (!date) return "Selecione uma data.";
        if (!courtId) return "Selecione uma quadra.";
        if (!startTime) return "Selecione um horário.";

        const endTime = addMinutes(startTime, duration);
        if (endTime > "23:00" && endTime !== "00:00") return "Horário excede o fechamento (23:00).";

        if (type === 'Aula') {
            const selectedCourt = courts.find(c => c.id === courtId);
            if (selectedCourt) {
                const rawType = selectedCourt.type || '';
                const courtType = rawType.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (!courtType.includes('rapida')) {
                    return "Aulas são permitidas apenas na Quadra Rápida.";
                }
            }
        }
        return null; // OK
    };

    const validateStep3 = () => {
        if (type === 'Play') {
            if (participantIds.length === 0 && !hasGuest) return "Selecione ao menos um participante.";
            if (hasGuest && !guestName.trim()) return "Nome do convidado é obrigatório.";
        }

        if (type === 'Aula') {
            if (currentUser.role === 'admin' && !selectedProfessorId) return "Selecione o professor.";
            if (participantIds.length + nonSocioStudentIds.length === 0) return "Selecione ao menos um aluno.";

            if (shouldRestrictNonSocioTimes && startTime && !availableTimes.includes(startTime)) {
                return "Horário inválido para aulas apenas com não-sócios/dependentes. Escolha manhã (5h-12h) ou noite (20h+).";
            }

            // Check ALL selected non-socio students for payment status
            for (const sid of nonSocioStudentIds) {
                const student = localNonSocioStudents.find(s => s.id === sid);
                if (!student) continue;
                // Dependentes não precisam de validação de pagamento
                if (student.studentType === 'dependent') continue;
                // Todos os planos pagos precisam estar ativos
                if (student.planStatus !== 'active') return `Bloqueado: ${student.name} Inativo. Pagamento pendente.`;
                // Card Mensal precisa de validação de expiração
                if (student.planType === 'Card Mensal') {
                    if (!student.masterExpirationDate || new Date(student.masterExpirationDate + 'T23:59:59') < new Date(date + 'T12:00:00')) {
                        return `Bloqueado: Card Mensal de ${student.name} Vencido.`;
                    }
                }
            }
        }
        return null;
    };

    const handleNext = () => {
        setError(null);
        if (step === 1) {
            setStep(2);
        } else if (step === 2) {
            const err = validateStep2();
            if (err) { setError(err); return; }
            setStep(3);
        }
    };

    const handleBack = () => {
        setError(null);
        setStep(s => Math.max(1, s - 1));
    };

    const handleConfirm = () => {
        const err = validateStep3();
        if (err) { setError(err); return; }

        const endTime = addMinutes(startTime, duration);

        // Conflict Check...
        const conflictingReservations = existingReservations.filter(r => {
            if (isEdit && r.id === initialData?.id) return false;
            if (r.courtId !== courtId || r.date !== date || r.status === 'cancelled') return false;
            return checkOverlap(startTime, endTime, r.startTime, r.endTime);
        });

        if (conflictingReservations.length > 0) {
            const allNames: string[] = [];
            conflictingReservations.forEach(r => {
                r.participantIds.forEach(pid => {
                    const pName = profiles.find(u => u.id === pid)?.name;
                    if (pName) allNames.push(pName);
                });
                if (r.guestName) allNames.push(`${r.guestName} (Convidado)`);
                // ... (simplified logic for brevity, matches original) ...
            });
            const namesString = Array.from(new Set(allNames)).join(', ');
            if (!window.confirm(`Choque de horário com: ${namesString}. Deseja marcar mesmo assim?`)) return;
        }

        const derivedStudentType = type === 'Aula'
            ? (participantIds.length > 0 && nonSocioStudentIds.length === 0
                ? 'socio'
                : (participantIds.length === 0 && nonSocioStudentIds.length > 0 ? 'non-socio' : undefined))
            : undefined;
        const derivedNonSocioStudentId = type === 'Aula' && nonSocioStudentIds.length === 1
            ? nonSocioStudentIds[0]
            : undefined;

        const newRes: Reservation = {
            id: initialData?.id || `r_${Date.now()}`,
            type, date, startTime, endTime, courtId,
            creatorId: initialData?.creatorId || currentUser.id,
            participantIds,
            guestName: hasGuest ? guestName : undefined,
            guestResponsibleId: hasGuest ? guestResponsibleId : undefined,
            professorId: type === 'Aula' ? currentProfessorId : undefined,
            studentType: derivedStudentType,
            nonSocioStudentId: derivedNonSocioStudentId,
            nonSocioStudentIds: type === 'Aula' ? nonSocioStudentIds : [],
            observation: observation || undefined,
            status: initialData?.status || 'active'
        };
        onSave(newRes);
    };

    return createPortal(
        <div className="fixed inset-0 bg-stone-900/60 z-999 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-md">
            <div className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] w-full max-w-lg transition-all duration-300 animate-slide-in`}>

                {/* Header with Steps */}
                <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50 rounded-t-3xl">
                    <div>
                        <h3 className="text-xl font-bold text-stone-800">{isEdit ? 'Editar Reserva' : 'Nova Reserva'}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            {[1, 2, 3].map(s => (
                                <div key={s} className={`h-1.5 rounded-full transition-all ${step >= s ? 'w-6 bg-saibro-500' : 'w-2 bg-stone-200'}`} />
                            ))}
                            <span className="text-[10px] font-bold text-stone-400 uppercase ml-1">
                                Passo {step} de 3
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-stone-400 hover:bg-stone-100 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {error && (
                    <div className="mx-5 mt-4 bg-red-50 text-red-600 text-xs p-3 rounded-xl flex gap-2 items-center font-bold border border-red-100">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <div className="p-5 overflow-y-auto flex-1">

                    {/* STEP 1: TYPE */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <p className="text-sm text-stone-500 font-medium">O que você vai marcar hoje?</p>

                            <button
                                onClick={() => {
                                    setType('Play');
                                    setCourtId('');
                                    if (!isEdit) {
                                        setParticipantIds([currentUser.id]);
                                        setNonSocioStudentIds([]);
                                    }
                                }}
                                className={`w-full p-6 rounded-2xl border-2 text-left transition-all group ${type === 'Play' ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100 bg-white hover:border-saibro-200 hover:bg-stone-50'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${type === 'Play' ? 'bg-saibro-500 text-white shadow-lg shadow-saibro-200' : 'bg-stone-100 text-stone-400'}`}>
                                        <Trophy size={24} />
                                    </div>
                                    {type === 'Play' && <div className="w-6 h-6 rounded-full bg-saibro-500 text-white flex items-center justify-center"><Check size={14} strokeWidth={4} /></div>}
                                </div>
                                <h4 className="text-lg font-black text-stone-800">Play Amistoso</h4>
                                <p className="text-xs text-stone-500 mt-1 font-medium">Reserve uma quadra para jogar com amigos. Permite convidados (Day Use).</p>
                            </button>

                            {canCreateAula && (
                                <button
                                    onClick={() => {
                                        setType('Aula');
                                        if (!isEdit) {
                                            setParticipantIds([]);
                                            setNonSocioStudentIds([]);
                                        }
                                        const rapidaId = courts.find(c => (c.type || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes('rapida'))?.id || '';
                                        setCourtId(rapidaId);
                                    }}
                                    className={`w-full p-6 rounded-2xl border-2 text-left transition-all group ${type === 'Aula' ? 'border-saibro-500 bg-saibro-50' : 'border-stone-100 bg-white hover:border-saibro-200 hover:bg-stone-50'}`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${type === 'Aula' ? 'bg-saibro-500 text-white shadow-lg shadow-saibro-200' : 'bg-stone-100 text-stone-400'}`}>
                                            <UserCog size={24} />
                                        </div>
                                        {type === 'Aula' && <div className="w-6 h-6 rounded-full bg-saibro-500 text-white flex items-center justify-center"><Check size={14} strokeWidth={4} /></div>}
                                    </div>
                                    <h4 className="text-lg font-black text-stone-800">Aula</h4>
                                    <p className="text-xs text-stone-500 mt-1 font-medium">Reserve horário para aulas com professor. Exclusivo para Quadra Rápida.</p>
                                </button>
                            )}
                        </div>
                    )}

                    {/* STEP 2: DETAILS */}
                    {step === 2 && (
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Data</label>
                                    <div className="relative">
                                        <input
                                            type="date"
                                            value={date}
                                            onChange={e => { setDate(e.target.value); setError(null); }}
                                            className="w-full pl-3 pr-2 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Quadra</label>
                                    {type === 'Aula' ? (
                                        <div className="w-full px-3 py-3 bg-stone-100 border-none rounded-xl text-sm font-bold text-stone-500 flex items-center gap-2 cursor-not-allowed">
                                            <Check size={16} className="text-saibro-500" /> Quadra Rápida (Automático)
                                        </div>
                                    ) : (
                                        <select
                                            className="w-full px-3 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700"
                                            value={courtId}
                                            onChange={e => { setCourtId(e.target.value); setError(null); }}
                                        >
                                            <option value="">Selecione...</option>
                                            {courts
                                                .filter(c => c.isActive)
                                                .map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                                        </select>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Duração</label>
                                    <div className="flex bg-stone-50 rounded-xl p-1 gap-1">
                                        {[30, 60, 90, 120].map(d => {
                                            if (type === 'Play' && d === 30) return null;
                                            if (type === 'Aula' && d !== 30) return null;
                                            return (
                                                <button
                                                    key={d}
                                                    onClick={() => setDuration(d)}
                                                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${duration === d ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                                                >
                                                    {d}m
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Horário de Início</label>
                                    <select
                                        value={startTime}
                                        onChange={e => { setStartTime(e.target.value); setError(null); }}
                                        className="w-full px-3 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700 appearance-none"
                                    >
                                        <option value="">Selecione...</option>
                                        {availableTimes.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3 text-blue-800">
                                <Info className="shrink-0" size={18} />
                                <p className="text-xs font-medium leading-relaxed">
                                    {type === 'Play'
                                        ? "Jogos amistosos padrão têm duração de 60-120min. Quadras de saibro são a preferência."
                                        : type === 'Aula' && shouldRestrictNonSocioTimes
                                            ? "Aulas sem sócios: permitidas pela manhã (5h-12h) ou à noite (20h+). Duração de 30min na Quadra Rápida."
                                            : "Aulas com sócios: permitidas em qualquer horário. Duração de 30min na Quadra Rápida."}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: PARTICIPANTS */}
                    {step === 3 && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">

                            {/* PLAY LOGIC */}
                            {type === 'Play' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-stone-500 uppercase mb-2">Quem vai jogar? (Sócios)</label>
                                        <div className="grid grid-cols-1 gap-2 max-h-[240px] overflow-y-auto pr-1">
                                            <button
                                                onClick={() => toggleParticipant(currentUser.id)}
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${participantIds.includes(currentUser.id) ? 'bg-saibro-50 border-saibro-500' : 'bg-white border-stone-100'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${participantIds.includes(currentUser.id) ? 'bg-saibro-500 text-white' : 'bg-stone-100 text-stone-500'}`}>
                                                        {currentUser.name[0]}
                                                    </div>
                                                    <span className="text-sm font-bold text-stone-700">Eu ({currentUser.name})</span>
                                                </div>
                                                {participantIds.includes(currentUser.id) && <Check size={16} className="text-saibro-600" />}
                                            </button>

                                            {availablePartners.map(u => (
                                                <button
                                                    key={u.id}
                                                    onClick={() => toggleParticipant(u.id)}
                                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${participantIds.includes(u.id) ? 'bg-saibro-50 border-saibro-500' : 'bg-white border-stone-100'}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {u.avatar ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover bg-stone-100" /> : (
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-stone-100 text-stone-500`}>
                                                                {u.name[0]}
                                                            </div>
                                                        )}
                                                        <span className="text-sm font-bold text-stone-700">{u.name}</span>
                                                    </div>
                                                    {participantIds.includes(u.id) && <Check size={16} className="text-saibro-600" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-sm font-bold text-stone-800">Convidado (Day Use)</span>
                                            <div onClick={() => setHasGuest(!hasGuest)} className={`w-12 h-7 rounded-full p-1 cursor-pointer transition-colors ${hasGuest ? 'bg-saibro-500' : 'bg-stone-300'}`}>
                                                <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${hasGuest ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                        </div>
                                        {hasGuest && (
                                            <div className="space-y-3">
                                                <input
                                                    type="text"
                                                    placeholder="Nome do convidado"
                                                    value={guestName}
                                                    onChange={e => setGuestName(e.target.value)}
                                                    className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                                                />
                                                <select
                                                    value={guestResponsibleId}
                                                    onChange={e => setGuestResponsibleId(e.target.value)}
                                                    className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm"
                                                >
                                                    <option value={currentUser.id}>Responsável: Eu</option>
                                                    {availablePartners.map(u => <option key={u.id} value={u.id}>Responsável: {u.name}</option>)}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* AULA LOGIC */}
                            {type === 'Aula' && (
                                <div className="space-y-4">
                                    {currentUser.role === 'admin' && (
                                        <div>
                                            <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Professor</label>
                                            <select
                                                className="w-full px-3 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700"
                                                value={selectedProfessorId}
                                                onChange={(e) => setSelectedProfessorId(e.target.value)}
                                            >
                                                <option value="">Selecione...</option>
                                                {professors.filter(p => p.isActive).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Alunos Sócios</label>
                                        <select
                                            className="w-full px-3 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700 mb-2"
                                            onChange={(e) => { if (e.target.value) toggleSocio(e.target.value); }}
                                            value=""
                                        >
                                            <option value="">Adicionar sócio...</option>
                                            {availableSocios.filter(u => !participantIds.includes(u.id)).map(u => (
                                                <option key={u.id} value={u.id}>{u.name}</option>
                                            ))}
                                        </select>
                                        <div className="flex flex-wrap gap-2">
                                            {participantIds.map(pid => {
                                                const s = profiles.find(st => st.id === pid);
                                                if (!s) return null;
                                                return (
                                                    <span key={s.id} onClick={() => toggleSocio(s.id)} className="bg-stone-100 text-stone-700 px-3 py-1 rounded-full text-xs font-bold cursor-pointer flex items-center gap-1 hover:bg-red-100 hover:text-red-600">
                                                        {s.name} <X size={12} />
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Não-sócios e Dependentes</label>
                                        <select
                                            className="w-full px-3 py-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm font-bold text-stone-700 mb-2"
                                            onChange={(e) => { if (e.target.value) toggleNonSocio(e.target.value); }}
                                            value=""
                                        >
                                            <option value="">Adicionar aluno...</option>
                                            {availableNonSocioStudents.filter(s => !nonSocioStudentIds.includes(s.id)).map(s => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name} ({s.studentType === 'dependent' ? 'Dependente' : s.planType})
                                                </option>
                                            ))}
                                        </select>
                                        <div className="flex flex-wrap gap-2">
                                            {nonSocioStudentIds.map(sid => {
                                                const s = localNonSocioStudents.find(st => st.id === sid);
                                                if (!s) return null;
                                                const isDependent = s.studentType === 'dependent';
                                                return (
                                                    <span
                                                        key={s.id}
                                                        onClick={() => toggleNonSocio(s.id)}
                                                        className={`${isDependent ? 'bg-blue-100 text-blue-700' : 'bg-saibro-100 text-saibro-800'} px-3 py-1 rounded-full text-xs font-bold cursor-pointer flex items-center gap-1 hover:bg-red-100 hover:text-red-600`}
                                                    >
                                                        {s.name} {isDependent ? '(Dep.)' : ''} <X size={12} />
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <p className="text-xs text-stone-500 font-medium">
                                        Total de alunos selecionados: {participantIds.length + nonSocioStudentIds.length}
                                    </p>
                                </div>
                            )}

                            {/* Observation - Only for Play or other types, NOT for Aula */}
                            {type !== 'Aula' && (
                                <div className="pt-2">
                                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1.5">Observações</label>
                                    <textarea
                                        rows={2}
                                        value={observation}
                                        onChange={e => setObservation(e.target.value)}
                                        placeholder="Detalhes adicionais..."
                                        className="w-full p-3 bg-stone-50 border-none rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 text-sm"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="p-5 border-t border-stone-100 flex gap-3 bg-white rounded-b-3xl">
                    {step > 1 ? (
                        <button onClick={handleBack} className="px-6 py-3 rounded-xl font-bold text-stone-500 hover:bg-stone-50 transition-colors">
                            Voltar
                        </button>
                    ) : (
                        <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-stone-400 hover:bg-stone-50 transition-colors">
                            Cancelar
                        </button>
                    )}

                    {step < 3 ? (
                        <button onClick={handleNext} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-black transition-colors shadow-lg active:scale-95 flex items-center justify-center gap-2">
                            Próximo <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button onClick={handleConfirm} className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold hover:bg-saibro-700 transition-colors shadow-lg shadow-orange-200 active:scale-95 flex items-center justify-center gap-2">
                            <Check size={18} /> Confirmar Reserva
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
