import type { ChampionshipRound, Match } from '../../types';

/**
 * Se o atleta pode marcar o horário de uma partida sua.
 *
 * A regra do clube é sequencial: ninguém marca a rodada seguinte antes de
 * fechar a anterior. Isso existe para que a tabela não avance com jogos
 * pendentes atrás — quem joga a 3ª rodada sem ter jogado a 2ª desarruma a
 * classificação de todo o grupo.
 *
 * Os dois casos de dúvida estão resolvidos a favor de **liberar**, e é
 * deliberado: dado faltando não pode virar atleta impedido de jogar.
 *
 *  - Rodada anterior não existe no cadastro → libera.
 *  - Atleta não tem partida na rodada anterior (entrou depois, ou teve folga
 *    num grupo ímpar) → libera.
 *
 * O caso que **bloqueia** é o único com informação suficiente para bloquear:
 * a partida anterior existe e ainda não terminou.
 */
export function canScheduleMatch(params: {
    match: Match;
    userId: string;
    rounds: ChampionshipRound[];
    matches: Match[];
}): boolean {
    const { match, userId, rounds, matches } = params;

    if (!userId) return false;

    // Só quem joga marca. Admin usa outro caminho.
    if (match.playerAId !== userId && match.playerBId !== userId) return false;

    const rodadaAtual = rounds.find(r => r.id === match.round_id);
    if (!rodadaAtual) return false;

    if (rodadaAtual.round_number === 1) return true;

    const rodadaAnterior = rounds.find(r => r.round_number === rodadaAtual.round_number - 1);
    if (!rodadaAnterior) return true;

    const partidaAnterior = matches.find(m =>
        m.round_id === rodadaAnterior.id &&
        (m.playerAId === userId || m.playerBId === userId)
    );
    if (!partidaAnterior) return true;

    return partidaAnterior.status === 'finished';
}
