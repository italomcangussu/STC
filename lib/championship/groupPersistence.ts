import { supabase } from '../supabase';
import { assertRoundsHaveNoMatches } from './bracket';
import { buildRoundRobinPairings, type DrawnGroup } from './roundRobin';

/** Confronto de fase de todos-contra-todos, antes de virar linha em `matches`. */
export interface LeagueMatchRow {
    matchNumber: number;
    phase: string;
    a: string;
    b: string;
    /** null em pontos corridos, que não tem grupos. */
    groupId: string | null;
}

export function buildGroupStageMatches(params: {
    groups: DrawnGroup[];
    /** group_name → championship_groups.id */
    groupIds: Map<string, string>;
    homeAndAway: boolean;
}): LeagueMatchRow[] {
    const { groups, groupIds, homeAndAway } = params;
    const rows: LeagueMatchRow[] = [];
    let matchNumber = 1;

    const turno = (phase: string, returno: boolean) => {
        for (const group of groups) {
            const ids = group.members.map(m => m.registrationId);
            const groupId = groupIds.get(group.name) ?? null;
            for (const [a, b] of buildRoundRobinPairings(ids, { returno })) {
                rows.push({ matchNumber: matchNumber++, phase, a, b, groupId });
            }
        }
    };

    turno('grupos', false);
    if (homeAndAway) turno('grupos-volta', true);

    return rows;
}

export function buildLeagueMatches(params: {
    registrationIds: string[];
    homeAndAway: boolean;
}): LeagueMatchRow[] {
    const { registrationIds, homeAndAway } = params;
    const rows: LeagueMatchRow[] = [];
    let matchNumber = 1;

    const turno = (phase: string, returno: boolean) => {
        for (const [a, b] of buildRoundRobinPairings(registrationIds, { returno })) {
            rows.push({ matchNumber: matchNumber++, phase, a, b, groupId: null });
        }
    };

    turno('classificatoria', false);
    if (homeAndAway) turno('classificatoria-volta', true);

    return rows;
}

/** Cria os grupos da classe, ou devolve os que já existem. */
async function ensureGroups(
    championshipId: string,
    classe: string,
    groups: DrawnGroup[]
): Promise<Map<string, string>> {
    const { data: existing, error: existingError } = await supabase
        .from('championship_groups')
        .select('id, group_name')
        .eq('championship_id', championshipId)
        .eq('category', classe);

    if (existingError) throw new Error(`Erro ao verificar grupos: ${existingError.message}`);
    if (existing && existing.length > 0) {
        return new Map(existing.map((g: any) => [g.group_name, g.id]));
    }

    const { data, error } = await supabase
        .from('championship_groups')
        .insert(groups.map(group => ({
            championship_id: championshipId,
            category: classe,
            group_name: group.name,
            seed_registration_id: group.members.find(m => m.isSeed)?.registrationId ?? null,
        })))
        .select('id, group_name');

    if (error || !data) throw new Error(`Erro ao criar grupos: ${error?.message}`);
    return new Map<string, string>(data.map((g: any) => [g.group_name, g.id]));
}

/** Insere só os membros que ainda não estão gravados. */
async function ensureGroupMembers(
    ids: Map<string, string>,
    groups: DrawnGroup[]
): Promise<void> {
    const groupIds = [...ids.values()];
    if (groupIds.length === 0) return;

    const { data: existing, error: existingError } = await supabase
        .from('championship_group_members')
        .select('group_id, registration_id')
        .in('group_id', groupIds);

    if (existingError) throw new Error(`Erro ao verificar membros dos grupos: ${existingError.message}`);

    const jaGravado = new Set((existing ?? []).map((m: any) => `${m.group_id}|${m.registration_id}`));

    const faltando = groups.flatMap(group => {
        const groupId = ids.get(group.name);
        if (!groupId) return [];
        return group.members
            .filter(member => !jaGravado.has(`${groupId}|${member.registrationId}`))
            .map(member => ({
                group_id: groupId,
                registration_id: member.registrationId,
                is_seed: member.isSeed,
                draw_order: member.drawOrder,
            }));
    });

    if (faltando.length === 0) return;

    const { error } = await supabase.from('championship_group_members').insert(faltando);
    if (error) throw new Error(`Erro ao gravar membros dos grupos: ${error.message}`);
}

/**
 * Grava os grupos e seus membros, devolvendo group_name → id.
 *
 * São dois inserts em tabelas diferentes, e o PostgREST não abre transação
 * entre eles: se o segundo falha, os grupos já estão gravados e nada os desfaz.
 *
 * A resposta aqui não é fingir que isso não acontece — é **convergir**. Cada
 * passo pergunta o que já existe e grava só o que falta, então repetir a ação
 * termina o serviço de onde ele parou. A versão anterior fazia o oposto: via os
 * grupos órfãos, concluía "já está feito" e devolvia sucesso sem nenhum membro.
 * A classe ficava presa em grupos vazios e clicar de novo não consertava.
 */
export async function saveGroups(params: {
    championshipId: string;
    classe: string;
    groups: DrawnGroup[];
}): Promise<Map<string, string>> {
    const { championshipId, classe, groups } = params;

    const ids = await ensureGroups(championshipId, classe, groups);
    await ensureGroupMembers(ids, groups);

    return ids;
}

/** Grava os confrontos de fase de grupos ou de pontos corridos. */
export async function saveLeagueMatches(params: {
    championshipId: string;
    rows: LeagueMatchRow[];
    /** phase → championship_rounds.id */
    phaseToRoundId: Map<string, string>;
    /** registrationId → userId */
    registrationUserMap: Map<string, string | null>;
}): Promise<void> {
    const { championshipId, rows, phaseToRoundId, registrationUserMap } = params;
    if (rows.length === 0) return;

    await assertRoundsHaveNoMatches(
        championshipId,
        rows.map(r => phaseToRoundId.get(r.phase)).filter((id): id is string => !!id)
    );

    const payload = rows.map(row => {
        const roundId = phaseToRoundId.get(row.phase);
        if (!roundId) {
            throw new Error(`Rodada não encontrada para a fase "${row.phase}" (jogo ${row.matchNumber}).`);
        }
        return {
            championship_id: championshipId,
            round_id: roundId,
            championship_group_id: row.groupId,
            type: 'Campeonato',
            status: 'pending',
            match_number: row.matchNumber,
            phase: row.phase,
            registration_a_id: row.a,
            registration_b_id: row.b,
            player_a_id: registrationUserMap.get(row.a) ?? null,
            player_b_id: registrationUserMap.get(row.b) ?? null,
        };
    });

    const { error } = await supabase.from('matches').insert(payload);
    if (error) throw new Error(`Erro ao inserir confrontos: ${error.message}`);
}
