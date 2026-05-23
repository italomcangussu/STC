import React from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Clock, Trophy, X } from 'lucide-react';
import type { Match } from '../types';
import { formatDateBr } from '../utils';

interface RegistrationLike {
    id: string;
    participant_type: 'socio' | 'guest';
    guest_name?: string | null;
    class: string;
    user?: { name?: string | null; avatar_url?: string | null } | null;
}

interface ChampionshipMatchActionModalProps {
    match: Match;
    registrations: RegistrationLike[];
    roundName: string;
    className: string;
    isAdmin: boolean;
    currentUserId: string;
    scheduleMode: 'schedule' | 'suggested';
    onClose: () => void;
    onLaunch?: () => void;
    onSchedule?: () => void;
}

const getRegistrationName = (registration?: RegistrationLike, fallback = 'Aguardando') => {
    if (!registration) return fallback;
    if (registration.participant_type === 'guest') return registration.guest_name || 'Convidado';
    return registration.user?.name || 'Sócio';
};

const getRegistrationAvatar = (registration?: RegistrationLike) => {
    const name = getRegistrationName(registration, 'Atleta');
    return registration?.user?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
};

const isFinished = (match: Match) => match.status === 'finished';

const getWinnerSide = (match: Match): 'A' | 'B' | null => {
    if (match.winner_registration_id) {
        if (match.winner_registration_id === match.registration_a_id) return 'A';
        if (match.winner_registration_id === match.registration_b_id) return 'B';
    }
    if (match.winnerId) {
        if (match.winnerId === match.playerAId) return 'A';
        if (match.winnerId === match.playerBId) return 'B';
    }
    return null;
};

const ScoreSummary: React.FC<{ match: Match }> = ({ match }) => {
    if (!isFinished(match)) {
        return <span className="text-xs font-black uppercase tracking-widest text-stone-400">Partida pendente</span>;
    }

    if (match.is_walkover) {
        return <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase text-amber-700">W.O.</span>;
    }

    const scoreA = match.scoreA ?? match.score_a ?? [];
    const scoreB = match.scoreB ?? match.score_b ?? [];

    if (scoreA.length === 0 && scoreB.length === 0) {
        return <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase text-blue-700">Finalizada</span>;
    }

    return (
        <div className="flex items-center gap-2">
            {scoreA.map((score, index) => (
                <span key={index} className="rounded-xl bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">
                    {score}-{scoreB[index] ?? 0}
                </span>
            ))}
        </div>
    );
};

const PlayerLine: React.FC<{ registration?: RegistrationLike; winner: boolean; label: string }> = ({ registration, winner, label }) => (
    <div className={`flex items-center gap-3 rounded-2xl border p-3 ${winner ? 'border-saibro-200 bg-saibro-50' : 'border-stone-100 bg-stone-50'}`}>
        <img src={getRegistrationAvatar(registration)} className="h-11 w-11 rounded-full border-2 border-white object-cover shadow-sm" />
        <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-stone-900">{getRegistrationName(registration, label)}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">{registration?.participant_type === 'guest' ? 'Convidado' : registration ? 'Sócio' : 'Origem da chave'}</p>
        </div>
        {winner && <Trophy size={18} className="text-saibro-600" />}
    </div>
);

export const ChampionshipMatchActionModal: React.FC<ChampionshipMatchActionModalProps> = ({
    match,
    registrations,
    roundName,
    className,
    scheduleMode,
    onClose,
    onLaunch,
    onSchedule,
}) => {
    const regA = registrations.find(registration => registration.id === match.registration_a_id);
    const regB = registrations.find(registration => registration.id === match.registration_b_id);
    const winnerSide = getWinnerSide(match);
    const matchNumber = match.match_number ? `J${match.match_number}` : 'Jogo';
    const canShowLaunch = !isFinished(match) && Boolean(onLaunch);
    const canShowSchedule = !isFinished(match) && Boolean(onSchedule);

    return createPortal(
        <div className="fixed inset-0 z-999 flex items-center justify-center bg-stone-950/65 p-4 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex items-start justify-between gap-4 border-b border-stone-100 bg-stone-950 px-5 py-5 text-white">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">{className || 'Classe'}</p>
                        <h3 className="mt-1 text-xl font-black tracking-tight">{matchNumber}</h3>
                        <p className="mt-1 text-xs font-bold text-stone-300">{roundName}</p>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20" aria-label="Fechar">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4 p-5">
                    <PlayerLine registration={regA} winner={winnerSide === 'A'} label="Vencedor anterior" />
                    <PlayerLine registration={regB} winner={winnerSide === 'B'} label="Vencedor anterior" />

                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-3">
                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400">
                                <Calendar size={12} />
                                {scheduleMode === 'suggested' ? 'Sugerido' : 'Agendado'}
                            </p>
                            <p className="text-sm font-black text-stone-800">
                                {match.scheduledDate || match.scheduled_date ? formatDateBr((match.scheduledDate || match.scheduled_date) as string) : 'Sem data'}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-3">
                            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400">
                                <Clock size={12} />
                                Horário
                            </p>
                            <p className="text-sm font-black text-stone-800">
                                {(match.scheduledTime || match.scheduled_time || '').substring(0, 5) || '--:--'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">Status</p>
                            <p className="mt-1 text-sm font-black text-stone-900">{isFinished(match) ? 'Finalizada' : 'Pendente'}</p>
                        </div>
                        <ScoreSummary match={match} />
                    </div>

                    {(canShowLaunch || canShowSchedule) && (
                        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
                            {canShowLaunch && (
                                <button
                                    onClick={onLaunch}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-saibro-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-orange-100 transition-all hover:bg-saibro-700"
                                >
                                    <Trophy size={15} />
                                    Lançar
                                </button>
                            )}
                            {canShowSchedule && (
                                <button
                                    onClick={onSchedule}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-stone-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-stone-200 transition-all hover:bg-stone-800"
                                >
                                    <Clock size={15} />
                                    {scheduleMode === 'suggested' ? 'Editar horário' : 'Agendar'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};
