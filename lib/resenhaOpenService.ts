// Supabase operations for the Resenha Open championship.
// Pure draw / advance logic lives in resenhaOpenDraw.ts and resenhaOpenAdvance.ts.

import { supabase } from './supabase';
import type { DrawAthlete, DrawMatch } from './resenhaOpenDraw';
import type { BracketMatch } from './resenhaOpenAdvance';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResenhaClass = '4ª Classe' | '5ª Classe';

export interface RoundDateRange {
    startDate: string; // YYYY-MM-DD
    endDate: string;
}

export interface CreateChampionshipParams {
    name: string;
    classe: ResenhaClass;
    startDate: string;
    endDate: string;
}

export interface RegisterSocioParams {
    championshipId: string;
    userId: string;
    classe: ResenhaClass;
    cabecaDeChave?: boolean;
}

export interface RegisterGuestParams {
    championshipId: string;
    guestName: string;
    classe: ResenhaClass;
    guestCidade?: string;
    guestIdade?: number;
    cabecaDeChave?: boolean;
}

export interface BracketMatchWithPhase extends BracketMatch {
    round_phase: string;
}

// ── Phase definitions ─────────────────────────────────────────────────────────

interface RoundDef {
    phase: string;
    roundNumber: number;
    name: string;
    matchNumbers: number[];
}

const CLASSE5_ROUNDS: RoundDef[] = [
    { phase: 'oitavas',   roundNumber: 1, name: 'Oitavas de Final', matchNumbers: [1,2,3,4,5,6,7,8] },
    { phase: 'quartas',   roundNumber: 2, name: 'Quartas de Final',  matchNumbers: [9,10,11,12] },
    { phase: 'semifinal', roundNumber: 3, name: 'Semifinais',        matchNumbers: [13,14] },
    { phase: 'final',     roundNumber: 4, name: 'Final',             matchNumbers: [15] },
];

const CLASSE4_ROUNDS: RoundDef[] = [
    { phase: 'qualify',       roundNumber: 1, name: 'Qualify',         matchNumbers: [1,2,3] },
    { phase: 'primeira_fase', roundNumber: 2, name: '1ª Fase',         matchNumbers: [4,5,6,7,8,9] },
    { phase: 'segunda_fase',  roundNumber: 3, name: '2ª Fase',         matchNumbers: [10,11] },
    { phase: 'quartas',       roundNumber: 4, name: 'Quartas de Final', matchNumbers: [12,13,14,15] },
    { phase: 'semifinal',     roundNumber: 5, name: 'Semifinais',      matchNumbers: [16,17] },
    { phase: 'final',         roundNumber: 6, name: 'Final',           matchNumbers: [18] },
];

function roundDefsForClass(classe: ResenhaClass): RoundDef[] {
    return classe === '5ª Classe' ? CLASSE5_ROUNDS : CLASSE4_ROUNDS;
}

// Build match_number → phase map
function buildPhaseMap(classe: ResenhaClass): Map<number, string> {
    const map = new Map<number, string>();
    for (const rd of roundDefsForClass(classe)) {
        for (const n of rd.matchNumbers) map.set(n, rd.phase);
    }
    return map;
}

// ── 1. Create championship ─────────────────────────────────────────────────────

export async function fetchResenhaOpenSeriesId(): Promise<string> {
    const { data, error } = await supabase
        .from('championship_series')
        .select('id')
        .eq('slug', 'resenha-open')
        .single();
    if (error || !data) throw new Error('Série "Resenha Open" não encontrada. Execute a migration primeiro.');
    return data.id;
}

export async function createResenhaOpenChampionship(
    params: CreateChampionshipParams
): Promise<string> {
    const seriesId = await fetchResenhaOpenSeriesId();

    const { data, error } = await supabase
        .from('championships')
        .insert({
            name: params.name,
            series_id: seriesId,
            start_date: params.startDate,
            end_date: params.endDate,
            status: 'draft',
            format: 'mata-mata',
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao criar campeonato: ${error?.message}`);
    return data.id;
}

// ── 2. Create rounds ───────────────────────────────────────────────────────────

export async function createResenhaOpenRounds(
    championshipId: string,
    classe: ResenhaClass,
    // Per-phase date overrides; falls back to a single date range for all rounds
    dateFn: (roundDef: RoundDef) => RoundDateRange
): Promise<Map<string, string>> {
    const roundDefs = roundDefsForClass(classe);

    const rows = roundDefs.map(rd => {
        const { startDate, endDate } = dateFn(rd);
        return {
            championship_id: championshipId,
            round_number: rd.roundNumber,
            name: rd.name,
            phase: rd.phase,
            start_date: startDate,
            end_date: endDate,
            status: 'pending',
        };
    });

    const { data, error } = await supabase
        .from('championship_rounds')
        .insert(rows)
        .select('id, phase');

    if (error || !data) throw new Error(`Erro ao criar rodadas: ${error?.message}`);

    // phase → round_id map
    const phaseToId = new Map<string, string>();
    for (const row of data) phaseToId.set(row.phase, row.id);
    return phaseToId;
}

// ── 3. Register athletes ───────────────────────────────────────────────────────

export async function registerSocio(params: RegisterSocioParams): Promise<string> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .insert({
            championship_id: params.championshipId,
            participant_type: 'socio',
            user_id: params.userId,
            class: params.classe,
            cabeca_de_chave: params.cabecaDeChave ?? false,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao registrar sócio: ${error?.message}`);
    return data.id;
}

export async function registerGuest(params: RegisterGuestParams): Promise<string> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .insert({
            championship_id: params.championshipId,
            participant_type: 'guest',
            user_id: null,
            guest_name: params.guestName,
            guest_cidade: params.guestCidade ?? null,
            guest_idade: params.guestIdade ?? null,
            class: params.classe,
            cabeca_de_chave: params.cabecaDeChave ?? false,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao registrar convidado: ${error?.message}`);
    return data.id;
}

export async function removeRegistration(registrationId: string): Promise<void> {
    const { error } = await supabase
        .from('championship_registrations')
        .delete()
        .eq('id', registrationId);
    if (error) throw new Error(`Erro ao remover inscrição: ${error.message}`);
}

// ── 4. Fetch registrations as DrawAthlete[] ───────────────────────────────────

export async function fetchRegistrations(
    championshipId: string,
    classe: ResenhaClass
): Promise<DrawAthlete[]> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .select('id, participant_type, user_id, guest_name, cabeca_de_chave, guest_cidade, user:profiles(name)')
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (error) throw new Error(`Erro ao buscar inscrições: ${error.message}`);

    return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.participant_type === 'socio' ? (r.user?.name ?? r.user_id) : (r.guest_name ?? 'Convidado'),
        participant_type: r.participant_type,
        guest_cidade: r.guest_cidade ?? null,
        cabeca_de_chave: r.cabeca_de_chave ?? false,
    }));
}

// ── 5. Save bracket ────────────────────────────────────────────────────────────
// Two-pass: insert all matches with null source FKs, then patch the FKs.

export async function saveBracket(
    championshipId: string,
    classe: ResenhaClass,
    matches: DrawMatch[],
    phaseToRoundId: Map<string, string>,
    registrationUserMap: Map<string, string | null> // registrationId → userId
): Promise<void> {
    const phaseMap = buildPhaseMap(classe);

    // First pass: insert without source FKs
    const rows = matches.map(m => {
        const phase = phaseMap.get(m.match_number) ?? 'oitavas';
        const roundId = phaseToRoundId.get(phase);
        if (!roundId) throw new Error(`Round não encontrado para fase "${phase}" (jogo ${m.match_number})`);

        return {
            championship_id: championshipId,
            round_id: roundId,
            type: 'Campeonato',
            status: 'pending',
            match_number: m.match_number,
            player_a_id: m.registration_a_id ? (registrationUserMap.get(m.registration_a_id) ?? null) : null,
            player_b_id: m.registration_b_id ? (registrationUserMap.get(m.registration_b_id) ?? null) : null,
            registration_a_id: m.registration_a_id,
            registration_b_id: m.registration_b_id,
        };
    });

    const { data: inserted, error: insertError } = await supabase
        .from('matches')
        .insert(rows)
        .select('id, match_number');

    if (insertError || !inserted) {
        throw new Error(`Erro ao inserir partidas: ${insertError?.message}`);
    }

    // Build match_number → DB id map
    const numToId = new Map<number, string>(inserted.map((r: any) => [r.match_number, r.id]));

    // Second pass: patch source FKs for dependent matches
    const dependents = matches.filter(
        m => m.player_a_source_match_number != null || m.player_b_source_match_number != null
    );

    for (const m of dependents) {
        const matchId = numToId.get(m.match_number);
        if (!matchId) continue;

        const patch: Record<string, string | null> = {};
        if (m.player_a_source_match_number != null) {
            patch.player_a_source_match_id = numToId.get(m.player_a_source_match_number) ?? null;
        }
        if (m.player_b_source_match_number != null) {
            patch.player_b_source_match_id = numToId.get(m.player_b_source_match_number) ?? null;
        }

        const { error } = await supabase.from('matches').update(patch).eq('id', matchId);
        if (error) throw new Error(`Erro ao vincular jogo ${m.match_number}: ${error.message}`);
    }
}

// ── 6. Fetch bracket ───────────────────────────────────────────────────────────

export async function fetchBracket(
    championshipId: string
): Promise<BracketMatchWithPhase[]> {
    const [matchRes, regRes] = await Promise.all([
        supabase
            .from('matches')
            .select('*, round:championship_rounds(phase)')
            .eq('championship_id', championshipId)
            .order('match_number', { ascending: true }),
        supabase
            .from('championship_registrations')
            .select('id, participant_type, guest_name, user:profiles(name)')
            .eq('championship_id', championshipId),
    ]);

    if (matchRes.error) throw new Error(`Erro ao buscar partidas: ${matchRes.error.message}`);
    if (regRes.error) throw new Error(`Erro ao buscar inscrições: ${regRes.error.message}`);

    const dbMatches: any[] = matchRes.data ?? [];
    const regs: any[] = regRes.data ?? [];

    // registrationId → display name
    const nameMap = new Map<string, string>();
    for (const r of regs) {
        nameMap.set(r.id, r.participant_type === 'socio' ? (r.user?.name ?? '?') : (r.guest_name ?? 'Convidado'));
    }

    // id → match_number (for resolving source references)
    const idToNum = new Map<string, number>(dbMatches.map((m: any) => [m.id, m.match_number]));

    return dbMatches.map((m: any): BracketMatchWithPhase => {
        const srcANum = m.player_a_source_match_id ? idToNum.get(m.player_a_source_match_id) : undefined;
        const srcBNum = m.player_b_source_match_id ? idToNum.get(m.player_b_source_match_id) : undefined;

        return {
            id: m.id,
            match_number: m.match_number,
            registration_a_id: m.registration_a_id ?? null,
            registration_b_id: m.registration_b_id ?? null,
            player_a_label: m.registration_a_id
                ? (nameMap.get(m.registration_a_id) ?? '?')
                : (srcANum != null ? `Vencedor Jogo ${srcANum}` : '?'),
            player_b_label: m.registration_b_id
                ? (nameMap.get(m.registration_b_id) ?? '?')
                : (srcBNum != null ? `Vencedor Jogo ${srcBNum}` : '?'),
            player_a_source_match_number: srcANum,
            player_b_source_match_number: srcBNum,
            status: m.status ?? 'pending',
            winner_registration_id: m.winner_registration_id ?? null,
            is_walkover: m.is_walkover ?? false,
            round_phase: (m.round as any)?.phase ?? '',
        };
    });
}

// ── 7. Record results ──────────────────────────────────────────────────────────

export async function recordMatchResult(
    matchId: string,
    winnerRegistrationId: string
): Promise<void> {
    const { error } = await supabase
        .from('matches')
        .update({
            status: 'finished',
            winner_registration_id: winnerRegistrationId,
            result_set_at: new Date().toISOString(),
        })
        .eq('id', matchId)
        .eq('status', 'pending');

    if (error) throw new Error(`Erro ao registrar resultado: ${error.message}`);
}

export async function recordWalkover(
    matchId: string,
    winnerRegistrationId: string
): Promise<void> {
    const { error } = await supabase
        .from('matches')
        .update({
            status: 'finished',
            walkover_winner_registration_id: winnerRegistrationId,
            is_walkover: true,
            result_set_at: new Date().toISOString(),
        })
        .eq('id', matchId)
        .eq('status', 'pending');

    if (error) throw new Error(`Erro ao registrar W.O.: ${error.message}`);
}

// ── 8. Resolve phases and finish championship ─────────────────────────────────

export async function resolveAndFinish(championshipId: string): Promise<void> {
    const { error: rpcError } = await supabase.rpc('resolve_resenha_open_final_phases', {
        p_championship_id: championshipId,
    });
    if (rpcError) throw new Error(`Erro ao resolver fases: ${rpcError.message}`);

    const { error: updateError } = await supabase
        .from('championships')
        .update({ status: 'finished' })
        .eq('id', championshipId);

    if (updateError) throw new Error(`Erro ao encerrar campeonato: ${updateError.message}`);
}

// ── 9. Helpers for the admin UI ────────────────────────────────────────────────

// Build registrationId → userId map from a DrawAthlete list and the raw registration data.
// Guests have null userId.
export async function fetchRegistrationUserMap(
    championshipId: string,
    classe: ResenhaClass
): Promise<Map<string, string | null>> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .select('id, user_id')
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (error) throw new Error(`Erro ao buscar mapa de usuários: ${error.message}`);
    return new Map((data ?? []).map((r: any) => [r.id, r.user_id ?? null]));
}

// Activate championship (move from draft → active once the bracket is saved)
export async function activateChampionship(championshipId: string): Promise<void> {
    const { error } = await supabase
        .from('championships')
        .update({ status: 'active' })
        .eq('id', championshipId);
    if (error) throw new Error(`Erro ao ativar campeonato: ${error.message}`);
}

// Delete all matches for a championship (used before a redraw)
export async function deleteBracket(championshipId: string): Promise<void> {
    const { error } = await supabase
        .from('matches')
        .delete()
        .eq('championship_id', championshipId);
    if (error) throw new Error(`Erro ao deletar chave: ${error.message}`);
}
