import { supabase } from '../supabase';
import { errorMessage, logger } from '../logger';

/**
 * Quais origens de participante o campeonato aceita — os dois toggles de
 * "Quem pode se inscrever", no Criador.
 */
export interface ParticipantSources {
    allowGuests: boolean;
    allowStudents: boolean;
}

/** Sócio é a origem padrão de todo campeonato do clube; o resto se liga de propósito. */
export const DEFAULT_SOURCES: ParticipantSources = { allowGuests: false, allowStudents: false };

/**
 * Códigos de "essa coluna não existe aqui". `42703` é o Postgres; `PGRST204` é
 * o PostgREST recusando um campo que não está no schema em cache.
 *
 * Existem porque a migration `20260808120000_championship_participant_sources`
 * pode ainda não ter sido aplicada no ambiente em que o app está rodando. Nesse
 * caso a persistência degrada exatamente para o comportamento anterior — deduzir
 * pelas inscrições — em vez de derrubar a tela inteira.
 */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);

function isMissingColumn(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && MISSING_COLUMN.has(code);
}

/**
 * Deduz as origens a partir de quem já está inscrito: um convidado na lista é
 * prova de que convidado foi aceito, tenha ou não coluna gravada.
 *
 * Continua valendo mesmo depois da migration, como piso — nunca desliga um
 * toggle, só liga. Desligar apagaria a escolha que o admin fez antes da
 * primeira inscrição chegar.
 */
export function deriveSources(
    registrations: { participantType: string }[],
    base: ParticipantSources = DEFAULT_SOURCES
): ParticipantSources {
    return {
        allowGuests: base.allowGuests || registrations.some(r => r.participantType === 'guest'),
        allowStudents: base.allowStudents || registrations.some(r => r.participantType === 'aluno'),
    };
}

/** Lê o que está gravado. Devolve os defaults quando a coluna ainda não existe. */
export async function fetchParticipantSources(championshipId: string): Promise<ParticipantSources> {
    const { data, error } = await supabase
        .from('championships')
        .select('allow_guests, allow_students')
        .eq('id', championshipId)
        .maybeSingle();

    if (error) {
        if (!isMissingColumn(error)) throw error;
        logger.warn('participant_sources_columns_missing', { championshipId });
        return DEFAULT_SOURCES;
    }

    return {
        allowGuests: data?.allow_guests ?? false,
        allowStudents: data?.allow_students ?? false,
    };
}

/**
 * Grava a escolha do admin.
 *
 * Falha em silêncio (só log) de propósito: se a coluna não existe, o problema é
 * de deploy, não do admin — avisá-lo sobre uma coluna do Postgres não lhe daria
 * nenhuma ação possível, e a tela continua funcionando com o toggle em memória.
 */
export async function saveParticipantSources(
    championshipId: string,
    sources: Partial<ParticipantSources>
): Promise<void> {
    const patch: Record<string, boolean> = {};
    if (sources.allowGuests !== undefined) patch.allow_guests = sources.allowGuests;
    if (sources.allowStudents !== undefined) patch.allow_students = sources.allowStudents;
    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase.from('championships').update(patch).eq('id', championshipId);
    if (!error) return;

    if (!isMissingColumn(error)) throw error;
    logger.warn('participant_sources_save_skipped', {
        championshipId,
        error: errorMessage(error),
    });
}
