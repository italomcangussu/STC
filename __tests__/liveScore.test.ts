import { describe, expect, it } from 'vitest';
import { buildLiveScoreMatch, resolveWinnerIdentity } from '../lib/liveScore';
import type { Reservation } from '../types';

const championshipReservation: Reservation = {
    id: 'match_7e723f25',
    matchId: '7e723f25',
    type: 'Campeonato',
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '21:30',
    courtId: 'court-1',
    creatorId: 'system',
    participantIds: ['user-thieslley', 'user-diego'],
    participantNames: ['Thieslley Soares', 'Diego Memória'],
    participantAvatars: [null, null],
    scoreA: [0, 0],
    scoreB: [0, 0],
    matchStatus: 'pending',
    matchWinnerId: null,
    matchIsWalkover: false,
    matchRegistrationAId: 'reg-thieslley',
    matchRegistrationBId: 'reg-diego',
    matchWalkoverWinnerRegistrationId: null,
    status: 'active',
};

describe('buildLiveScoreMatch', () => {
    /**
     * O bug: a Agenda montava o placar ao vivo com `registration_a_id: undefined`.
     * Sem a inscrição, a partida é gravada com `winner_registration_id = NULL` e o
     * trigger `propagate_bracket_winner` desiste em silêncio — o vencedor nunca
     * chega à chave seguinte.
     */
    it('leva as inscrições da reserva para a partida do placar ao vivo', () => {
        const match = buildLiveScoreMatch(championshipReservation);

        expect(match.registration_a_id).toBe('reg-thieslley');
        expect(match.registration_b_id).toBe('reg-diego');
    });

    it('usa o id da partida, e não o id sintético da reserva', () => {
        expect(buildLiveScoreMatch(championshipReservation).id).toBe('7e723f25');
    });

    it('completa o placar em três sets para o marcador', () => {
        const match = buildLiveScoreMatch({ ...championshipReservation, scoreA: [6], scoreB: [1] });

        expect(match.scoreA).toEqual([6, 0, 0]);
        expect(match.scoreB).toEqual([1, 0, 0]);
    });

    it('preserva o placar já lançado quando a partida é reaberta', () => {
        const match = buildLiveScoreMatch({ ...championshipReservation, scoreA: [6, 6], scoreB: [1, 3] });

        expect(match.scoreA).toEqual([6, 6, 0]);
        expect(match.scoreB).toEqual([1, 3, 0]);
    });
});

describe('resolveWinnerIdentity', () => {
    const match = buildLiveScoreMatch(championshipReservation);

    it('devolve atleta e inscrição do vencedor', () => {
        expect(resolveWinnerIdentity(match, 'A')).toEqual({
            winnerId: 'user-thieslley',
            winnerRegistrationId: 'reg-thieslley',
        });
        expect(resolveWinnerIdentity(match, 'B')).toEqual({
            winnerId: 'user-diego',
            winnerRegistrationId: 'reg-diego',
        });
    });

    /**
     * Recusar é melhor do que gravar `null`: o placar aparecia certo na tela e a
     * chave ficava parada, sem erro nenhum para ninguém ver.
     */
    it('recusa partida de campeonato sem a inscrição do vencedor', () => {
        const semInscricao = { ...match, registration_a_id: undefined };

        expect(() => resolveWinnerIdentity(semInscricao, 'A')).toThrow(/inscrição/i);
    });

    it('aceita desafio de ranking sem inscrição — não há chave para avançar', () => {
        const desafio = { ...match, type: 'Desafio Ranking' as const, registration_a_id: undefined };

        expect(resolveWinnerIdentity(desafio, 'A')).toEqual({
            winnerId: 'user-thieslley',
            winnerRegistrationId: null,
        });
    });
});
