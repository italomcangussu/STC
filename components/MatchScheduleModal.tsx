import React, { useState, useEffect } from 'react';
import { StandardModal } from './StandardModal';
import { Calendar, Clock, MapPin, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Match, Court } from '../types';
import { formatDateBr } from '../utils';

interface Props {
    match: Match;
    roundName: string;
    roundStartDate: string; // YYYY-MM-DD
    roundEndDate: string;   // YYYY-MM-DD
    className: string; // Need class name to determine court restrictions
    courts: Court[];
    onSchedule: (date: string, time: string, courtId: string) => Promise<void>;
    onClose: () => void;
}

const TIME_SLOTS_MORNING = ['06:00', '06:30', '07:00'];
const TIME_SLOTS_AFTERNOON = ['16:00', '16:30', '17:00'];
const TIME_SLOTS_NIGHT = ['20:00', '21:00', '22:00'];

const ALL_TIME_SLOTS = [
    ...TIME_SLOTS_MORNING,
    ...TIME_SLOTS_AFTERNOON,
    ...TIME_SLOTS_NIGHT
];

export const MatchScheduleModal: React.FC<Props> = ({
    match, roundName, roundStartDate, roundEndDate, className, courts, onSchedule, onClose
}) => {
    const [date, setDate] = useState(match.scheduled_date || '');
    const [time, setTime] = useState(match.scheduled_time ? match.scheduled_time.substring(0, 5) : '');
    const [selectedCourtId, setSelectedCourtId] = useState(match.court_id || '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter courts based on class (robust check)
    const availableCourts = courts.filter(court => {
        // Handle both camelCase and snake_case from DB
        const isActive = (court as any).is_active !== undefined ? (court as any).is_active : court.isActive;
        if (isActive === false) return false;

        const normalizedClassName = (className || '').trim();

        const type = (court.type || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 6th class -> Hard Court (Rápida or Rapida)
        if (normalizedClassName.includes('6ª')) return type.includes('rapida');

        // 4th/5th class -> Clay Court (Saibro)
        if (normalizedClassName.includes('4ª') || normalizedClassName.includes('5ª')) return type.includes('saibro');

        return true; // Other classes (1, 2, 3, etc.) - any court
    });

    // Auto-select court if only one is available
    useEffect(() => {
        if (availableCourts.length === 1 && !selectedCourtId) {
            setSelectedCourtId(availableCourts[0].id);
        }
    }, [availableCourts, selectedCourtId]);

    const isFriday = (dateString: string) => {
        if (!dateString) return false;
        const d = new Date(dateString + 'T12:00:00'); // Safe parsing
        return d.getDay() === 5; // 5 = Friday
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!date || !time || !selectedCourtId) {
            setError('Preencha todos os campos.');
            return;
        }

        // Validate date range
        if (date < roundStartDate || date > roundEndDate) {
            setError(`A data deve estar dentro do período da rodada: ${formatDateBr(roundStartDate)} a ${formatDateBr(roundEndDate)}`);
            return;
        }

        setIsSubmitting(true);
        try {
            await onSchedule(date, time, selectedCourtId);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Erro ao agendar partida.');
            setIsSubmitting(false);
        }
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl flex flex-col pt-safe pb-safe max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-saibro-50/50 flex-none">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-saibro-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-200">
                            <Calendar size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-stone-800">Agendar Partida</h3>
                            <p className="text-[10px] font-bold text-saibro-600 uppercase tracking-widest">{roundName}</p>
                        </div>
                    </div>
                </div>

                {/* Content - Scrollable area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Date Selection */}
                        <div>
                            <label className="text-xs font-black text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Calendar size={14} className="text-saibro-500" /> Data do Confronto
                            </label>
                            <input
                                type="date"
                                value={date}
                                min={roundStartDate}
                                max={roundEndDate}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:ring-2 focus:ring-saibro-500 outline-none transition-all font-bold text-stone-800"
                            />
                            <p className="text-[10px] text-stone-400 mt-2 pl-1 font-medium italic">
                                Período da rodada: {formatDateBr(roundStartDate)} até {formatDateBr(roundEndDate)}
                            </p>
                        </div>

                        {/* Time Selection */}
                        <div>
                            <label className="text-xs font-black text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Clock size={14} className="text-saibro-500" /> Horários Sugeridos
                            </label>

                            {isFriday(date) ? (
                                <div className="space-y-2">
                                    <input
                                        type="time"
                                        value={time}
                                        onChange={(e) => setTime(e.target.value)}
                                        className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:ring-2 focus:ring-saibro-500 outline-none transition-all font-bold text-stone-800"
                                    />
                                    <p className="text-[10px] text-green-600 font-black mt-1 pl-1 flex items-center gap-1 uppercase tracking-tighter">
                                        <Check size={10} /> Sexta-feira: Horário livre disponível!
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {ALL_TIME_SLOTS.map(slot => (
                                        <button
                                            key={slot}
                                            type="button"
                                            onClick={() => setTime(slot)}
                                            className={`py-3 rounded-xl text-xs font-black transition-all border ${time === slot
                                                ? 'bg-saibro-600 text-white border-saibro-600 shadow-md'
                                                : 'bg-white text-stone-600 border-stone-100 hover:border-saibro-200'
                                                }`}
                                        >
                                            {slot}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!isFriday(date) && (
                                <div className="mt-3 p-3 bg-stone-50 rounded-xl border border-stone-100">
                                    <p className="text-[9px] text-stone-400 font-black uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-saibro-500 rounded-full" />
                                        Manhã (6h-7h) • Tarde (16h-17h) • Noite (20h-22h)
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Court Selection */}
                        <div>
                            <label className="text-xs font-black text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <MapPin size={14} className="text-saibro-500" /> Quadras Disponíveis ({className})
                            </label>
                            {availableCourts.length === 0 ? (
                                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3">
                                    <AlertCircle className="text-red-500 shrink-0" size={18} />
                                    <p className="text-red-600 text-xs font-bold">Não há quadras configuradas para esta categoria.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-2">
                                    {availableCourts.map(court => (
                                        <button
                                            key={court.id}
                                            type="button"
                                            onClick={() => setSelectedCourtId(court.id)}
                                            className={`p-4 rounded-2xl border text-left transition-all flex items-center justify-between ${selectedCourtId === court.id
                                                ? 'bg-saibro-50 border-saibro-500 ring-1 ring-saibro-500 shadow-inner'
                                                : 'bg-white border-stone-100 hover:border-saibro-200'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${selectedCourtId === court.id ? 'bg-saibro-600' : 'bg-stone-200'}`} />
                                                <div>
                                                    <div className="font-black text-stone-800 text-sm tracking-tight">{court.name}</div>
                                                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter">{court.type}</div>
                                                </div>
                                            </div>
                                            {selectedCourtId === court.id && <Check size={16} className="text-saibro-600" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-xs font-black flex items-center gap-3 animate-in fade-in zoom-in-95">
                                <AlertCircle size={18} className="shrink-0" />
                                {error}
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex-none pb-safe-extra">
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="w-full py-4 bg-saibro-600 text-white text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-saibro-100 hover:bg-saibro-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="animate-spin" size={18} />
                                Salvando...
                            </>
                        ) : (
                            <>
                                <Check size={18} />
                                Confirmar e Agendar
                            </>
                        )}
                    </button>
                </div>
            </div>
        </StandardModal>
    );
};
