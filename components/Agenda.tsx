import React, { useState, useMemo, useEffect } from 'react';
import { User, Reservation, ReservationType, NonSocioStudent, PlanType, Professor } from '../types';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, MapPin, Clock, Users, UserPlus, LogOut, Trash2, Check, X, AlertCircle, UserCog, Wallet, Save, Pencil, UserMinus, Share2, Info, ArrowLeft, Search, Loader2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ScoreModal } from './ScoreModal';
import { Challenge } from '../types';

// Court type
interface Court {
    id: string;
    name: string;
    type: string;
    isActive: boolean;
}

// --- HELPERS ---
const getDayName = (dateStr: string) => {
    const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const d = new Date(dateStr + 'T12:00:00');
    return days[d.getDay()];
};

const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatDateBr = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}`;
};

const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

const addMinutes = (time: string, minutes: number) => {
    const [h, m] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + minutes);
    return date.toTimeString().slice(0, 5);
};

// Check if two time ranges overlap (conflict logic)
const checkOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    return (startA < endB) && (endA > startB);
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
            if (prev.length >= 4) return prev; // Limit to 4 for example
            return [...prev, id];
        });
    };

    return (
        <div className="fixed inset-0 bg-stone-900/40 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-300">
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
                                    className={`w-full flex items-center justify-between p-3 rounded-2xl border-2 transition-all ${isSelected ? 'bg-saibro-50 border-saibro-500' : 'bg-white border-stone-50 hover:border-stone-200'
                                        }`}
                                >
                                    <div className="flex items-center gap-3 text-left">
                                        <img src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`} className="w-10 h-10 rounded-full border border-stone-100" />
                                        <div>
                                            <p className="font-bold text-stone-800 text-sm">{user.name}</p>
                                            <p className="text-[10px] text-stone-400">{user.phone ? `+${user.phone}` : user.email}</p>
                                        </div>
                                    </div>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors ${isSelected ? 'bg-saibro-500 border-saibro-500 text-white' : 'border-stone-200'
                                        }`}>
                                        {isSelected && <Check size={14} strokeWidth={3} />}
                                    </div>
                                </button>
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
        </div>
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
        <div className="fixed inset-0 bg-stone-900/40 z-[80] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-4 animate-in zoom-in duration-300">
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
}> = ({ res, currentUser, profiles, courts, professors, nonSocioStudents, onClose, onEdit, onCancel, onJoin, onLeave, onUpdate }) => {
    const [showManageParticipants, setShowManageParticipants] = useState(false);
    const [showGuestModal, setShowGuestModal] = useState(false);
    const court = courts.find(c => c.id === res.courtId);
    const professor = professors.find(p => p.id === res.professorId);
    const participants = res.participantIds.map(id => profiles.find(u => u.id === id)).filter(Boolean);
    const creator = profiles.find(u => u.id === res.creatorId);

    // Non-Socio Logic
    // Non-Socio Logic
    let nonSocioStudentsList: NonSocioStudent[] = [];
    if (res.type === 'Aula' && res.studentType === 'non-socio') {
        if (res.participantIds && res.participantIds.length > 0) {
            nonSocioStudentsList = res.participantIds.map(id => nonSocioStudents.find(s => s.id === id)).filter(Boolean) as NonSocioStudent[];
        } else if (res.nonSocioStudentId) {
            const s = nonSocioStudents.find(s => s.id === res.nonSocioStudentId);
            if (s) nonSocioStudentsList.push(s);
        }
    }

    const style = TYPE_STYLES[res.type] || TYPE_STYLES['Play'];

    // Permissions
    const isCreator = res.creatorId === currentUser.id;
    const isAdmin = currentUser.role === 'admin';
    const isProfessorOwner = currentUser.isProfessor && res.professorId && professors.find(p => p.id === res.professorId)?.userId === currentUser.id;
    const isParticipant = res.participantIds.includes(currentUser.id);
    const isActive = res.status === 'active';
    const isFuture = new Date(res.date + 'T' + res.startTime) > new Date();

    const canManageParticipants = isActive && (isAdmin || currentUser.role === 'socio') && isFuture && res.type === 'Play';
    const canEdit = isActive && (isAdmin || (isFuture && isCreator));
    const canCancel = isActive && isFuture && (isAdmin || isCreator);
    const canJoin = res.type === 'Play' && isActive && isFuture && !isParticipant && (currentUser.role === 'socio' || isAdmin) && res.participantIds.length < 4;
    const canLeave = res.type === 'Play' && isActive && isFuture && isParticipant;

    // Whatsapp Share: Allow for participants, creator, admin, professor
    const canShare = isActive;

    const handleShareWhatsapp = () => {
        const dateBr = formatDateBr(res.date);
        const dayWeek = getDayName(res.date);
        const emoji = res.type === 'Aula' ? '🎓' : '🎾';

        let text = `*SCT TÊNIS - RESERVA CONFIRMADA*\n`;
        text += `------------------------------------\n`;
        text += `${emoji} *TIPO:* ${res.type.toUpperCase()}\n`;
        text += `📅 *DATA:* ${dateBr} (${dayWeek})\n`;
        text += `⏰ *HORÁRIO:* ${res.startTime} - ${res.endTime}\n`;
        text += `📍 *QUADRA:* ${court?.name} (${court?.type})\n`;
        text += `------------------------------------\n\n`;

        if (res.type === 'Aula') {
            text += `🎓 *PROFESSOR:* ${professor?.name || 'N/A'}\n`;
            text += `👥 *ALUNOS:* ${res.studentType === 'socio' ? (participants[0]?.name || 'TBD') : (nonSocioStudentsList.map(s => s.name).join(', ') || 'TBD')}\n`;
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
        <div className="fixed inset-0 bg-stone-50 z-[70] flex flex-col animate-in slide-in-from-right duration-300">
            {/* 1. Header */}
            <div className="bg-white px-4 py-4 shadow-sm border-b border-stone-200 flex items-center justify-between sticky top-0 z-10">
                <button onClick={onClose} className="p-2 -ml-2 text-stone-600 hover:bg-stone-100 rounded-full transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h2 className="text-lg font-bold text-stone-800">Detalhes</h2>
                <div className="w-10" /> {/* Spacer */}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 2. Main Info Card */}
                <div className={`bg-white rounded-2xl card-court p-5 relative overflow-hidden`}>
                    <div className={`absolute top-0 left-0 w-2 h-full ${style.bg.replace('bg-', 'bg-').replace('50', '500')}`} />

                    <div className="flex justify-between items-start mb-4">
                        <div className="flex gap-2">
                            <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide border ${style.bg} ${style.text} ${style.border}`}>
                                {style.label}
                            </span>
                            {res.status === 'cancelled' ? (
                                <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide bg-red-100 text-red-600">Cancelada</span>
                            ) : !isFuture ? (
                                <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide bg-stone-100 text-stone-600">Finalizada</span>
                            ) : (
                                <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wide bg-green-100 text-green-600">Ativa</span>
                            )}
                        </div>
                    </div>

                    <h1 className="text-3xl font-black text-stone-800 mb-1">{res.startTime}</h1>
                    <p className="text-stone-500 font-medium text-sm mb-6 flex items-center gap-2">
                        <Clock size={16} /> Até {res.endTime} • {getDayName(res.date)}, {formatDateBr(res.date)}
                    </p>

                    <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl border border-stone-100">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border border-stone-200 shadow-sm text-saibro-600">
                            <MapPin size={20} />
                        </div>
                        <div>
                            <p className="font-bold text-stone-800">{court?.name}</p>
                            <p className="text-xs text-stone-500 uppercase font-bold">{court?.type}</p>
                        </div>
                    </div>
                </div>

                {/* 3. Central Blocks */}

                {/* PLAY PARTICIPANTS */}
                {res.type === 'Play' && (
                    <div className="bg-white rounded-2xl card-court p-5">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-stone-700 flex items-center gap-2">
                                <Users size={18} className="text-saibro-500" /> Participantes
                            </h3>
                            <span className="text-xs font-bold bg-stone-50 text-stone-500 px-2 py-1 rounded-full">
                                {participants.length + (res.guestName ? 1 : 0)} / 4
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                            {participants.map(p => (
                                <div key={p?.id} className="flex items-center justify-between p-2 bg-stone-50 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <img src={p?.avatar} className="w-10 h-10 rounded-full border border-stone-200 object-cover" alt={p?.name} />
                                        <div>
                                            <p className="font-bold text-stone-800 text-sm">{p?.name}</p>
                                            <p className="text-[10px] uppercase font-bold text-stone-400">Sócio</p>
                                        </div>
                                    </div>
                                    {isAdmin && p?.id !== res.creatorId && (
                                        <button
                                            onClick={() => onUpdate({ ...res, participantIds: res.participantIds.filter(id => id !== p?.id) })}
                                            className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                                        >
                                            <UserMinus size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {res.guestName && (
                                <div className="flex items-center justify-between bg-saibro-50 p-3 rounded-xl border border-saibro-100">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-saibro-200 flex items-center justify-center text-saibro-700 font-bold text-xs shadow-inner">
                                            DAY
                                        </div>
                                        <div>
                                            <p className="font-bold text-stone-800 text-sm">{res.guestName}</p>
                                            <p className="text-[10px] uppercase font-bold text-saibro-600">
                                                Convidado de: {profiles.find(u => u.id === res.guestResponsibleId)?.name.split(' ')[0]}
                                            </p>
                                        </div>
                                    </div>
                                    {canManageParticipants && (
                                        <button
                                            onClick={() => setShowGuestModal(true)}
                                            className="p-2 text-stone-300 hover:text-saibro-600 transition-colors"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                    )}
                                </div>
                            )}

                            {canManageParticipants && participants.length + (res.guestName ? 1 : 0) < 4 && !res.guestName && (
                                <button
                                    onClick={() => setShowGuestModal(true)}
                                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-stone-200 text-stone-400 hover:border-saibro-300 hover:text-saibro-600 hover:bg-saibro-50 transition-all text-xs font-bold"
                                >
                                    <UserPlus size={16} /> Adicionar Convidado (Day Use)
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* AULA INFO */}
                {res.type === 'Aula' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl card-court p-5">
                            <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-4">Professor</h3>
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-saibro-600 flex items-center justify-center text-white font-black text-lg shadow-saibro-200 shadow-lg">
                                    {professor?.name[0]}
                                </div>
                                <div>
                                    <p className="font-black text-stone-800 text-lg uppercase leading-tight">{professor?.name}</p>
                                    <p className="text-xs text-saibro-600 font-bold">Professor Titular</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl card-court p-5">
                            <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-4">Alunos</h3>
                            {res.studentType === 'socio' ? (
                                <div className="flex items-center gap-4">
                                    <img src={participants[0]?.avatar} className="w-12 h-12 rounded-full border-2 border-saibro-100 p-0.5 object-cover" alt="" />
                                    <div>
                                        <p className="font-black text-stone-800 text-lg uppercase leading-tight">{participants[0]?.name}</p>
                                        <span className="text-[10px] font-bold text-saibro-700 bg-saibro-50 px-2 py-0.5 rounded-md border border-saibro-100">SÓCIO ATIVO</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {nonSocioStudentsList.length > 0 ? nonSocioStudentsList.map(s => (
                                        <div key={s.id} className="flex items-center gap-4 border-b border-stone-50 pb-2 last:border-0 last:pb-0">
                                            <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-blue-200 shadow-lg shrink-0">
                                                <Wallet size={24} />
                                            </div>
                                            <div>
                                                <p className="font-black text-stone-800 text-lg uppercase leading-tight">{s.name}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-stone-500 font-bold uppercase">{s.planType}</span>
                                                    {s.planType === 'Card Mensal' && (
                                                        <span className={`text-[9px] px-2 py-0.5 rounded font-black border ${new Date(s.masterExpirationDate || '') < new Date() ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'
                                                            }`}>
                                                            {new Date(s.masterExpirationDate || '') < new Date() ? 'VENCIDO' : 'ATIVO'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )) : <p className="text-stone-400 italic">Nenhum aluno vinculado.</p>}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Observations */}
                {res.observation && (
                    <div className="bg-white rounded-2xl card-court p-5">
                        <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Info size={14} className="text-stone-300" /> Observações
                        </h3>
                        <p className="text-stone-600 text-sm italic font-medium leading-relaxed">"{res.observation}"</p>
                    </div>
                )}

                {/* Meta Info */}
                <div className="text-center pt-4 pb-20">
                    <p className="text-[10px] text-stone-400">
                        Reserva criada por {creator?.name} em {formatDateBr(res.date)}
                    </p>
                    <p className="text-[10px] text-stone-300 mt-1">ID: {res.id}</p>
                </div>
            </div>

            {/* 4. Actions Bar (Sticky Bottom) */}
            <div className="bg-white border-t border-stone-200 p-4 pb-safe flex flex-col gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="flex gap-2">
                    {/* Share is generally always available if active */}
                    {canShare && (
                        <button onClick={handleShareWhatsapp} className="p-3 rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
                            <Share2 size={20} />
                        </button>
                    )}

                    {canManageParticipants && (
                        <button
                            onClick={() => setShowManageParticipants(true)}
                            className="flex-1 py-3 bg-saibro-100 text-saibro-700 font-bold rounded-xl hover:bg-saibro-200 flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                            <Users size={18} /> Gerenciar Atletas
                        </button>
                    )}

                    {/* Join / Leave Logic */}
                    {canJoin && (
                        <button onClick={() => onJoin(res.id)} className="flex-1 py-3 bg-saibro-600 text-white font-bold rounded-xl shadow-md hover:bg-saibro-700 flex items-center justify-center gap-2 transition-all active:scale-95">
                            <UserPlus size={18} /> Entrar no Jogo
                        </button>
                    )}
                    {canLeave && (
                        <button onClick={() => onLeave(res.id)} className="flex-1 py-3 bg-stone-100 text-stone-700 font-bold rounded-xl hover:bg-stone-200 flex items-center justify-center gap-2 transition-all active:scale-95">
                            <LogOut size={18} /> Sair do Jogo
                        </button>
                    )}
                </div>

                <div className="flex gap-2">
                    {canEdit && (
                        <button onClick={() => onEdit(res)} className="flex-1 py-3 bg-stone-50 text-stone-600 font-bold rounded-xl hover:bg-stone-100 flex items-center justify-center gap-2 transition-colors">
                            <Pencil size={18} /> Editar
                        </button>
                    )}
                    {canCancel && (
                        <button onClick={() => onCancel(res.id)} className="flex-1 py-3 bg-red-50 text-red-500 font-bold rounded-xl hover:bg-red-100 flex items-center justify-center gap-2 transition-colors">
                            <Trash2 size={18} /> Cancelar Reserva
                        </button>
                    )}
                </div>
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
        </div>
    );
};


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
    const participants = res.participantIds.map(id => profiles.find(u => u.id === id)).filter(Boolean);
    const professor = professors.find(p => p.id === res.professorId);

    // Non-Socio Logic (Multi)
    let nonSocioStudentsList: NonSocioStudent[] = [];
    if (res.type === 'Aula' && res.studentType === 'non-socio') {
        if (res.participantIds && res.participantIds.length > 0) {
            nonSocioStudentsList = res.participantIds.map(id => nonSocioStudents.find(s => s.id === id)).filter(Boolean) as NonSocioStudent[];
        } else if (res.nonSocioStudentId) {
            const s = nonSocioStudents.find(s => s.id === res.nonSocioStudentId);
            if (s) nonSocioStudentsList.push(s);
        }
    }

    return (
        <div
            onClick={() => onSelect(res)}
            className={`relative rounded-xl border-l-4 shadow-sm p-4 transition-all hover:shadow-md cursor-pointer active:scale-[0.99] ${style.bg} ${style.border} group`}
        >
            {/* Header */}
            <div className="flex justify-between items-start mb-2">
                <div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${style.text} bg-white/50 border-current`}>
                        {style.label}
                    </span>
                    <h4 className="font-bold text-stone-800 mt-1">{court?.name} <span className="text-stone-400 font-normal text-xs">({court?.type})</span></h4>
                </div>
                <div className="text-right">
                    <div className="flex items-center gap-1 font-mono font-bold text-stone-700">
                        <Clock size={14} />
                        {res.startTime} - {res.endTime}
                    </div>
                    {res.status === 'cancelled' && <span className="text-[10px] font-bold text-red-500 uppercase bg-red-100 px-1 rounded">Cancelada</span>}
                </div>
            </div>

            {/* Content */}
            <div className="space-y-2">
                {res.type === 'Aula' ? (
                    <div className="text-sm text-stone-600">
                        <p><span className="font-semibold">Prof:</span> {professor?.name}</p>
                        <div className="flex items-start gap-2">
                            <span className="font-semibold whitespace-nowrap">Alunos:</span>
                            {res.studentType === 'non-socio' ? (
                                <div className="flex flex-wrap gap-1">
                                    {nonSocioStudentsList.length > 0 ? nonSocioStudentsList.map(s => (
                                        <span key={s.id} className="text-blue-600 font-medium flex items-center gap-1 text-[10px] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                            {s.name}
                                            {s.planType === 'Card Mensal' && (
                                                <span className="text-[9px] bg-purple-100 text-purple-700 px-1 rounded border border-purple-200">M</span>
                                            )}
                                        </span>
                                    )) : <span className="text-stone-400 text-xs italic">Nenhum</span>}
                                </div>
                            ) : (
                                participants[0]?.name || 'TBD'
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {participants.map(p => (
                            <span key={p?.id} className="flex items-center gap-1 text-xs bg-white border border-stone-200 px-2 py-1 rounded-full text-stone-700 shadow-sm">
                                <Users size={10} /> {p?.name}
                            </span>
                        ))}
                        {res.guestName && (
                            <span className="flex items-center gap-1 text-xs bg-yellow-100 border border-yellow-200 px-2 py-1 rounded-full text-yellow-800 shadow-sm">
                                <Users size={10} /> {res.guestName}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Hint or Action */}
            <div className="mt-3 pt-2 border-t border-stone-200/50 flex justify-between items-center">
                {res.type === 'Desafio' && res.status !== 'finished' && res.status !== 'cancelled' && (
                    (() => {
                        const challenge = challenges.find(c => c.reservationId === res.id);
                        if (!challenge) return null;

                        const now = new Date();
                        const startDate = new Date(`${res.date}T${res.startTime}`);
                        const canLaunch = now >= startDate;

                        if (canLaunch && challenge.status !== 'finished') {
                            return (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onLaunchScore(challenge);
                                    }}
                                    className="px-3 py-1 bg-saibro-500 text-white text-xs font-bold rounded-lg shadow-md hover:bg-saibro-600 flex items-center gap-1"
                                >
                                    <Trophy size={12} /> Lançar Placar
                                </button>
                            );
                        }
                        return null;
                    })()
                )}
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide ml-auto">Ver Detalhes</span>
            </div>
        </div>
    );
};

// --- COMPONENT: Agenda ---
export const Agenda: React.FC<{ currentUser: User }> = ({ currentUser }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<'day' | 'week' | 'month'>('day');
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [nonSocioStudents, setNonSocioStudents] = useState<NonSocioStudent[]>([]);
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCancelled, setShowCancelled] = useState(false);

    // Modal States
    const [showAddModal, setShowAddModal] = useState(false);
    const [reservationToEdit, setReservationToEdit] = useState<Reservation | undefined>(undefined);
    const [selectedReservation, setSelectedReservation] = useState<Reservation | undefined>(undefined);
    const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

    // Fetch profiles and reservations from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
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

                if (reservationsError) {
                    console.log('Reservations table may not exist yet, using empty array');
                    setReservations([]);
                } else if (reservationsData) {
                    const mappedReservations: Reservation[] = reservationsData.map(r => ({
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
                        observation: r.observation,
                        status: r.status || 'active'
                    }));
                    setReservations(mappedReservations);
                }

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
                    planType: s.plan_type,
                    planStatus: s.plan_status,
                    masterExpirationDate: s.master_expiration_date,
                    professorId: s.professor_id
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
                // Fallback to empty arrays
                setReservations([]);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Helper to get user by ID from fetched profiles
    const getUserById = (id: string): User | undefined => {
        return profiles.find(p => p.id === id);
    };


    // --- Actions ---
    const handleJoin = (id: string) => {
        setReservations(prev => {
            const res = prev.find(r => r.id === id);
            if (res && res.participantIds.length >= 4) {
                alert('Limite de 4 participantes atingido.');
                return prev;
            }
            const newRes = prev.map(r => r.id === id ? { ...r, participantIds: [...r.participantIds, currentUser.id] } : r);
            if (selectedReservation?.id === id) setSelectedReservation(newRes.find(r => r.id === id));
            return newRes;
        });
    };

    const handleLeave = (id: string) => {
        setReservations(prev => {
            const newRes = prev.map(r => r.id === id ? { ...r, participantIds: r.participantIds.filter(pid => pid !== currentUser.id) } : r);
            if (selectedReservation?.id === id) setSelectedReservation(newRes.find(r => r.id === id));
            return newRes;
        });
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

    const handleSaveReservation = async (res: Reservation) => {
        try {
            const exists = reservations.some(r => r.id === res.id);

            // Prepare data for Supabase (snake_case)
            const supabaseData = {
                type: res.type,
                date: res.date,
                start_time: res.startTime,
                end_time: res.endTime,
                court_id: res.courtId,
                creator_id: res.creatorId,
                participant_ids: res.participantIds,
                guest_name: res.guestName || null,
                guest_responsible_id: res.guestResponsibleId || null,
                professor_id: res.professorId || null,
                student_type: res.studentType || null,
                non_socio_student_id: res.nonSocioStudentId || null,
                observation: res.observation || null,
                status: res.status
            };

            if (exists) {
                // Update existing
                const { error } = await supabase
                    .from('reservations')
                    .update(supabaseData)
                    .eq('id', res.id);

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
                res = { ...res, id: data.id };
            }

            // Update local state
            setReservations(prev => {
                let newResList: Reservation[];
                const existsLocal = prev.some(r => r.id === res.id);

                if (existsLocal) {
                    newResList = prev.map(r => r.id === res.id ? res : r);
                } else {
                    newResList = [...prev, res];
                }

                newResList.sort((a, b) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date);
                    return a.startTime.localeCompare(b.startTime);
                });

                if (selectedReservation?.id === res.id) setSelectedReservation(res);

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
                    date: new Date().toISOString(),
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
    const goToToday = () => setCurrentDate(new Date());
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
                    <div className="text-center py-10 text-stone-600 section-header">Nenhuma reserva para este dia.</div>
                ) : (
                    filteredReservations.map(res => (
                        <ReservationCard
                            key={res.id}
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
                    const isToday = dayStr === formatDate(new Date());

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
                        const isToday = dateStr === formatDate(new Date());

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
        <div className="p-4 space-y-4 pb-24">
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
                        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-stone-200 shadow-sm">
                            <button onClick={() => navigate('prev')} className="p-2 hover:bg-stone-50 rounded-lg text-stone-500"><ChevronLeft size={20} /></button>
                            <div className="text-center">
                                <span className="block text-sm font-bold text-stone-800">
                                    {view === 'month'
                                        ? currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                                        : currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                                    }
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={goToToday} className="text-xs font-bold text-saibro-600 hover:bg-saibro-50 px-2 py-1 rounded">Hoje</button>
                                <button onClick={() => navigate('next')} className="p-2 hover:bg-stone-50 rounded-lg text-stone-500"><ChevronRight size={20} /></button>
                            </div>
                        </div>

                        {/* Filters */}
                        <div className="flex justify-end px-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none group">
                                <div className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${showCancelled ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-stone-300 text-transparent hover:border-red-300'}`}>
                                    <Check size={14} strokeWidth={3} />
                                </div>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={showCancelled}
                                    onChange={(e) => setShowCancelled(e.target.checked)}
                                />
                                <span className={`text-sm font-bold transition-colors section-header ${showCancelled ? 'text-red-600' : 'text-stone-500'}`}>Ver Canceladas</span>
                            </label>
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

    // Helper to calculate duration from start/end
    const getInitialDuration = () => {
        if (!initialData) return 60;
        const start = new Date(`2000-01-01T${initialData.startTime}`);
        const end = new Date(`2000-01-01T${initialData.endTime}`);
        return (end.getTime() - start.getTime()) / 60000;
    };

    // 1. Basic Fields
    const [type, setType] = useState<ReservationType>(initialData?.type || 'Play');
    const [date, setDate] = useState(initialData?.date || new Date().toISOString().split('T')[0]);
    const [courtId, setCourtId] = useState(initialData?.courtId || (courts.length > 0 ? courts[0].id : ''));
    const [startTime, setStartTime] = useState(initialData?.startTime || '');
    const [duration, setDuration] = useState(getInitialDuration());

    // 2. Participants
    const [participantIds, setParticipantIds] = useState<string[]>(initialData?.participantIds || [currentUser.id]);
    const [observation, setObservation] = useState(initialData?.observation || '');

    // 3. Guest Logic
    const [hasGuest, setHasGuest] = useState(!!initialData?.guestName);
    const [guestName, setGuestName] = useState(initialData?.guestName || '');
    const [guestResponsibleId, setGuestResponsibleId] = useState(initialData?.guestResponsibleId || currentUser.id);

    // 4. Professor/Class Logic
    const [studentType, setStudentType] = useState<'socio' | 'non-socio'>(initialData?.studentType || 'socio');
    const [nonSocioStudentId, setNonSocioStudentId] = useState(initialData?.nonSocioStudentId || '');
    const [selectedProfessorId, setSelectedProfessorId] = useState(initialData?.professorId || '');

    // 5. Quick Add Student State
    const [isCreatingStudent, setIsCreatingStudent] = useState(false);
    const [newStudentForm, setNewStudentForm] = useState({ name: '', plan: 'Day Card' as PlanType, expiry: '' });

    const [error, setError] = useState<string | null>(null);

    // Context Data - use profiles instead of mock USERS
    const availablePartners = profiles.filter(u => (u.role === 'socio' || u.role === 'admin') && u.id !== currentUser.id);
    const professorRecord = professors.find(p => p.userId === currentUser.id);

    // Use nonSocioStudents from props
    const [localNonSocioStudents, setLocalNonSocioStudents] = useState(nonSocioStudents);

    // Filter students managed by the selected professor
    const currentProfessorId = currentUser.role === 'admin' ? selectedProfessorId : professorRecord?.id;
    const myNonSocioStudents = localNonSocioStudents.filter(s => s.professorId === currentProfessorId);

    // Only Admin or Professor can create 'Aula'
    const canCreateAula = currentUser.role === 'admin' || !!professorRecord;

    // Initial Setup
    useEffect(() => {
        if (!isEdit) {
            if (!canCreateAula && type === 'Aula') setType('Play');
            if (currentUser.isProfessor && professorRecord) setSelectedProfessorId(professorRecord.id);
            if (currentUser.role === 'admin' && type === 'Aula' && !selectedProfessorId && professors.length > 0) {
                setSelectedProfessorId(professors[0].id);
            }
        }

        // If creating, set default start time. If editing, keep initial time unless date changes
        if (!isEdit || (isEdit && date !== initialData.date)) {
            const validTimes = getAvailableTimes(type, date);
            if (validTimes.length > 0 && !startTime) setStartTime(validTimes[0]);
        }
    }, [canCreateAula, type, date, currentUser, isEdit]);

    // Generate Available Times based on rules
    const getAvailableTimes = (resType: ReservationType, resDate: string) => {
        const times: string[] = [];
        const dayOfWeek = new Date(resDate + 'T12:00:00').getDay(); // 0 = Sun

        let startHour = 5;
        const endHour = 22; // Last slot starts at 22:30 for 23:00 close? Or just 22:00? Let's say 22:00 if 60min.

        if (resType === 'Aula' && dayOfWeek !== 0) {
            startHour = 19; // Starts at 19:30
        }

        for (let h = startHour; h <= endHour; h++) {
            ['00', '30'].forEach(m => {
                if (resType === 'Aula' && dayOfWeek !== 0 && h === 19 && m === '00') return; // Skip 19:00, start 19:30
                if (h === 23) return; // Close at 23:00
                times.push(`${String(h).padStart(2, '0')}:${m}`);
            });
        }

        return times;
    };

    const availableTimes = useMemo(() => getAvailableTimes(type, date), [type, date]);

    // Helper: Toggle user in participant list
    const toggleParticipant = (uid: string) => {
        setParticipantIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
    };



    const validate = () => {
        if (!startTime) return "Horário inválido ou indisponível.";
        const endTime = addMinutes(startTime, duration);

        // 1. Mandatory Fields
        if (type === 'Play') {
            if (participantIds.length === 0 && !hasGuest) return "Selecione ao menos um participante.";
            if (hasGuest && !guestName.trim()) return "Nome do convidado é obrigatório.";
        }

        if (type === 'Aula') {
            // Validate Court Type for Aula
            const selectedCourt = courts.find(c => c.id === courtId);
            if (selectedCourt?.type !== 'Rápida') return "Aulas são permitidas apenas na Quadra Rápida.";

            if (currentUser.role === 'admin' && !selectedProfessorId) return "Selecione o professor.";

            if (studentType === 'socio' && participantIds.length === 0) return "Selecione um aluno sócio.";
            // Validate Card Mensal (Iteration check)
            if (studentType === 'non-socio') {
                if (participantIds.length === 0) return "Adicione ao menos um aluno.";

                // Check ALL selected students
                for (const pid of participantIds) {
                    const student = localNonSocioStudents.find(s => s.id === pid);
                    if (student?.planType === 'Card Mensal') {
                        if (student.planStatus !== 'active') return `Bloqueado: ${student.name} aguardando Pagamento (Inativo).`;
                        if (!student.masterExpirationDate || new Date(student.masterExpirationDate) < new Date(date)) {
                            return `Bloqueado: Card Mensal de ${student.name} Vencido.`;
                        }
                    }
                }
            }
        }

        // 2. Time Limits (Already handled by select, but double check)
        if (endTime > "23:00" && endTime !== "00:00") return "Horário excede o fechamento (23:00).";

        // 3. Conflict Rules (Anti-choque)
        // EXCLUDE SELF if editing
        const hasConflict = existingReservations.some(r => {
            if (isEdit && r.id === initialData?.id) return false; // Ignore self
            if (r.courtId !== courtId || r.date !== date || r.status === 'cancelled') return false;
            return checkOverlap(startTime, endTime, r.startTime, r.endTime);
        });

        if (hasConflict) return "Horário indisponível nesta quadra (Conflito de agendamento).";

        return null;
    };

    const handleConfirm = () => {
        const err = validate();
        if (err) {
            setError(err);
            return;
        }

        const endTime = addMinutes(startTime, duration);
        const newRes: Reservation = {
            id: initialData?.id || `r_${Date.now()}`, // Keep ID if editing
            type,
            date,
            startTime,
            endTime,
            courtId,
            creatorId: initialData?.creatorId || currentUser.id, // Preserve creator
            participantIds: participantIds,
            guestName: hasGuest ? guestName : undefined,
            guestResponsibleId: hasGuest ? guestResponsibleId : undefined,

            // Class specific fields
            professorId: type === 'Aula' ? currentProfessorId : undefined,
            studentType: type === 'Aula' ? studentType : undefined,

            observation: observation || undefined,
            status: initialData?.status || 'active'
        };
        onSave(newRes);
    };

    return (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full bg-black/70 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-md">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl p-6 w-full max-w-lg space-y-5 animate-in slide-in-from-bottom-10 duration-300 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center border-b border-stone-100 pb-3">
                    <h3 className="text-xl font-bold text-saibro-800">{isEdit ? 'Editar Reserva' : 'Nova Reserva'}</h3>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded-full hover:bg-stone-100"><X size={20} /></button>
                </div>

                {error && (
                    <div className="bg-red-50 text-red-600 text-xs p-3 rounded-lg flex gap-2 items-center font-medium border border-red-100 animate-in shake">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                    {/* 1. Identification */}
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Tipo de Reserva</label>
                        <div className="flex gap-2 bg-stone-50 p-1 rounded-lg">
                            <button onClick={() => setType('Play')}
                                disabled={isEdit} // Prevent changing type on edit
                                className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${type === 'Play' ? 'bg-white text-saibro-700 shadow-sm ring-1 ring-stone-200' : 'text-stone-500'} ${isEdit ? 'opacity-50 cursor-not-allowed' : 'hover:text-stone-700'}`}
                            >
                                Play Amistoso
                            </button>
                            {canCreateAula && (
                                <button onClick={() => {
                                    setType('Aula');
                                    // Auto-select Rápida court
                                    const rapida = courts.find(c => c.type === 'Rápida' && c.isActive);
                                    if (rapida) setCourtId(rapida.id);
                                }}
                                    disabled={isEdit}
                                    className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${type === 'Aula' ? 'bg-white text-saibro-700 shadow-sm ring-1 ring-stone-200' : 'text-stone-500'} ${isEdit ? 'opacity-50 cursor-not-allowed' : 'hover:text-stone-700'}`}
                                >
                                    Aula
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Data</label>
                            <input type="date" value={date} onChange={e => { setDate(e.target.value); setError(null); }} className="w-full p-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-200 outline-none text-stone-700 font-medium" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Quadra</label>
                            <select
                                className="w-full p-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-200 outline-none text-stone-700 font-medium bg-white"
                                value={courtId}
                                onChange={e => { setCourtId(e.target.value); setError(null); }}
                            >
                                {courts
                                    .filter(c => c.isActive)
                                    .filter(c => type === 'Aula' ? c.type === 'Rápida' : true)
                                    .map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Duração</label>
                            <select
                                value={duration} onChange={e => setDuration(Number(e.target.value))}
                                className="w-full p-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-200 outline-none text-stone-700 font-medium bg-white"
                            >
                                <option value={60}>60 min</option>
                                <option value={90}>90 min</option>
                                <option value={120}>120 min</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Início</label>
                            <select
                                value={startTime}
                                onChange={e => { setStartTime(e.target.value); setError(null); }}
                                className="w-full p-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-200 outline-none text-stone-700 font-medium bg-white"
                            >
                                {availableTimes.map(t => <option key={t} value={t}>{t}</option>)}
                                {availableTimes.length === 0 && <option disabled>Sem horários</option>}
                                {/* If editing and original time is not in filtered list (e.g. rule change), allow keeping it */}
                                {isEdit && !availableTimes.includes(initialData?.startTime || '') && (
                                    <option value={initialData?.startTime}>{initialData?.startTime} (Original)</option>
                                )}
                            </select>
                        </div>
                    </div>

                    {/* --- PLAY AMISTOSO PARTICIPANTS --- */}
                    {type === 'Play' && (
                        <div className="space-y-3 pt-2 border-t border-stone-100">
                            <label className="block text-xs font-bold text-stone-500 uppercase">Participantes (Sócios)</label>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => toggleParticipant(currentUser.id)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors flex items-center gap-1 ${participantIds.includes(currentUser.id) ? 'bg-saibro-100 border-saibro-300 text-saibro-800' : 'bg-white border-stone-200 text-stone-500'}`}
                                >
                                    {participantIds.includes(currentUser.id) && <Check size={12} />} Eu ({currentUser.name})
                                </button>
                                {availablePartners.map(u => (
                                    <button
                                        key={u.id}
                                        onClick={() => toggleParticipant(u.id)}
                                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors flex items-center gap-1 ${participantIds.includes(u.id) ? 'bg-saibro-100 border-saibro-300 text-saibro-800' : 'bg-white border-stone-200 text-stone-500'}`}
                                    >
                                        {participantIds.includes(u.id) && <Check size={12} />} {u.name}
                                    </button>
                                ))}
                            </div>

                            {/* Guest Toggle */}
                            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 mt-2">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-bold text-stone-700">Tem convidado (Day Use)?</span>
                                    <button
                                        onClick={() => setHasGuest(!hasGuest)}
                                        className={`w-10 h-6 rounded-full p-1 transition-colors ${hasGuest ? 'bg-saibro-500' : 'bg-stone-300'}`}
                                    >
                                        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${hasGuest ? 'translate-x-4' : ''}`} />
                                    </button>
                                </div>

                                {hasGuest && (
                                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                                        <input
                                            type="text"
                                            placeholder="Nome do convidado"
                                            value={guestName}
                                            onChange={e => setGuestName(e.target.value)}
                                            className="w-full p-2 border border-stone-200 rounded-lg text-sm"
                                        />
                                        <div>
                                            <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Responsável</label>
                                            <select
                                                value={guestResponsibleId}
                                                onChange={e => setGuestResponsibleId(e.target.value)}
                                                className="w-full p-2 border border-stone-200 rounded-lg text-sm bg-white"
                                            >
                                                <option value={currentUser.id}>Eu ({currentUser.name})</option>
                                                {availablePartners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- AULA LOGIC --- */}
                    {type === 'Aula' && (
                        <div className="space-y-3 pt-2 border-t border-stone-100">
                            {currentUser.role === 'admin' && (
                                <div className="mb-3">
                                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Professor</label>
                                    <select
                                        className="w-full p-2 border border-stone-200 rounded-lg text-sm bg-white"
                                        value={selectedProfessorId}
                                        onChange={(e) => setSelectedProfessorId(e.target.value)}
                                    >
                                        <option value="">Selecione o professor...</option>
                                        {professors.filter(p => p.isActive).map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Student Type Selector */}
                            <label className="block text-xs font-bold text-stone-500 uppercase">Aluno</label>
                            <div className="flex gap-2 mb-3">
                                <button onClick={() => { setStudentType('socio'); setParticipantIds([]); }} className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1 ${studentType === 'socio' ? 'bg-saibro-100 text-saibro-800' : 'bg-stone-100 text-stone-500'}`}>
                                    <UserCog size={14} /> Sócio
                                </button>
                                <button onClick={() => { setStudentType('non-socio'); setParticipantIds([]); }} className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1 ${studentType === 'non-socio' ? 'bg-saibro-100 text-saibro-800' : 'bg-stone-100 text-stone-500'}`}>
                                    <Users size={14} /> Não Sócio
                                </button>
                            </div>

                            {studentType === 'socio' ? (
                                <select
                                    className="w-full p-2.5 border border-stone-200 rounded-xl bg-white text-sm"
                                    onChange={(e) => setParticipantIds([e.target.value])}
                                    value={participantIds[0] || ''}
                                >
                                    <option value="">Selecione o sócio...</option>
                                    <option value={currentUser.id}>Eu ({currentUser.name})</option>
                                    {availablePartners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                            ) : (
                                // NON-SOCIO LOGIC
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap gap-2">
                                            {/* List Selected Non-Socios */}
                                            {participantIds.map(pid => {
                                                const s = localNonSocioStudents.find(st => st.id === pid);
                                                if (!s) return null;
                                                return (
                                                    <button
                                                        key={s.id}
                                                        onClick={() => toggleParticipant(s.id)}
                                                        className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1 bg-saibro-100 border-saibro-300 text-saibro-800`}
                                                    >
                                                        <Check size={12} /> {s.name} ({s.planType === 'Card Mensal' ? 'M' : 'D'})
                                                    </button>
                                                )
                                            })}
                                        </div>

                                        <select
                                            className="w-full p-2.5 border border-stone-200 rounded-xl bg-white text-sm"
                                            onChange={(e) => {
                                                if (e.target.value) toggleParticipant(e.target.value);
                                            }}
                                            value=""
                                        >
                                            <option value="">Adicionar aluno...</option>
                                            {myNonSocioStudents
                                                .filter(s => !participantIds.includes(s.id))
                                                .map(s => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name} ({s.planType})
                                                        {s.planType === 'Card Mensal' && s.planStatus !== 'active' ? ' [INATIVO]' : ''}
                                                    </option>
                                                ))}
                                            {myNonSocioStudents.length === 0 && <option disabled>Sem alunos cadastrados.</option>}
                                        </select>
                                        <p className="text-[10px] text-stone-400 pl-1">
                                            * Novos alunos devem ser cadastrados na Área do Professor.
                                        </p>
                                    </div>

                                    {/* Info Display for Selected Non-Socio(s) */}
                                    {participantIds.length > 0 && (
                                        <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 space-y-1">
                                            {participantIds.map(pid => {
                                                const s = localNonSocioStudents.find(st => st.id === pid);
                                                if (!s) return null;
                                                const isExpirado = s.planType === 'Card Mensal' && (!s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date(date));
                                                const isInativo = s.planStatus !== 'active';
                                                const hasIssue = (s.planType === 'Card Mensal' && (isExpirado || isInativo));

                                                return (
                                                    <div key={s.id} className={`flex items-center justify-between text-xs ${hasIssue ? 'text-red-600 font-bold' : 'text-blue-800'}`}>
                                                        <span className="flex items-center gap-1">
                                                            {s.name}
                                                        </span>
                                                        <span>
                                                            {s.planType === 'Day Card'
                                                                ? 'Day Use'
                                                                : isInativo
                                                                    ? '[AGUARDANDO PAGAMENTO]'
                                                                    : isExpirado
                                                                        ? '[VENCIDO]'
                                                                        : `Ativo até ${new Date(s.masterExpirationDate!).toLocaleDateString()}`}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 4. Observation */}
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Observações</label>
                        <textarea
                            rows={2}
                            value={observation}
                            onChange={e => setObservation(e.target.value)}
                            placeholder="Ex: Treino leve, trazer bolas..."
                            className="w-full p-2 border border-stone-200 rounded-xl text-sm outline-none focus:border-saibro-300"
                        />
                    </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-stone-100">
                    <button onClick={onClose} className="flex-1 py-3 text-stone-500 font-bold hover:bg-stone-50 rounded-xl transition-colors">Cancelar</button>
                    <button onClick={handleConfirm} className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-saibro-700 transition-colors active:scale-95 flex items-center justify-center gap-2">
                        <Save size={18} /> {isEdit ? 'Salvar Alterações' : 'Confirmar Reserva'}
                    </button>
                </div>
            </div>
        </div>
    );
};