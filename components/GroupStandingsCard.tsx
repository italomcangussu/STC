import React from 'react';
import { InternalStanding } from '../types';
import { Trophy, Medal, AlertCircle } from 'lucide-react';

interface Props {
    standings: InternalStanding[]; // Should be sorted already
    groupName: string;
    registrations: any[]; // To map registration ID to Name
    onShowDetails?: () => void;
}

export const GroupStandingsCard: React.FC<Props> = ({ standings, groupName, registrations, onShowDetails }) => {
    const getPlayerName = (regId: string) => {
        const reg = registrations.find(r => r.id === regId);
        if (!reg) return 'Desconhecido';
        if (reg.participant_type === 'guest') return reg.guest_name;
        return reg.user?.name || 'Sócio';
    };

    return (
        <div className="bg-white rounded-3xl shadow-lg shadow-stone-200/50 border-2 border-stone-100 overflow-hidden hover:shadow-xl hover:border-saibro-300 transition-all duration-300">
            {/* Header */}
            <div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 px-6 py-5 border-b-2 border-white/10 flex items-center justify-between relative overflow-hidden">
                {/* Decoração */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-12 -mt-12" />
                
                <div className="flex items-center gap-3 relative z-10">
                    <div className="w-10 h-10 bg-white/20 backdrop-blur-sm text-white rounded-2xl flex items-center justify-center shadow-lg border-2 border-white/30">
                        <Trophy size={20} strokeWidth={2.5} className="drop-shadow" />
                    </div>
                    <div>
                        <h3 className="font-black text-white text-sm uppercase tracking-tight drop-shadow-md">
                            {groupName}
                        </h3>
                        <p className="text-xs text-white/90 font-bold uppercase tracking-wide drop-shadow-sm">Classificação</p>
                    </div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm px-4 py-1.5 rounded-full border-2 border-white/30 text-xs font-black text-white shadow-lg">
                    LIVE
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-stone-500 uppercase tracking-wide bg-linear-to-r from-stone-50 to-stone-100 border-b-2 border-stone-200">
                            <th className="py-4 px-5 text-left font-black">Pos</th>
                            <th className="py-4 px-3 text-left font-black">Atleta</th>
                            <th className="py-4 px-3 text-center font-black">Pts</th>
                            <th className="py-4 px-3 text-center font-black">V</th>
                            <th className="py-4 px-3 text-center font-black hidden sm:table-cell">Sets</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-stone-100">
                        {standings.map((standing, index) => {
                            const isLeader = index === 0;
                            const isQualified = index < 2;
                            const setsBalance = standing.setsWon - standing.setsLost;

                            return (
                                <tr 
                                    key={standing.userId} 
                                    className={`transition-all duration-200 ${
                                        isQualified 
                                            ? 'bg-linear-to-r from-emerald-50/30 to-green-50/20 hover:from-emerald-50/50 hover:to-green-50/30' 
                                            : 'hover:bg-stone-50'
                                    }`}
                                >
                                    <td className="py-4 px-5">
                                        <div className={`w-8 h-8 flex items-center justify-center rounded-xl text-sm font-black shadow-sm transition-all
                                        ${index === 0 
                                            ? 'bg-linear-to-br from-amber-400 to-amber-500 text-white shadow-amber-200' :
                                          index === 1 
                                            ? 'bg-linear-to-br from-stone-300 to-stone-400 text-white shadow-stone-200' : 
                                          index === 2
                                            ? 'bg-linear-to-br from-orange-300 to-orange-400 text-white shadow-orange-200'
                                            : 'bg-stone-100 text-stone-400'
                                        }`}>
                                            {index + 1}
                                        </div>
                                    </td>
                                    <td className="py-4 px-3">
                                        <div className="flex items-center gap-2">
                                            <span className={`font-black text-sm transition-colors ${isLeader ? 'text-stone-900' : 'text-stone-700'}`}>
                                                {getPlayerName(standing.userId)}
                                            </span>
                                            {isQualified && (
                                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-200" />
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 px-3 text-center">
                                        <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-xl bg-linear-to-br from-saibro-500 to-saibro-600 text-white font-black text-sm shadow-sm shadow-saibro-200">
                                            {standing.points}
                                        </span>
                                    </td>
                                    <td className="py-4 px-3 text-center">
                                        <span className="inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-xl bg-emerald-100 text-emerald-700 font-black text-sm border-2 border-emerald-200">
                                            {standing.wins}
                                        </span>
                                    </td>
                                    <td className="py-4 px-3 text-center hidden sm:table-cell">
                                        <span className={`inline-flex items-center justify-center min-w-10 h-8 px-2 rounded-xl font-black text-sm ${
                                            setsBalance > 0 
                                                ? 'bg-green-100 text-green-700 border-2 border-green-200'
                                                : setsBalance < 0
                                                ? 'bg-red-100 text-red-700 border-2 border-red-200'
                                                : 'bg-stone-100 text-stone-500 border-2 border-stone-200'
                                        }`}>
                                            {setsBalance > 0 ? `+${setsBalance}` : setsBalance}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-linear-to-r from-stone-50 to-stone-100 flex items-center justify-between border-t-2 border-stone-200">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-200" />
                    <span className="text-xs font-black text-stone-600 uppercase tracking-tight">Zona de Classificação</span>
                </div>
                <button 
                    onClick={onShowDetails}
                    className="bg-linear-to-br from-saibro-600 to-saibro-700 text-white text-xs font-black uppercase tracking-wide px-4 py-2 rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200"
                >
                    Detalhes
                </button>
            </div>
        </div>
    );
};
