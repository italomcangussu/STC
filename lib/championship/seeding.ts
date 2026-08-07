import { supabase } from '../supabase';
import { fetchRanking } from '../rankingService';

export interface SeedCandidate {
    registrationId: string;
    userId: string | null;
    name: string;
}

/**
 * Escolhe até `count` inscritos seguindo a ordem do ranking.
 * Participantes sem userId (convidados e alunos) não têm posição no ranking
 * e só podem ser marcados manualmente.
 */
export function pickSeedsByRanking(
    candidates: SeedCandidate[],
    rankedUserIds: string[],
    count: number
): string[] {
    if (count <= 0) return [];

    const byUserId = new Map<string, string>();
    for (const c of candidates) {
        if (c.userId && !byUserId.has(c.userId)) byUserId.set(c.userId, c.registrationId);
    }

    const seeds: string[] = [];
    const used = new Set<string>();
    for (const userId of rankedUserIds) {
        if (seeds.length >= count) break;
        const registrationId = byUserId.get(userId);
        if (!registrationId || used.has(registrationId)) continue;
        seeds.push(registrationId);
        used.add(registrationId);
    }
    return seeds;
}

export async function suggestSeedsFromRanking(
    candidates: SeedCandidate[],
    classe: string,
    count: number
): Promise<string[]> {
    const ranking = await fetchRanking(classe);
    return pickSeedsByRanking(candidates, ranking.map(p => p.id), count);
}

/** Substitui o conjunto de cabeças da classe pelos ids informados. */
export async function applySeeds(
    championshipId: string,
    classe: string,
    registrationIds: string[]
): Promise<void> {
    const { error: clearError } = await supabase
        .from('championship_registrations')
        .update({ cabeca_de_chave: false })
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (clearError) throw new Error(`Erro ao limpar cabeças de chave: ${clearError.message}`);
    if (registrationIds.length === 0) return;

    const { error } = await supabase
        .from('championship_registrations')
        .update({ cabeca_de_chave: true })
        .in('id', registrationIds);

    if (error) throw new Error(`Erro ao marcar cabeças de chave: ${error.message}`);
}
