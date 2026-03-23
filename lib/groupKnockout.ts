import { ChampionshipRegistration, ChampionshipRound, Match } from '../types';
import { calculateGroupStandings } from './championshipUtils';

interface GroupMember {
    registration_id: string;
}

interface ChampionshipGroupDetail {
    id: string;
    category: string;
    group_name: string;
    members: GroupMember[];
}

export interface QualifiedKnockoutPlayer {
    registrationId: string;
    name: string;
    groupName?: string;
    position?: 1 | 2;
    isMathematical: boolean;
    avatar?: string | null;
}

export interface ResolvedKnockoutSlot {
    match?: Match;
    playerA?: QualifiedKnockoutPlayer;
    playerB?: QualifiedKnockoutPlayer;
}

export interface GroupKnockoutBracketData {
    semifinal1: ResolvedKnockoutSlot;
    semifinal2: ResolvedKnockoutSlot;
    finalMatch?: Match;
    finalPlayers: {
        playerA?: QualifiedKnockoutPlayer;
        playerB?: QualifiedKnockoutPlayer;
    };
}

const isSemifinalPhase = (phase?: string) => (phase || '').toLowerCase().includes('semi');
const isFinalPhase = (phase?: string) => (phase || '').toLowerCase() === 'final';

export const getGroupStageMatches = (matches: Match[], groupId?: string) => (
    matches.filter((match) => {
        if (!groupId || match.championship_group_id !== groupId) return false;
        return !isSemifinalPhase(match.phase) && !isFinalPhase(match.phase);
    })
);

const getRegistrationName = (registration?: ChampionshipRegistration) => {
    if (!registration) return 'Sócio';
    return registration.participant_type === 'guest'
        ? (registration.guest_name || 'Convidado')
        : (registration.user?.name || 'Sócio');
};

const matchHasPair = (match: Match, regA?: string, regB?: string) => {
    if (!regA || !regB) return false;
    return (
        (match.registration_a_id === regA && match.registration_b_id === regB) ||
        (match.registration_a_id === regB && match.registration_b_id === regA)
    );
};

const pickOfficialPairMatch = (matches: Match[], regA?: string, regB?: string) => {
    if (!regA || !regB) return undefined;

    const pairMatches = matches.filter((match) => matchHasPair(match, regA, regB));
    return pairMatches.find((match) => match.status === 'finished')
        || pairMatches.find((match) => match.status === 'pending')
        || pairMatches[0];
};

const getPlayerByRegistration = (
    registrationMap: Map<string, ChampionshipRegistration>,
    qualifiedByRegistration: Map<string, QualifiedKnockoutPlayer>,
    registrationId?: string,
    fallback?: QualifiedKnockoutPlayer
): QualifiedKnockoutPlayer | undefined => {
    if (!registrationId) return fallback;

    const registration = registrationMap.get(registrationId);
    if (!registration) return fallback;

    const qualified = qualifiedByRegistration.get(registrationId);
    return {
        registrationId,
        name: getRegistrationName(registration),
        groupName: qualified?.groupName || fallback?.groupName,
        position: qualified?.position || fallback?.position,
        isMathematical: qualified?.isMathematical ?? true,
        avatar: (registration.user as any)?.avatar_url || (registration.user as any)?.avatar || null
    };
};

export const buildGroupKnockoutBracketData = (
    groups: ChampionshipGroupDetail[],
    registrations: ChampionshipRegistration[],
    matches: Match[],
    category: string
): GroupKnockoutBracketData => {
    const categoryGroups = groups.filter((group) => group.category === category);
    const categoryGroupMap = new Map<string, ChampionshipGroupDetail>(categoryGroups.map((group) => [group.id, group]));
    const registrationMap = new Map<string, ChampionshipRegistration>(registrations.map((registration) => [registration.id, registration]));
    const qualifiedPlayers: QualifiedKnockoutPlayer[] = [];
    const qualifiedByRegistration = new Map<string, QualifiedKnockoutPlayer>();

    categoryGroups.forEach((group) => {
        const groupMatches = getGroupStageMatches(matches, group.id);
        const groupMemberIds = group.members.map((member) => member.registration_id);
        const groupRegistrations = registrations.filter((registration) => groupMemberIds.includes(registration.id));
        const standings = calculateGroupStandings(groupRegistrations, groupMatches);
        const totalMatchesPerPlayer = Math.max(groupRegistrations.length - 1, 0);

        standings.slice(0, 2).forEach((standing, index) => {
            const registration = groupRegistrations.find((groupRegistration) => groupRegistration.id === standing.userId);
            if (!registration) return;

            const matchesRemaining = totalMatchesPerPlayer - standing.matchesPlayed;
            const maxPossibleForThird = standings[2] ? standings[2].points + (matchesRemaining * 3) : 0;
            const isMathematical = standing.matchesPlayed > 0 && (standing.points > maxPossibleForThird || matchesRemaining === 0);

            const qualifiedPlayer: QualifiedKnockoutPlayer = {
                registrationId: registration.id,
                name: getRegistrationName(registration),
                groupName: group.group_name,
                position: (index + 1) as 1 | 2,
                isMathematical,
                avatar: (registration.user as any)?.avatar_url || (registration.user as any)?.avatar || null
            };

            qualifiedPlayers.push(qualifiedPlayer);
            qualifiedByRegistration.set(registration.id, qualifiedPlayer);
        });
    });

    const groupA = qualifiedPlayers.filter((player) => player.groupName === 'A');
    const groupB = qualifiedPlayers.filter((player) => player.groupName === 'B');

    const firstA = groupA.find((player) => player.position === 1);
    const secondA = groupA.find((player) => player.position === 2);
    const firstB = groupB.find((player) => player.position === 1);
    const secondB = groupB.find((player) => player.position === 2);

    const resolveMatchCategory = (match: Match): string | null => {
        if (match.championship_group_id && categoryGroupMap.has(match.championship_group_id)) {
            return categoryGroupMap.get(match.championship_group_id)?.category || null;
        }

        const registrationA = match.registration_a_id ? registrationMap.get(match.registration_a_id) : undefined;
        const registrationB = match.registration_b_id ? registrationMap.get(match.registration_b_id) : undefined;
        return registrationA?.class || registrationB?.class || null;
    };

    const categoryKnockoutMatches = matches.filter((match) => (
        resolveMatchCategory(match) === category
        && (isSemifinalPhase(match.phase) || isFinalPhase(match.phase))
    ));
    const semifinalMatches = categoryKnockoutMatches.filter((match) => isSemifinalPhase(match.phase));
    const finalMatches = categoryKnockoutMatches.filter((match) => isFinalPhase(match.phase));

    const semifinal1Match = pickOfficialPairMatch(semifinalMatches, firstA?.registrationId, secondB?.registrationId);
    const semifinal2Match = pickOfficialPairMatch(semifinalMatches, secondA?.registrationId, firstB?.registrationId);
    const finalMatch = finalMatches.find((match) => match.status === 'finished') || finalMatches[0];

    return {
        semifinal1: {
            match: semifinal1Match,
            playerA: firstA,
            playerB: secondB
        },
        semifinal2: {
            match: semifinal2Match,
            playerA: secondA,
            playerB: firstB
        },
        finalMatch,
        finalPlayers: {
            playerA: finalMatch
                ? getPlayerByRegistration(registrationMap, qualifiedByRegistration, finalMatch.registration_a_id)
                : undefined,
            playerB: finalMatch
                ? getPlayerByRegistration(registrationMap, qualifiedByRegistration, finalMatch.registration_b_id)
                : undefined
        }
    };
};

export const getRoundMatchesForDisplay = (
    round: Pick<ChampionshipRound, 'id' | 'phase'>,
    groups: ChampionshipGroupDetail[],
    registrations: ChampionshipRegistration[],
    matches: Match[]
): Match[] => {
    const roundMatches = matches.filter((match) => match.round_id === round.id);
    if (round.phase !== 'mata-mata-semifinal' || groups.length === 0) {
        return roundMatches;
    }

    const seenMatchIds = new Set<string>();
    const categories = [...new Set(groups.map((group) => group.category).filter(Boolean))]
        .sort((categoryA, categoryB) => categoryA.localeCompare(categoryB, 'pt-BR', { numeric: true }));
    const officialMatches = categories.flatMap((category) => {
        const bracket = buildGroupKnockoutBracketData(groups, registrations, matches, category);
        return [bracket.semifinal1.match, bracket.semifinal2.match].filter((match): match is Match => {
            if (!match || match.round_id !== round.id || seenMatchIds.has(match.id)) return false;
            seenMatchIds.add(match.id);
            return true;
        });
    });

    return officialMatches.length > 0 ? officialMatches : roundMatches;
};
