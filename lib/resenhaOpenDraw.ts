// Pure, side-effect-free draw logic for the "Resenha Open" championship.
// All functions accept an optional `rng` parameter (injectable RNG) so tests
// can be fully deterministic while production uses Math.random.

export interface DrawAthlete {
    id: string;           // registration id (UUID in production; any unique string in tests)
    name: string;
    participant_type: 'socio' | 'guest';
    guest_cidade?: string | null;
    cabeca_de_chave: boolean;
}

export interface DrawMatch {
    match_number: number;
    registration_a_id: string | null; // null = placeholder (winner not yet decided)
    registration_b_id: string | null;
    player_a_label: string;           // display name or "Vencedor Jogo X"
    player_b_label: string;
    player_a_source_match_number?: number; // winner of this match fills slot A
    player_b_source_match_number?: number; // winner of this match fills slot B
}

// Fisher-Yates shuffle with injectable RNG
function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// ── 5ª Classe: simple 16-player knockout ─────────────────────────────────────

export function drawClasse5(
    athletes: DrawAthlete[],
    rng?: () => number
): DrawMatch[] {
    if (athletes.length !== 16) {
        throw new Error(`drawClasse5: esperado 16 atletas, recebido ${athletes.length}`);
    }
    const ids = athletes.map(a => a.id);
    if (new Set(ids).size !== ids.length) {
        throw new Error('drawClasse5: atletas duplicados na entrada');
    }

    const shuffled = shuffle(athletes, rng);
    return Array.from({ length: 8 }, (_, i) => {
        const a = shuffled[i * 2];
        const b = shuffled[i * 2 + 1];
        return {
            match_number: i + 1,
            registration_a_id: a.id,
            registration_b_id: b.id,
            player_a_label: a.name,
            player_b_label: b.name,
        };
    });
}

// Bracket continuation for 5ª Classe after oitavas (generated once and saved)
export function buildClasse5Bracket(oitavasMatches: DrawMatch[]): DrawMatch[] {
    if (oitavasMatches.length !== 8) {
        throw new Error('buildClasse5Bracket: esperado 8 partidas de oitavas');
    }
    const all = [...oitavasMatches];

    // Quartas: adjacent first-round winners (1v2, 3v4, 5v6, 7v8)
    const quarterSources: [number, number][] = [
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
    ];

    quarterSources.forEach(([sourceA, sourceB], i) => {
        all.push({
            match_number: 9 + i, // 9, 10, 11, 12
            registration_a_id: null,
            registration_b_id: null,
            player_a_label: `Vencedor Jogo ${sourceA}`,
            player_b_label: `Vencedor Jogo ${sourceB}`,
            player_a_source_match_number: sourceA,
            player_b_source_match_number: sourceB,
        });
    });

    // Semis
    all.push({
        match_number: 13,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Quartas 1', player_b_label: 'Vencedor Quartas 2',
        player_a_source_match_number: 9, player_b_source_match_number: 10,
    });
    all.push({
        match_number: 14,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Quartas 3', player_b_label: 'Vencedor Quartas 4',
        player_a_source_match_number: 11, player_b_source_match_number: 12,
    });

    // Final
    all.push({
        match_number: 15,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Semifinal 1', player_b_label: 'Vencedor Semifinal 2',
        player_a_source_match_number: 13, player_b_source_match_number: 14,
    });

    return all;
}

// ── 4ª Classe helpers ─────────────────────────────────────────────────────────

function isQualifyEligible(athlete: DrawAthlete): boolean {
    if (athlete.cabeca_de_chave) return false;
    if (athlete.participant_type === 'socio') return true;
    return (athlete.guest_cidade?.trim().toLowerCase() ?? '') === 'sobral';
}

// ── 4ª Classe Step 1: Qualify (Jogos 1-3) ────────────────────────────────────

export function drawClasse4Qualify(
    athletes: DrawAthlete[],
    rng?: () => number
): { qualifyMatches: DrawMatch[]; remainingPool: DrawAthlete[] } {
    if (athletes.length !== 19) {
        throw new Error(`drawClasse4Qualify: esperado 19 atletas, recebido ${athletes.length}`);
    }
    const ccCount = athletes.filter(a => a.cabeca_de_chave).length;
    if (ccCount !== 3) {
        throw new Error(`drawClasse4Qualify: esperado 3 cabeças de chave, recebido ${ccCount}`);
    }
    const eligible = athletes.filter(isQualifyEligible);
    if (eligible.length < 6) {
        throw new Error(
            `drawClasse4Qualify: insuficientes elegíveis para Qualify (${eligible.length} < 6). ` +
            'Atletas elegíveis são sócios não-CC ou convidados de Sobral não-CC.'
        );
    }

    const drawn = shuffle(eligible, rng).slice(0, 6);
    const drawnIds = new Set(drawn.map(a => a.id));

    const qualifyMatches: DrawMatch[] = [
        {
            match_number: 1,
            registration_a_id: drawn[0].id, registration_b_id: drawn[1].id,
            player_a_label: drawn[0].name,  player_b_label: drawn[1].name,
        },
        {
            match_number: 2,
            registration_a_id: drawn[2].id, registration_b_id: drawn[3].id,
            player_a_label: drawn[2].name,  player_b_label: drawn[3].name,
        },
        {
            match_number: 3,
            registration_a_id: drawn[4].id, registration_b_id: drawn[5].id,
            player_a_label: drawn[4].name,  player_b_label: drawn[5].name,
        },
    ];

    // Remaining pool: not drawn AND not CC
    const remainingPool = athletes.filter(a => !drawnIds.has(a.id) && !a.cabeca_de_chave);

    return { qualifyMatches, remainingPool };
}

// ── 4ª Classe Step 2: 1ª Fase (Jogos 4-9) ────────────────────────────────────

export function drawClasse4PrimeiraFase(
    remainingPool: DrawAthlete[],
    rng?: () => number
): DrawMatch[] {
    if (remainingPool.length !== 10) {
        throw new Error(
            `drawClasse4PrimeiraFase: esperado 10 atletas no pool, recebido ${remainingPool.length}. ` +
            'Pool deve ser: 19 − 6 do Qualify − 3 cabeças de chave = 10.'
        );
    }

    const shuffled = shuffle(remainingPool, rng);
    const matches: DrawMatch[] = Array.from({ length: 5 }, (_, i) => ({
        match_number: i + 4, // 4, 5, 6, 7, 8
        registration_a_id: shuffled[i * 2].id,
        registration_b_id: shuffled[i * 2 + 1].id,
        player_a_label: shuffled[i * 2].name,
        player_b_label: shuffled[i * 2 + 1].name,
    }));

    // Jogo 9: automatically Vencedor Jogo 1 × Vencedor Jogo 2 (not drawn)
    matches.push({
        match_number: 9,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: 'Vencedor Jogo 1',
        player_b_label: 'Vencedor Jogo 2',
        player_a_source_match_number: 1,
        player_b_source_match_number: 2,
    });

    return matches;
}

// ── 4ª Classe Step 3: Cabeças de Chave → Quartas slots ───────────────────────

export function drawClasse4CabecasDeChave(
    headSeeds: DrawAthlete[],
    rng?: () => number
): { quartas1: DrawAthlete; quartas2: DrawAthlete; quartas3: DrawAthlete } {
    if (headSeeds.length !== 3) {
        throw new Error(`drawClasse4CabecasDeChave: esperado 3 cabeças de chave, recebido ${headSeeds.length}`);
    }
    const shuffled = shuffle(headSeeds, rng);
    return { quartas1: shuffled[0], quartas2: shuffled[1], quartas3: shuffled[2] };
}

// ── 4ª Classe: build full bracket after all 3 draw steps ─────────────────────
// match_number convention:
//  1-3   = Qualify
//  4-9   = 1ª Fase (9 is placeholder)
//  10-11 = 2ª Fase
//  12    = Quartas 1  (CC1 × winner jogo 11)
//  13    = Quartas 2  (CC3 × winner jogo 9)
//  14    = Quartas 3  (CC2 × winner jogo 10)
//  15    = Quartas 4  (winner jogo 4 × winner jogo 5)
//  16    = Semifinal 1
//  17    = Semifinal 2
//  18    = Final

export function buildClasse4Bracket(
    qualifyMatches: DrawMatch[],
    primeiraFaseMatches: DrawMatch[],
    quartasSeeds: { quartas1: DrawAthlete; quartas2: DrawAthlete; quartas3: DrawAthlete }
): DrawMatch[] {
    if (qualifyMatches.length !== 3) throw new Error('buildClasse4Bracket: esperado 3 jogos de qualify');
    if (primeiraFaseMatches.length !== 6) throw new Error('buildClasse4Bracket: esperado 6 jogos da 1ª fase (4-8 + jogo 9)');

    const all: DrawMatch[] = [...qualifyMatches, ...primeiraFaseMatches];

    // 2ª Fase
    all.push({
        match_number: 10,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Jogo 3', player_b_label: 'Vencedor Jogo 8',
        player_a_source_match_number: 3,   player_b_source_match_number: 8,
    });
    all.push({
        match_number: 11,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Jogo 6', player_b_label: 'Vencedor Jogo 7',
        player_a_source_match_number: 6,   player_b_source_match_number: 7,
    });

    // Quartas — CC positions come from the draw result
    // Quartas 1: CC1 × winner jogo 11
    all.push({
        match_number: 12,
        registration_a_id: quartasSeeds.quartas1.id,
        registration_b_id: null,
        player_a_label: quartasSeeds.quartas1.name,
        player_b_label: 'Vencedor Jogo 11',
        player_b_source_match_number: 11,
    });
    // Quartas 2: CC3 × winner jogo 9
    all.push({
        match_number: 13,
        registration_a_id: quartasSeeds.quartas2.id,
        registration_b_id: null,
        player_a_label: quartasSeeds.quartas2.name,
        player_b_label: 'Vencedor Jogo 9',
        player_b_source_match_number: 9,
    });
    // Quartas 3: CC2 × winner jogo 10
    all.push({
        match_number: 14,
        registration_a_id: quartasSeeds.quartas3.id,
        registration_b_id: null,
        player_a_label: quartasSeeds.quartas3.name,
        player_b_label: 'Vencedor Jogo 10',
        player_b_source_match_number: 10,
    });
    // Quartas 4: Classifica A (winner jogo 4) × Classifica B (winner jogo 5)
    all.push({
        match_number: 15,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: 'Classifica A (Vencedor Jogo 4)',
        player_b_label: 'Classifica B (Vencedor Jogo 5)',
        player_a_source_match_number: 4,
        player_b_source_match_number: 5,
    });

    // Semis
    all.push({
        match_number: 16,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Quartas 1', player_b_label: 'Vencedor Quartas 2',
        player_a_source_match_number: 12, player_b_source_match_number: 13,
    });
    all.push({
        match_number: 17,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Quartas 3', player_b_label: 'Vencedor Quartas 4',
        player_a_source_match_number: 14, player_b_source_match_number: 15,
    });

    // Final
    all.push({
        match_number: 18,
        registration_a_id: null, registration_b_id: null,
        player_a_label: 'Vencedor Semifinal 1', player_b_label: 'Vencedor Semifinal 2',
        player_a_source_match_number: 16, player_b_source_match_number: 17,
    });

    return all;
}

// ── 4ª Classe: official 20-player bracket ────────────────────────────────────

export function buildClasse4OfficialBracket(
    athletes: DrawAthlete[],
    rng?: () => number
): DrawMatch[] {
    if (athletes.length !== 20) {
        throw new Error(`buildClasse4OfficialBracket: esperado 20 atletas, recebido ${athletes.length}`);
    }
    const ids = athletes.map(a => a.id);
    if (new Set(ids).size !== ids.length) {
        throw new Error('buildClasse4OfficialBracket: atletas duplicados na entrada');
    }

    const shuffled = shuffle(athletes, rng);
    const direct = (matchNumber: number, a: DrawAthlete, b: DrawAthlete): DrawMatch => ({
        match_number: matchNumber,
        registration_a_id: a.id,
        registration_b_id: b.id,
        player_a_label: a.name,
        player_b_label: b.name,
    });
    const source = (matchNumber: number, sourceA: number, sourceB: number): DrawMatch => ({
        match_number: matchNumber,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: `Vencedor Jogo ${sourceA}`,
        player_b_label: `Vencedor Jogo ${sourceB}`,
        player_a_source_match_number: sourceA,
        player_b_source_match_number: sourceB,
    });

    return [
        direct(1, shuffled[0], shuffled[1]),
        direct(2, shuffled[2], shuffled[3]),
        direct(3, shuffled[4], shuffled[5]),
        direct(4, shuffled[6], shuffled[7]),
        {
            match_number: 5,
            registration_a_id: shuffled[8].id,
            registration_b_id: null,
            player_a_label: shuffled[8].name,
            player_b_label: 'Vencedor Jogo 1',
            player_b_source_match_number: 1,
        },
        direct(6, shuffled[9], shuffled[10]),
        direct(7, shuffled[11], shuffled[12]),
        {
            match_number: 8,
            registration_a_id: shuffled[13].id,
            registration_b_id: null,
            player_a_label: shuffled[13].name,
            player_b_label: 'Vencedor Jogo 2',
            player_b_source_match_number: 2,
        },
        {
            match_number: 9,
            registration_a_id: shuffled[14].id,
            registration_b_id: null,
            player_a_label: shuffled[14].name,
            player_b_label: 'Vencedor Jogo 3',
            player_b_source_match_number: 3,
        },
        direct(10, shuffled[15], shuffled[16]),
        direct(11, shuffled[17], shuffled[18]),
        {
            match_number: 12,
            registration_a_id: shuffled[19].id,
            registration_b_id: null,
            player_a_label: shuffled[19].name,
            player_b_label: 'Vencedor Jogo 4',
            player_b_source_match_number: 4,
        },
        source(13, 5, 6),
        source(14, 7, 8),
        source(15, 9, 10),
        source(16, 11, 12),
        source(17, 13, 14),
        source(18, 15, 16),
        source(19, 17, 18),
    ];
}
