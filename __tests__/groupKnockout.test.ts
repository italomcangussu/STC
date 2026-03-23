import { describe, expect, it } from 'vitest';
import { ChampionshipRegistration, ChampionshipRound, Match } from '../types';
import { buildGroupKnockoutBracketData, getRoundMatchesForDisplay } from '../lib/groupKnockout';

const semifinalRound: ChampionshipRound = {
    id: 'round-semi',
    championship_id: 'champ-1',
    round_number: 4,
    name: 'Semifinais',
    phase: 'mata-mata-semifinal',
    start_date: '2026-03-13',
    end_date: '2026-03-20',
    status: 'active'
};

const createRegistration = (id: string, className: string, name: string): ChampionshipRegistration => ({
    id,
    championship_id: 'champ-1',
    participant_type: 'socio',
    user_id: `user-${id}`,
    guest_name: null,
    class: className,
    shirt_size: 'M',
    user: {
        id: `user-${id}`,
        name,
        email: '',
        phone: '',
        role: 'socio',
        balance: 0,
        isActive: true
    }
});

const createFinishedWin = (
    id: string,
    groupId: string,
    winner: ChampionshipRegistration,
    loser: ChampionshipRegistration
): Match => ({
    id,
    championshipId: 'champ-1',
    type: 'Campeonato',
    playerAId: winner.user_id,
    playerBId: loser.user_id,
    registration_a_id: winner.id,
    registration_b_id: loser.id,
    championship_group_id: groupId,
    round_id: 'round-groups',
    scoreA: [6, 6],
    scoreB: [0, 0],
    winnerId: winner.user_id,
    winner_registration_id: winner.id,
    status: 'finished'
});

const createSemifinal = (
    id: string,
    groupId: string,
    playerA: ChampionshipRegistration,
    playerB: ChampionshipRegistration,
    status: Match['status']
): Match => ({
    id,
    championshipId: 'champ-1',
    type: 'Campeonato',
    phase: 'Semi',
    playerAId: playerA.user_id,
    playerBId: playerB.user_id,
    registration_a_id: playerA.id,
    registration_b_id: playerB.id,
    championship_group_id: groupId,
    round_id: semifinalRound.id,
    scoreA: status === 'finished' ? [6, 6] : [0, 0, 0],
    scoreB: status === 'finished' ? [2, 3] : [0, 0, 0],
    winnerId: status === 'finished' ? playerA.user_id : null,
    winner_registration_id: status === 'finished' ? playerA.id : null,
    status
});

const registrations = {
    tiago: createRegistration('reg-tiago', '4ª Classe', 'Tiago Gomes'),
    diego: createRegistration('reg-diego', '4ª Classe', 'Diego Memoria'),
    carlos: createRegistration('reg-carlos', '4ª Classe', 'Carlos Carneiro'),
    henrique: createRegistration('reg-henrique', '4ª Classe', 'Henrique Coelho'),
    marcelo: createRegistration('reg-marcelo', '4ª Classe', 'Marcelo Sampieri'),
    mario: createRegistration('reg-mario', '4ª Classe', 'Mario Rego'),
    ealber: createRegistration('reg-ealber', '4ª Classe', 'Ealber Luna'),
    thieslley: createRegistration('reg-thieslley', '4ª Classe', 'Thieslley Soares'),
    bruno: createRegistration('reg-bruno', '5ª Classe', 'Bruno Vaz Carvalho'),
    daniel: createRegistration('reg-daniel', '5ª Classe', 'Daniel Leao'),
    marcelino: createRegistration('reg-marcelino', '5ª Classe', 'Marcelino'),
    diegoParente: createRegistration('reg-diego-parente', '5ª Classe', 'Diego Parente'),
    hermeson: createRegistration('reg-hermeson', '5ª Classe', 'Hermeson Veras'),
    davi: createRegistration('reg-davi', '5ª Classe', 'Davi Arcelino'),
    derlan: createRegistration('reg-derlan', '5ª Classe', 'Derlan'),
    mailson: createRegistration('reg-mailson', '5ª Classe', 'Mailson Freitas'),
    italo: createRegistration('reg-italo', '6ª Classe', 'Italo Cangussu'),
    vinicius: createRegistration('reg-vinicius', '6ª Classe', 'Vinicius Cangussu'),
    willams: createRegistration('reg-willams', '6ª Classe', 'Willams Santos'),
    iago: createRegistration('reg-iago', '6ª Classe', 'Iago Ribeiro'),
    jorge: createRegistration('reg-jorge', '6ª Classe', 'Jorge Medeiros'),
    bruninho: createRegistration('reg-bruninho', '6ª Classe', 'Bruninho'),
    julio: createRegistration('reg-julio', '6ª Classe', 'Julio Cesar Cavalcante'),
    moacyr: createRegistration('reg-moacyr', '6ª Classe', 'Moacyr Andrade')
};

const allRegistrations = Object.values(registrations);

const groups = [
    { id: 'group-4a', category: '4ª Classe', group_name: 'A', members: [{ registration_id: registrations.tiago.id }, { registration_id: registrations.diego.id }, { registration_id: registrations.carlos.id }, { registration_id: registrations.henrique.id }] },
    { id: 'group-4b', category: '4ª Classe', group_name: 'B', members: [{ registration_id: registrations.marcelo.id }, { registration_id: registrations.mario.id }, { registration_id: registrations.ealber.id }, { registration_id: registrations.thieslley.id }] },
    { id: 'group-5a', category: '5ª Classe', group_name: 'A', members: [{ registration_id: registrations.bruno.id }, { registration_id: registrations.daniel.id }, { registration_id: registrations.marcelino.id }, { registration_id: registrations.diegoParente.id }] },
    { id: 'group-5b', category: '5ª Classe', group_name: 'B', members: [{ registration_id: registrations.hermeson.id }, { registration_id: registrations.davi.id }, { registration_id: registrations.derlan.id }, { registration_id: registrations.mailson.id }] },
    { id: 'group-6a', category: '6ª Classe', group_name: 'A', members: [{ registration_id: registrations.italo.id }, { registration_id: registrations.vinicius.id }, { registration_id: registrations.willams.id }, { registration_id: registrations.iago.id }] },
    { id: 'group-6b', category: '6ª Classe', group_name: 'B', members: [{ registration_id: registrations.jorge.id }, { registration_id: registrations.bruninho.id }, { registration_id: registrations.julio.id }, { registration_id: registrations.moacyr.id }] }
];

const baseMatches: Match[] = [
    createFinishedWin('4a-1', 'group-4a', registrations.tiago, registrations.diego),
    createFinishedWin('4a-2', 'group-4a', registrations.tiago, registrations.carlos),
    createFinishedWin('4a-3', 'group-4a', registrations.tiago, registrations.henrique),
    createFinishedWin('4a-4', 'group-4a', registrations.diego, registrations.carlos),
    createFinishedWin('4a-5', 'group-4a', registrations.diego, registrations.henrique),
    createFinishedWin('4a-6', 'group-4a', registrations.carlos, registrations.henrique),
    createFinishedWin('4b-1', 'group-4b', registrations.marcelo, registrations.mario),
    createFinishedWin('4b-2', 'group-4b', registrations.marcelo, registrations.ealber),
    createFinishedWin('4b-3', 'group-4b', registrations.marcelo, registrations.thieslley),
    createFinishedWin('4b-4', 'group-4b', registrations.mario, registrations.ealber),
    createFinishedWin('4b-5', 'group-4b', registrations.mario, registrations.thieslley),
    createFinishedWin('4b-6', 'group-4b', registrations.ealber, registrations.thieslley),
    createFinishedWin('5a-1', 'group-5a', registrations.bruno, registrations.daniel),
    createFinishedWin('5a-2', 'group-5a', registrations.bruno, registrations.marcelino),
    createFinishedWin('5a-3', 'group-5a', registrations.bruno, registrations.diegoParente),
    createFinishedWin('5a-4', 'group-5a', registrations.daniel, registrations.marcelino),
    createFinishedWin('5a-5', 'group-5a', registrations.daniel, registrations.diegoParente),
    createFinishedWin('5a-6', 'group-5a', registrations.marcelino, registrations.diegoParente),
    createFinishedWin('5b-1', 'group-5b', registrations.hermeson, registrations.davi),
    createFinishedWin('5b-2', 'group-5b', registrations.hermeson, registrations.derlan),
    createFinishedWin('5b-3', 'group-5b', registrations.hermeson, registrations.mailson),
    createFinishedWin('5b-4', 'group-5b', registrations.davi, registrations.derlan),
    createFinishedWin('5b-5', 'group-5b', registrations.davi, registrations.mailson),
    createFinishedWin('5b-6', 'group-5b', registrations.derlan, registrations.mailson),
    createFinishedWin('6a-1', 'group-6a', registrations.italo, registrations.vinicius),
    createFinishedWin('6a-2', 'group-6a', registrations.italo, registrations.willams),
    createFinishedWin('6a-3', 'group-6a', registrations.italo, registrations.iago),
    createFinishedWin('6a-4', 'group-6a', registrations.vinicius, registrations.willams),
    createFinishedWin('6a-5', 'group-6a', registrations.vinicius, registrations.iago),
    createFinishedWin('6a-6', 'group-6a', registrations.willams, registrations.iago),
    createFinishedWin('6b-1', 'group-6b', registrations.jorge, registrations.bruninho),
    createFinishedWin('6b-2', 'group-6b', registrations.jorge, registrations.julio),
    createFinishedWin('6b-3', 'group-6b', registrations.jorge, registrations.moacyr),
    createFinishedWin('6b-4', 'group-6b', registrations.bruninho, registrations.julio),
    createFinishedWin('6b-5', 'group-6b', registrations.bruninho, registrations.moacyr),
    createFinishedWin('6b-6', 'group-6b', registrations.julio, registrations.moacyr),
    createSemifinal('sf-4-1', 'group-4a', registrations.tiago, registrations.mario, 'finished'),
    createSemifinal('sf-4-dup', 'group-4a', registrations.tiago, registrations.mario, 'pending'),
    createSemifinal('sf-5-1', 'group-5a', registrations.bruno, registrations.davi, 'finished'),
    createSemifinal('sf-5-2', 'group-5a', registrations.hermeson, registrations.daniel, 'finished'),
    createSemifinal('sf-6-1', 'group-6a', registrations.italo, registrations.bruninho, 'finished'),
    createSemifinal('sf-6-dup', 'group-6a', registrations.italo, registrations.bruninho, 'pending')
];

describe('groupKnockout helpers', () => {
    it('filters semifinal round to official pairings and ignores pending duplicates', () => {
        const displayMatches = getRoundMatchesForDisplay(semifinalRound, groups as any, allRegistrations, baseMatches);
        const displayMatchIds = displayMatches.map((match) => match.id);

        expect(displayMatchIds).toEqual(['sf-4-1', 'sf-5-1', 'sf-5-2', 'sf-6-1']);
        expect(displayMatchIds).not.toContain('sf-4-dup');
        expect(displayMatchIds).not.toContain('sf-6-dup');
    });

    it('keeps semifinal 2 display order as 2º do Grupo A x 1º do Grupo B', () => {
        const bracket = buildGroupKnockoutBracketData(groups as any, allRegistrations, baseMatches, '5ª Classe');

        expect(bracket.semifinal2.match?.id).toBe('sf-5-2');
        expect(bracket.semifinal2.playerA?.name).toBe('Daniel Leao');
        expect(bracket.semifinal2.playerB?.name).toBe('Hermeson Veras');
    });

    it('shows all six official semifinals after pending duplicates are replaced by the missing pairings', () => {
        const repairedMatches = [
            ...baseMatches.filter((match) => !['sf-4-dup', 'sf-6-dup'].includes(match.id)),
            createSemifinal('sf-4-2', 'group-4a', registrations.diego, registrations.marcelo, 'pending'),
            createSemifinal('sf-6-2', 'group-6a', registrations.vinicius, registrations.jorge, 'pending')
        ];

        const displayMatches = getRoundMatchesForDisplay(semifinalRound, groups as any, allRegistrations, repairedMatches);
        const displayMatchIds = displayMatches.map((match) => match.id);
        const bracket4 = buildGroupKnockoutBracketData(groups as any, allRegistrations, repairedMatches, '4ª Classe');
        const bracket6 = buildGroupKnockoutBracketData(groups as any, allRegistrations, repairedMatches, '6ª Classe');

        expect(displayMatchIds).toEqual(['sf-4-1', 'sf-4-2', 'sf-5-1', 'sf-5-2', 'sf-6-1', 'sf-6-2']);
        expect(bracket4.semifinal2.playerA?.name).toBe('Diego Memoria');
        expect(bracket4.semifinal2.playerB?.name).toBe('Marcelo Sampieri');
        expect(bracket6.semifinal2.playerA?.name).toBe('Vinicius Cangussu');
        expect(bracket6.semifinal2.playerB?.name).toBe('Jorge Medeiros');
    });
});
