import { describe, expect, it } from 'vitest';
import {
    drawClasse5,
    buildClasse5Bracket,
    buildClasse4OfficialBracket,
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

    it('quartas têm match_numbers 9-12 e referenciam pares adjacentes das oitavas', () => {
        const bracket = buildClasse5Bracket(oitavas);
        const expectedSources = [
            [9, 1, 2],
            [10, 3, 4],
            [11, 5, 6],
            [12, 7, 8],
        ];

        for (const [matchNumber, sourceA, sourceB] of expectedSources) {
            const match = bracket.find(m => m.match_number === matchNumber)!;
            expect(match.registration_a_id).toBeNull();
            expect(match.registration_b_id).toBeNull();
            expect(match.player_a_source_match_number).toBe(sourceA);
            expect(match.player_b_source_match_number).toBe(sourceB);
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

// ── A.2 — 4ª Classe official bracket ─────────────────────────────────────────

describe('buildClasse4OfficialBracket', () => {
    const athletes20 = Array.from({ length: 20 }, (_, i) => makeAthlete(`c4-${i + 1}`));
    const bracket = buildClasse4OfficialBracket(athletes20, identityRng);

    it('lança erro se não receber 20 atletas', () => {
        expect(() => buildClasse4OfficialBracket(athletes20.slice(0, 19))).toThrow('esperado 20 atletas');
        expect(() => buildClasse4OfficialBracket([...athletes20, makeAthlete('extra')])).toThrow('esperado 20 atletas');
    });

    it('lança erro com atletas duplicados', () => {
        expect(() => buildClasse4OfficialBracket([...athletes20.slice(0, 19), athletes20[0]])).toThrow('duplicados');
    });

    it('cria 19 partidas de J1 a J19', () => {
        expect(bracket).toHaveLength(19);
        expect(bracket.map(m => m.match_number)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    });

    it('preliminares J1-J4 têm jogadores diretos', () => {
        for (const matchNumber of [1, 2, 3, 4]) {
            const match = bracket.find(m => m.match_number === matchNumber)!;
            expect(match.registration_a_id).toBeTruthy();
            expect(match.registration_b_id).toBeTruthy();
            expect(match.player_a_source_match_number).toBeUndefined();
            expect(match.player_b_source_match_number).toBeUndefined();
        }
    });

    it('oitavas recebem vencedores das preliminares nos slots corretos', () => {
        const j5 = bracket.find(m => m.match_number === 5)!;
        const j8 = bracket.find(m => m.match_number === 8)!;
        const j9 = bracket.find(m => m.match_number === 9)!;
        const j12 = bracket.find(m => m.match_number === 12)!;

        expect(j5.player_b_source_match_number).toBe(1);
        expect(j8.player_b_source_match_number).toBe(2);
        expect(j9.player_b_source_match_number).toBe(3);
        expect(j12.player_b_source_match_number).toBe(4);
    });

    it('quartas, semis e final seguem avanço adjacente até J19', () => {
        expect(bracket.find(m => m.match_number === 13)).toMatchObject({ player_a_source_match_number: 5, player_b_source_match_number: 6 });
        expect(bracket.find(m => m.match_number === 14)).toMatchObject({ player_a_source_match_number: 7, player_b_source_match_number: 8 });
        expect(bracket.find(m => m.match_number === 15)).toMatchObject({ player_a_source_match_number: 9, player_b_source_match_number: 10 });
        expect(bracket.find(m => m.match_number === 16)).toMatchObject({ player_a_source_match_number: 11, player_b_source_match_number: 12 });
        expect(bracket.find(m => m.match_number === 17)).toMatchObject({ player_a_source_match_number: 13, player_b_source_match_number: 14 });
        expect(bracket.find(m => m.match_number === 18)).toMatchObject({ player_a_source_match_number: 15, player_b_source_match_number: 16 });
        expect(bracket.find(m => m.match_number === 19)).toMatchObject({ player_a_source_match_number: 17, player_b_source_match_number: 18 });
    });
});
