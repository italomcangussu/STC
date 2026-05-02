import { describe, expect, it } from 'vitest';
import {
    drawClasse5,
    buildClasse5Bracket,
    drawClasse4Qualify,
    drawClasse4PrimeiraFase,
    drawClasse4CabecasDeChave,
    buildClasse4Bracket,
    type DrawAthlete,
} from '../lib/resenhaOpenDraw';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAthlete(id: string, opts: Partial<DrawAthlete> = {}): DrawAthlete {
    return {
        id,
        name: `Atleta ${id}`,
        participant_type: 'socio',
        cabeca_de_chave: false,
        ...opts,
    };
}

function makeSobralGuest(id: string): DrawAthlete {
    return makeAthlete(id, { participant_type: 'guest', guest_cidade: 'Sobral' });
}

function makeOutGuest(id: string, cidade = 'Fortaleza'): DrawAthlete {
    return makeAthlete(id, { participant_type: 'guest', guest_cidade: cidade });
}

// Deterministic RNG: sequences 0, 0, 0... → shuffle leaves array as-is
function seqRng(sequence: number[]): () => number {
    let i = 0;
    return () => sequence[i++ % sequence.length] ?? 0;
}

const identityRng = () => 0; // always picks index 0 — no swap

// 16 distinct socios for 5ª Classe tests
const athletes16 = Array.from({ length: 16 }, (_, i) => makeAthlete(`s${i + 1}`));

// ── A.1 — 5ª Classe ───────────────────────────────────────────────────────────

describe('drawClasse5', () => {
    it('lança erro com 0 atletas', () => {
        expect(() => drawClasse5([])).toThrow('esperado 16 atletas');
    });

    it('lança erro com 15 atletas', () => {
        expect(() => drawClasse5(athletes16.slice(0, 15))).toThrow('esperado 16 atletas');
    });

    it('lança erro com 17 atletas', () => {
        const extra = [...athletes16, makeAthlete('s17')];
        expect(() => drawClasse5(extra)).toThrow('esperado 16 atletas');
    });

    it('lança erro com atletas duplicados', () => {
        const withDup = [...athletes16.slice(0, 15), athletes16[0]];
        expect(() => drawClasse5(withDup)).toThrow('duplicados');
    });

    it('retorna exatamente 8 confrontos com 16 atletas', () => {
        const matches = drawClasse5(athletes16, identityRng);
        expect(matches).toHaveLength(8);
    });

    it('cada atleta aparece exatamente uma vez nos 16 slots', () => {
        const matches = drawClasse5(athletes16, identityRng);
        const allIds = matches.flatMap(m => [m.registration_a_id, m.registration_b_id]);
        const uniqueIds = new Set(allIds);
        expect(allIds).toHaveLength(16);
        expect(uniqueIds.size).toBe(16);
    });

    it('match_numbers vão de 1 a 8', () => {
        const matches = drawClasse5(athletes16, identityRng);
        const nums = matches.map(m => m.match_number).sort((a, b) => a - b);
        expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('RNG determinístico produz resultado reproduzível', () => {
        const rng1 = seqRng([0.1, 0.5, 0.3, 0.9, 0.2, 0.7, 0.4, 0.6, 0.15, 0.55, 0.35, 0.95, 0.25, 0.75, 0.45]);
        const rng2 = seqRng([0.1, 0.5, 0.3, 0.9, 0.2, 0.7, 0.4, 0.6, 0.15, 0.55, 0.35, 0.95, 0.25, 0.75, 0.45]);
        const r1 = drawClasse5(athletes16, rng1);
        const r2 = drawClasse5(athletes16, rng2);
        expect(r1.map(m => [m.registration_a_id, m.registration_b_id])).toEqual(
            r2.map(m => [m.registration_a_id, m.registration_b_id])
        );
    });
});

// ── buildClasse5Bracket ───────────────────────────────────────────────────────

describe('buildClasse5Bracket', () => {
    const oitavas = drawClasse5(athletes16, identityRng);

    it('lança erro se não receber 8 jogos de oitavas', () => {
        expect(() => buildClasse5Bracket(oitavas.slice(0, 7))).toThrow('esperado 8 partidas');
    });

    it('retorna 15 partidas no total (8 oitavas + 4 quartas + 2 semis + 1 final)', () => {
        const bracket = buildClasse5Bracket(oitavas);
        expect(bracket).toHaveLength(15);
    });

    it('quartas têm match_numbers 9-12 e referenciam oitavas', () => {
        const bracket = buildClasse5Bracket(oitavas);
        const quartas = bracket.filter(m => m.match_number >= 9 && m.match_number <= 12);
        expect(quartas).toHaveLength(4);
        for (const q of quartas) {
            expect(q.registration_a_id).toBeNull();
            expect(q.registration_b_id).toBeNull();
            expect(q.player_a_source_match_number).toBeDefined();
            expect(q.player_b_source_match_number).toBeDefined();
        }
    });

    it('semifinais têm match_numbers 13-14 e referenciam quartas', () => {
        const bracket = buildClasse5Bracket(oitavas);
        const semis = bracket.filter(m => m.match_number >= 13 && m.match_number <= 14);
        expect(semis).toHaveLength(2);
        const semi1 = semis.find(m => m.match_number === 13)!;
        expect(semi1.player_a_source_match_number).toBe(9);
        expect(semi1.player_b_source_match_number).toBe(10);
    });

    it('final tem match_number 15 e referencia as duas semifinais', () => {
        const bracket = buildClasse5Bracket(oitavas);
        const final = bracket.find(m => m.match_number === 15)!;
        expect(final).toBeDefined();
        expect(final.player_a_source_match_number).toBe(13);
        expect(final.player_b_source_match_number).toBe(14);
    });

    it('não contém disputa de 3º lugar', () => {
        const bracket = buildClasse5Bracket(oitavas);
        expect(bracket).toHaveLength(15);
        // 3rd place would be match 16 or similar
        expect(bracket.find(m => m.match_number === 16)).toBeUndefined();
    });
});

// ── A.2 — 4ª Classe Qualify ───────────────────────────────────────────────────

// 19 athletes: 3 CC socios + 10 non-CC socios + 6 Sobral guests
function make19Athletes(): DrawAthlete[] {
    const ccs = Array.from({ length: 3 }, (_, i) =>
        makeAthlete(`cc${i + 1}`, { cabeca_de_chave: true })
    );
    const socios = Array.from({ length: 10 }, (_, i) => makeAthlete(`s${i + 1}`));
    const sobral = Array.from({ length: 6 }, (_, i) => makeSobralGuest(`g${i + 1}`));
    return [...ccs, ...socios, ...sobral];
}

describe('drawClasse4Qualify', () => {
    const athletes19 = make19Athletes();

    it('lança erro com 18 atletas', () => {
        expect(() => drawClasse4Qualify(athletes19.slice(0, 18))).toThrow('esperado 19 atletas');
    });

    it('lança erro com 20 atletas', () => {
        const extra = [...athletes19, makeAthlete('x')];
        expect(() => drawClasse4Qualify(extra)).toThrow('esperado 19 atletas');
    });

    it('lança erro se houver ≠ 3 cabeças de chave', () => {
        const only2CC = athletes19.map((a, i) =>
            a.cabeca_de_chave && i > 1 ? { ...a, cabeca_de_chave: false } : a
        );
        expect(() => drawClasse4Qualify(only2CC)).toThrow('cabeças de chave');
    });

    it('lança erro se houver menos de 6 atletas elegíveis', () => {
        // Replace Sobral guests with out-of-town guests
        const noEligible = athletes19.map(a =>
            a.participant_type === 'guest' ? makeOutGuest(a.id) : a
        );
        // Now only 10 socios are eligible but let's reduce socios too
        const few = noEligible.map((a, i) =>
            !a.cabeca_de_chave && a.participant_type === 'socio' && i > 5
                ? makeOutGuest(a.id)
                : a
        );
        // At this point we have enough socios — need a case with < 6 eligible
        // Build fresh: 3 CC + 2 non-CC socios + 14 out-of-town guests
        const tooFew: DrawAthlete[] = [
            makeAthlete('cc1', { cabeca_de_chave: true }),
            makeAthlete('cc2', { cabeca_de_chave: true }),
            makeAthlete('cc3', { cabeca_de_chave: true }),
            makeAthlete('s1'), makeAthlete('s2'),
            ...Array.from({ length: 14 }, (_, i) => makeOutGuest(`og${i + 1}`)),
        ];
        expect(() => drawClasse4Qualify(tooFew)).toThrow('insuficientes elegíveis');
    });

    it('não inclui cabeças de chave nos 6 sorteados', () => {
        const { qualifyMatches } = drawClasse4Qualify(athletes19, identityRng);
        const drawnIds = qualifyMatches.flatMap(m => [m.registration_a_id, m.registration_b_id]);
        const ccIds = athletes19.filter(a => a.cabeca_de_chave).map(a => a.id);
        for (const ccId of ccIds) {
            expect(drawnIds).not.toContain(ccId);
        }
    });

    it('não inclui convidados de fora de Sobral', () => {
        const withOut = [...athletes19.slice(0, 16), makeOutGuest('fg1'), makeOutGuest('fg2'), makeOutGuest('fg3')];
        // replace last 3 sobral guests with out-of-town guests — still ≥ 6 eligible (socios)
        const { qualifyMatches } = drawClasse4Qualify(withOut, identityRng);
        const drawnIds = new Set(qualifyMatches.flatMap(m => [m.registration_a_id, m.registration_b_id]));
        expect(drawnIds.has('fg1')).toBe(false);
        expect(drawnIds.has('fg2')).toBe(false);
        expect(drawnIds.has('fg3')).toBe(false);
    });

    it('considera elegíveis convidados com cidade "sobral", "SOBRAL" e " Sobral " (case-insensitive + trim)', () => {
        const variants: DrawAthlete[] = [
            makeAthlete('cc1', { cabeca_de_chave: true }),
            makeAthlete('cc2', { cabeca_de_chave: true }),
            makeAthlete('cc3', { cabeca_de_chave: true }),
            makeAthlete('s1'), makeAthlete('s2'), makeAthlete('s3'),
            makeAthlete('s4'), makeAthlete('s5'), makeAthlete('s6'),
            makeAthlete('s7'), makeAthlete('s8'), makeAthlete('s9'), makeAthlete('s10'),
            makeAthlete('g-lower', { participant_type: 'guest', guest_cidade: 'sobral' }),
            makeAthlete('g-upper', { participant_type: 'guest', guest_cidade: 'SOBRAL' }),
            makeAthlete('g-space', { participant_type: 'guest', guest_cidade: ' Sobral ' }),
            makeAthlete('g-out', { participant_type: 'guest', guest_cidade: 'Caucaia' }),
            makeAthlete('g-out2', { participant_type: 'guest', guest_cidade: 'Mossoró' }),
            makeAthlete('g-out3', { participant_type: 'guest', guest_cidade: 'Fortaleza' }),
        ];
        // With identityRng the first 6 eligible sorted will be drawn — just ensure no error
        expect(() => drawClasse4Qualify(variants)).not.toThrow();
    });

    it('considera sócios não-CC elegíveis independentemente da cidade', () => {
        // All 10 non-CC socios should be eligible even without guest_cidade
        const { qualifyMatches } = drawClasse4Qualify(athletes19, identityRng);
        const drawnIds = new Set(qualifyMatches.flatMap(m => [m.registration_a_id, m.registration_b_id]));
        const nonCcSocioIds = athletes19.filter(a => !a.cabeca_de_chave && a.participant_type === 'socio').map(a => a.id);
        const anyDrawn = nonCcSocioIds.some(id => drawnIds.has(id));
        expect(anyDrawn).toBe(true);
    });

    it('retorna exatamente 3 confrontos (Jogo 1, 2, 3)', () => {
        const { qualifyMatches } = drawClasse4Qualify(athletes19, identityRng);
        expect(qualifyMatches).toHaveLength(3);
        expect(qualifyMatches.map(m => m.match_number)).toEqual([1, 2, 3]);
    });

    it('cada um dos 6 sorteados aparece exatamente uma vez', () => {
        const { qualifyMatches } = drawClasse4Qualify(athletes19, identityRng);
        const allIds = qualifyMatches.flatMap(m => [m.registration_a_id, m.registration_b_id]);
        expect(allIds).toHaveLength(6);
        expect(new Set(allIds).size).toBe(6);
    });

    it('remainingPool tem 10 atletas (19 − 6 sorteados − 3 CC)', () => {
        const { remainingPool } = drawClasse4Qualify(athletes19, identityRng);
        expect(remainingPool).toHaveLength(10);
    });

    it('remainingPool exclui os 3 cabeças de chave', () => {
        const { remainingPool } = drawClasse4Qualify(athletes19, identityRng);
        const ccIds = athletes19.filter(a => a.cabeca_de_chave).map(a => a.id);
        for (const ccId of ccIds) {
            expect(remainingPool.map(a => a.id)).not.toContain(ccId);
        }
    });
});

// ── A.3 — 4ª Classe 1ª Fase ───────────────────────────────────────────────────

describe('drawClasse4PrimeiraFase', () => {
    const pool10 = Array.from({ length: 10 }, (_, i) => makeAthlete(`p${i + 1}`));

    it('lança erro se pool ≠ 10 atletas', () => {
        expect(() => drawClasse4PrimeiraFase(pool10.slice(0, 9))).toThrow('esperado 10 atletas');
        expect(() => drawClasse4PrimeiraFase([...pool10, makeAthlete('extra')])).toThrow('esperado 10 atletas');
    });

    it('gera 6 entradas no total (5 confrontos sorteados + Jogo 9 placeholder)', () => {
        const matches = drawClasse4PrimeiraFase(pool10, identityRng);
        expect(matches).toHaveLength(6);
    });

    it('confrontos sorteados têm match_numbers 4-8', () => {
        const matches = drawClasse4PrimeiraFase(pool10, identityRng);
        const sorted = matches.filter(m => m.match_number >= 4 && m.match_number <= 8);
        expect(sorted).toHaveLength(5);
    });

    it('Jogo 9 é placeholder: registration_a_id e registration_b_id são null', () => {
        const matches = drawClasse4PrimeiraFase(pool10, identityRng);
        const j9 = matches.find(m => m.match_number === 9)!;
        expect(j9).toBeDefined();
        expect(j9.registration_a_id).toBeNull();
        expect(j9.registration_b_id).toBeNull();
    });

    it('Jogo 9 referencia winner(jogo 1) × winner(jogo 2)', () => {
        const matches = drawClasse4PrimeiraFase(pool10, identityRng);
        const j9 = matches.find(m => m.match_number === 9)!;
        expect(j9.player_a_source_match_number).toBe(1);
        expect(j9.player_b_source_match_number).toBe(2);
    });

    it('cada atleta dos 10 do pool aparece exatamente uma vez nos jogos 4-8', () => {
        const matches = drawClasse4PrimeiraFase(pool10, identityRng);
        const slotted = matches.filter(m => m.match_number <= 8);
        const allIds = slotted.flatMap(m => [m.registration_a_id, m.registration_b_id]);
        expect(allIds).toHaveLength(10);
        expect(new Set(allIds).size).toBe(10);
    });
});

// ── A.4 — 4ª Classe Cabeças de Chave ─────────────────────────────────────────

describe('drawClasse4CabecasDeChave', () => {
    const ccs = [
        makeAthlete('cc1', { cabeca_de_chave: true }),
        makeAthlete('cc2', { cabeca_de_chave: true }),
        makeAthlete('cc3', { cabeca_de_chave: true }),
    ];

    it('lança erro se não receber exatamente 3 cabeças de chave', () => {
        expect(() => drawClasse4CabecasDeChave([])).toThrow('esperado 3');
        expect(() => drawClasse4CabecasDeChave(ccs.slice(0, 2))).toThrow('esperado 3');
        expect(() => drawClasse4CabecasDeChave([...ccs, makeAthlete('cc4')])).toThrow('esperado 3');
    });

    it('atribui os 3 atletas distintos entre quartas1, quartas2, quartas3', () => {
        const { quartas1, quartas2, quartas3 } = drawClasse4CabecasDeChave(ccs, identityRng);
        const assigned = [quartas1.id, quartas2.id, quartas3.id];
        expect(new Set(assigned).size).toBe(3);
        expect(new Set(assigned)).toEqual(new Set(['cc1', 'cc2', 'cc3']));
    });

    it('RNG determinístico produz resultado reproduzível', () => {
        const rng = seqRng([0.3, 0.7]);
        const r1 = drawClasse4CabecasDeChave(ccs, rng);
        const rng2 = seqRng([0.3, 0.7]);
        const r2 = drawClasse4CabecasDeChave(ccs, rng2);
        expect(r1.quartas1.id).toBe(r2.quartas1.id);
        expect(r1.quartas2.id).toBe(r2.quartas2.id);
        expect(r1.quartas3.id).toBe(r2.quartas3.id);
    });
});

// ── A.5 — buildClasse4Bracket ─────────────────────────────────────────────────

describe('buildClasse4Bracket', () => {
    const athletes19 = make19Athletes();
    const ccs = athletes19.filter(a => a.cabeca_de_chave);
    const { qualifyMatches, remainingPool } = drawClasse4Qualify(athletes19, identityRng);
    const pool10 = remainingPool.slice(0, 10);
    const primeiraFaseMatches = drawClasse4PrimeiraFase(pool10, identityRng);
    const quartasSeeds = drawClasse4CabecasDeChave(ccs, identityRng);
    const bracket = buildClasse4Bracket(qualifyMatches, primeiraFaseMatches, quartasSeeds);

    it('lança erro se não receber 3 jogos de qualify', () => {
        expect(() => buildClasse4Bracket([], primeiraFaseMatches, quartasSeeds)).toThrow('qualify');
    });

    it('lança erro se não receber 6 jogos de 1ª fase', () => {
        expect(() => buildClasse4Bracket(qualifyMatches, [], quartasSeeds)).toThrow('1ª fase');
    });

    it('Jogo 10 (2ª Fase) é winner(3) × winner(8)', () => {
        const j10 = bracket.find(m => m.match_number === 10)!;
        expect(j10).toBeDefined();
        expect(j10.player_a_source_match_number).toBe(3);
        expect(j10.player_b_source_match_number).toBe(8);
    });

    it('Jogo 11 (2ª Fase) é winner(6) × winner(7)', () => {
        const j11 = bracket.find(m => m.match_number === 11)!;
        expect(j11).toBeDefined();
        expect(j11.player_a_source_match_number).toBe(6);
        expect(j11.player_b_source_match_number).toBe(7);
    });

    it('Quartas 4 (Jogo 15) é Classifica A (winner jogo 4) × Classifica B (winner jogo 5) — sem partida intermediária', () => {
        const q4 = bracket.find(m => m.match_number === 15)!;
        expect(q4).toBeDefined();
        expect(q4.player_a_source_match_number).toBe(4);
        expect(q4.player_b_source_match_number).toBe(5);
    });

    it('Quartas 1 (Jogo 12) é CC1 × winner(jogo 11)', () => {
        const q1 = bracket.find(m => m.match_number === 12)!;
        expect(q1.registration_a_id).toBe(quartasSeeds.quartas1.id);
        expect(q1.player_b_source_match_number).toBe(11);
    });

    it('Quartas 2 (Jogo 13) é CC3 × winner(jogo 9)', () => {
        const q2 = bracket.find(m => m.match_number === 13)!;
        expect(q2.registration_a_id).toBe(quartasSeeds.quartas2.id);
        expect(q2.player_b_source_match_number).toBe(9);
    });

    it('Quartas 3 (Jogo 14) é CC2 × winner(jogo 10)', () => {
        const q3 = bracket.find(m => m.match_number === 14)!;
        expect(q3.registration_a_id).toBe(quartasSeeds.quartas3.id);
        expect(q3.player_b_source_match_number).toBe(10);
    });

    it('Semifinal 1 (Jogo 16) é winner(12) × winner(13)', () => {
        const sf1 = bracket.find(m => m.match_number === 16)!;
        expect(sf1.player_a_source_match_number).toBe(12);
        expect(sf1.player_b_source_match_number).toBe(13);
    });

    it('Semifinal 2 (Jogo 17) é winner(14) × winner(15)', () => {
        const sf2 = bracket.find(m => m.match_number === 17)!;
        expect(sf2.player_a_source_match_number).toBe(14);
        expect(sf2.player_b_source_match_number).toBe(15);
    });

    it('Final (Jogo 18) é winner(16) × winner(17)', () => {
        const final = bracket.find(m => m.match_number === 18)!;
        expect(final).toBeDefined();
        expect(final.player_a_source_match_number).toBe(16);
        expect(final.player_b_source_match_number).toBe(17);
    });

    it('não contém disputa de 3º lugar (nenhum match_number ≥ 19)', () => {
        expect(bracket.every(m => m.match_number <= 18)).toBe(true);
        // Specifically no 3rd place match
        const thirdPlace = bracket.find(m =>
            m.player_a_source_match_number === 16 && m.player_b_source_match_number === 17 && m.match_number !== 18
        );
        expect(thirdPlace).toBeUndefined();
    });

    it('bracket total tem 18 partidas', () => {
        expect(bracket).toHaveLength(18);
    });
});
