import React from 'react';
import { Trophy, Medal, Users } from 'lucide-react';
import { ChampionshipRegistration, ChampionshipGroup, Match } from '../types';
import { calculateGroupStandings } from '../lib/championshipUtils';

interface BracketViewProps {
    groups: any[]; // Groups with members
    registrations: ChampionshipRegistration[];
    matches: Match[];
    category: string; // "6ª Classe", etc.
}

interface QualifiedPlayer {
    registrationId: string;
    name: string;
    groupName: string;
    position: 1 | 2;
    isMathematical: boolean; // Classified mathematically
}

export const BracketView: React.FC<BracketViewProps> = ({ groups, registrations, matches, category }) => {
    // Calculate standings for each group in this category
    const categoryGroups = groups.filter(g => g.category === category);

    const qualifiedPlayers: QualifiedPlayer[] = [];

    categoryGroups.forEach(group => {
        const groupMatches = matches.filter(m => m.championship_group_id === group.id);
        const groupMemberIds = group.members.map((m: any) => m.registration_id);
        const groupRegs = registrations.filter(r => groupMemberIds.includes(r.id));

        const standings = calculateGroupStandings(groupRegs, groupMatches);

        // Get total matches to play in group (round-robin calculation)
        const n = groupRegs.length;
        const totalMatchesPerPlayer = n - 1;

        // Top 2 qualify
        standings.slice(0, 2).forEach((s, idx) => {
            const reg = groupRegs.find(r => r.id === s.userId);
            if (!reg) return;

            // Mathematical qualification check
            // If player has enough points that 3rd place can't catch up
            const matchesPlayed = s.matchesPlayed;
            const matchesRemaining = totalMatchesPerPlayer - matchesPlayed;
            const maxPossibleFor3rd = standings[2] ? standings[2].points + (matchesRemaining * 3) : 0;
            const isMathematical = matchesPlayed > 0 && (s.points > maxPossibleFor3rd || matchesRemaining === 0);

            qualifiedPlayers.push({
                registrationId: reg.id,
                name: reg.participant_type === 'guest' ? (reg.guest_name || 'Convidado') : (reg.user?.name || 'Sócio'),
                groupName: group.group_name,
                position: (idx + 1) as 1 | 2,
                isMathematical
            });
        });
    });

    // Organize bracket: 1º A vs 2º B, 1º B vs 2º A
    const groupA = qualifiedPlayers.filter(p => p.groupName === 'A');
    const groupB = qualifiedPlayers.filter(p => p.groupName === 'B');

    const first_A = groupA.find(p => p.position === 1);
    const second_A = groupA.find(p => p.position === 2);
    const first_B = groupB.find(p => p.position === 1);
    const second_B = groupB.find(p => p.position === 2);

    const semifinal1 = { playerA: first_A, playerB: second_B };
    const semifinal2 = { playerA: first_B, playerB: second_A };

    const renderPlayer = (player: QualifiedPlayer | undefined, label: string) => {
        // Only show player if mathematically qualified
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

        // Only mathematically qualified players are shown with their names
        return (
            <div className="flex-1 p-4 rounded-xl border-2 bg-green-50 border-green-500 transition-all">
                <div className="flex items-center justify-between">
                    <div className="flex-1">
                        <p className="font-black text-stone-800 text-sm">{player.name}</p>
                        <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                            {player.position === 1 ? '1º' : '2º'} - Grupo {player.groupName}
                        </p>
                    </div>
                    <Trophy className="w-5 h-5 text-green-600" />
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {/* Legend */}
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

            {/* Bracket */}
            <div className="space-y-6">
                {/* Semifinais */}
                <div>
                    <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Medal className="w-4 h-4" />
                        Semifinais
                    </h3>
                    <div className="space-y-4">
                        {/* Semifinal 1 */}
                        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                            <p className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-3">Semifinal 1</p>
                            <div className="flex gap-3 items-center">
                                {renderPlayer(semifinal1.playerA, '1º Grupo A')}
                                <div className="text-center px-2">
                                    <div className="w-10 h-10 rounded-full bg-saibro-100 flex items-center justify-center">
                                        <span className="text-xs font-black text-saibro-600">VS</span>
                                    </div>
                                </div>
                                {renderPlayer(semifinal1.playerB, '2º Grupo B')}
                            </div>
                        </div>

                        {/* Semifinal 2 */}
                        <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                            <p className="text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-3">Semifinal 2</p>
                            <div className="flex gap-3 items-center">
                                {renderPlayer(semifinal2.playerA, '1º Grupo B')}
                                <div className="text-center px-2">
                                    <div className="w-10 h-10 rounded-full bg-saibro-100 flex items-center justify-center">
                                        <span className="text-xs font-black text-saibro-600">VS</span>
                                    </div>
                                </div>
                                {renderPlayer(semifinal2.playerB, '2º Grupo A')}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Final */}
                <div>
                    <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        Final
                    </h3>
                    <div className="bg-linear-to-br from-yellow-50 to-orange-50 rounded-2xl p-6 border-2 border-yellow-400 shadow-lg">
                        <p className="text-center text-[10px] font-black text-yellow-700 uppercase tracking-widest mb-4">Grande Final</p>
                        <div className="flex gap-3 items-center">
                            <div className="flex-1 p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-yellow-200 flex items-center justify-center">
                                <p className="text-xs font-bold text-stone-600 text-center">Vencedor<br/>Semifinal 1</p>
                            </div>
                            <div className="text-center px-2">
                                <div className="w-12 h-12 rounded-full bg-linear-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                                    <span className="text-sm font-black text-white">VS</span>
                                </div>
                            </div>
                            <div className="flex-1 p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-yellow-200 flex items-center justify-center">
                                <p className="text-xs font-bold text-stone-600 text-center">Vencedor<br/>Semifinal 2</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
