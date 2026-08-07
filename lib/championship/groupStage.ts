export interface GroupStanding {
    registrationId: string;
    groupName: string;
    /** Posição dentro do grupo, 1-based. */
    position: number;
    points: number;
    setDiff: number;
    gameDiff: number;
}

/**
 * Ordena terceiros colocados por pontos, saldo de sets e saldo de games.
 * O id entra como último critério para o resultado nunca depender da ordem
 * de entrada — uma chave sorteada duas vezes com os mesmos dados sai igual.
 */
export function bestThirds(standings: GroupStanding[], count: number): GroupStanding[] {
    if (count <= 0) return [];

    return standings
        .filter(s => s.position === 3)
        .sort((a, b) =>
            b.points - a.points ||
            b.setDiff - a.setDiff ||
            b.gameDiff - a.gameDiff ||
            a.registrationId.localeCompare(b.registrationId)
        )
        .slice(0, count);
}

/**
 * Monta a lista de classificados para o mata-mata: primeiro todos os primeiros
 * colocados, depois todos os segundos, e assim por diante até
 * `qualifiersPerGroup`; em seguida os melhores terceiros.
 *
 * Substitui a regra fixa de lib/groupKnockout.ts, que assumia exatamente dois
 * grupos ('A' e 'B') e dois classificados por grupo.
 */
export function rankQualifiers(
    standings: GroupStanding[],
    qualifiersPerGroup: number,
    bestThirdPlaces: number
): GroupStanding[] {
    const diretos: GroupStanding[] = [];

    for (let position = 1; position <= qualifiersPerGroup; position++) {
        const daPosicao = standings
            .filter(s => s.position === position)
            .sort((a, b) => a.groupName.localeCompare(b.groupName));
        diretos.push(...daPosicao);
    }

    // Terceiros só entram por repescagem; se já classificam direto, não repetem.
    if (qualifiersPerGroup >= 3) return diretos;

    return [...diretos, ...bestThirds(standings, bestThirdPlaces)];
}
