// Pure, side-effect-free bracket-advancement logic for the Resenha Open.
// Works on an in-memory representation (BracketMatch[]) so the same functions
// serve both unit tests and the DB-write layer (resenhaOpenService.ts).

import type { DrawMatch } from './resenhaOpenDraw';

export interface BracketMatch extends DrawMatch {
    id: string;           // UUID in production; match_number string in tests
    status: 'pending' | 'finished';
    winner_registration_id: string | null;
    is_walkover?: boolean;
}

// ── Apply a result (regular or WO) ───────────────────────────────────────────

export function applyMatchResult(
    bracket: BracketMatch[],
    matchId: string,
    winnerRegistrationId: string
): BracketMatch[] {
    const match = bracket.find(m => m.id === matchId);
    if (!match) throw new Error(`applyMatchResult: partida ${matchId} não encontrada`);
    if (match.status === 'finished') throw new Error(`applyMatchResult: partida ${matchId} já encerrada`);

    // Winner must be one of the two registered players
    if (
        match.registration_a_id !== winnerRegistrationId &&
        match.registration_b_id !== winnerRegistrationId
    ) {
        throw new Error(
            `applyMatchResult: vencedor ${winnerRegistrationId} não pertence à partida ${matchId}`
        );
    }

    // Update the finished match, then propagate into dependents
    const updated: BracketMatch[] = bracket.map(m =>
        m.id === matchId
            ? { ...m, status: 'finished', winner_registration_id: winnerRegistrationId }
            : m
    );

    return propagateWinner(updated, match.match_number, winnerRegistrationId);
}

export function applyWalkover(
    bracket: BracketMatch[],
    matchId: string,
    winnerRegistrationId: string,
    loserRegistrationId: string
): BracketMatch[] {
    if (winnerRegistrationId === loserRegistrationId) {
        throw new Error('applyWalkover: vencedor e perdedor não podem ser o mesmo atleta');
    }
    const match = bracket.find(m => m.id === matchId);
    if (!match) throw new Error(`applyWalkover: partida ${matchId} não encontrada`);
    if (match.status === 'finished') throw new Error(`applyWalkover: partida ${matchId} já encerrada`);

    const updated: BracketMatch[] = bracket.map(m =>
        m.id === matchId
            ? { ...m, status: 'finished', winner_registration_id: winnerRegistrationId, is_walkover: true }
            : m
    );
    return propagateWinner(updated, match.match_number, winnerRegistrationId);
}

// ── Bracket editing (only allowed before any results) ────────────────────────

export function redrawBracket(bracket: BracketMatch[]): never | BracketMatch[] {
    if (bracket.some(m => m.status === 'finished')) {
        throw new Error('redrawBracket: não é possível refazer o sorteio após resultados registrados');
    }
    return bracket;
}

export function replaceAthleteInMatch(
    bracket: BracketMatch[],
    matchId: string,
    slot: 'a' | 'b',
    newRegistrationId: string
): BracketMatch[] {
    if (bracket.some(m => m.status === 'finished')) {
        throw new Error('replaceAthleteInMatch: não é possível editar confrontos após resultados registrados');
    }
    return bracket.map(m => {
        if (m.id !== matchId) return m;
        return slot === 'a'
            ? { ...m, registration_a_id: newRegistrationId }
            : { ...m, registration_b_id: newRegistrationId };
    });
}

// ── Final-phase mapping for points calculation ────────────────────────────────
// Maps Resenha Open's internal round phases to the canonical final_phase values
// used by apply_championship_edition_points.

export type CanonicalPhase =
    | 'champion'
    | 'finalist'
    | 'semifinal'
    | 'quarterfinal'
    | 'round_of_16'
    | 'participation';

export function mapPhaseToCanonical(roundPhase: string): CanonicalPhase {
    switch (roundPhase) {
        case 'final':        return 'champion';  // loser corrected by caller to 'finalist'
        case 'semifinal':    return 'semifinal';
        case 'quartas':      return 'quarterfinal';
        case 'segunda_fase':
        case 'classifica_a':
        case 'classifica_b':
        case 'primeira_fase':
        case 'qualify':      return 'round_of_16';
        default:             return 'participation';
    }
}

// ── Internal helper ───────────────────────────────────────────────────────────

function propagateWinner(
    bracket: BracketMatch[],
    sourceMatchNumber: number,
    winnerRegistrationId: string
): BracketMatch[] {
    return bracket.map(m => {
        let next = { ...m };
        if (m.player_a_source_match_number === sourceMatchNumber && m.registration_a_id === null) {
            next = { ...next, registration_a_id: winnerRegistrationId };
        }
        if (m.player_b_source_match_number === sourceMatchNumber && m.registration_b_id === null) {
            next = { ...next, registration_b_id: winnerRegistrationId };
        }
        return next;
    });
}
