import { supabase } from '../supabase';
import { primaryFormat, type ClassFormats } from './formatConfig';

export interface ScoringRules {
    ptsVictory: number;
    ptsDefeat: number;
    ptsWoVictory: number;
    ptsSet: number;
    ptsGame: number;
    ptsTechnicalDraw: number;
    finalRankingPts: number;
}

/** Espelha os defaults das colunas de championships. */
export const DEFAULT_SCORING: ScoringRules = {
    ptsVictory: 3,
    ptsDefeat: 0,
    ptsWoVictory: 3,
    ptsSet: 0,
    ptsGame: 0,
    ptsTechnicalDraw: 0,
    finalRankingPts: 200,
};

export function slugify(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // remove diacríticos
        .replace(/º/g, 'o')
        .replace(/ª/g, 'a')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export interface ChampionshipSeriesRow {
    id: string;
    name: string;
    slug: string;
}

export async function ensureSeries(name: string): Promise<ChampionshipSeriesRow> {
    const trimmed = name.trim();
    const slug = slugify(trimmed);

    const { data: existing, error: lookupError } = await supabase
        .from('championship_series')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();

    if (lookupError) throw new Error(`Erro ao buscar série: ${lookupError.message}`);
    if (existing) return existing as ChampionshipSeriesRow;

    const { data, error } = await supabase
        .from('championship_series')
        .insert({ name: trimmed, slug })
        .select('id, name, slug')
        .single();

    if (error || !data) throw new Error(`Erro ao criar série: ${error?.message}`);
    return data as ChampionshipSeriesRow;
}

export interface CreateChampionshipParams {
    name: string;
    /** Configuração por classe: cada uma pode ter formato e fases próprios. */
    classFormats: ClassFormats;
    classes: string[];
    startDate: string;
    endDate: string | null;
    seriesId: string | null;
    scoring?: Partial<ScoringRules>;
}

/**
 * Cria o campeonato como rascunho. Idempotente: se já existir um campeonato
 * aberto com a mesma série, nome e datas, devolve o id dele em vez de duplicar.
 */
export async function createChampionship(params: CreateChampionshipParams): Promise<string> {
    let lookup = supabase
        .from('championships')
        .select('id')
        .eq('name', params.name)
        .eq('start_date', params.startDate)
        .in('status', ['draft', 'active', 'ongoing']);

    lookup = params.seriesId
        ? lookup.eq('series_id', params.seriesId)
        : lookup.is('series_id', null);

    const { data: existing, error: lookupError } = await lookup
        .order('created_at', { ascending: false })
        .limit(1);

    if (lookupError) throw new Error(`Erro ao verificar campeonato existente: ${lookupError.message}`);

    const scoring: ScoringRules = { ...DEFAULT_SCORING, ...params.scoring };

    // Recriar o mesmo campeonato é a rota do "voltar e ajustar": sincroniza a
    // configuração em vez de devolver a antiga em silêncio. Depois que as
    // rodadas existem, elas foram derivadas do formato antigo — aí mudar a
    // configuração dessincronizaria as duas coisas, e é melhor recusar.
    if (existing && existing.length > 0) {
        const id = existing[0].id;

        const { data: rodadas, error: roundsError } = await supabase
            .from('championship_rounds')
            .select('id')
            .eq('championship_id', id)
            .limit(1);

        if (roundsError) throw new Error(`Erro ao verificar rodadas: ${roundsError.message}`);
        if (rodadas && rodadas.length > 0) {
            throw new Error(
                'Este campeonato já tem rodadas geradas; o formato não pode mais mudar. ' +
                'Apague as rodadas para reconfigurar, ou crie um campeonato novo.'
            );
        }

        const { error: updateError } = await supabase
            .from('championships')
            .update({
                format: primaryFormat(params.classFormats, params.classes),
                format_config: params.classFormats,
                end_date: params.endDate,
                pts_victory: scoring.ptsVictory,
                pts_defeat: scoring.ptsDefeat,
                pts_wo_victory: scoring.ptsWoVictory,
                pts_set: scoring.ptsSet,
                pts_game: scoring.ptsGame,
                pts_technical_draw: scoring.ptsTechnicalDraw,
                final_ranking_pts: scoring.finalRankingPts,
            })
            .eq('id', id);

        if (updateError) throw new Error(`Erro ao atualizar campeonato: ${updateError.message}`);
        return id;
    }

    // edition_year só faz sentido com série: o índice único
    // uidx_championship_series_edition_year é (series_id, edition_year).
    const editionYear = params.seriesId ? Number(params.startDate.slice(0, 4)) : null;

    const { data, error } = await supabase
        .from('championships')
        .insert({
            name: params.name,
            // A coluna `format` é única e anterior ao multi-classe; guarda o
            // formato da primeira classe para os leitores antigos. A verdade
            // por classe vive em format_config.
            format: primaryFormat(params.classFormats, params.classes),
            format_config: params.classFormats,
            status: 'draft',
            start_date: params.startDate,
            end_date: params.endDate,
            series_id: params.seriesId,
            edition_year: editionYear,
            pts_victory: scoring.ptsVictory,
            pts_defeat: scoring.ptsDefeat,
            pts_wo_victory: scoring.ptsWoVictory,
            pts_set: scoring.ptsSet,
            pts_game: scoring.ptsGame,
            pts_technical_draw: scoring.ptsTechnicalDraw,
            final_ranking_pts: scoring.finalRankingPts,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao criar campeonato: ${error?.message}`);
    return data.id;
}
