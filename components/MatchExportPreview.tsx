import React, { forwardRef } from 'react';
import { Match, User, Championship } from '../types';
import { Trophy, Calendar, MapPin, Ticket } from 'lucide-react';
import { getNowInFortaleza } from '../utils';

interface MatchExportPreviewProps {
    championship: Championship;
    matches: Match[];
    profiles: User[];
    date: string; // YYYY-MM-DD
    groupName?: string; // e.g., "6ª CLASSE"
}

export const MatchExportPreview = forwardRef<HTMLDivElement, MatchExportPreviewProps>(({
    championship, matches, profiles, date, groupName
}, ref) => {

    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Fortaleza'
    });

    // Helper to get player data
    const getPlayer = (id: string | null) => {
        if (!id) return { name: 'TBD', avatar: null };
        const p = profiles.find(u => u.id === id);
        return p ? { name: p.name, avatar: p.avatar } : { name: 'Convidado', avatar: null };
    };

    return (
        <div ref={ref} className="w-[600px] bg-stone-900 text-white overflow-hidden relative font-sans" style={{ minHeight: '800px' }}>
            {/* BACKGROUND PATTERN */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-saibro-500 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-court-green rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2"></div>
            </div>

            {/* HEADER */}
            <div className="relative p-8 pb-4 flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center p-2 shadow-xl backdrop-blur-sm">
                        {championship.logoUrl ? (
                            <img src={championship.logoUrl} className="w-full h-full object-contain drop-shadow-md" />
                        ) : (
                            <Trophy className="text-saibro-500 w-10 h-10" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded-md bg-saibro-500 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
                                {groupName || 'Fase de Grupos'}
                            </span>
                        </div>
                        <h1 className="text-2xl font-black uppercase italic tracking-tighter leading-none mb-1 text-transparent bg-clip-text bg-linear-to-r from-white to-stone-400">
                            {championship.name}
                        </h1>
                        <p className="text-stone-400 text-sm font-medium flex items-center gap-1.5 capitalize">
                            <Calendar size={14} className="text-saibro-500" /> {formattedDate}
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-1 mx-auto backdrop-blur-md border border-white/10">
                        <Ticket className="text-stone-300" size={24} />
                    </div>
                    <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest">Agenda do Dia</p>
                </div>
            </div>

            {/* MATCHES LIST */}
            <div className="relative p-6 space-y-4">
                {matches.length === 0 ? (
                    <div className="text-center py-20 text-stone-500">
                        <p>Nenhuma partida agendada.</p>
                    </div>
                ) : (
                    matches.map((match, idx) => {
                        const pA = getPlayer(match.playerAId);
                        const pB = getPlayer(match.playerBId);
                        const time = match.scheduledTime || 'A definir';

                        return (
                            <div key={idx} className="flex items-center bg-white/5 rounded-xl border border-white/5 p-3 relative overflow-hidden backdrop-blur-sm">
                                {/* Time Strip */}
                                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-saibro-500"></div>

                                {/* Time */}
                                <div className="pl-4 pr-6 flex flex-col items-center justify-center border-r border-white/10 w-24 shrink-0">
                                    <span className="text-2xl font-black text-white italic tracking-tighter">{time}</span>
                                    <span className="text-[10px] uppercase font-bold text-stone-500">Horário</span>
                                </div>

                                {/* Players */}
                                <div className="flex-1 flex items-center justify-between px-6">
                                    {/* Player A */}
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="w-12 h-12 rounded-full bg-stone-800 border-2 border-stone-600 flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                                            {pA.avatar ? (
                                                <img src={pA.avatar} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-stone-500 font-bold text-lg">{pA.name[0]}</span>
                                            )}
                                        </div>
                                        <span className="text-sm font-bold text-stone-200 uppercase truncate leading-tight">
                                            {pA.name.split(' ').slice(0, 2).join(' ')}
                                        </span>
                                    </div>

                                    {/* VS */}
                                    <div className="mx-2 flex flex-col items-center">
                                        <span className="text-stone-600 font-black italic text-lg opacity-50">VS</span>
                                    </div>

                                    {/* Player B */}
                                    <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
                                        <span className="text-sm font-bold text-stone-200 uppercase truncate leading-tight text-right">
                                            {pB.name.split(' ').slice(0, 2).join(' ')}
                                        </span>
                                        <div className="w-12 h-12 rounded-full bg-stone-800 border-2 border-stone-600 flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                                            {pB.avatar ? (
                                                <img src={pB.avatar} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-stone-500 font-bold text-lg">{pB.name[0]}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* FOOTER */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-linear-to-t from-black/80 to-transparent flex items-end justify-between">
                <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-court-green" />
                    <span className="text-sm font-bold text-stone-300">Reserva SCT</span>
                </div>
                <div className="text-right">
                    <p className="text-[10px] text-stone-500 uppercase tracking-widest mb-0.5">Organização</p>
                    <p className="text-xs font-bold text-white">SCT TENNIS</p>
                </div>
            </div>
        </div>
    );
});

MatchExportPreview.displayName = 'MatchExportPreview';
