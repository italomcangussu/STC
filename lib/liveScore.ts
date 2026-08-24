import type { Match, Reservation } from '../types';

/**
 * Contrato entre a Agenda e o marcador ao vivo.
 *
 * Existe como módulo próprio porque o elo que faltava era invisível: a Agenda
 * montava a partida do `LiveScoreboard` com `registration_a_id: undefined`
 * escrito na mão, o placar era gravado com `winner_registration_id = NULL` e o
 * trigger `propagate_bracket_winner` desistia em silêncio — vencedor definido,
 * chave seguinte vazia, nenhum erro em lugar nenhum. Com o mapeamento aqui, o
 * elo tem teste.
 */

const SETS_NO_MARCADOR = 3;

/** Completa (ou corta) o placar nos três sets que o marcador desenha. */
function normalizarSets(score: number[] | undefined): number[] {
    const base = score && score.length > 0 ? score : [];
    return [...base, ...Array(Math.max(0, SETS_NO_MARCADOR - base.length)).fill(0)]
        .slice(0, SETS_NO_MARCADOR);
}

/**
 * Converte a reserva exibida na Agenda na partida que o marcador ao vivo grava.
 * As inscrições (`matchRegistration*Id`) são o que permite ao banco promover o
 * vencedor para a próxima chave — sem elas o resultado é gravado, mas morre ali.
 */
export function buildLiveScoreMatch(res: Reservation): Match {
    return {
        id: res.matchId as string,
        championshipId: undefined,
        type: 'Campeonato',
        playerAId: res.participantIds?.[0] || null,
        playerBId: res.participantIds?.[1] || null,
        scoreA: normalizarSets(res.scoreA),
        scoreB: normalizarSets(res.scoreB),
        phase: undefined,
        slot: undefined,
        winnerId: undefined,
        date: res.date,
        scheduledDate: res.date,
        scheduledTime: res.startTime,
        status: 'pending',
        championship_group_id: undefined,
        round_id: undefined,
        scheduled_date: res.date,
        scheduled_time: res.startTime,
        court_id: res.courtId,
        registration_a_id: res.matchRegistrationAId ?? undefined,
        registration_b_id: res.matchRegistrationBId ?? undefined,
        is_walkover: undefined,
        walkover_winner_id: undefined,
    };
}

export interface WinnerIdentity {
    winnerId: string | null;
    winnerRegistrationId: string | null;
}

/**
 * Quem venceu, nas duas identidades que o banco usa: `winner_id` (perfil) e
 * `winner_registration_id` (inscrição no campeonato).
 *
 * Em partida de campeonato a inscrição é obrigatória e a falta dela é erro, não
 * omissão: gravar `null` aqui trava a chave sem avisar ninguém. Desafio de
 * ranking não tem chave para avançar, então segue sem inscrição.
 */
export function resolveWinnerIdentity(match: Match, winner: 'A' | 'B'): WinnerIdentity {
    const winnerId = (winner === 'A' ? match.playerAId : match.playerBId) ?? null;
    const winnerRegistrationId = (winner === 'A' ? match.registration_a_id : match.registration_b_id) ?? null;

    if (match.type === 'Campeonato' && !winnerRegistrationId) {
        throw new Error(
            'Esta partida de campeonato está sem a inscrição do vencedor. ' +
            'Salvar assim deixaria a próxima chave vazia.'
        );
    }

    return { winnerId, winnerRegistrationId };
}
