import { supabase } from '../supabase';
import { type FormatConfig } from './formatConfig';
import { deriveRounds } from './rounds';

export interface BracketSlot {
    matchNumber: number;
    phase: string;
    a: string | null;
    b: string | null;
    aSourceMatch?: number;
    bSourceMatch?: number;
}

/**
 * Ordem padrão de cabeças no quadro, na convenção do tênis: cabeça 1 no topo,
 * cabeça 2 na base, 3 e 4 nas metades opostas às do 2 e do 1. Para 8 vagas
 * devolve [1,8,5,4,3,6,7,2] — o 1 enfrenta o 8 na primeira rodada e só
 * encontra o 2 na final.
 *
 * A cada duplicação, as posições ímpares são espelhadas. Sem esse
 * espelhamento o cabeça 2 cairia no meio do quadro, e não na base.
 */
export function seedSlots(bracketSize: number): number[] {
    let slots = [1, 2];
    while (slots.length < bracketSize) {
        const sum = slots.length * 2 + 1;
        const next: number[] = [];
        slots.forEach((seed, index) => {
            if (index % 2 === 0) {
                next.push(seed, sum - seed);
            } else {
                next.push(sum - seed, seed);
            }
        });
        slots = next;
    }
    return slots;
}

export function seedPositionFor(bracketSize: number, seedNumber: number): number {
    return seedSlots(bracketSize).indexOf(seedNumber) + 1;
}

/**
 * Fases de todos-contra-todos. Não formam chave: os confrontos saem das
 * combinações de participantes, e quem avança sai da classificação, não do
 * vencedor de um jogo específico.
 */
const LEAGUE_PHASES = new Set(['grupos', 'grupos-volta', 'classificatoria', 'classificatoria-volta']);

export function buildEmptyBracket(config: FormatConfig, participantCount: number): BracketSlot[] {
    const rounds = deriveRounds(config, participantCount);
    const qualifyRound = rounds.find(r => r.phase === 'qualify');
    const knockoutRounds = rounds.filter(r => r.phase !== 'qualify' && !LEAGUE_PHASES.has(r.phase));

    const slots: BracketSlot[] = [];

    if (qualifyRound) {
        for (const n of qualifyRound.matchNumbers) {
            slots.push({ matchNumber: n, phase: 'qualify', a: null, b: null });
        }
    }

    knockoutRounds.forEach((round, roundIndex) => {
        const previous = knockoutRounds[roundIndex - 1];
        round.matchNumbers.forEach((n, i) => {
            const slot: BracketSlot = { matchNumber: n, phase: round.phase, a: null, b: null };
            if (previous) {
                slot.aSourceMatch = previous.matchNumbers[i * 2];
                slot.bSourceMatch = previous.matchNumbers[i * 2 + 1];
            }
            slots.push(slot);
        });
    });

    // Vencedores do qualify entram nas vagas configuradas do quadro principal.
    if (qualifyRound && config.format === 'mata-mata' && config.qualifying) {
        const firstRound = knockoutRounds[0];
        config.qualifying.entrySlots.forEach((position, i) => {
            const matchIndex = Math.floor((position - 1) / 2);
            const side: 'a' | 'b' = (position - 1) % 2 === 0 ? 'a' : 'b';
            const target = slots.find(s => s.matchNumber === firstRound.matchNumbers[matchIndex]);
            if (!target) return;
            if (side === 'a') target.aSourceMatch = qualifyRound.matchNumbers[i];
            else target.bSourceMatch = qualifyRound.matchNumbers[i];
        });
    }

    return slots;
}

export function assignToSlot(
    bracket: BracketSlot[],
    matchNumber: number,
    side: 'a' | 'b',
    registrationId: string | null
): BracketSlot[] {
    return bracket.map(slot =>
        slot.matchNumber === matchNumber ? { ...slot, [side]: registrationId } : slot
    );
}

/** Vagas que recebem atleta direto, e não o vencedor de outro jogo. */
const isEntrySide = (slot: BracketSlot, side: 'a' | 'b') =>
    side === 'a' ? !slot.aSourceMatch : !slot.bSourceMatch;

export function validateBracket(
    bracket: BracketSlot[],
    seedIds: string[]
): { ok: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const slot of bracket) {
        if (isEntrySide(slot, 'a') && !slot.a) {
            errors.push(`Jogo ${slot.matchNumber}: vaga A está vazia.`);
        }
        if (isEntrySide(slot, 'b') && !slot.b) {
            errors.push(`Jogo ${slot.matchNumber}: vaga B está vazia.`);
        }
    }

    const seen = new Map<string, number>();
    for (const slot of bracket) {
        for (const id of [slot.a, slot.b]) {
            if (!id) continue;
            if (seen.has(id)) {
                errors.push(`Um atleta está em duas vagas: jogos ${seen.get(id)} e ${slot.matchNumber}.`);
            } else {
                seen.set(id, slot.matchNumber);
            }
        }
    }

    // Cabeças no mesmo lado do quadro: aviso, não bloqueio.
    if (seedIds.length >= 2) {
        const entry = bracket.filter(s => s.phase !== 'qualify' && (isEntrySide(s, 'a') || isEntrySide(s, 'b')));
        const metade = Math.ceil(entry.length / 2);
        const ladoPorSeed = new Map<string, number>();
        entry.forEach((slot, i) => {
            const lado = i < metade ? 0 : 1;
            for (const id of [slot.a, slot.b]) {
                if (id && seedIds.includes(id)) ladoPorSeed.set(id, lado);
            }
        });
        const lados = [...ladoPorSeed.values()];
        if (lados.length >= 2 && lados.every(l => l === lados[0])) {
            warnings.push('Os cabeças de chave estão no mesmo lado do quadro e se enfrentariam antes da final.');
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Recusa gravar quando as rodadas de destino já têm partidas. Sem isso, um
 * segundo clique duplica a chave inteira — as rodadas são idempotentes, as
 * partidas não eram. Falha alto em vez de ignorar em silêncio: partida
 * duplicada distorce classificação e pontuação sem dar sinal.
 */
export async function assertRoundsHaveNoMatches(
    championshipId: string,
    roundIds: string[]
): Promise<void> {
    if (roundIds.length === 0) return;

    const { data, error } = await supabase
        .from('matches')
        .select('id')
        .eq('championship_id', championshipId)
        .in('round_id', [...new Set(roundIds)])
        .limit(1);

    if (error) throw new Error(`Erro ao verificar partidas existentes: ${error.message}`);
    if (data && data.length > 0) {
        throw new Error(
            'Estas fases já têm partidas geradas. Apague as partidas existentes antes de gerar de novo.'
        );
    }
}

export interface SaveBracketParams {
    championshipId: string;
    slots: BracketSlot[];
    /** phase → championship_rounds.id */
    phaseToRoundId: Map<string, string>;
    /** registrationId → userId (null para convidados e alunos) */
    registrationUserMap: Map<string, string | null>;
}

/**
 * Grava a chave em dois passes: insere todas as partidas com as FKs de origem
 * nulas, depois liga player_a_source_match_id / player_b_source_match_id, que
 * só podem ser resolvidas depois de conhecer os ids gerados.
 */
export async function saveGenericBracket(params: SaveBracketParams): Promise<void> {
    const { championshipId, slots, phaseToRoundId, registrationUserMap } = params;

    await assertRoundsHaveNoMatches(
        championshipId,
        slots.map(s => phaseToRoundId.get(s.phase)).filter((id): id is string => !!id)
    );

    const rows = slots.map(slot => {
        const roundId = phaseToRoundId.get(slot.phase);
        if (!roundId) {
            throw new Error(`Rodada não encontrada para a fase "${slot.phase}" (jogo ${slot.matchNumber}).`);
        }

        return {
            championship_id: championshipId,
            round_id: roundId,
            type: 'Campeonato',
            status: 'pending',
            match_number: slot.matchNumber,
            player_a_id: slot.a ? (registrationUserMap.get(slot.a) ?? null) : null,
            player_b_id: slot.b ? (registrationUserMap.get(slot.b) ?? null) : null,
            registration_a_id: slot.a,
            registration_b_id: slot.b,
        };
    });

    const { data: inserted, error: insertError } = await supabase
        .from('matches')
        .insert(rows)
        .select('id, match_number');

    if (insertError || !inserted) {
        throw new Error(`Erro ao inserir partidas: ${insertError?.message}`);
    }

    const numToId = new Map<number, string>(inserted.map((r: any) => [r.match_number, r.id]));

    const dependentes = slots.filter(s => s.aSourceMatch != null || s.bSourceMatch != null);

    for (const slot of dependentes) {
        const matchId = numToId.get(slot.matchNumber);
        if (!matchId) continue;

        const patch: Record<string, string | null> = {};
        if (slot.aSourceMatch != null) {
            patch.player_a_source_match_id = numToId.get(slot.aSourceMatch) ?? null;
        }
        if (slot.bSourceMatch != null) {
            patch.player_b_source_match_id = numToId.get(slot.bSourceMatch) ?? null;
        }

        const { error } = await supabase.from('matches').update(patch).eq('id', matchId);
        if (error) throw new Error(`Erro ao vincular jogo ${slot.matchNumber}: ${error.message}`);
    }
}

/**
 * Cadeia de fases dos campeonatos antigos, que gravavam a fase em
 * `matches.phase` com inicial maiúscula. Os campeonatos novos não usam isto:
 * eles ligam cada jogo ao anterior por `player_a_source_match_id`.
 */
const FASE_SEGUINTE: Record<string, string> = {
    Oitavas: 'Quartas',
    Quartas: 'Semi',
    Semi: 'Final',
};

export interface AdvanceTarget {
    matchId: string;
    slot: 'a' | 'b';
}

/**
 * Para onde vai o vencedor de uma partida de campeonato **antigo**, sem FK de
 * origem na chave.
 *
 * Devolve `null` quando a chave declara a origem: aí quem promove é o trigger
 * `propagate_bracket_winner`, que segue a FK e acerta a vaga certa. Palpite por
 * fase competindo com a FK só erraria — e erraria calado.
 *
 * Sem FK não existe resposta certa, só uma escolha: a primeira vaga livre da
 * fase seguinte, na ordem do número do jogo. O ponto é ser **a mesma escolha
 * toda vez** — antes dependia da ordem em que o array chegava da rede.
 */
export function resolveLegacyAdvanceTarget(
    matches: any[],
    finishedMatchId: string
): AdvanceTarget | null {
    const chaveLigada = matches.some(m =>
        m.player_a_source_match_id === finishedMatchId ||
        m.player_b_source_match_id === finishedMatchId
    );
    if (chaveLigada) return null;

    const finished = matches.find(m => m.id === finishedMatchId);
    const proximaFase = finished?.phase ? FASE_SEGUINTE[finished.phase] : undefined;
    if (!proximaFase) return null;

    const candidatos = matches
        .filter(m => m.phase === proximaFase)
        .sort((x, y) =>
            (x.match_number ?? Number.MAX_SAFE_INTEGER) - (y.match_number ?? Number.MAX_SAFE_INTEGER)
            || String(x.id).localeCompare(String(y.id))
        );

    for (const candidato of candidatos) {
        if (!candidato.playerAId && !candidato.registration_a_id) return { matchId: candidato.id, slot: 'a' };
        if (!candidato.playerBId && !candidato.registration_b_id) return { matchId: candidato.id, slot: 'b' };
    }

    return null;
}
