import React from 'react';
import { Trophy, Medal, Users } from 'lucide-react';
import { ChampionshipRegistration, Match } from '../types';
import { buildGroupKnockoutBracketData, QualifiedKnockoutPlayer } from '../lib/groupKnockout';

interface BracketViewProps {
    groups: any[];
    registrations: ChampionshipRegistration[];
    matches: Match[];
    category: string;
}

export const BracketView: React.FC<BracketViewProps> = ({ groups, registrations, matches, category }) => {
    const bracket = buildGroupKnockoutBracketData(groups, registrations, matches, category);

    const renderPlayer = (player: QualifiedKnockoutPlayer | undefined, label: string) => {
        if (!player || !player.isMathematical) {
            return (
                <div className="flex-1 p-4 bg-stone-100 rounded-xl border-2 border-dashed border-stone-300 flex items-center justify-center">
                    <div className="text-center">
                        <Users className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                        <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">{label}</p>
                        <p className="text-[10px] text-stone-400 mt-1">Aguardando definição</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex-1 p-4 rounded-xl border-2 bg-green-50 border-green-500 transition-all">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                        <p className="font-black text-stone-800 text-sm">{player.name}</p>
                        {player.position && player.groupName && (
                            <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                                {player.position === 1 ? '1º' : '2º'} - Grupo {player.groupName}
                            </p>
                        )}
                    </div>
                    {player.avatar ? (
                        <img src={player.avatar} alt={player.name} className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm" />
                    ) : null}
                    <Trophy className="w-5 h-5 text-green-600" />
                </div>
            </div>
        );
    };

    const renderMatchStatus = (match?: Match) => {
        if (!match) return 'Aguardando definição';
        if (match.status === 'finished') return 'Finalizada';
        if (match.status === 'pending') return 'Pendente';
        return 'Aguardando';
    };

    return (
        <div className="space-y-8">
            <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200">
                <h4 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-3">Legenda</h4>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-50 border-2 border-green-500 rounded-lg flex items-center justify-center">
                            <Trophy className="w-4 h-4 text-green-600" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-stone-800">Classificado</p>
                            <p className="text-[10px] text-stone-500">Matematicamente</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-stone-100 border-2 border-dashed border-stone-300 rounded-lg flex items-center justify-center">
                            <Users className="w-4 h-4 text-stone-400" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-stone-800">Aguardando</p>
                            <p className="text-[10px] text-stone-500">Definição</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                <div>
                    <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Medal className="w-4 h-4" />
                        Semifinais
                    </h3>
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                            <p className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-3">Semifinal 1</p>
                            <div className="flex gap-3 items-center">
                                {renderPlayer(bracket.semifinal1.playerA, '1º Grupo A')}
                                <div className="text-center px-2">
                                    <div className="w-10 h-10 rounded-full bg-saibro-100 flex items-center justify-center">
                                        <span className="text-xs font-black text-saibro-600">VS</span>
                                    </div>
                                </div>
                                {renderPlayer(bracket.semifinal1.playerB, '2º Grupo B')}
                            </div>
                            <p className="mt-3 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                {renderMatchStatus(bracket.semifinal1.match)}
                            </p>
                        </div>

                        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                            <p className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-3">Semifinal 2</p>
                            <div className="flex gap-3 items-center">
                                {renderPlayer(bracket.semifinal2.playerA, '2º Grupo A')}
                                <div className="text-center px-2">
                                    <div className="w-10 h-10 rounded-full bg-saibro-100 flex items-center justify-center">
                                        <span className="text-xs font-black text-saibro-600">VS</span>
                                    </div>
                                </div>
                                {renderPlayer(bracket.semifinal2.playerB, '1º Grupo B')}
                            </div>
                            <p className="mt-3 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                {renderMatchStatus(bracket.semifinal2.match)}
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        Final
                    </h3>
                    <div className="bg-linear-to-br from-yellow-50 to-orange-50 rounded-2xl p-6 border-2 border-yellow-400 shadow-lg">
                        <p className="text-center text-[10px] font-black text-yellow-700 uppercase tracking-widest mb-4">Grande Final</p>
                        <div className="flex gap-3 items-center">
                            {renderPlayer(bracket.finalPlayers.playerA, 'Vencedor Semi 1')}
                            <div className="text-center px-2">
                                <div className="w-12 h-12 rounded-full bg-linear-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                                    <span className="text-sm font-black text-white">VS</span>
                                </div>
                            </div>
                            {renderPlayer(bracket.finalPlayers.playerB, 'Vencedor Semi 2')}
                        </div>
                        <p className="mt-4 text-center text-[10px] font-bold text-yellow-800 uppercase tracking-wider">
                            {renderMatchStatus(bracket.finalMatch)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
