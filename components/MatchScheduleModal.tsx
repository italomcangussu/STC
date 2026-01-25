import React, { useState } from 'react';
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

    // Filter courts based on class
    const availableCourts = courts.filter(court => {
        if (!court.isActive) return false;
        if (['6ª Classe'].includes(className)) return court.type === 'Rápida';
        if (['4ª Classe', '5ª Classe'].includes(className)) return court.type === 'Saibro';
        return true; // 1, 2, 3 classes - any court
    });

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

        // Validate time slot (unless Friday)
        if (!isFriday(date) && !ALL_TIME_SLOTS.includes(time)) {
            // If manual input allowed outside slots, skip this. But req says "Manhã 5h-8h..."
            // Assuming strict slots for now unless logic allows custom
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="bg-saibro-50 p-6 border-b border-saibro-100 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-saibro-900">Agendar Partida</h3>
                        <p className="text-xs text-saibro-700">{roundName} • {formatDateBr(roundStartDate)} a {formatDateBr(roundEndDate)}</p>
                    </div>
                    <button onClick={onClose} className="text-saibro-400 hover:text-saibro-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Date Selection */}
                    <div>
                        <label className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                            <Calendar size={16} className="text-saibro-500" /> Data
                        </label>
                        <input
                            type="date"
                            value={date}
                            min={roundStartDate}
                            max={roundEndDate}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none transition-all"
                        />
                        <p className="text-[10px] text-stone-400 mt-1 pl-1">
                            Período permitido: {formatDateBr(roundStartDate)} a {formatDateBr(roundEndDate)}
                        </p>
                    </div>

                    {/* Time Selection */}
                    <div>
                        <label className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                            <Clock size={16} className="text-saibro-500" /> Horário
                        </label>

                        {isFriday(date) ? (
                            <div>
                                <input
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none transition-all"
                                />
                                <p className="text-[10px] text-green-600 font-bold mt-1 pl-1 flex items-center gap-1">
                                    <Check size={10} /> Sexta-feira: Horário livre!
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2">
                                {ALL_TIME_SLOTS.map(slot => (
                                    <button
                                        key={slot}
                                        type="button"
                                        onClick={() => setTime(slot)}
                                        className={`py-2 px-1 rounded-lg text-xs font-bold border transition-all ${time === slot
                                            ? 'bg-saibro-600 text-white border-saibro-600 shadow-md'
                                            : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                            }`}
                                    >
                                        {slot}
                                    </button>
                                ))}
                            </div>
                        )}
                        {!isFriday(date) && (
                            <p className="text-[10px] text-stone-400 mt-2 pl-1">
                                Slots: Manhã (6h-8h), Tarde (16h-17h), Noite (20h-22h)
                            </p>
                        )}
                    </div>

                    {/* Court Selection */}
                    <div>
                        <label className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                            <MapPin size={16} className="text-saibro-500" /> Quadra
                        </label>
                        {availableCourts.length === 0 ? (
                            <p className="text-red-500 text-sm p-3 bg-red-50 rounded-xl">Não há quadras disponíveis para esta classe ({className}).</p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {availableCourts.map(court => (
                                    <button
                                        key={court.id}
                                        type="button"
                                        onClick={() => setSelectedCourtId(court.id)}
                                        className={`p-3 rounded-xl border text-left transition-all ${selectedCourtId === court.id
                                            ? 'bg-saibro-50 border-saibro-500 ring-1 ring-saibro-500'
                                            : 'bg-white border-stone-200 hover:bg-stone-50'
                                            }`}
                                    >
                                        <div className="font-bold text-stone-800 text-sm">{court.name}</div>
                                        <div className="text-xs text-stone-500">{court.type}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-center gap-2 animate-pulse">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3.5 bg-saibro-600 text-white font-bold rounded-xl shadow-lg shadow-orange-100 hover:bg-saibro-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="animate-spin" size={20} />
                                Salvando...
                            </>
                        ) : (
                            <>
                                <Check size={20} />
                                Confirmar Agendamento
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};
