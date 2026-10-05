
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { User, Reservation, ReservationType, NonSocioStudent, Professor, Match, StudentProfile, RelationshipType } from '../types';
import { ChevronLeft, ChevronRight, Plus, X, Calendar, MapPin, Users, Check, AlertCircle, Search, Loader2, Trash2, Trophy, UserCog, ArrowRight, Info, UserPlus, LogOut, Wallet, Pencil, UserMinus, Share2, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { useConfirm } from '../hooks/useConfirm';
import { ScoreModal } from './ScoreModal';
import { LiveScoreboard } from './LiveScoreboard';
import { buildLiveScoreMatch } from '../lib/liveScore';
import { StandardModal } from './StandardModal';
import { TennisCourtAnimation } from './ui/TennisCourtAnimation';
import { Challenge } from '../types';
import { getNowInFortaleza, formatDate, addDays, formatDateBr, getSetWinner, getMatchWinner, countSetsWon, isMember } from '../utils';
import { canParticipateInClass, getCardStatus, StudentLevel, STUDENT_LEVELS } from '../lib/students/studentRules';

// Court type
interface Court {
    id: string;
    name: string;
    type: string;
    isActive: boolean;
}

// --- HELPERS ---

// Check if user can launch score (same logic as LiveScoreboard)
const _canLaunchScore = (match: Match, userId?: string, isAdmin?: boolean): boolean => {
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
    // User request: "se horГЎrio for apГіs inicio do jogo"
    // Championship logic was:
    if (match.scheduled_date !== today) return false;
    
    // Check if current time >= scheduled time
    const [hours, minutes] = match.scheduled_time.split(':').map(Number);
    const scheduledDateTime = new Date(now); // now is Fortaleza time
    scheduledDateTime.setHours(hours, minutes, 0, 0);
    
    return now >= scheduledDateTime;
};

const getDayName = (dateStr: string) => {
    const days = ['Domingo', 'Segunda', 'TerГ§a', 'Quarta', 'Quinta', 'Sexta', 'SГЎbado'];
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

    const availableSocios = profiles.filter(u => isMember(u) && u.isActive !== false);

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
                            placeholder="Buscar por nome ou nГєmero..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-stone-50 border-none rounded-2xl outline-hidden focus:ring-2 focus:ring-saibro-500 text-sm"
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

    const availablePartners = profiles.filter(u => isMember(u) && (u.id === currentUser.id || res.participantIds.includes(u.id)));

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
                            className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl outline-hidden focus:ring-2 focus:ring-saibro-500 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">SГіcio ResponsГЎvel</label>
                        <select
                            value={responsibleId}
                            onChange={(e) => setResponsibleId(e.target.value)}
                            className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl outline-hidden focus:ring-2 focus:ring-saibro-500 text-sm appearance-none"
                        >
                            {availablePartners.map(u => (
                                <option key={u.id} value={u.id}>{u.name} (SГіcio)</option>
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
                        {res.guestName ? 'Salvar AlteraГ§Гµes' : 'Confirmar Convidado'}
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

const getChampionshipCardResult = (res: Reservation): {
    isFinished: boolean;
    winnerSide: 'A' | 'B' | null;
    setsA: number;
    setsB: number;
    showSetScore: boolean;
} => {
    const isFinished = res.matchStatus === 'finished';
    if (!isFinished) {
        return { isFinished, winnerSide: null, setsA: 0, setsB: 0, showSetScore: false };
    }

    const scoreA = Array.isArray(res.scoreA) ? res.scoreA : [];
    const scoreB = Array.isArray(res.scoreB) ? res.scoreB : [];
    const { setsA: rawSetsA, setsB: rawSetsB } = countSetsWon(scoreA, scoreB);
    let setsA = rawSetsA;
    let setsB = rawSetsB;
    let winnerSide = getMatchWinner(scoreA, scoreB);

    if (!winnerSide && res.matchIsWalkover && res.matchWalkoverWinnerRegistrationId) {
        if (res.matchWalkoverWinnerRegistrationId === res.matchRegistrationAId) winnerSide = 'A';
        else if (res.matchWalkoverWinnerRegistrationId === res.matchRegistrationBId) winnerSide = 'B';
    }

    const hasValidSetScore = setsA > 0 || setsB > 0;
    if (!hasValidSetScore && winnerSide && res.matchIsWalkover) {
        setsA = winnerSide === 'A' ? 2 : 0;
        setsB = winnerSide === 'B' ? 2 : 0;
    }

    const showSetScore = Boolean(winnerSide) && (hasValidSetScore || res.matchIsWalkover);
    return { isFinished, winnerSide, setsA, setsB, showSetScore };
};

// LiveScore HUD legacy removed in favor of shared LiveScoreboard

// --- COMPONENT: Reservation Details View ---
export const ReservationDetails: React.FC<{
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
    onDataRefresh?: () => void;
}> = ({ res, currentUser, profiles, courts, professors, nonSocioStudents, onClose, onEdit, onCancel, onJoin, onLeave, onUpdate, onDataRefresh }) => {
    const [showManageParticipants, setShowManageParticipants] = useState(false);
    const [showGuestModal, setShowGuestModal] = useState(false);
    const court = courts.find(c => c.id === res.courtId);
    const professor = professors.find(p => p.id === res.professorId);
    const socioParticipantIds = res.type === 'Aula' ? getClassSocioIds(res) : res.participantIds;
    const participants = socioParticipantIds.map(id => profiles.find(u => u.id === id)).filter(Boolean);
    const championshipPlayers = [0, 1].map((idx) => {
        const profile = profiles.find(u => u.id === res.participantIds[idx]);
        const fallbackName = idx === 0 ? 'Jogador 1' : 'Jogador 2';
        return {
            id: res.participantIds[idx] || `player-${idx}`,
            name: res.participantNames?.[idx] || profile?.name || fallbackName,
            avatar: res.participantAvatars?.[idx] || profile?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${res.participantIds[idx] || `p${idx + 1}`}`
        };
    });
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

    const canManageParticipants = isActive && isMember(currentUser) && isFuture && res.type === 'Play';
    const canEdit = isActive && (isAdmin || (isFuture && isCreator)) && res.type !== 'Campeonato';
    const canCancel = isActive && isFuture && (isAdmin || isCreator) && res.type !== 'Campeonato';
    const canJoin = res.type === 'Play' && isActive && isNotFinished && !isParticipant && isMember(currentUser) && res.participantIds.length < 8;
    const canLeave = res.type === 'Play' && isActive && isNotFinished && isParticipant;
    const canShare = isActive;

    const handleShareWhatsapp = () => {
        const dateBr = formatDateBr(res.date);
        const dayWeek = getDayName(res.date);
        const emoji = res.type === 'Aula' ? 'рџЋ“' : res.type === 'Campeonato' ? 'рџЏ†' : 'рџЋѕ';

        let text = `*SCT TГЉNIS - ${res.type === 'Campeonato' ? 'JOGO DE CAMPEONATO' : 'RESERVA CONFIRMADA'}*\n`;
        text += `------------------------------------\n`;
        text += `${emoji} *TIPO:* ${res.type.toUpperCase()}\n`;
        text += `рџ“… *DATA:* ${dateBr} (${dayWeek})\n`;
        text += `вЏ° *HORГЃRIO:* ${res.startTime} - ${res.endTime}\n`;
        text += `рџ“Ќ *QUADRA:* ${court?.name} (${court?.type})\n`;
        text += `------------------------------------\n\n`;

        if (res.type === 'Aula') {
            text += `рџЋ“ *PROFESSOR:* ${professor?.name || 'N/A'}\n`;
            const socioNames = participants.map(p => p?.name).filter(Boolean) as string[];
            const nonSocioNames = nonSocioStudentsList.map(s => s.name);
            if (socioNames.length > 0) text += `рџ‘Ґ *SГ“CIOS:* ${socioNames.join(', ')}\n`;
            if (nonSocioNames.length > 0) text += `рџ‘Ґ *ALUNOS:* ${nonSocioNames.join(', ')}\n`;
            if (socioNames.length === 0 && nonSocioNames.length === 0) text += `рџ‘Ґ *ALUNOS:* TBD\n`;
        } else if (res.type === 'Campeonato') {
            text += `рџЏ† *CAMPEONATO:* ${res.observation?.split('|')[0] || 'Oficial'}\n`;
            text += `вљ”пёЏ *CONFRONTO:*\n`;
            text += `рџЋѕ ${participants[0]?.name || 'TBD'} vs ${participants[1]?.name || 'TBD'}\n`;
        } else {
            text += `рџ‘Ґ *ATLETAS:* \n`;
            participants.forEach(p => {
                text += `рџ‘¤ ${p?.name}\n`;
            });
            if (res.guestName) {
                text += `рџ‘¤ ${res.guestName} (Convidado)\n`;
            }
        }

        if (res.observation) {
            text += `\nрџ“ќ *OBS:* ${res.observation}`;
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
                            <LiveScoreboard
                                match={buildLiveScoreMatch(res)}
                                profiles={profiles}
                                // Fallback names/avatars for guests (registrations) injected when available
                                overrideNames={res.participantNames}
                                overrideAvatars={res.participantAvatars}
                                currentUser={currentUser}
                                onScoreSaved={() => {
                                    onClose();
                                    onDataRefresh?.();
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
                                                <p className="text-[10px] uppercase font-black text-stone-400 tracking-wider">Atleta SГіcio</p>
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
                                                        <img src={championshipPlayers[0].avatar} className={`w-14 h-14 rounded-full border-4 object-cover ${isWinnerA ? 'border-saibro-500 shadow-md ring-2 ring-saibro-100' : 'border-stone-100'}`} alt="" />
                                                        {isWinnerA && <div className="absolute -top-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow-lg"><Trophy size={10} fill="currentColor" /></div>}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className={`font-black text-lg ${isWinnerA ? 'text-stone-900' : 'text-stone-600'}`}>{championshipPlayers[0].name}</span>
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
                                                        <img src={championshipPlayers[1].avatar} className={`w-14 h-14 rounded-full border-4 object-cover ${isWinnerB ? 'border-saibro-500 shadow-md ring-2 ring-saibro-100' : 'border-stone-100'}`} alt="" />
                                                        {isWinnerB && <div className="absolute -top-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow-lg"><Trophy size={10} fill="currentColor" /></div>}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className={`font-black text-lg ${isWinnerB ? 'text-stone-900' : 'text-stone-600'}`}>{championshipPlayers[1].name}</span>
                     ЯmuжЪ$z{-®йЬjЧќ[—Э\N€\С\[™[ќИ	С\[™[ќIИ€	С^HШ\™	Л€[—ЬЭ]\О€\С\[™[ќИ	ШXЭ]™IИ€	Ъ[XЭ]™IЛ€JB€њЩ[XЭ
	К‰КB€њЪ[™ЫJ
NВ€Y€
ЭY[ќ\њ›ЬЉH›ЭИЭY[ќ\њ›ЬЋВ€ЫЫњЭИ]N€ЭY[ќ›Щљ[K\њ›ЬЋ€ЭY[ќ›Щљ[Q\њ›Ь€HH]ШZ]Э\X\ЩB€™њ›ЫJ	ЬЭY[ќЬ›Щљ[\ЙКB€љ[њЩ\ќ
В€›Ы—ЬЫШЪ[ЧЬЭY[ќЪY€ЭY[ќљY€XЪљXШ[Ы]™[€™]ФЭY[ќ]™[€ЭY[ќЬЭ]\О€	ШXЭ]™IЛ€›Щ™\ЬЫЬ—ЪY€Э\њ™[ќ›Щ™\ЬЫЬ’Y€JB€њЩ[XЭ
	ЪY›Ы—ЬЫШЪ[ЧЬЭY[ќЪYXЪљXШ[Ы]™[ЭY[ќЬЭ]\Л›Щ™\ЬЫЬ—ЪY	КB€њЪ[™ЫJ
NВ€Y€
ЭY[ќ›Щљ[Q\њ›ЬЉH›ЭИЭY[ќ›Щљ[Q\њ›ЬЋВ€Щ]ШШ[›Ы”ЫШЪ[ФЭY[ќКЭ\њ™[ќO€Л‹‹Э\њ™[ќВ€Y€ЭY[ќљY€[YN€ЭY[ќ›[YK€Ы™N€ЭY[ќњЫ™K€[•\N€ЭY[ќњ[—Э\K€[”Э]\О€ЭY[ќњ[—ЬЭ]\Л€X\Э\‘^\][Ы‘]N€ЭY[ќ›X\Э\—Щ^\][Ы—Щ]K€›Щ™\ЬЫЬ’Y€ЭY[ќњ›Щ™\ЬЫЬ—ЪY€ЭY[ќ\N€ЭY[ќњЭY[ќЭ\K€™\ЬЫњЪX›TЫШЪ[ТY€ЭY[ќњ™\ЬЫњЪX›WЬЫШЪ[ЧЪY€™[][ЫњЪ\\N€ЭY[ќњ™[][ЫњЪ\Э\K€\РXЭ]™N€ќYK€ЭY[ќ›Щљ[RY€ЭY[ќ›Щљ[KљY€XЪљXШ[]™[€ЭY[ќ›Щљ[KќXЪљXШ[Ы]™[€ЭY[ќЭ]\О€ЭY[ќ›Щљ[KњЭY[ќЬЭ]\Л€WJNВ€Щ]ШШ[ЭY[ќ›Щљ[\КЭ\њ™[ќO€Л‹‹Э\њ™[ќВ€Y€ЭY[ќ›Щљ[KљY€›Ы”ЫШЪ[ФЭY[ќY€ЭY[ќ›Щљ[K››Ы—ЬЫШЪ[ЧЬЭY[ќЪY€XЪљXШ[]™[€ЭY[ќ›Щљ[KќXЪљXШ[Ы]™[€ЭY[ќЭ]\О€ЭY[ќ›Щљ[KњЭY[ќЬЭ]\Л€›Щ™\ЬЫЬ’Y€ЭY[ќ›Щљ[Kњ›Щ™\ЬЫЬ—ЪY€WJNВ€Щ]›Ы”ЫШЪ[ФЭY[ќYКЭ\њ™[ќO€Э\њ™[ќљ[ЫY\КЭY[ќљY
HИЭ\њ™[ќ€Л‹‹Э\њ™[ќЭY[ќљYJNВ€B€]ШZ]Ы”ЭY[ќЬ™X]Y

NВ€Щ]ЪЭУ™]ФЭY[ќ
[ЩJNВ€Щ]™]УY[X™\’Y
	ЙКNВ€Щ]™]ФЭY[ќ[YJ	ЙКNВ€Щ]™]ФЭY[ќЫ™J	ЙКNВ€Щ]™]ФЭY[ќ]™[
	ЙКNВ€Щ]™]С\[™[ќ™\ЬЫњЪX›RY
	ЙКNВ€Щ]™]С\[™[ќ™[][ЫњЪ\
	ЙКNВ€HШ]Ъ
Ш]\ЩJHВ€›ЭYћK™Z[\™JШ]\ЩK	У°иЫИ›ЪHЬЬрл]™[YXЪ[Ы\€И[[›И0и][K‰КNВ€Hљ[[HВ€Щ]Ь™X][™ФЭY[ќ
[ЩJNВ€B€NВ‚€ЛИ[Y][Ы‚€ЫЫњЭ[Y]TЭ\€H

HO€В€Y€
Y]JH™]\›€”Щ[XЪ[Ы™H[XH]K€ЋВ€Y€
XЫЭ\ќY
H™]\›€”Щ[XЪ[Ы™H[XH]XYK€ЋВ€Y€
\Э\ќ[YJH™]\›€”Щ[XЪ[Ы™H[HЬ°и\љ[Л€ЋВ‚€ЫЫњЭ[™[YHHYZ[ќ]\КЭ\ќ[YK\][ЫЉNВ€Y€
[™[YH€ЊЊОЊ€	‰€[™[YHOOHЊЊЉH™]\›€’Ь°и\љ[И^ЩYHИ™XЪ[Y[ќИ
ЊОЊ
K€ЋВ‚€Y€
\HOOH	Р][IКHВ€ЫЫњЭЩ[XЭYЫЭ\ќHЫЭ\ќЛ™љ[™
ИO€ЛљYOOHЫЭ\ќY
NВ€Y€
Щ[XЭYЫЭ\ќ	‰€[›Ь›X[^™PЫЭ\ќ\JЩ[XЭYЫЭ\ќќ\JKљ[ЫY\К	Ь\YIКJHВ€™]\›€ђ][\ИриЫИ\›Z]Y\И\[\ИH]XYH°и\YK€ЋВ€B€B€™]\›€ќ[ИЛИТВ€NВ‚€ЫЫњЭ[Y]TЭ\ИH

HO€В€Y€
\HOOH	Ф^IКHВ€Y€
\ќXЪ\[ќYЛ›[™ЭOOH	‰€Z\СЭY\Э
H™]\›€”Щ[XЪ[Ы™H[ИY[›ЬИ[H\ќXЪ\[ќK€ЋВ€Y€
\СЭY\Э	‰€YЭY\Э[YKќљ[J
JH™]\›€“›ЫYHИЫЫќљYYИ0кHШњљYШ]0мЬљ[Л€ЋВ€B‚€Y€
\HOOH	Р][IКHВ€Y€
Э\њ™[ќ\Щ\‹њ›ЫHOOH	ШYZ[‰И	‰€\Щ[XЭY›Щ™\ЬЫЬ’Y
H™]\›€”Щ[XЪ[Ы™HИ›Щ™\ЬЫЬ‹€ЋВ€Y€
\ќXЪ\[ќYЛ›[™Э
И›Ы”ЫШЪ[ФЭY[ќYЛ›[™ЭOOH
H™]\›€”Щ[XЪ[Ы™H[ИY[›ЬИ[H[[›Л€ЋВ‚€›Ь€
ЫЫњЭ›Щљ[RYЩ€\ќXЪ\[ќYКHВ€ЫЫњЭЭY[ќ›Щљ[HHШШ[ЭY[ќ›Щљ[\Л™љ[™
›Щљ[HO€›Щљ[Kњ›Щљ[RYOOH›Щљ[RY
NВ€Y€
ЭY[ќ›Щљ[H	‰€ЭY[ќ›Щљ[KњЭY[ќЭ]\ИOOH	ШXЭ]™IКHВ€ЫЫњЭ[YHH›Щљ[\Л™љ[™
›Щљ[HO€›Щљ[KљYOOH›Щљ[RY
OЛ›[YH	С\ЭH[[›ЙОВ€™]\›€	Ы[Y_H\Э0иH]\ШYЛ€™X]]™K[ИH0и\™XHH[[›ЬИ\H[ЫpлK[И[H[XH›ЭH][KВ€B€B‚€Y€
ЪЭ[™\ЭљXЭ›Ы”ЫШЪ[Х[Y\И	‰€Э\ќ[YH	‰€X]Z[X›U[Y\Лљ[ЫY\КЭ\ќ[YJJHВ€™]\›€’Ь°и\љ[И[ќ°и[YИ\H][\И\[\ИЫЫH°иЫЛ\рмШЪ[ЬЛЩ\[™[ќ\Л€\ШЫЫHX[љ0иИ
ZLLљ
HЭH›Ъ]H
Њ
КK€ЋВ€B‚€ЛИЪXЪИSЩ[XЭY›Ы‹\ЫШЪ[ИЭY[ќИ›Ь€^[Y[ќЭ]\В€›Ь€
ЫЫњЭЪYЩ€›Ы”ЫШЪ[ФЭY[ќYКHВ€ЫЫњЭЭY[ќHШШ[›Ы”ЫШЪ[ФЭY[ќЛ™љ[™
ИO€ЛљYOOHЪY
NВ€Y€
\ЭY[ќ
HЫЫќ[ќYNВ€ЫЫњЭЭ]\ИHЭY[ќњЭY[ќЭ]\И
ЭY[ќљ\РXЭ]™HOOH[ЩHИ	Ь]\ЩY	И€	ШXЭ]™IКNВ€Y€
Э]\ИOOH	ШXЭ]™IКH™]\›€	ЬЭY[ќ›[Y_H\Э0иH]\ШYЛ€™X]]™K[ИH0и\™XHH[[›ЬЛВ€ЛИ\[™[ќ\И°иЫИ™XЪ\Ш[HH[YpйриЫИHYШ[Y[ќВ€Y€
ЭY[ќњЭY[ќ\HOOH	Щ\[™[ќ	КHЫЫќ[ќYNВ€ЫЫњЭXШЩ\ЬС]HHВ€™[][ЫњЪ\€	Ы›Ы‹\ЫШЪ[ЙИ\ИЫЫњЭ€Э]\Л€[•\N€ЭY[ќњ[•\K€[”Э]\О€ЭY[ќњ[”Э]\Л€^\][Ы‘]N€ЭY[ќ›X\Э\‘^\][Ы‘]K€NВ€Y€
XШ[”\ќXЪ\]R[ђЫ\ЬКXШЩ\ЬС]K]JJHВ€ЫЫњЭШ\™Э]\ИHЩ]Ш\™Э]\КXШЩ\ЬС]K]JNВ€™]\›€Ш\™Э]\ИOOH	Щ^\™Y	В€ИШ\™Y[њШ[H	ЬЭY[ќ›[Y_H™[ЪYЛ€™YЪ\Э™HH™[›ЭpйриЫИ[ќ\ИHЫЫ™љ\›X\€H][K€€	ЬЭY[ќ›[Y_H\Э0иHЩ[HYШ[Y[ќИ°и[YИИЫX™H\H\ЭH][KВ€B€B€B€™]\›€ќ[В€NВ‚€ЫЫњЭ[™S™^H

HO€В€Щ]\њ›ЬЉќ[
NВ€Y€
Э\OOHJHВ€Щ]Э\
ЉNВ€H[ЩHY€
Э\OOHЉHВ€ЫЫњЭ\њ€H[Y]TЭ\Љ
NВ€Y€
\њЉHИЩ]\њ›ЬЉ\њЉNИ™]\›ЋИB€Щ]Э\
КNВ€B€NВ‚€ЫЫњЭ[™PXЪИH

HO€В€Щ]\њ›ЬЉќ[
NВ€Щ]Э\
ИO€X]›X^
KИHJJNВ€NВ‚€ЫЫњЭ[™PЫЫ™љ\›HH\Ю[И

HO€В€Y€
Ш]љ[™КH™]\›ЋВ‚€ЫЫњЭ\њ€H[Y]TЭ\К
NВ€Y€
\њЉHИЩ]\њ›ЬЉ\њЉNИ™]\›ЋИB‚€ЫЫњЭ[™[YHHYZ[ќ]\КЭ\ќ[YK\][ЫЉNВ‚€ЛИЫЫ™›XЭЪXЪЛ‹‹‚€ЫЫњЭЫЫ™›XЭ[™Ф™\Щ\ќ][ЫњИH^\Э[™Ф™\Щ\ќ][ЫњЛ™љ[\Љ€O€В€Y€
\СY]	‰€‹љYOOH[љ]X[]OЛљY
H™]\›€[ЩNВ€Y€
‹ЫЭ\ќYOOHЫЭ\ќY‹™]HOOH]H‹њЭ]\ИOOH	ШШ[Щ[Y	КH™]\›€[ЩNВ€™]\›€ЪXЪУЭ™\›\
Э\ќ[YK[™[YK‹њЭ\ќ[YK‹™[™[YJNВ€JNВ‚€Y€
ЫЫ™›XЭ[™Ф™\Щ\ќ][ЫњЛ›[™Э€
HВ€ЫЫњЭ[[Y\О€Эљ[™ЦЧHHЧNВ€ЫЫ™›XЭ[™Ф™\Щ\ќ][ЫњЛ™›Ь‘XXЪ
€O€В€‹њ\ќXЪ\[ќYЛ™›Ь‘XXЪ
YO€В€ЫЫњЭ[YHH›Щљ[\Л™љ[™
HO€KљYOOHY
OЛ›[YNВ€Y€
[YJH[[Y\Лњ\Ъ
[YJNВ€JNВ€Y€
‹™ЭY\Э[YJH[[Y\Лњ\Ъ
	Ь‹™ЭY\Э[Y_H
ЫЫќљYYКX
NВ€ЛИ‹‹€
Ъ[\YљYYЩЪXИ›Ь€њ™]љ]KX]Ъ\ИЬљYЪ[[
H‹‹‚€JNВ€ЫЫњЭ[Y\ФЭљ[™ИH\њ^K™њ›ЫJ™]ИЩ]
[[Y\КJKљ›Ъ[Љ	Л	КNВ€Y€
X]ШZ]ЫЫ™љ\›JВ€Ы™N€	ЭШ\›љ[™ЙЛ€]N€	РЪЬ]YHHЬ°и\љ[ЙЛ€\ШЬљ\[ЫЋ€	С\Э\И]]\И°иH0к›HЫЫ\›ЫZ\ЬЫИ™\ЭHЬ°и\љ[Л€0иH\HX\Ш\€Y\Ы[И\ЬЪ[K‰Л€ЫЫњЩ\]Y[Щ\О€Ы[Y\ФЭљ[™ЧK€ЫЫ™љ\›SX™[€	УX\Ш\€\ЬЪ[HY\Ы[ЙЛ€Ш[Щ[X™[€	С\ШЫЫ\€Э]›ИЬ°и\љ[ЙЛ€JJH™]\›ЋВ€B‚€ЫЫњЭ\љ]™YЭY[ќ\HH\HOOH	Р][IВ€И
\ќXЪ\[ќYЛ›[™Э€	‰€›Ы”ЫШЪ[ФЭY[ќYЛ›[™ЭOOH€И	ЬЫШЪ[ЙВ€€
\ќXЪ\[ќYЛ›[™ЭOOH	‰€›Ы”ЫШЪ[ФЭY[ќYЛ›[™Э€И	Ы›Ы‹\ЫШЪ[ЙИ€[™Yљ[™Y
JB€€[™Yљ[™YВ€ЫЫњЭ\љ]™Y›Ы”ЫШЪ[ФЭY[ќYH\HOOH	Р][IИ	‰€›Ы”ЫШЪ[ФЭY[ќYЛ›[™ЭOOHB€И›Ы”ЫШЪ[ФЭY[ќYЦМB€€[™Yљ[™YВ‚€ЫЫњЭ™]Ф™\О€™\Щ\ќ][Ы€HВ€Y€[љ]X[]OЛљY—ЙС]K››ЭК
_X€\K]KЭ\ќ[YK[™[YKЫЭ\ќY€Ь™X]Ь’Y€[љ]X[]OЛЬ™X]Ь’YЭ\њ™[ќ\Щ\‹љY€\ќXЪ\[ќYЛ€ЭY\Э[YN€\СЭY\ЭИЭY\Э[YH€[™Yљ[™Y€ЭY\Э™\ЬЫњЪX›RY€\СЭY\ЭИЭY\Э™\ЬЫњЪX›RY€[™Yљ[™Y€›Щ™\ЬЫЬ’Y€\HOOH	Р][IИИЭ\њ™[ќ›Щ™\ЬЫЬ’Y€[™Yљ[™Y€ЭY[ќ\N€\љ]™YЭY[ќ\K€›Ы”ЫШЪ[ФЭY[ќY€\љ]™Y›Ы”ЫШЪ[ФЭY[ќY€›Ы”ЫШЪ[ФЭY[ќYО€\HOOH	Р][IИИ›Ы”ЫШЪ[ФЭY[ќYИ€ЧK€ШњЩ\ќ][ЫЋ€ШњЩ\ќ][Ы€[™Yљ[™Y€Э]\О€[љ]X[]OЛњЭ]\И	ШXЭ]™IВ€NВ€Щ]Ш]љ[™КќYJNВ€ћHВ€]ШZ]Ы”Ш]™J™]Ф™\КNВ€Hљ[[HВ€Щ]Ш]љ[™К[ЩJNВ€B€NВ‚€™]\›€Ь™X]TЬќ[
€]€Ы\ЬУ[YOH™љ^Y[њЩ]L™Л\ЭЫ™KNLНЊ‹NNNH›^][\ЛY[™ЫNљ][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€LЫNњMXЪЩ›ЬX›\‹[YЏ‚€]€Ы\ЬУ[YO^Ш™Л]Ъ]H›Э[™Y]LЮЫNњ›Э[™YLЮЪYЭЛLћ›^›^XЫЫX^ZVОLљHЛYќ[X^]Л[И[њЪ][Ы‹X[\][Ы‹LМ[љ[X]K\ЫYKZ[O‚‚€ЛК€XY\€Ъ]Э\И
‹ЯB€]€Ы\ЬУ[YOHњMH›Ь™\‹X€›Ь™\‹\ЭЫ™KLL›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€™Л\ЭЫ™KML›Э[™Y]LЮЏ‚€]Џ‚€ИЫ\ЬУ[YOHќ^^›ЫќX›Ы^\ЭЫ™KNЏћЪ\СY]И	СY]\€™\Щ\ќIИ€	У›ЭH™\Щ\ќIЯOЪП‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€Ш\L€]LHЏ‚€ЦМK‹ЧK›X\
ИO€
€]€Щ^O^ЬЯHЫ\ЬУ[YO^ШLKЌH›Э[™YYќ[[њЪ][Ы‹X[	ЬЭ\ЏHИИ	ЭЛM€™Л\ШZXњ›ЛML	И€	ЭЛL€™Л\ЭЫ™KLЊ	ЯXHП‚€
J_B€Ь[€Ы\ЬУ[YOHќ^VМLH›ЫќX›Ы^\ЭЫ™KM\\Ш\ЩH[LHЏ‚€\ЬЫИЬЭ\HHВ€ЬЬ[Џ‚€Щ]Џ‚€Щ]Џ‚€ќ]Ы€ЫђЫXЪП^ЫЫђЫЬЩ_HЫ\ЬУ[YOHњL€^\ЭЫ™KMЭ™\Ћ™Л\ЭЫ™KLL›Э[™YYќ[[њЪ][Ы‹XЫЫЬњИЏ‚€Ъ^™O^МЊHП‚€Шќ]ЫЏ‚€Щ]Џ‚‚€Щ\њ›Ь€	‰€
€]€Ы\ЬУ[YOH›^MH]M™Л\™YML^\™YMЊ^^ИLИ›Э[™Y^›^Ш\L€][\ЛXЩ[ќ\€›ЫќX›Ы›Ь™\€›Ь™\‹\™YLLЏ‚€[\ќЪ\ЫHЪ^™O^МMџHП€Щ\њ›ЬџB€Щ]Џ‚€
_B‚€]€Ы\ЬУ[YOHњMHЭ™\™›ЭЛ^KX]]И›^LHЏ‚‚€ЛК€ХTN€TH
‹ЯB€ЬЭ\OOHH	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KMЏ‚€Ы\ЬУ[YOHќ^\ЫH^\ЭЫ™KML›Ыќ[YY][HЏ“И]YH›Шрк€ZHX\Ш\€Ъ™OПЬ‚‚€ќ]Ы‚€ЫђЫXЪП^К
HO€В€Щ]\J	Ф^IКNВ€Щ]ЫЭ\ќY
	ЙКNВ€Y€
Z\СY]
HВ€Щ]\ќXЪ\[ќYКШЭ\њ™[ќ\Щ\‹љYJNВ€Щ]›Ы”ЫШЪ[ФЭY[ќYКЧJNВ€B€_B€Ы\ЬУ[YO^ШЛYќ[M€›Э[™YLћ›Ь™\‹L€^[Yќ[њЪ][Ы‹X[Ь›Э\	Э\HOOH	Ф^IИИ	Ш›Ь™\‹\ШZXњ›ЛML™Л\ШZXњ›ЛML	И€	Ш›Ь™\‹\ЭЫ™KLL™Л]Ъ]HЭ™\Ћ›Ь™\‹\ШZXњ›ЛLЊЭ™\Ћ™Л\ЭЫ™KML	ЯXB€‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€X‹L€Џ‚€]€Ы\ЬУ[YO^ШЛLL€LL€›Э[™YYќ[›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€	Э\HOOH	Ф^IИИ	Ш™Л\ШZXњ›ЛML^]Ъ]HЪYЭЛ[ИЪYЭЛ\ШZXњ›ЛLЊ	И€	Ш™Л\ЭЫ™KLL^\ЭЫ™KM	ЯXO‚€›ЬHЪ^™O^МЌHП‚€Щ]Џ‚€Э\HOOH	Ф^IИ	‰€]€Ы\ЬУ[YOHќЛM€M€›Э[™YYќ[™Л\ШZXњ›ЛML^]Ъ]H›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€ЏЏЪXЪИЪ^™O^МMHЭ›ЪЩUЪY^НHПЏЩ]ЏџB€Щ]Џ‚€Ы\ЬУ[YOHќ^[И›ЫќX›XЪИ^\ЭЫ™KNЏ”^H[Z\ЭЬЫПЪ‚€Ы\ЬУ[YOHќ^^И^\ЭЫ™KML]LH›Ыќ[YY][HЏ”™\Щ\ќ™H[XH]XYH\H›ЩШ\€ЫЫH[ZYЫЬЛ€\›Z]HЫЫќљYYЬИ
^H\ЩJKЏЬ‚€Шќ]ЫЏ‚‚€ШШ[ђЬ™X]P][H	‰€
€ќ]Ы‚€ЫђЫXЪП^К
HO€В€Щ]\J	Р][IКNВ€Y€
Z\СY]
HВ€Щ]\ќXЪ\[ќYКЧJNВ€Щ]›Ы”ЫШЪ[ФЭY[ќYКЧJNВ€B€ЫЫњЭ\YRYHЫЭ\ќЛ™љ[™
ИO€›Ь›X[^™PЫЭ\ќ\JЛќ\JKљ[ЫY\К	Ь\YIКJOЛљY	ЙОВ€Щ]ЫЭ\ќY
\YRY
NВ€_B€Ы\ЬУ[YO^ШЛYќ[M€›Э[™YLћ›Ь™\‹L€^[Yќ[њЪ][Ы‹X[Ь›Э\	Э\HOOH	Р][IИИ	Ш›Ь™\‹\ШZXњ›ЛML™Л\ШZXњ›ЛML	И€	Ш›Ь™\‹\ЭЫ™KLL™Л]Ъ]HЭ™\Ћ›Ь™\‹\ШZXњ›ЛLЊЭ™\Ћ™Л\ЭЫ™KML	ЯXB€‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€X‹L€Џ‚€]€Ы\ЬУ[YO^ШЛLL€LL€›Э[™YYќ[›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€	Э\HOOH	Р][IИИ	Ш™Л\ШZXњ›ЛML^]Ъ]HЪYЭЛ[ИЪYЭЛ\ШZXњ›ЛLЊ	И€	Ш™Л\ЭЫ™KLL^\ЭЫ™KM	ЯXO‚€\Щ\ђЫЩИЪ^™O^МЌHП‚€Щ]Џ‚€Э\HOOH	Р][IИ	‰€]€Ы\ЬУ[YOHќЛM€M€›Э[™YYќ[™Л\ШZXњ›ЛML^]Ъ]H›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€ЏЏЪXЪИЪ^™O^МMHЭ›ЪЩUЪY^НHПЏЩ]ЏџB€Щ]Џ‚€Ы\ЬУ[YOHќ^[И›ЫќX›XЪИ^\ЭЫ™KNЏђ][OЪ‚€Ы\ЬУ[YOHќ^^И^\ЭЫ™KML]LH›Ыќ[YY][HЏ”™\Щ\ќ™HЬ°и\љ[И\H][\ИЫЫH›Щ™\ЬЫЬ‹€^Ы\Ъ]›И\H]XYH°и\YKЏЬ‚€Шќ]ЫЏ‚€
_B€Щ]Џ‚€
_B‚€ЛК€ХTЋ€URSИ
‹ЯB€ЬЭ\OOH€	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KMHЏ‚€]€Ы\ЬУ[YOH™ЬљYЬљYXЫЫЛL€Ш\MЏ‚€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ‘]OЫX™[‚€]€Ы\ЬУ[YOHњ™[]]™HЏ‚€[њ]€\OH™]H‚€[YO^Щ]_B€ЫђЪ[™ЩO^ЩHO€ИЩ]]JKќ\™Щ]ќ[YJNИЩ]\њ›ЬЉќ[
NИ_B€Ы\ЬУ[YOHќЛYќ[LИ‹L€KLИ™Л\ЭЫ™KML›Ь™\‹[›Ы™H›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH›ЫќX›Ы^\ЭЫ™KMМ‚€П‚€Щ]Џ‚€Щ]Џ‚€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ”]XYOЫX™[‚€Э\HOOH	Р][IИИ
€]€Ы\ЬУ[YOHќЛYќ[LИKLИ™Л\ЭЫ™KLL›Ь™\‹[›Ы™H›Э[™Y^^\ЫH›ЫќX›Ы^\ЭЫ™KML›^][\ЛXЩ[ќ\€Ш\L€Э\њЫЬ‹[›ЭX[ЭЩYЏ‚€ЪXЪИЪ^™O^МMџHЫ\ЬУ[YOHќ^\ШZXњ›ЛML€П€]XYH°и\YH
]]Ыpи]XЫКB€Щ]Џ‚€
H€
€Щ[XЭ€Ы\ЬУ[YOHќЛYќ[LИKLИ™Л\ЭЫ™KML›Ь™\‹[›Ы™H›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH›ЫќX›Ы^\ЭЫ™KMМ‚€[YO^ШЫЭ\ќYB€ЫђЪ[™ЩO^ЩHO€ИЩ]ЫЭ\ќY
Kќ\™Щ]ќ[YJNИЩ]\њ›ЬЉќ[
NИ_B€‚€Ь[Ы€[YOH€Џ”Щ[XЪ[Ы™K‹‹ЏЫЬ[ЫЏ‚€ШЫЭ\ќВ€™љ[\ЉИO€Лљ\РXЭ]™JB€›X\
ИO€Ь[Ы€Щ^O^ШЛљYH[YO^ШЛљYOћШЛ›[Y_H
ШЛќ\_JOЫЬ[ЫЏЉ_B€ЬЩ[XЭ‚€
_B€Щ]Џ‚€Щ]Џ‚‚€]€Ы\ЬУ[YOH™ЬљYЬљYXЫЫЛL€Ш\MЏ‚€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ‘\pйриЫПЫX™[‚€]€Ы\ЬУ[YOH™›^™Л\ЭЫ™KML›Э[™Y^LHШ\LHЏ‚€ЦММЊLLЊK›X\
O€В€Y€
\HOOH	Ф^IИ	‰€OOHМ
H™]\›€ќ[В€Y€
\HOOH	Р][IИ	‰€OOHМ
H™]\›€ќ[В€™]\›€
€ќ]Ы‚€Щ^O^ЩB€ЫђЫXЪП^К
HO€Щ]\][ЫЉ
_B€Ы\ЬУ[YO^Ш›^LHKL€›Э[™Y[И^^И›ЫќX›Ы[њЪ][Ы‹X[	Щ\][Ы€OOHИ	Ш™Л]Ъ]H^\ШZXњ›ЛMМЪYЭЛ\ЫIИ€	Э^\ЭЫ™KMЭ™\Ћќ^\ЭЫ™KMЊ	ЯXB€‚€Щ[B€Шќ]ЫЏ‚€
NВ€J_B€Щ]Џ‚€Щ]Џ‚€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ’Ь°и\љ[ИH[°лXЪ[ПЫX™[‚€Щ[XЭ€[YO^ЬЭ\ќ[Y_B€ЫђЪ[™ЩO^ЩHO€ИЩ]Э\ќ[YJKќ\™Щ]ќ[YJNИЩ]\њ›ЬЉќ[
NИ_B€Ы\ЬУ[YOHќЛYќ[LИKLИ™Л\ЭЫ™KML›Ь™\‹[›Ы™H›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH›ЫќX›Ы^\ЭЫ™KMМ\X\[ЩK[›Ы™H‚€‚€Ь[Ы€[YOH€Џ”Щ[XЪ[Ы™K‹‹ЏЫЬ[ЫЏ‚€Ш]Z[X›U[Y\Л›X\
O€Ь[Ы€Щ^O^ЭH[YO^ЭOћЭOЫЬ[ЫЏЉ_B€ЬЩ[XЭ‚€Щ]Џ‚€Щ]Џ‚‚€]€Ы\ЬУ[YOH™ЛX›YKMLM›Э[™Y^›Ь™\€›Ь™\‹X›YKLL›^Ш\LИ^X›YKNЏ‚€[™›ИЫ\ЬУ[YOHњЪљ[љЛL€Ъ^™O^МNHП‚€Ы\ЬУ[YOHќ^^И›Ыќ[YY][HXY[™Л\™[^YЏ‚€Э\HOOH	Ф^IВ€И’›ЩЫЬИ[Z\ЭЬЫЬИY°иЫИ0к›H\pйриЫИHЊLLЊZ[‹€]XY\ИHШZXњ›ИриЫИH™Y™\°к›ЪXK€‚€€\HOOH	Р][IИ	‰€ЪЭ[™\ЭљXЭ›Ы”ЫШЪ[Х[Y\В€Иђ][\ИЩ[HрмШЪ[ЬО€\›Z]Y\И[HX[љ0иИ
ZLLљ
HЭH0и›Ъ]H
Њ
КK€\pйриЫИHМZ[€H]XYH°и\YK€‚€€ђ][\ИЫЫHрмШЪ[ЬО€\›Z]Y\И[H]X[]Y\€Ь°и\љ[Л€\pйриЫИHМZ[€H]XYH°и\YK€џB€Ь‚€Щ]Џ‚€Щ]Џ‚€
_B‚€ЛК€ХTО€T•PТTS•И
‹ЯB€ЬЭ\OOHИ	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KMH[љ[X]KZ[€YKZ[€ЫYKZ[‹Yњ›ЫK\љYЪM\][Ы‹LМЏ‚‚€ЛК€VHСТPИ
‹ЯB€Э\HOOH	Ф^IИ	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KMЏ‚€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹L€Џ”]Y[HZH›ЩШ\ЏИ
рмШЪ[ЬКOЫX™[‚€]€Ы\ЬУ[YOH™ЬљYЬљYXЫЫЛLHШ\L€X^ZVМЌHЭ™\™›ЭЛ^KX]]И‹LHЏ‚€ќ]Ы‚€ЫђЫXЪП^К
HO€ЩЩЫT\ќXЪ\[ќ
Э\њ™[ќ\Щ\‹љY
_B€Ы\ЬУ[YO^Ш›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€LИ›Э[™Y^›Ь™\€[њЪ][Ы‹X[	Ь\ќXЪ\[ќYЛљ[ЫY\КЭ\њ™[ќ\Щ\‹љY
HИ	Ш™Л\ШZXњ›ЛML›Ь™\‹\ШZXњ›ЛML	И€	Ш™Л]Ъ]H›Ь™\‹\ЭЫ™KLL	ЯXB€‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€Ш\LИЏ‚€]€Ы\ЬУ[YO^ШЛNN›Э[™YYќ[›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€›ЫќX›Ы^^И	Ь\ќXЪ\[ќYЛљ[ЫY\КЭ\њ™[ќ\Щ\‹љY
HИ	Ш™Л\ШZXњ›ЛML^]Ъ]IИ€	Ш™Л\ЭЫ™KLL^\ЭЫ™KML	ЯXO‚€ШЭ\њ™[ќ\Щ\‹›[YVМ_B€Щ]Џ‚€Ь[€Ы\ЬУ[YOHќ^\ЫH›ЫќX›Ы^\ЭЫ™KMМЏ‘]H
ШЭ\њ™[ќ\Щ\‹›[Y_JOЬЬ[Џ‚€Щ]Џ‚€Ь\ќXЪ\[ќYЛљ[ЫY\КЭ\њ™[ќ\Щ\‹љY
H	‰€ЪXЪИЪ^™O^МMџHЫ\ЬУ[YOHќ^\ШZXњ›ЛMЊ€ПџB€Шќ]ЫЏ‚‚€Ш]Z[X›T\ќ™\њЛ›X\
HO€
€ќ]Ы‚€Щ^O^ЭKљYB€ЫђЫXЪП^К
HO€ЩЩЫT\ќXЪ\[ќ
KљY
_B€Ы\ЬУ[YO^Ш›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€LИ›Э[™Y^›Ь™\€[њЪ][Ы‹X[	Ь\ќXЪ\[ќYЛљ[ЫY\КKљY
HИ	Ш™Л\ШZXњ›ЛML›Ь™\‹\ШZXњ›ЛML	И€	Ш™Л]Ъ]H›Ь™\‹\ЭЫ™KLL	ЯXB€‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€Ш\LИЏ‚€ЭK]]\€И[YИЬП^ЭK]]\џHЫ\ЬУ[YOHќЛNN›Э[™YYќ[Шљ™XЭXЫЭ™\€™Л\ЭЫ™KLL€П€€
€]€Ы\ЬУ[YO^ШЛNN›Э[™YYќ[›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€›ЫќX›Ы^^И™Л\ЭЫ™KLL^\ЭЫ™KMLO‚€ЭK›[YVМ_B€Щ]Џ‚€
_B€Ь[€Ы\ЬУ[YOHќ^\ЫH›ЫќX›Ы^\ЭЫ™KMМЏћЭK›[Y_OЬЬ[Џ‚€Щ]Џ‚€Ь\ќXЪ\[ќYЛљ[ЫY\КKљY
H	‰€ЪXЪИЪ^™O^МMџHЫ\ЬУ[YOHќ^\ШZXњ›ЛMЊ€ПџB€Шќ]ЫЏ‚€
J_B€Щ]Џ‚€Щ]Џ‚‚€]€Ы\ЬУ[YOH™Л\ЭЫ™KMLM›Э[™Y^›Ь™\€›Ь™\‹\ЭЫ™KLLЏ‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€X‹LИЏ‚€Ь[€Ы\ЬУ[YOHќ^\ЫH›ЫќX›Ы^\ЭЫ™KNЏђЫЫќљYYИ
^H\ЩJOЬЬ[Џ‚€]€ЫђЫXЪП^К
HO€Щ]\СЭY\Э
Z\СЭY\Э
_HЫ\ЬУ[YO^ШЛLL€MИ›Э[™YYќ[LHЭ\њЫЬ‹\Ъ[ќ\€[њЪ][Ы‹XЫЫЬњИ	Ъ\СЭY\ЭИ	Ш™Л\ШZXњ›ЛML	И€	Ш™Л\ЭЫ™KLМ	ЯXO‚€]€Ы\ЬУ[YO^ШЛMHMH™Л]Ъ]H›Э[™YYќ[ЪYЭЛ\ЫH[њЪ][Ы‹][њЩ›Ь›H	Ъ\СЭY\ЭИ	Э[њЫ]K^MIИ€	Э[њЫ]K^L	ЯXHП‚€Щ]Џ‚€Щ]Џ‚€Ъ\СЭY\Э	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KLИЏ‚€[њ]€\OHќ^‚€XЩZЫ\ЏH“›ЫYHИЫЫќљYYИ‚€[YO^ЩЭY\Э[Y_B€ЫђЪ[™ЩO^ЩHO€Щ]ЭY\Э[YJKќ\™Щ]ќ[YJ_B€Ы\ЬУ[YOHќЛYќ[LИKL€™Л]Ъ]H›Ь™\€›Ь™\‹\ЭЫ™KLЊ›Э[™Y[И^\ЫH‚€П‚€Щ[XЭ€[YO^ЩЭY\Э™\ЬЫњЪX›RYB€ЫђЪ[™ЩO^ЩHO€Щ]ЭY\Э™\ЬЫњЪX›RY
Kќ\™Щ]ќ[YJ_B€Ы\ЬУ[YOHќЛYќ[LИKL€™Л]Ъ]H›Ь™\€›Ь™\‹\ЭЫ™KLЊ›Э[™Y[И^\ЫH‚€‚€Ь[Ы€[YO^ШЭ\њ™[ќ\Щ\‹љYO”™\ЬЫњри]™[€]OЫЬ[ЫЏ‚€Ш]Z[X›T\ќ™\њЛ›X\
HO€Ь[Ы€Щ^O^ЭKљYH[YO^ЭKљYO”™\ЬЫњри]™[€ЭK›[Y_OЫЬ[ЫЏЉ_B€ЬЩ[XЭ‚€Щ]Џ‚€
_B€Щ]Џ‚€Щ]Џ‚€
_B‚€ЛК€USHСТPИ
‹ЯB€Э\HOOH	Р][IИ	‰€
€]€Ы\ЬУ[YOHњЬXЩK^KMЏ‚€ШЭ\њ™[ќ\Щ\‹њ›ЫHOOH	ШYZ[‰И	‰€
€]Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ”›Щ™\ЬЫЬЏЫX™[‚€Щ[XЭ€Ы\ЬУ[YOHќЛYќ[LИKLИ™Л\ЭЫ™KML›Ь™\‹[›Ы™H›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH›ЫќX›Ы^\ЭЫ™KMМ‚€[YO^ЬЩ[XЭY›Щ™\ЬЫЬ’YB€ЫђЪ[™ЩO^КJHO€Щ]Щ[XЭY›Щ™\ЬЫЬ’Y
Kќ\™Щ]ќ[YJ_B€‚€Ь[Ы€[YOH€Џ”Щ[XЪ[Ы™K‹‹ЏЫЬ[ЫЏ‚€Ь›Щ™\ЬЫЬњЛ™љ[\ЉO€љ\РXЭ]™JK›X\
O€
€Ь[Ы€Щ^O^ЬљYH[YO^ЬљYOћЬ›[Y_OЫЬ[ЫЏ‚€
J_B€ЬЩ[XЭ‚€Щ]Џ‚€
_B‚€]Џ‚€]€Ы\ЬУ[YOH™›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€X‹LKЌHЏ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHЏђ[[›ЬПЫX™[‚€ќ]Ы€\OHќ]Ы€€ЫђЫXЪП^К
HO€Щ]ЪЭУ™]ФЭY[ќ
ќYJ_HЫ\ЬУ[YOHќ^^И›ЫќX›Ы^\ШZXњ›ЛMМЭ™\Ћќ^\ШZXњ›ЛNL›^][\ЛXЩ[ќ\€Ш\LHЏ‚€\Щ\”\ИЪ^™O^МMHП€›Э›И[[›В€Шќ]ЫЏ‚€Щ]Џ‚€]€Ы\ЬУ[YOHњ™[]]™HX‹L€Џ‚€ЩX\ЪЪ^™O^МMџHЫ\ЬУ[YOHXњЫЫ]HYќLИЬLKМ€][њЫ]K^KLKМ€^\ЭЫ™KM€П‚€[њ]€[YO^ЬЭY[ќЩX\ЪB€ЫђЪ[™ЩO^Щ]™[ќO€Щ]ЭY[ќЩX\Ъ
]™[ќќ\™Щ]ќ[YJ_B€XЩZЫ\ЏHђќ\ШШ\€[[›Л‹‹€‚€Ы\ЬУ[YOHќЛYќ[NH‹LИKLИ™Л\ЭЫ™KML›Ь™\€›Ь™\‹\ЭЫ™KLL›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH‚€П‚€Щ]Џ‚€]€Ы\ЬУ[YOH›X^ZMM€Э™\™›ЭЛ^KX]]И›Э[™Y^›Ь™\€›Ь™\‹\ЭЫ™KLL]љYK^H]љYK\ЭЫ™KLLЏ‚€Щљ[\™YЭY[ќЬ[ЫњЛ›[™ЭOOHИ
€Ы\ЬУ[YOHњLИ^^И^\ЭЫ™KMLЏ“™[љ[H[[›И[ЫЫќYЛ€\ЩH8 '›Э›И[[›ш 'H\HШY\Э°иK[ЛЏЬ‚€
H€љ[\™YЭY[ќЬ[ЫњЛ›X\
ЭY[ќO€В€ЫЫњЭЩ[XЭYHЭY[ќљЪ[™OOH	ЬЫШЪ[ЙВ€И\ќXЪ\[ќYЛљ[ЫY\КЭY[ќљY
B€€›Ы”ЫШЪ[ФЭY[ќYЛљ[ЫY\КЭY[ќљY
NВ€™]\›€
€ќ]Ы‚€Щ^O^Ш	ЬЭY[ќљЪ[™N‰ЬЭY[ќљYXB€\OHќ]Ы€‚€ЫђЫXЪП^К
HO€ЩЩЫTЭY[ќЬ[ЫЉЭY[ќ
_B€Ы\ЬУ[YO^ШЛYќ[›^][\ЛXЩ[ќ\€ќ\ЭYћKX™]ЩY[€Ш\LИLИKL‹ЌH^[YќЭ™\Ћ™Л\ЭЫ™KML	ЬЩ[XЭYИ	Ш™Л\ШZXњ›ЛMLНМ	И€	Ш™Л]Ъ]IЯXB€‚€Ь[€Ы\ЬУ[YOH›Z[‹]ЛLЏ‚€Ь[€Ы\ЬУ[YOH›ШЪИ^\ЫH›Ыќ\Щ[ZX›Ы^\ЭЫ™KNќ[Ш]HЏћЬЭY[ќ›[Y_OЬЬ[Џ‚€Ь[€Ы\ЬУ[YOH›ШЪИ^^И^\ЭЫ™KMLќ[Ш]HЏ‚€ЬЭY[ќ›]™[	ФЩ[H°л]™[	ЯH0­ИЬЭY[ќњЩXЫЫ™\ћ_B€ЬЭY[ќШ\™Э]\ИOOH	Щ^\™Y	ИИ	И0­ИШ\™™[ЪYЙИ€	ЙЯB€ЬЭY[ќШ\™Э]\ИOOH	Ъ[XЭ]™IИИ	И0­ИЩ[HШ\™°и[YЙИ€	ЙЯB€ЬЬ[Џ‚€ЬЬ[Џ‚€ЬЩ[XЭY	‰€ЪXЪИЪ^™O^МMЯHЫ\ЬУ[YOHќ^\ШZXњ›ЛMЊЪљ[љЛL€ПџB€Шќ]ЫЏ‚€
NВ€J_B€Щ]Џ‚€]€Ы\ЬУ[YOH™›^›^]Ь\Ш\L€]LИЏ‚€Ь\ќXЪ\[ќYЛ›X\
YO€В€ЫЫњЭЭY[ќH›Щљ[\Л™љ[™
›Щљ[HO€›Щљ[KљYOOHY
NВ€Y€
\ЭY[ќ
H™]\›€ќ[В€ЫЫњЭ]™[HШШ[ЭY[ќ›Щљ[\Л™љ[™
›Щљ[HO€›Щљ[Kњ›Щљ[RYOOHY
OЛќXЪљXШ[]™[В€™]\›€ќ]Ы€Щ^O^ЪYH\OHќ]Ы€€ЫђЫXЪП^К
HO€ЩЩЫTЫШЪ[КY
_HЫ\ЬУ[YOH™Л\ЭЫ™KLL^\ЭЫ™KMМLИKLH›Э[™YYќ[^^И›Ыќ\Щ[ZX›Ы›^][\ЛXЩ[ќ\€Ш\LHЏћЬЭY[ќ›[Y_H0­ИЫ]™[	ФЩ[H°л]™[	ЯHЪ^™O^МLџHПЏШќ]ЫЏЋВ€J_B€Ы›Ы”ЫШЪ[ФЭY[ќYЛ›X\
YO€В€ЫЫњЭЭY[ќHШШ[›Ы”ЫШЪ[ФЭY[ќЛ™љ[™
][HO€][KљYOOHY
NВ€Y€
\ЭY[ќ
H™]\›€ќ[В€™]\›€ќ]Ы€Щ^O^ЪYH\OHќ]Ы€€ЫђЫXЪП^К
HO€ЩЩЫS›Ы”ЫШЪ[КY
_HЫ\ЬУ[YOH™Л\ЭЫ™KLL^\ЭЫ™KMМLИKLH›Э[™YYќ[^^И›Ыќ\Щ[ZX›Ы›^][\ЛXЩ[ќ\€Ш\LHЏћЬЭY[ќ›[Y_H0­ИЬЭY[ќќXЪљXШ[]™[	ФЩ[H°л]™[	ЯHЪ^™O^МLџHПЏШќ]ЫЏЋВ€J_B€Щ]Џ‚€Щ]Џ‚‚€Ы\ЬУ[YOHќ^^И^\ЭЫ™KML›Ыќ[YY][HЏ‚€Э[H[[›ЬИЩ[XЪ[ЫYЬО€Ь\ќXЪ\[ќYЛ›[™Э
И›Ы”ЫШЪ[ФЭY[ќYЛ›[™ЭB€Ь‚€Щ]Џ‚€
_B‚€ЛК€ШњЩ\ќ][Ы€HЫ›H›Ь€^HЬ€Э\€\\Л“Х›Ь€][H
‹ЯB€Э\HOOH	Р][IИ	‰€
€]€Ы\ЬУ[YOHњL€Џ‚€X™[Ы\ЬУ[YOH›ШЪИ^VМLH›ЫќX›Ы^\ЭЫ™KML\\Ш\ЩHX‹LKЌHЏ“ШњЩ\ќpйрнY\ПЫX™[‚€^\™XB€›ЭЬП^МџB€[YO^ЫШњЩ\ќ][ЫџB€ЫђЪ[™ЩO^ЩHO€Щ]ШњЩ\ќ][ЫЉKќ\™Щ]ќ[YJ_B€XЩZЫ\ЏH‘][\ИYXЪ[ЫZ\Л‹‹€‚€Ы\ЬУ[YOHќЛYќ[LИ™Л\ЭЫ™KML›Ь™\‹[›Ы™H›Э[™Y^Э][™KZY[€›ШЭ\Оњљ[™ЛL€›ШЭ\Оњљ[™Л\ШZXњ›ЛML^\ЫH‚€П‚€Щ]Џ‚€
_B€Щ]Џ‚€
_B€Щ]Џ‚‚€ЛК€›ЫЭ\€ќ]ЫњИ
‹ЯB€]€Ы\ЬУ[YOHњMH›Ь™\‹]›Ь™\‹\ЭЫ™KLL›^Ш\LИ™Л]Ъ]H›Э[™YX‹LЮЏ‚€ЬЭ\€HИ
€ќ]Ы€ЫђЫXЪП^Ъ[™PXЪЯHЫ\ЬУ[YOHњM€KLИ›Э[™Y^›ЫќX›Ы^\ЭЫ™KMLЭ™\Ћ™Л\ЭЫ™KML[њЪ][Ы‹XЫЫЬњИЏ‚€›Ы\‚€Шќ]ЫЏ‚€
H€
€ќ]Ы€ЫђЫXЪП^ЫЫђЫЬЩ_HЫ\ЬУ[YOHњM€KLИ›Э[™Y^›ЫќX›Ы^\ЭЫ™KMЭ™\Ћ™Л\ЭЫ™KML[њЪ][Ы‹XЫЫЬњИЏ‚€Ш[Щ[\‚€Шќ]ЫЏ‚€
_B‚€ЬЭ\ИИ
€ќ]Ы€ЫђЫXЪП^Ъ[™S™^HЫ\ЬУ[YOH™›^LHKLИ™Л\ЭЫ™KN^]Ъ]H›Э[™Y^›ЫќX›ЫЭ™\Ћ™ЛX›XЪИ[њЪ][Ы‹XЫЫЬњИЪYЭЛ[ИXЭ]™NњШШ[KNMH›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€Ш\L€Џ‚€°мЮ[[И\њ›ЭФљYЪЪ^™O^МNHП‚€Шќ]ЫЏ‚€
H€
€ќ]Ы‚€ЫђЫXЪП^Ъ[™PЫЫ™љ\›_B€\ШX›Y^ЬШ]љ[™ЯB€Ы\ЬУ[YO^Ш›^LHKLИ›Э[™Y^›ЫќX›Ы[њЪ][Ы‹XЫЫЬњИЪYЭЛ[ИЪYЭЛ[Ь[™ЩKLЊXЭ]™NњШШ[KNMH›^][\ЛXЩ[ќ\€ќ\ЭYћKXЩ[ќ\€Ш\L€	ЬШ]љ[™ИИ	Ш™Л\ЭЫ™KLМ^\ЭЫ™KMLЭ\њЫЬ‹[›ЭX[ЭЩYЪYЭЛ[›Ы™IИ€	Ш™Л\ШZXњ›ЛMЊ^]Ъ]HЭ™\Ћ™Л\ШZXњ›ЛMМ	ЯXB€‚€ЬШ]љ[™ИИШY\Њ€Ы\ЬУ[YOH[љ[X]K\Ь[€€Ъ^™O^МNHП€€ЪXЪИЪ^™O^МNHПџB€ЬШ]љ[™ИИ	ФШ[[™Л‹‹‰И€	РЫЫ™љ\›X\€™\Щ\ќIЯB€Шќ]ЫЏ‚€
_B€Щ]Џ‚€Щ]Џ‚€Э[™\™[Щ[\УЬ[Џ^ЬЪЭУ™]ФЭY[ќHЫђЫЬЩO^К
HO€Щ]ЪЭУ™]ФЭY[ќ
[ЩJ_O‚€]€Ы\ЬУ[YOH™Л]Ъ]H›Э[™YLћЛYќ[X^]Л[YMHЬXЩK^KMЏ‚€]Џ‚€ИЫ\ЬУ[YOHќ^[И›ЫќX›Ы^\ЭЫ™KNЏ“›Э›И[[›ПЪП‚€Ы\ЬУ[YOHќ^\ЫH^\ЭЫ™KMLЏ“И[[›ИЩ\°иHYXЪ[ЫYИ0и][H]X[ЏЬ‚€Щ]Џ‚€]€Ы\ЬУ[YOH™ЬљYЬљYXЫЫЛLИШ\L€Џ‚€КЙЬЫШЪ[ЙЛ	Ы›Ы‹\ЫШЪ[ЙЛ	Щ\[™[ќ	ЧH\ИЫЫњЭ
K›X\
Ъ[™O€
€ќ]Ы€Щ^O^ЪЪ[™H\OHќ]Ы€€ЫђЫXЪП^К
HO€Щ]™]ФЭY[ќЪ[™
Ъ[™
_HЫ\ЬУ[YO^ШKL€LH›Э[™Y[И^^И›ЫќX›Ы	Ы™]ФЭY[ќЪ[™OOHЪ[™И	Ш™Л\ШZXњ›ЛMЊ^]Ъ]IИ€	Ш™Л\ЭЫ™KLL^\ЭЫ™KMЊ	ЯXO‚€ЪЪ[™OOH	ЬЫШЪ[ЙИИ	ФрмШЪ[ЙИ€Ъ[™OOH	Ы›Ы‹\ЫШЪ[ЙИИ	У°иЫИрмШЪ[ЙИ€	С\[™[ќIЯB€Шќ]ЫЏ‚€
J_B€Щ]Џ‚€Ы™]ФЭY[ќЪ[™OOH	ЬЫШЪ[ЙИИ
€X™[Ы\ЬУ[YOH›ШЪИ^^И›Ыќ\Щ[ZX›Ы^\ЭЫ™KMЊЏ‚€ќ\ШШ\€рмШЪ[И^\Э[ќB€Щ[XЭ[YO^Ы™]УY[X™\’YHЫђЪ[™ЩO^Щ]™[ќO€Щ]™]УY[X™\’Y
]™[ќќ\™Щ]ќ[YJ_HЫ\ЬУ[YOH›]LHЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫHЏ‚€Ь[Ы€[YOH€Џ”Щ[XЪ[Ы™K‹‹ЏЫЬ[ЫЏ‚€Ь›Щљ[\Л™љ[\Љ›Щљ[HO€\УY[X™\Љ›Щљ[JH	‰€›Щљ[Kљ\РXЭ]™HOOH[ЩH	‰€[ШШ[ЭY[ќ›Щљ[\ЛњЫЫYJ][HO€][Kњ›Щљ[RYOOH›Щљ[KљY
JK›X\
›Щљ[HO€
€Ь[Ы€Щ^O^Ь›Щљ[KљYH[YO^Ь›Щљ[KљYOћЬ›Щљ[K›[Y_OЫЬ[ЫЏ‚€
J_B€ЬЩ[XЭ‚€ЫX™[‚€
H€
€]€Ы\ЬУ[YOHњЬXЩK^KLИЏ‚€[њ][YO^Ы™]ФЭY[ќ[Y_HЫђЪ[™ЩO^Щ]™[ќO€Щ]™]ФЭY[ќ[YJ]™[ќќ\™Щ]ќ[YJ_HXЩZЫ\ЏH“›ЫYHЫЫ\]И€Ы\ЬУ[YOHќЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫH€П‚€[њ][YO^Ы™]ФЭY[ќЫ™_HЫђЪ[™ЩO^Щ]™[ќO€Щ]™]ФЭY[ќЫ™J]™[ќќ\™Щ]ќ[YJ_HXЩZЫ\ЏH•[Y›Ы™H
ЬЪ[Ы[
H€Ы\ЬУ[YOHќЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫH€П‚€Ы™]ФЭY[ќЪ[™OOH	Щ\[™[ќ	И	‰€
€‚€Щ[XЭ[YO^Ы™]С\[™[ќ™\ЬЫњЪX›RYHЫђЪ[™ЩO^Щ]™[ќO€Щ]™]С\[™[ќ™\ЬЫњЪX›RY
]™[ќќ\™Щ]ќ[YJ_HЫ\ЬУ[YOHќЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫHЏ‚€Ь[Ы€[YOH€Џ”рмШЪ[И™\ЬЫњри]™[ЫЬ[ЫЏ‚€Ь›Щљ[\Л™љ[\Љ›Щљ[HO€\УY[X™\Љ›Щљ[JH	‰€›Щљ[Kљ\РXЭ]™HOOH[ЩJK›X\
›Щљ[HO€Ь[Ы€Щ^O^Ь›Щљ[KљYH[YO^Ь›Щљ[KљYOћЬ›Щљ[K›[Y_OЫЬ[ЫЏЉ_B€ЬЩ[XЭ‚€Щ[XЭ[YO^Ы™]С\[™[ќ™[][ЫњЪ\HЫђЪ[™ЩO^Щ]™[ќO€Щ]™]С\[™[ќ™[][ЫњЪ\
]™[ќќ\™Щ]ќ[YH\И™[][ЫњЪ\\J_HЫ\ЬУ[YOHќЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫHЏ‚€Ь[Ы€[YOH€Џ•°л[Э[ИЫЫHИ™\ЬЫњри]™[ЫЬ[ЫЏ‚€Ь[Ы€[YOH™љ[ИЏ‘љ[ПЫЬ[ЫЏЏЬ[Ы€[YOH™љ[HЏ‘љ[OЫЬ[ЫЏЏЬ[Ы€[YOH™\ЬЬЫИЏ‘\ЬЬЫПЫЬ[ЫЏЏЬ[Ы€[YOH™\ЬЬШHЏ‘\ЬЬШOЫЬ[ЫЏЏЬ[Ы€[YOH›Э]›ИЏ“Э]›ПЫЬ[ЫЏ‚€ЬЩ[XЭ‚€П‚€
_B€Щ]Џ‚€
_B€X™[Ы\ЬУ[YOH›ШЪИ^^И›Ыќ\Щ[ZX›Ы^\ЭЫ™KMЊЏ‚€°л]™[0кXЫљXЫВ€Щ[XЭ[YO^Ы™]ФЭY[ќ]™[HЫђЪ[™ЩO^Щ]™[ќO€Щ]™]ФЭY[ќ]™[
]™[ќќ\™Щ]ќ[YH\ИЭY[ќ]™[
_HЫ\ЬУ[YOH›]LHЛYќ[LИ›Э[™Y^™Л\ЭЫ™KML^\ЫHЏ‚€Ь[Ы€[YOH€Џ”Щ[XЪ[Ы™K‹‹ЏЫЬ[ЫЏ‚€ФХQS•УU‘SЛ›X\
]™[O€Ь[Ы€Щ^O^Ы]™[H[YO^Ы]™[OћЫ]™[OЫЬ[ЫЏЉ_B€ЬЩ[XЭ‚€ЫX™[‚€]€Ы\ЬУ[YOH™›^Ш\L€LHЏ‚€ќ]Ы€\OHќ]Ы€€ЫђЫXЪП^К
HO€Щ]ЪЭУ™]ФЭY[ќ
[ЩJ_HЫ\ЬУ[YOH™›^LHKLИ›Э[™Y^™Л\ЭЫ™KLL^\ЭЫ™KMМ›ЫќX›ЫЏђШ[Щ[\ЏШќ]ЫЏ‚€ќ]Ы€\OHќ]Ы€€ЫђЫXЪП^ШЬ™X]TЭY[ќњ›ЫPЫ\ЬЯH\ШX›Y^ШЬ™X][™ФЭY[ќHЫ\ЬУ[YOH™›^LHKLИ›Э[™Y^™Л\ШZXњ›ЛMЊ^]Ъ]H›ЫќX›Ы\ШX›Y›ЬXЪ]KMLЏ‚€ШЬ™X][™ФЭY[ќИ	ФШ[[™Л‹‹‰И€	ФШ[\€HYXЪ[Ы\‰ЯB€Шќ]ЫЏ‚€Щ]Џ‚€Щ]Џ‚€ФЭ[™\™[Щ[‚€Щ]Џ‹€ШЭ[Y[ќ›ЩB€
NВџNВ