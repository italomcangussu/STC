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

export function buildEmptyBracket(config: FormatConfig, participantCount: number): BracketSlot[] {
    const rounds = deriveRounds(config, participantCount);
    const qualifyRound = rounds.find(r => r.phase === 'qualify');
    const knockoutRounds = rounds.filter(r => r.phase !== 'qualify');

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
