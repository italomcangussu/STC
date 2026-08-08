import { supabase } from '../supabase';
import { calculateGroupStandings } from '../championshipUtils';
import { rankQualifiers, type GroupStanding } from './groupStage';
import { assignToSlot, buildEmptyBracket, saveGenericBracket, type BracketSlot } from './bracket';
import type { FormatConfig } from './formatConfig';

/**
 * Linha de classificação como `calculateGroupStandings` devolve.
 * `userId` guarda o id da inscrição, não o do usuário — o nome vem de
 * InternalStanding em types.ts e é anterior ao suporte a convidados.
 */
interface InternalStandingLike {
    userId: string;
    groupName: string;
    points: number;
    setsWon: number;
    setsLost: number;
    gamesWon: number;
    gamesLost: number;
    [key: string]: unknown;
}

/**
 * Converte a classificação bruta em GroupStanding, atribuindo a posição de
 * cada um dentro do seu grupo. Ordena por pontos, saldo de sets e saldo de
 * games; o id entra por último para a ordem nunca depender da entrada.
 */
export function toGroupStandings(standings: InternalStandingLike[]): GroupStanding[] {
    const porGrupo = new Map<string, InternalStandingLike[]>();
    for (const s of standings) {
        const lista = porGrupo.get(s.groupName) ?? [];
        lista.push(s);
        porGrupo.set(s.groupName, lista);
    }

    const result: GroupStanding[] = [];
    for (const [groupName, lista] of porGrupo) {
        const ordenada = [...lista].sort((a, b) =>
            b.points - a.points ||
            (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) ||
            (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost) ||
            a.userId.localeCompare(b.userId)
        );

        ordenada.forEach((s, index) => {
            result.push({
                registrationId: s.userId,
                groupName,
                position: index + 1,
                points: s.points,
                setDiff: s.setsWon - s.setsLost,
                gameDiff: s.gamesWon - s.gamesLost,
            });
        });
    }

    return result;
}

/**
 * Emparelha os classificados para a primeira rodada do mata-mata, cruzando
 * primeiros colocados com não-primeiros de outro grupo. O deslocamento de uma
 * posição entre as duas listas é o que evita reencontro de quem já se
 * enfrentou na fase de grupos.
 *
 * Com melhores terceiros o cruzamento perfeito nem sempre existe; nesse caso
 * o par sai mesmo assim e `countSameGroupPairs` permite avisar o admin.
 */
export function pairQualifiersForKnockout(qualified: GroupStanding[]): [string, string][] {
    if (qualified.length < 2) return [];

    const primeiros = qualified
        .filter(q => q.position === 1)
        .sort((a, b) => a.groupName.localeCompare(b.groupName));

    const demais = qualified
        .filter(q => q.position !== 1)
        .sort((a, b) => a.position - b.position || a.groupName.localeCompare(b.groupName));

    // Sem primeiros colocados (ex.: só terceiros), emparelha na ordem.
    if (primeiros.length === 0) {
        const pares: [string, string][] = [];
        for (let i = 0; i + 1 < demais.length; i += 2) {
            pares.push([demais[i].registrationId, demais[i + 1].registrationId]);
        }
        return pares;
    }

    const disponiveis = [...demais];
    const pares: [string, string][] = [];
    const primeirosSemPar: GroupStanding[] = [];

    for (const primeiro of primeiros) {
        if (disponiveis.length === 0) {
            primeirosSemPar.push(primeiro);
            continue;
        }
        // Prefere alguém de outro grupo; se não houver, aceita o primeiro da fila.
        const idx = disponiveis.findIndex(d => d.groupName !== primeiro.groupName);
        const adversario = disponiveis.splice(idx >= 0 ? idx : 0, 1)[0];
        pares.push([primeiro.registrationId, adversario.registrationId]);
    }

    // Classificando 1 por grupo, todos os classificados são primeiros colocados
    // e não há com quem cruzar: aí eles se enfrentam entre si.
    for (let i = 0; i + 1 < primeirosSemPar.length; i += 2) {
        pares.push([primeirosSemPar[i].registrationId, primeirosSemPar[i + 1].registrationId]);
    }

    // Sobra quando há mais não-primeiros que primeiros colocados.
    for (let i = 0; i + 1 < disponiveis.length; i += 2) {
        pares.push([disponiveis[i].registrationId, disponiveis[i + 1].registrationId]);
    }

    return pares;
}

/** Quantos confrontos reencontram gente do mesmo grupo. */
export function countSameGroupPairs(
    pares: [string, string][],
    qualified: GroupStanding[]
): number {
    const grupoDe = new Map(qualified.map(q => [q.registrationId, q.groupName]));
    return pares.filter(([a, b]) => grupoDe.get(a) === grupoDe.get(b)).length;
}

// ── Leitura da classificação e gravação do mata-mata ──────────────────────────

export interface GroupsKnockoutPreview {
    standings: GroupStanding[];
    qualified: GroupStanding[];
    pairs: [string, string][];
    sameGroupPairs: number;
    /** Confrontos da fase de grupos ainda sem resultado. */
    pendingMatches: number;
}

/**
 * Lê os grupos e resultados da classe e monta a prévia do mata-mata.
 * Não grava nada: o admin confere antes de confirmar.
 */
export async function previewKnockoutFromGroups(params: {
    championshipId: string;
    classe: string;
    config: FormatConfig;
}): Promise<GroupsKnockoutPreview> {
    const { championshipId, classe, config } = params;

    if (config.format !== 'grupo-mata-mata') {
        throw new Error('Este formato não tem fase de grupos.');
    }

    const { data: groups, error: groupsError } = await supabase
        .from('championship_groups')
        .select('id, group_name, members:championship_group_members(registration_id)')
        .eq('championship_id', championshipId)
        .eq('category', classe);

    if (groupsError) throw new Error(`Erro ao buscar grupos: ${groupsError.message}`);
    if (!groups || groups.length === 0) {
        throw new Error(`Nenhum grupo encontrado para a ${classe}.`);
    }

    const { data: registrations, error: regError } = await supabase
        .from('championship_registrations')
        .select('id, participant_type, user_id, guest_name, class, user:profiles!user_id(name)')
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (regError) throw new Error(`Erro ao buscar inscrições: ${regError.message}`);

    const { data: matches, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('championship_id', championshipId)
        .in('championship_group_id', groups.map((g: any) => g.id));

    if (matchError) throw new Error(`Erro ao buscar partidas: ${matchError.message}`);

    const todas = matches ?? [];
    const pendingMatches = todas.filter((m: any) => m.status !== 'finished').length;

    const standings: GroupStanding[] = [];
    for (const group of groups as any[]) {
        const memberIds = (group.members ?? []).map((m: any) => m.registration_id);
        const groupRegs = (registrations ?? []).filter((r: any) => memberIds.includes(r.id));
        const groupMatches = todas.filter((m: any) => m.championship_group_id === group.id);

        const internas = calculateGroupStandings(groupRegs as any, groupMatches as any)
            .map(s => ({ ...s, groupName: group.group_name }));

        standings.push(...toGroupStandings(internas as any));
    }

    const qualified = rankQualifiers(standings, config.qualifiersPerGroup, config.bestThirdPlaces);
    const pairs = pairQualifiersForKnockout(qualified);

    return {
        standings,
        qualified,
        pairs,
        sameGroupPairs: countSameGroupPairs(pairs, qualified),
        pendingMatches,
    };
}

/**
 * Grava as partidas do mata-mata a partir dos pares confirmados.
 * Devolve a fase da primeira rodada eliminatória — a única cujos confrontos
 * já estão definidos, e portanto a única publicável agora.
 */
export async function saveKnockoutFromGroups(params: {
    championshipId: string;
    config: FormatConfig;
    participantCount: number;
    pairs: [string, string][];
    phaseToRoundId: Map<string, string>;
    registrationUserMap: Map<string, string | null>;
}): Promise<string> {
    const { championshipId, config, participantCount, pairs, phaseToRoundId, registrationUserMap } = params;

    // A chave vazia já traz as fases eliminatórias e as ligações de vencedor;
    // a fase de grupos fica de fora dela por construção.
    let bracket: BracketSlot[] = buildEmptyBracket(config, participantCount);

    const primeiraFase = bracket.filter(s => !s.aSourceMatch && !s.bSourceMatch);
    if (primeiraFase.length < pairs.length) {
        throw new Error(
            `A chave comporta ${primeiraFase.length} confrontos na primeira fase, mas há ${pairs.length} pares.`
        );
    }

    pairs.forEach(([a, b], i) => {
        const slot = primeiraFase[i];
        if (!slot) return;
        bracket = assignToSlot(bracket, slot.matchNumber, 'a', a);
        bracket = assignToSlot(bracket, slot.matchNumber, 'b', b);
    });

    // Só as fases eliminatórias vão para o banco; os jogos de grupo já existem.
    await saveGenericBracket({
        championshipId,
        slots: bracket,
        phaseToRoundId,
        registrationUserMap,
    });

    return primeiraFase[0].phase;
}
