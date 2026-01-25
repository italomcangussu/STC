import React from 'react';
import { InternalStanding } from '../types';
import { Trophy, Medal, AlertCircle } from 'lucide-react';

interface Props {
    standings: InternalStanding[]; // Should be sorted already
    groupName: string;
    registrations: any[]; // To map registration ID to Name
}

export const GroupStandingsCard: React.FC<Props> = ({ standings, groupName, registrations }) => {
    const getPlayerName = (regId: string) => {
        const reg = registrations.find(r => r.id === regId);
        if (!reg) return 'Desconhecido';
        if (reg.participant_type === 'guest') return reg.guest_name;
        return reg.user?.name || 'Sócio';
    };

    return (
        <div className="bg-white rounded-[2.5rem] shadow-sm border border-stone-100 overflow-hidden">
            <div className="bg-stone-50/50 px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-saibro-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-saibro-100">
                        <Trophy size={16} />
                    </div>
                    <div>
                        <h3 className="font-black text-stone-800 text-xs uppercase tracking-tighter">
                            Grupo {groupName}
                        </h3>
                        <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">Classificação</p>
                    </div>
                </div>
                <div className="bg-white px-3 py-1 rounded-full border border-stone-200 text-[10px] font-black text-stone-400">
                    LIVE
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[10px] text-stone-400 uppercase tracking-widest border-b border-stone-50">
                            <th className="py-4 px-4 text-left font-black w-10">Pos</th>
                            <th className="py-4 px-2 text-left font-black">Atleta</th>
                            <th className="py-4 px-2 text-center font-black">Pts</th>
                            <th className="py-4 px-2 text-center font-black">V</th>
                            <th className="py-4 px-2 text-center font-black hidden sm:table-cell">Sets</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50/50">
                        {standings.map((standing, index) => {
                            const isLeader = index === 0;
                            const isQualified = index < 2;
                            const setsBalance = standing.setsWon - standing.setsLost;

                            return (
                                <tr key={standing.userId} className={`transition-colors ${isQualified ? 'bg-white' : 'bg-stone-50/10'}`}>
                                    <td className="py-4 px-4">
                                        <div className={`w-7 h-7 flex items-center justify-center rounded-xl text-xs font-black
                                        ${index === 0 ? 'bg-amber-100 text-amber-700 shadow-sm' :
                                                index === 1 ? 'bg-stone-100 text-stone-600 shadow-sm' : 'text-stone-300'}`}>
                                            {index + 1}
                                        </div>
                                    </td>
                                    <td className="py-4 px-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`font-bold text-sm ${isLeader ? 'text-stone-900' : 'text-stone-600'}`}>
                                                {getPlayerName(standing.userId)}
                                            </span>
                                            {isQualified && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 px-2 text-center font-black text-stone-900 text-base">{standing.points}</td>
                                    <td className="py-4 px-2 text-center font-bold text-green-600">{standing.wins}</td>
                                    <td className="py-4 px-2 text-center text-stone-400 hidden sm:table-cell font-mono">
                                        {setsBalance > 0 ? `+${setsBalance}` : setsBalance}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="px-6 py-3 bg-stone-50/30 flex items-center justify-between border-t border-stone-100">
                <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter">Zona de Classificação</span>
                </div>
                <button className="text-[10px] font-black text-saibro-600 uppercase tracking-widest">Detalhes</button>
            </div>
        </div>
    );
};
