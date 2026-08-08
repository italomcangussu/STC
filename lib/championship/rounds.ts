import { supabase } from '../supabase';
import { BRACKET_SLOTS, validateAgainstParticipants, type BracketSize, type FormatConfig } from './formatConfig';

export interface RoundDef {
    phase: string;
    roundNumber: number;
    name: string;
    matchNumbers: number[];
}

/**
 * Vocabulário de `championship_rounds.phase`.
 * resolve_championship_final_phases procura a final por phase IN ('final','Final')
 * ou name = 'Final', e exclui qualquer phase contendo 'semi'. Mudar estes valores
 * quebra a apuração de pontos silenciosamente.
 */
export const ROUND_PHASES: Record<BracketSize, { phase: string; name: string }> = {
    round_of_32: { phase: '16avos', name: '16 avos de Final' },
    round_of_16: { phase: 'oitavas', name: 'Oitavas de Final' },
    quarterfinal: { phase: 'quartas', name: 'Quartas de Final' },
    semifinal: { phase: 'semifinal', name: 'Semifinais' },
};

const FINAL_ROUND = { phase: 'final', name: 'Final' };

/** Fases do mata-mata a partir de um tamanho de quadro, até a final. */
const knockoutChain = (start: BracketSize): { phase: string; name: string }[] => {
    const order: BracketSize[] = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal'];
    const from = order.indexOf(start);
    return [...order.slice(from).map(size => ROUND_PHASES[size]), FINAL_ROUND];
};

/** Numera sequencialmente os jogos de cada fase. */
const numberRounds = (defs: { phase: string; name: string; matchCount: number }[]): RoundDef[] => {
    let n = 1;
    return defs.map((def, i) => {
        const matchNumbers = Array.from({ length: def.matchCount }, () => n++);
        return { phase: def.phase, name: def.name, roundNumber: i + 1, matchNumbers };
    });
};

const roundRobinMatchCount = (participants: number) => (participants * (participants - 1)) / 2;

export function deriveRounds(config: FormatConfig, participantCount: number): RoundDef[] {
    const check = validateAgainstParticipants(config, participantCount);
    if (!check.ok) throw new Error(check.errors.join(' '));

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        const defs: { phase: string; name: string; matchCount: number }[] = [];

        if (config.qualifying) {
            defs.push({ phase: 'qualify', name: 'Qualificatórias', matchCount: config.qualifying.matchCount });
        }

        let remaining = slots;
        for (const link of knockoutChain(config.mainDrawStartPhase)) {
            defs.push({ ...link, matchCount: remaining / 2 });
            remaining /= 2;
        }

        return numberRounds(defs);
    }

    if (config.format === 'pontos-corridos') {
        const perTurn = roundRobinMatchCount(participantCount);
        const defs: { phase: string; name: string; matchCount: number }[] = [
            { phase: 'classificatoria', name: 'Fase Classificatória', matchCount: perTurn },
        ];
        if (config.homeAndAway) {
            defs.push({ phase: 'classificatoria-volta', name: 'Returno', matchCount: perTurn });
        }
        if (config.finalPhase) {
            let remaining = BRACKET_SLOTS[config.finalPhase.startPhase];
            for (const link of knockoutChain(config.finalPhase.startPhase)) {
                defs.push({ ...link, matchCount: remaining / 2 });
                remaining /= 2;
            }
        }
        return numberRounds(defs);
    }

    const perGroup = roundRobinMatchCount(config.membersPerGroup) * config.groupCount;
    const defs: { phase: string; name: string; matchCount: number }[] = [
        { phase: 'grupos', name: 'Fase de Grupos', matchCount: perGroup },
    ];
    if (config.homeAndAway) {
        defs.push({ phase: 'grupos-volta', name: 'Fase de Grupos — Returno', matchCount: perGroup });
    }

    const qualifiers = config.qualifiersPerGroup * config.groupCount + config.bestThirdPlaces;
    const startSize = (Object.keys(BRACKET_SLOTS) as BracketSize[]).find(k => BRACKET_SLOTS[k] === qualifiers);

    if (startSize) {
        let remaining = qualifiers;
        for (const link of knockoutChain(startSize)) {
            defs.push({ ...link, matchCount: remaining / 2 });
            remaining /= 2;
        }
    } else {
        // qualifiers === 2: só a final. validateFormatShape já garantiu potência de 2.
        defs.push({ ...FINAL_ROUND, matchCount: 1 });
    }

    return numberRounds(defs);
}

export interface CreateRoundsParams {
    championshipId: string;
    classe: string;
    config: FormatConfig;
    participantCount: number;
    startDate: string;
    endDate: string;
}

/**
 * Persiste as rodadas da classe. Idempotente: se a classe já tem rodadas,
 * devolve o mapa existente sem inserir. Recusa campeonatos do modelo antigo,
 * cujas rodadas têm class nulo e são compartilhadas entre classes.
 */
export async function createRounds(params: CreateRoundsParams): Promise<Map<string, string>> {
    const { data: legacy, error: legacyError } = await supabase
        .from('championship_rounds')
        .select('id')
        .eq('championship_id', params.championshipId)
        .is('class', null)
        .limit(1);

    if (legacyError) throw new Error(`Erro ao verificar rodadas: ${legacyError.message}`);
    if (legacy && legacy.length > 0) {
        throw new Error(
            'Este campeonato foi criado no modelo antigo, em que as classes compartilham rodadas. ' +
            'Crie um campeonato novo pelo Criador para usar rodadas por classe.'
        );
    }

    const { data: existing, error: existingError } = await supabase
        .from('championship_rounds')
        .select('id, phase')
        .eq('championship_id', params.championshipId)
        .eq('class', params.classe);

    if (existingError) throw new Error(`Erro ao verificar rodadas: ${existingError.message}`);
    if (existing && existing.length > 0) {
        return new Map(existing.map((r: any) => [r.phase, r.id]));
    }

    const defs = deriveRounds(params.config, params.participantCount);
    const rows = defs.map(def => ({
        championship_id: params.championshipId,
        class: params.classe,
        round_number: def.roundNumber,
        name: def.name,
        phase: def.phase,
        start_date: params.startDate,
        end_date: params.endDate,
        status: 'pending',
    }));

    const { data, error } = await supabase
        .from('championship_rounds')
        .insert(rows)
        .select('id, phase');

    if (error || !data) throw new Error(`Erro ao criar rodadas: ${error?.message}`);
    return new Map(data.map((r: any) => [r.phase, r.id]));
}

/**
 * Tira a rodada do rascunho e coloca o campeonato em andamento.
 *
 * Só é chamada para uma rodada cujos confrontos já estão definidos — as fases
 * seguintes seguem 'pending' porque ainda são placeholders
 * (registration_a_id/registration_b_id nulos, ligados por
 * player_a_source_match_id) e apareceriam como "a definir" para os sócios.
 * Idempotente: as condições de status fazem a chamada repetida não reabrir uma
 * rodada já finalizada nem reverter um campeonato encerrado.
 */
async function publishRound(championshipId: string, roundId: string): Promise<void> {
    const { error: roundError } = await supabase
        .from('championship_rounds')
        .update({ status: 'active' })
        .eq('id', roundId)
        .eq('status', 'pending');

    if (roundError) throw new Error(`Erro ao publicar a rodada: ${roundError.message}`);

    const { error: champError } = await supabase
        .from('championships')
        .update({ status: 'ongoing' })
        .eq('id', championshipId)
        .eq('status', 'draft');

    if (champError) throw new Error(`Erro ao colocar o campeonato em andamento: ${champError.message}`);
}

/**
 * Publica a fase inicial da classe. Chamado depois de gravar a chave —
 * sorteada ou montada à mão.
 */
export async function activateFirstRound(championshipId: string, classe: string): Promise<void> {
    const { data: primeira, error } = await supabase
        .from('championship_rounds')
        .select('id')
        .eq('championship_id', championshipId)
        .eq('class', classe)
        .order('round_number', { ascending: true })
        .limit(1);

    if (error) throw new Error(`Erro ao buscar a primeira rodada: ${error.message}`);
    if (!primeira || primeira.length === 0) return;

    await publishRound(championshipId, primeira[0].id);
}

/**
 * Publica a rodada de uma fase específica da classe. Serve ao mata-mata gerado
 * a partir dos grupos, cuja primeira fase eliminatória só ganha confrontos
 * depois que a fase de grupos é jogada — e portanto não é a primeira rodada da
 * classe.
 */
export async function activateRoundByPhase(
    championshipId: string,
    classe: string,
    phase: string
): Promise<void> {
    const { data: rodada, error } = await supabase
        .from('championship_rounds')
        .select('id')
        .eq('championship_id', championshipId)
        .eq('class', classe)
        .eq('phase', phase)
        .limit(1);

    if (error) throw new Error(`Erro ao buscar a rodada da fase "${phase}": ${error.message}`);
    if (!rodada || rodada.length === 0) return;

    await publishRound(championshipId, rodada[0].id);
}
