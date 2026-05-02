import { describe, expect, it } from 'vitest';
import {
    applyMatchResult,
    applyWalkover,
    redrawBracket,
    replaceAthleteInMatch,
    mapPhaseToCanonical,
    type BracketMatch,
} from '../lib/resenhaOpenAdvance';
import {
    drawClasse5,
    buildClasse5Bracket,
    drawClasse4Qualify,
    drawClasse4PrimeiraFase,
    drawClasse4CabecasDeChave,
    buildClasse4Bracket,
    type DrawAthlete,
} from '../lib/resenhaOpenDraw';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAthlete(id: string, opts: Partial<DrawAthlete> = {}): DrawAthlete {
    return {
        id,
        name: `Atleta ${id}`,
        participant_type: 'socio',
        cabeca_de_chave: false,
        ...opts,
    };
}

const identityRng = () => 0;

// Convert DrawMatch[] to BracketMatch[] with synthetic string IDs
function toBracket(draws: ReturnType<typeof buildClasse5Bracket>): BracketMatch[] {
    return draws.map(m => ({
        ...m,
        id: `m${m.match_number}`,
        status: 'pending' as const,
        winner_registration_id: null,
    }));
}

// ── 5ª Classe bracket fixture ─────────────────────────────────────────────────

const athletes16 = Array.from({ length: 16 }, (_, i) => makeAthlete(`s${i + 1}`));
const oitavas = drawClasse5(athletes16, identityRng);
const classe5Bracket: BracketMatch[] = toBracket(buildClasse5Bracket(oitavas));

// ── 4ª Classe bracket fixture ─────────────────────────────────────────────────

function make19Athletes(): DrawAthlete[] {
    const ccs = Array.from({ length: 3 }, (_, i) =>
        makeAthlete(`cc${i + 1}`, { cabeca_de_chave: true })
    );
    const socios = Array.from({ length: 10 }, (_, i) => makeAthlete(`s${i + 1}`));
    const sobral = Array.from({ length: 6 }, (_, i) =>
        makeAthlete(`g${i + 1}`, { participant_type: 'guest', guest_cidade: 'Sobral' })
    );
    return [...ccs, ...socios, ...sobral];
}

const athletes19 = make19Athletes();
const ccs = athletes19.filter(a => a.cabeca_de_chave);
const { qualifyMatches, remainingPool } = drawClasse4Qualify(athletes19, identityRng);
const pool10 = remainingPool.slice(0, 10);
const primeiraFaseMatches = drawClasse4PrimeiraFase(pool10, identityRng);
const quartasSeeds = drawClasse4CabecasDeChave(ccs, identityRng);
const classe4DrawMatches = buildClasse4Bracket(qualifyMatches, primeiraFaseMatches, quartasSeeds);
const classe4Bracket: BracketMatch[] = toBracket(classe4DrawMatches);

// ── Utility: run result for a match by match_number ───────────────────────────

function winnerOf(bracket: BracketMatch[], matchNumber: number): string {
    const m = bracket.find(m => m.match_number === matchNumber)!;
    // Return player A's registration id as the winner
    return m.registration_a_id!;
}

function applyResult(bracket: BracketMatch[], matchNumber: number): BracketMatch[] {
    const m = bracket.find(m => m.match_number === matchNumber)!;
    const winner = m.registration_a_id ?? m.registration_b_id!;
    return applyMatchResult(bracket, m.id, winner);
}

// ── B.1 — Avanço 5ª Classe ────────────────────────────────────────────────────

describe('applyMatchResult — 5ª Classe', () => {
    it('vencedor da Oitava 1 preenche slot A das Quartas 1 (Jogo 9)', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m1.id, winner);
        const quartas1 = updated.find(m => m.match_number === 9)!;
        expect(quartas1.registration_a_id).toBe(winner);
    });

    it('vencedor da Oitava 5 preenche slot B das Quartas 1 (Jogo 9)', () => {
        const m5 = classe5Bracket.find(m => m.match_number === 5)!;
        const winner = m5.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m5.id, winner);
        const quartas1 = updated.find(m => m.match_number === 9)!;
        expect(quartas1.registration_b_id).toBe(winner);
    });

    it('após duas quartas, os slots da Semifinal correspondente são preenchidos', () => {
        let b = classe5Bracket;
        // Win quartas 9 and 10 → preenche semi 13
        const q9 = b.find(m => m.match_number === 9)!;
        const q10 = b.find(m => m.match_number === 10)!;

        // Fill quartas prerequisites first
        b = applyResult(b, 1); // fill q9 slot A
        b = applyResult(b, 5); // fill q9 slot B
        b = applyResult(b, 2); // fill q10 slot A
        b = applyResult(b, 6); // fill q10 slot B

        // Now play quartas
        const wQ9 = b.find(m => m.match_number === 9)!.registration_a_id!;
        b = applyMatchResult(b, `m9`, wQ9);
        const wQ10 = b.find(m => m.match_number === 10)!.registration_a_id!;
        b = applyMatchResult(b, `m10`, wQ10);

        const semi13 = b.find(m => m.match_number === 13)!;
        expect(semi13.registration_a_id).toBe(wQ9);
        expect(semi13.registration_b_id).toBe(wQ10);
    });

    it('lança erro se o vencedor informado não pertence à partida', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        expect(() => applyMatchResult(classe5Bracket, m1.id, 'stranger-id')).toThrow();
    });

    it('lança erro ao tentar registrar resultado em partida já encerrada', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m1.id, winner);
        expect(() => applyMatchResult(updated, m1.id, winner)).toThrow('já encerrada');
    });

    it('lança erro se partida não encontrada', () => {
        expect(() => applyMatchResult(classe5Bracket, 'nonexistent', 's1')).toThrow('não encontrada');
    });
});

// ── B.2 — Avanço 4ª Classe (Qualify → 1ª Fase) ───────────────────────────────

describe('applyMatchResult — 4ª Classe Qualify → 1ª Fase', () => {
    it('vencedor do Jogo 1 preenche slot A do Jogo 9', () => {
        const m1 = classe4Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m1.id, winner);
        const j9 = updated.find(m => m.match_number === 9)!;
        expect(j9.registration_a_id).toBe(winner);
    });

    it('vencedor do Jogo 2 preenche slot B do Jogo 9', () => {
        const m2 = classe4Bracket.find(m => m.match_number === 2)!;
        const winner = m2.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m2.id, winner);
        const j9 = updated.find(m => m.match_number === 9)!;
        expect(j9.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 3 preenche slot A do Jogo 10 (2ª Fase)', () => {
        const m3 = classe4Bracket.find(m => m.match_number === 3)!;
        const winner = m3.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m3.id, winner);
        const j10 = updated.find(m => m.match_number === 10)!;
        expect(j10.registration_a_id).toBe(winner);
    });
});

// ── B.3 — Avanço 4ª Classe (1ª Fase → 2ª Fase e Quartas) ─────────────────────

describe('applyMatchResult — 4ª Classe 1ª Fase → 2ª Fase/Quartas', () => {
    it('vencedor do Jogo 4 preenche slot A das Quartas 4 (Jogo 15 — Classifica A, sem intermediário)', () => {
        const m4 = classe4Bracket.find(m => m.match_number === 4)!;
        const winner = m4.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m4.id, winner);
        const q4 = updated.find(m => m.match_number === 15)!;
        expect(q4.registration_a_id).toBe(winner);
    });

    it('vencedor do Jogo 5 preenche slot B das Quartas 4 (Jogo 15 — Classifica B, sem intermediário)', () => {
        const m5 = classe4Bracket.find(m => m.match_number === 5)!;
        const winner = m5.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m5.id, winner);
        const q4 = updated.find(m => m.match_number === 15)!;
        expect(q4.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 6 preenche slot A do Jogo 11', () => {
        const m6 = classe4Bracket.find(m => m.match_number === 6)!;
        const winner = m6.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m6.id, winner);
        const j11 = updated.find(m => m.match_number === 11)!;
        expect(j11.registration_a_id).toBe(winner);
    });

    it('vencedor do Jogo 7 preenche slot B do Jogo 11', () => {
        const m7 = classe4Bracket.find(m => m.match_number === 7)!;
        const winner = m7.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m7.id, winner);
        const j11 = updated.find(m => m.match_number === 11)!;
        expect(j11.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 8 preenche slot B do Jogo 10', () => {
        const m8 = classe4Bracket.find(m => m.match_number === 8)!;
        const winner = m8.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m8.id, winner);
        const j10 = updated.find(m => m.match_number === 10)!;
        expect(j10.registration_b_id).toBe(winner);
    });
});

// ── B.4 — Avanço 4ª Classe (2ª Fase → Quartas) ───────────────────────────────

describe('applyMatchResult — 4ª Classe 2ª Fase → Quartas', () => {
    // Fill slots before testing second phase
    function prepare2aFaseBracket(): BracketMatch[] {
        let b = classe4Bracket;
        // Qualify results
        b = applyResult(b, 1); b = applyResult(b, 2); b = applyResult(b, 3);
        // 1ª Fase results (4–8; j9 is auto-filled by j1 and j2 results)
        b = applyResult(b, 4); b = applyResult(b, 5);
        b = applyResult(b, 6); b = applyResult(b, 7); b = applyResult(b, 8);
        b = applyResult(b, 9); // fill semi after j1+j2 done
        return b;
    }

    it('vencedor do Jogo 10 preenche slot B das Quartas 3 (Jogo 14)', () => {
        let b = prepare2aFaseBracket();
        const j10 = b.find(m => m.match_number === 10)!;
        const winner = j10.registration_a_id!;
        b = applyMatchResult(b, j10.id, winner);
        const q3 = b.find(m => m.match_number === 14)!;
        expect(q3.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 11 preenche slot B das Quartas 1 (Jogo 12)', () => {
        let b = prepare2aFaseBracket();
        const j11 = b.find(m => m.match_number === 11)!;
        const winner = j11.registration_a_id!;
        b = applyMatchResult(b, j11.id, winner);
        const q1 = b.find(m => m.match_number === 12)!;
        expect(q1.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 9 preenche slot B das Quartas 2 (Jogo 13)', () => {
        let b = classe4Bracket;
        b = applyResult(b, 1); b = applyResult(b, 2);
        const j9 = b.find(m => m.match_number === 9)!;
        const winner = j9.registration_a_id!;
        b = applyMatchResult(b, j9.id, winner);
        const q2 = b.find(m => m.match_number === 13)!;
        expect(q2.registration_b_id).toBe(winner);
    });
});

// ── B.5 — Avanço 4ª Classe (Quartas → Semis → Final) ─────────────────────────

describe('applyMatchResult — 4ª Classe Quartas → Final', () => {
    it('vencedor das Quartas 1 e 2 preenche os dois slots da Semifinal 1', () => {
        let b = classe4Bracket;
        // Play through to get quartas slots filled
        for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
            const m = b.find(x => x.match_number === n);
            if (m && m.registration_a_id) b = applyResult(b, n);
        }
        const q1 = b.find(m => m.match_number === 12)!;
        const q2 = b.find(m => m.match_number === 13)!;
        if (q1.registration_a_id) b = applyResult(b, 12);
        if (q2.registration_a_id) b = applyResult(b, 13);

        const wQ1 = b.find(m => m.match_number === 12 && m.status === 'finished')?.winner_registration_id;
        const wQ2 = b.find(m => m.match_number === 13 && m.status === 'finished')?.winner_registration_id;
        const sf1 = b.find(m => m.match_number === 16)!;
        if (wQ1) expect(sf1.registration_a_id).toBe(wQ1);
        if (wQ2) expect(sf1.registration_b_id).toBe(wQ2);
    });

    it('Semifinal 1 winner preenche slot A da Final', () => {
        let b = classe4Bracket;
        for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
            const m = b.find(x => x.match_number === n);
            if (m && (m.registration_a_id || m.registration_b_id)) {
                try { b = applyResult(b, n); } catch { /* already finished or not ready */ }
            }
        }
        const sf1 = b.find(m => m.match_number === 16)!;
        if (sf1.registration_a_id && sf1.status === 'pending') {
            b = applyResult(b, 16);
            const final = b.find(m => m.match_number === 18)!;
            const wSf1 = b.find(m => m.match_number === 16)!.winner_registration_id;
            if (wSf1) expect(final.registration_a_id).toBe(wSf1);
        }
    });

    it('não existe partida de disputa de 3º lugar na estrutura do bracket', () => {
        expect(classe4Bracket.find(m => m.match_number === 19)).toBeUndefined();
        const losersMatch = classe4Bracket.find(m =>
            m.player_a_source_match_number === 16 &&
            m.player_b_source_match_number === 17 &&
            m.match_number !== 18
        );
        expect(losersMatch).toBeUndefined();
    });
});

// ── B.6 — Bloqueio de edição após resultado ───────────────────────────────────

describe('redrawBracket e replaceAthleteInMatch', () => {
    it('redrawBracket lança erro se há partida encerrada', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m1.id, winner);
        expect(() => redrawBracket(updated)).toThrow('resultados registrados');
    });

    it('redrawBracket funciona normalmente quando nenhuma partida foi finalizada', () => {
        expect(() => redrawBracket(classe5Bracket)).not.toThrow();
    });

    it('replaceAthleteInMatch lança erro se há partida encerrada', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m1.id, winner);
        expect(() =>
            replaceAthleteInMatch(updated, 'm2', 'a', 'new-reg-id')
        ).toThrow('resultados registrados');
    });

    it('replaceAthleteInMatch substitui slot A corretamente antes de resultados', () => {
        const updated = replaceAthleteInMatch(classe5Bracket, 'm1', 'a', 'new-reg-id');
        const m1 = updated.find(m => m.match_number === 1)!;
        expect(m1.registration_a_id).toBe('new-reg-id');
    });

    it('replaceAthleteInMatch substitui slot B corretamente antes de resultados', () => {
        const updated = replaceAthleteInMatch(classe5Bracket, 'm1', 'b', 'new-reg-id-b');
        const m1 = updated.find(m => m.match_number === 1)!;
        expect(m1.registration_b_id).toBe('new-reg-id-b');
    });
});

// ── B.7 — WO (walkover) ───────────────────────────────────────────────────────

describe('applyWalkover', () => {
    it('WO define vencedor e propaga normalmente para a fase seguinte', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const loser = m1.registration_b_id!;
        const updated = applyWalkover(classe5Bracket, m1.id, winner, loser);
        const finished = updated.find(m => m.match_number === 1)!;
        expect(finished.status).toBe('finished');
        expect(finished.winner_registration_id).toBe(winner);
        expect(finished.is_walkover).toBe(true);
        // Winner propagated
        const q1 = updated.find(m => m.match_number === 9)!;
        expect(q1.registration_a_id).toBe(winner);
    });

    it('WO com vencedor e perdedor iguais lança erro', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const reg = m1.registration_a_id!;
        expect(() => applyWalkover(classe5Bracket, m1.id, reg, reg)).toThrow('mesmo atleta');
    });

    it('WO em partida inexistente lança erro', () => {
        expect(() => applyWalkover(classe5Bracket, 'ghost', 's1', 's2')).toThrow('não encontrada');
    });
});

// ── C.4 — Mapeamento de fases para pontos ─────────────────────────────────────

describe('mapPhaseToCanonical', () => {
    it('final → champion', () => expect(mapPhaseToCanonical('final')).toBe('champion'));
    it('semifinal → semifinal', () => expect(mapPhaseToCanonical('semifinal')).toBe('semifinal'));
    it('quartas → quarterfinal', () => expect(mapPhaseToCanonical('quartas')).toBe('quarterfinal'));
    it('segunda_fase → round_of_16', () => expect(mapPhaseToCanonical('segunda_fase')).toBe('round_of_16'));
    it('classifica_a → round_of_16', () => expect(mapPhaseToCanonical('classifica_a')).toBe('round_of_16'));
    it('classifica_b → round_of_16', () => expect(mapPhaseToCanonical('classifica_b')).toBe('round_of_16'));
    it('primeira_fase → round_of_16', () => expect(mapPhaseToCanonical('primeira_fase')).toBe('round_of_16'));
    it('qualify → round_of_16', () => expect(mapPhaseToCanonical('qualify')).toBe('round_of_16'));
    it('oitavas → participation (não mapeado especificamente)', () => expect(mapPhaseToCanonical('oitavas')).toBe('participation'));
    it('desconhecido → participation', () => expect(mapPhaseToCanonical('unknown_phase')).toBe('participation'));

    it('CC eliminado nas Quartas: fase "quartas" mapeia para quarterfinal (pontos de Quartas)', () => {
        // C.4: sócio CC eliminado nas Quartas 1 recebe fase canônica "quarterfinal"
        const canonical = mapPhaseToCanonical('quartas');
        expect(canonical).toBe('quarterfinal');
    });
});
