import { supabase } from '../supabase';

/**
 * Apaga todos os confrontos de um campeonato.
 *
 * São dois caminhos porque são dois modelos de dados convivendo: os campeonatos
 * novos penduram cada partida numa rodada (`round_id`), e os antigos gravam
 * apenas `championship_id`. Escolher errado falha em silêncio, das duas formas —
 * apagar por rodada quando não há rodada nenhuma não alcança nada, e apagar pelo
 * campeonato inteiro quando há rodadas alcança partidas que o chamador não
 * listou. Por isso a escolha mora aqui, com teste, e não dentro da tela.
 *
 * @param roundIds Rodadas conhecidas do campeonato. Vazio = modelo antigo.
 */
export async function deleteChampionshipMatches(
    championshipId: string,
    roundIds: string[]
): Promise<void> {
    const matches = supabase.from('matches');

    const { error } = roundIds.length > 0
        ? await matches.delete().in('round_id', roundIds)
        : await matches.delete().eq('championship_id', championshipId);

    if (error) throw error;
}
