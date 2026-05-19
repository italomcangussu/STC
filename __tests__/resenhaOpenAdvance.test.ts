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
    buildClasse4OfficialBracket,
    type DrawAthlete,
    type DrawMatch,
} from '../lib/resenhaOpenDraw';

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

function toBracket(draws: DrawMatch[]): BracketMatch[] {
    return draws.map(m => ({
        ...m,
        id: `m${m.match_number}`,
        status: 'pending' as const,
        winner_registration_id: null,
    }));
}

const athletes16 = Array.from({ length: 16 }, (_, i) => makeAthlete(`s${i + 1}`));
const classe5Bracket: BracketMatch[] = toBracket(buildClasse5Bracket(drawClasse5(athletes16, identityRng)));

const athletes20 = Array.from({ length: 20 }, (_, i) => makeAthlete(`c4-${i + 1}`));
const classe4Bracket: BracketMatch[] = toBracket(buildClasse4OfficialBracket(athletes20, identityRng));

function applyResult(bracket: BracketMatch[], matchNumber: number): BracketMatch[] {
    const m = bracket.find(m => m.match_number === matchNumber)!;
    const winner = m.registration_a_id ?? m.registration_b_id!;
    return applyMatchResult(bracket, m.id, winner);
}

describe('applyMatchResult — 5ª Classe', () => {
    it('vencedor da Oitava 1 preenche slot A das Quartas 1 (Jogo 9)', () => {
        const m1 = classe5Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m1.id, winner);
        const quartas1 = updated.find(m => m.match_number === 9)!;
        expect(quartas1.registration_a_id).toBe(winner);
    });

    it('vencedor da Oitava 2 preenche slot B das Quartas 1 (Jogo 9)', () => {
        const m2 = classe5Bracket.find(m => m.match_number === 2)!;
        const winner = m2.registration_a_id!;
        const updated = applyMatchResult(classe5Bracket, m2.id, winner);
        const quartas1 = updated.find(m => m.match_number === 9)!;
        expect(quartas1.registration_b_id).toBe(winner);
    });

    it('após duas quartas adjacentes, os slots da Semifinal correspondente são preenchidos', () => {
        let b = classe5Bracket;
        b = applyResult(b, 1);
        b = applyResult(b, 2);
        b = applyResult(b, 3);
        b = applyResult(b, 4);

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

describe('applyMatchResult — 4ª Classe Preliminar → Oitavas', () => {
    it('vencedor do Jogo 1 preenche slot B do Jogo 5', () => {
        const m1 = classe4Bracket.find(m => m.match_number === 1)!;
        const winner = m1.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m1.id, winner);
        const j5 = updated.find(m => m.match_number === 5)!;
        expect(j5.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 2 preenche slot B do Jogo 8', () => {
        const m2 = classe4Bracket.find(m => m.match_number === 2)!;
        const winner = m2.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m2.id, winner);
        const j8 = updated.find(m => m.match_number === 8)!;
        expect(j8.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 3 preenche slot B do Jogo 9', () => {
        const m3 = classe4Bracket.find(m => m.match_number === 3)!;
        const winner = m3.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m3.id, winner);
        const j9 = updated.find(m => m.match_number === 9)!;
        expect(j9.registration_b_id).toBe(winner);
    });

    it('vencedor do Jogo 4 preenche slot B do Jogo 12', () => {
        const m4 = classe4Bracket.find(m => m.match_number === 4)!;
        const winner = m4.registration_a_id!;
        const updated = applyMatchResult(classe4Bracket, m4.id, winner);
        const j12 = updated.find(m => m.match_number === 12)!;
        expect(j12.registration_b_id).toBe(winner);
    });
});

describe('applyMatchResult — 4ª Classe Oitavas → Final', () => {
    function prepareQuartas(): BracketMatch[] {
        let b = classe4Bracket;
        for (const n of [1, 2, 3, 4]) b = applyResult(b, n);
        return b;
    }

    it('vencedores das Oitavas 5 e 6 preenchem Quartas J13', () => {
        let b = prepareQuartas();
        b = applyResult(b, 5);
        b = applyResult(b, 6);
        const w5 = b.find(m => m.match_number === 5)!.winner_registration_id;
        const w6 = b.find(m => m.match_number === 6)!.winner_registration_id;
        const q13 = b.find(m => m.match_number === 13)!;
        expect(q13.registration_a_id).toBe(w5);
        expect(q13.registration_b_id).toBe(w6);
    });

    it('vencedores das Quartas 13 e 14 preenchem Semifinal J17', () => {
        let b = prepareQuartas();
        for (const n of [5, 6, 7, 8]) b = applyResult(b, n);
        b = applyResult(b, 13);
        b = applyResult(b, 14);
        const w13 = b.find(m => m.match_number === 13)!.winner_registration_id;
        const w14 = b.find(m => m.match_number === 14)!.winner_registration_id;
        const sf17 = b.find(m => m.match_number === 17)!;
        expect(sf17.registration_a_id).toBe(w13);
        expect(sf17.registration_b_id).toBe(w14);
    });

    it('vencedores das semifinais 17 e 18 preenchem Final J19', () => {
        let b = prepareQuartas();
        for (const n of [5, 6, 7, 8, 9, 10, 11, 12]) b = applyResult(b, n);
        for (const n of [13, 14, 15, 16]) b = applyResult(b, n);
        b = applyResult(b, 17);
        b = applyResult(b, 18);
        const w17 = b.find(m => m.match_number === 17)!.winner_registration_id;
        const w18 = b.find(m => m.match_number === 18)!.winner_registration_id;
        const final = b.find(m => m.match_number === 19)!;
        expect(final.registration_a_id).toBe(w17);
        expect(final.registration_b_id).toBe(w18);
    });

    it('não existe disputa de 3º lugar', () => {
        const thirdPlace = classe4Bracket.find(m =>
            m.player_a_source_match_number === 17 &&
            m.player_b_source_match_number === 18 &&
            m.match_number !== 19
        );
        expect(thirdPlace).toBeUndefined();
    });
});

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

describe('mapPhaseToCanonical', () => {
    it('final → champion', () => expect(mapPhaseToCanonical('final')).toBe('champion'));
    it('semifinal → semifinal', () => expect(mapPhaseToCanonical('semifinal')).toBe('semifinal'));
    it('quartas → quarterfinal', () => expect(mapPhaseToCanonical('quartas')).toBe('quarterfinal'));
    it('preliminar → round_of_16', () => expect(mapPhaseToCanonical('preliminar')).toBe('round_of_16'));
    it('oitavas → round_of_16', () => expect(mapPhaseToCanonical('oitavas')).toBe('round_of_16'));
    it('segunda_fase → round_of_16', () => expect(mapPhaseToCanonical('segunda_fase')).toBe('round_of_16'));
    it('classifica_a → round_of_16', () => expect(mapPhaseToCanonical('classifica_a')).toBe('round_of_16'));
    it('classifica_b → round_of_16', () => expect(mapPhaseToCanonical('classifica_b')).toBe('round_of_16'));
    it('primeira_fase → round_of_16', () => expect(mapPhaseToCanonical('primeira_fase')).toBe('round_of_16'));
    it('qualify → round_of_16', () => expect(mapPhaseToCanonical('qualify')).toBe('round_of_16'));
    it('desconhecido → participation', () => expect(mapPhaseToCanonical('unknown_phase')).toBe('participation'));
});
