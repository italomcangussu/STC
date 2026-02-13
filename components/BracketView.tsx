import React from 'react';
import { Trophy, Medal, Users } from 'lucide-react';
import { ChampionshipRegistration, Match } from '../types';
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
    groupName?: string;
    position?: 1 | 2;
    isMathematical: boolean; // Classified mathematically
    avatar?: string | null;
}

const isSemifinalPhase = (phase?: string) => (phase || '').toLowerCase().includes('semi');
const isFinalPhase = (phase?: string) => (phase || '').toLowerCase() === 'final';

export const BracketView: React.FC<BracketViewProps> = ({ groups, registrations, matches, category }) => {
    // Calculate standings for each group in this category
    const categoryGroups = groups.filter(g => g.category === category);
    const categoryGroupMap = new Map<string, any>(categoryGroups.map(group => [group.id, group]));
    const registrationMap = new Map<string, ChampionshipRegistration>(registrations.map(reg => [reg.id, reg]));

    const qualifiedPlayers: QualifiedPlayer[] = [];
    const qualifiedByRegistration = new Map<string, QualifiedPlayer>();

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

            const qualifiedPlayer: QualifiedPlayer = {
                registrationId: reg.id,
                name: reg.participant_type === 'guest' ? (reg.guest_name || 'Convidado') : (reg.user?.name || 'Sócio'),
                groupName: group.group_name,
                position: (idx + 1) as 1 | 2,
                isMathematical,
                avatar: (reg.user as any)?.avatar_url || (reg.user as any)?.avatar || null
            };

            qualifiedPlayers.push(qualifiedPlayer);
            qualifiedByRegistration.set(reg.id, qualifiedPlayer);
        });
    });

    // Organize bracket: 1º A vs 2º B, 1º B vs 2º A
    const groupA = qualifiedPlayers.filter(p => p.groupName === 'A');
    const groupB = qualifiedPlayers.filter(p => p.groupName === 'B');

    const first_A = groupA.find(p => p.position === 1);
    const second_A = groupA.find(p => p.position === 2);
    const first_B = groupB.find(p => p.position === 1);
    const second_B = groupB.find(p => p.position === 2);

    const resolveMatchCategory = (match: Match): string | null => {
        if (match.championship_group_id && categoryGroupMap.has(match.championship_group_id)) {
            return categoryGroupMap.get(match.championship_group_id).category;
        }

        const regA = match.registration_a_id ? registrationMap.get(match.registration_a_id) : undefined;
        const regB = match.registration_b_id ? registrationMap.get(match.registration_b_id) : undefined;
        return regA?.class || regB?.class || null;
    };

    const categoryKnockoutMatches = matches.filter(
        match =>
            resolveMatchCategory(match) === category &&
            (isSemifinalPhase(match.phase) || isFinalPhase(match.phase))
    );
    const semifinalMatches = categoryKnockoutMatches.filter(match => isSemifinalPhase(match.phase));
    const finalMatches = categoryKnockoutMatches.filter(match => isFinalPhase(match.phase));

    const matchHasPair = (match: Match, regA?: string, regB?: string) => {
        if (!regA || !regB) return false;
        return (
            (match.registration_a_id === regA && match.registration_b_id === regB) ||
            (match.registration_a_id === regB && match.registration_b_id === regA)
        );
    };

    let semifinal1Match = semifinalMatches.find(match => matchHasPair(match, first_A?.registrationId, second_B?.registrationId));
    let semifinal2Match = semifinalMatches.find(match => match.id !== semifinal1Match?.id && matchHasPair(match, first_B?.registrationId, second_A?.registrationId));

    const remainingSemifinals = semifinalMatches.filter(match => match.id !== semifinal1Match?.id && match.id !== semifinal2Match?.id);
    if (!semifinal1Match) semifinal1Match = remainingSemifinals[0];
    if (!semifinal2Match) semifinal2Match = remainingSemifinals.find(match => match.id !== semifinal1Match?.id);

    const finalMatch = finalMatches.find(match => match.status === 'finished') || finalMatches[0];

    const getPlayerByRegistration = (registrationId?: string, fallback?: QualifiedPlayer): QualifiedPlayer | undefined => {
        if (!registrationId) return fallback;

        const reg = registrationMap.get(registrationId);
        if (!reg) return fallback;

        const qualified = qualifiedByRegistration.get(registrationId);
        return {
            registrationId,
            name: reg.participant_type === 'guest' ? (reg.guest_name || 'Convidado') : (reg.user?.name || 'Sócio'),
            groupName: qualified?.groupName || fallback?.groupName,
            position: qualified?.position || fallback?.position,
            isMathematical: qualified?.isMathematical ?? true,
            avatar: (reg.user as any)?.avatar_url || (reg.user as any)?.avatar || null
        };
    };

    const semifinal1 = {
        match: semifinal1Match,
        playerA: semifinal1Match ? getPlayerByRegistration(semifinal1Match.registration_a_id, first_A) : first_A,
        playerB: semifinal1Match ? getPlayerByRegistration(semifinal1Match.registration_b_id, second_B) : second_B
    };
    const semifinal2 = {
        match: semifinal2Match,
        playerA: semifinal2Match ? getPlayerByRegistration(semifinal2Match.registration_a_id, first_B) : first_B,
        playerB: semifinal2Match ? getPlayerByRegistration(semifinal2Match.registration_b_id, second_A) : second_A
    };
    const finalPlayers = {
        playerA: finalMatch ? getPlayerByRegistration(finalMatch.registration_a_id) : undefined,
        playerB: finalMatch ? getPlayerByRegistration(finalMatch.registration_b_id) : undefined
    };

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
                            <p className="mt-3 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                {renderMatchStatus(semifinal1.match)}
                            </p>
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
                            <p className="mt-3 text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                {renderMatchStatus(semifinal2.match)}
                            </p>
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
                            {renderPlayer(finalPlayers.playerA, 'Vencedor Semi 1')}
                            <div className="text-center px-2">
                                <div className="w-12 h-12 rounded-full bg-linear-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                                    <span className="text-sm font-black text-white">VS</span>
                                </div>
                            </div>
                            {renderPlayer(finalPlayers.playerB, 'Vencedor Semi 2')}
                        </div>
                        <p className="mt-4 text-center text-[10px] font-bold text-yellow-800 uppercase tracking-wider">
                            {renderMatchStatus(finalMatch)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
