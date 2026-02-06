import React from 'react';
import { X, Trophy, Target, TrendingUp, Award } from 'lucide-react';
import { StandardModal } from './StandardModal';
import { InternalStanding, ChampionshipRegistration } from '../types';

interface StandingsDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    standings: InternalStanding[];
    registrations: ChampionshipRegistration[];
    groupName: string;
    category: string;
}

export const StandingsDetailModal: React.FC<StandingsDetailModalProps> = ({
    isOpen,
    onClose,
    standings,
    registrations,
    groupName,
    category
}) => {
    const getPlayerName = (regId: string) => {
        const reg = registrations.find(r => r.id === regId);
        if (!reg) return 'Desconhecido';
        return reg.participant_type === 'guest' ? (reg.guest_name || 'Convidado') : (reg.user?.name || 'Sócio');
    };

    const getPositionBadge = (position: number) => {
        const colors = [
            'bg-linear-to-br from-yellow-400 to-yellow-600 text-white shadow-lg', // 1º
            'bg-linear-to-br from-gray-300 to-gray-400 text-stone-800 shadow-md', // 2º
            'bg-linear-to-br from-orange-400 to-orange-600 text-white shadow-md', // 3º
            'bg-stone-200 text-stone-600 shadow-sm' // 4º+
        ];

        const icons = [Trophy, Award, Award, Target];
        const Icon = icons[Math.min(position - 1, icons.length - 1)];

        return (
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${colors[Math.min(position - 1, colors.length - 1)]}`}>
                <Icon className="w-5 h-5" />
            </div>
        );
    };

    return (
        <StandardModal isOpen={isOpen} onClose={onClose}>
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-linear-to-r from-saibro-600 to-saibro-700 p-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black text-white">Estatísticas Detalhadas</h2>
                        <p className="text-saibro-100 text-sm font-medium">{category} - Grupo {groupName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <X size={24} className="text-white" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-4">
                        {standings.map((s, idx) => {
                            const playerName = getPlayerName(s.userId);
                            const setsDiff = s.setsWon - s.setsLost;
                            const gamesDiff = s.gamesWon - s.gamesLost;
                            const winRate = s.matchesPlayed > 0 ? ((s.wins / s.matchesPlayed) * 100).toFixed(0) : '0';

                            return (
                                <div
                                    key={s.userId}
                                    className={`bg-stone-50 rounded-2xl p-5 border-2 transition-all ${
                                        idx < 2
                                            ? 'border-green-300 bg-green-50/50 shadow-md'
                                            : 'border-stone-200'
                                    }`}
                                >
                                    {/* Player Header */}
                                    <div className="flex items-center gap-4 mb-4">
                                        {getPositionBadge(idx + 1)}
                                        <div className="flex-1">
                                            <h3 className="text-lg font-black text-stone-800">{playerName}</h3>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-xs font-bold text-stone-600">
                                                    {s.matchesPlayed} {s.matchesPlayed === 1 ? 'partida' : 'partidas'}
                                                </span>
                                                <span className="text-xs text-stone-400">•</span>
                                                <span className="text-xs font-bold text-green-600">
                                                    {winRate}% vitórias
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-3xl font-black text-saibro-600">{s.points}</div>
                                            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Pontos</div>
                                        </div>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {/* Vitórias/Derrotas */}
                                        <div className="bg-white rounded-xl p-3 border border-stone-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Trophy className="w-4 h-4 text-green-600" />
                                                <p className="text-[10px] font-bold text-stone-400 uppercase">V/D</p>
                                            </div>
                                            <p className="text-xl font-black text-stone-800">
                                                {s.wins} <span className="text-sm text-stone-400">/ {s.losses}</span>
                                            </p>
                                        </div>

                                        {/* Saldo de Sets */}
                                        <div className="bg-white rounded-xl p-3 border border-stone-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <TrendingUp className="w-4 h-4 text-blue-600" />
                                                <p className="text-[10px] font-bold text-stone-400 uppercase">Sets</p>
                                            </div>
                                            <p className="text-xl font-black text-stone-800">
                                                {s.setsWon} <span className="text-sm text-stone-400">/ {s.setsLost}</span>
                                            </p>
                                            <p className={`text-xs font-bold mt-1 ${setsDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {setsDiff >= 0 ? '+' : ''}{setsDiff}
                                            </p>
                                        </div>

                                        {/* Saldo de Games */}
                                        <div className="bg-white rounded-xl p-3 border border-stone-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Target className="w-4 h-4 text-purple-600" />
                                                <p className="text-[10px] font-bold text-stone-400 uppercase">Games</p>
                                            </div>
                                            <p className="text-xl font-black text-stone-800">
                                                {s.gamesWon} <span className="text-sm text-stone-400">/ {s.gamesLost}</span>
                                            </p>
                                            <p className={`text-xs font-bold mt-1 ${gamesDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {gamesDiff >= 0 ? '+' : ''}{gamesDiff}
                                            </p>
                                        </div>

                                        {/* Aproveitamento */}
                                        <div className="bg-white rounded-xl p-3 border border-stone-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Award className="w-4 h-4 text-orange-600" />
                                                <p className="text-[10px] font-bold text-stone-400 uppercase">Aproveitamento</p>
                                            </div>
                                            <p className="text-xl font-black text-stone-800">{winRate}%</p>
                                            <div className="w-full bg-stone-200 h-1.5 rounded-full mt-2 overflow-hidden">
                                                <div
                                                    className="bg-linear-to-r from-green-400 to-green-600 h-full transition-all duration-500"
                                                    style={{ width: `${winRate}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Qualification Badge */}
                                    {idx < 2 && (
                                        <div className="mt-4 bg-green-100 border border-green-300 rounded-xl p-3 flex items-center gap-2">
                                            <Trophy className="w-4 h-4 text-green-700" />
                                            <p className="text-xs font-bold text-green-800">
                                                {idx === 0 ? '1º Classificado - Semifinal' : '2º Classificado - Semifinal'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Tiebreaker Info */}
                    <div className="mt-6 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                        <h4 className="text-xs font-black text-blue-800 uppercase tracking-wider mb-2">Critérios de Desempate</h4>
                        <ol className="text-xs text-blue-700 space-y-1">
                            <li className="flex items-start gap-2">
                                <span className="font-black">1.</span>
                                <span>Maior número de pontos (⭐ principal)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-black">2.</span>
                                <span>Confronto direto (quem ganhou no jogo entre os atletas empatados)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-black">3.</span>
                                <span>Melhor saldo de sets (sets vencidos - sets perdidos)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-black">4.</span>
                                <span>Melhor saldo de games (games vencidos - games perdidos)</span>
                            </li>
                        </ol>
                    </div>
                </div>
            </div>
        </StandardModal>
    );
};
