export interface RoundRobinAthlete {
    registrationId: string;
    isSeed: boolean;
}

export interface GroupMember {
    registrationId: string;
    isSeed: boolean;
    /** Posição do sorteio dentro do grupo, 1-based. */
    drawOrder: number;
}

export interface DrawnGroup {
    name: string;
    members: GroupMember[];
}

/** A, B, ..., Z, AA, AB, ... */
export function groupNameFor(index: number): string {
    let name = '';
    let n = index;
    do {
        name = String.fromCharCode(65 + (n % 26)) + name;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return name;
}

/** Todas as combinações de dois, sem repetição. */
export function buildRoundRobinPairings(
    registrationIds: string[],
    options: { returno?: boolean } = {}
): [string, string][] {
    const pares: [string, string][] = [];
    for (let i = 0; i < registrationIds.length; i++) {
        for (let j = i + 1; j < registrationIds.length; j++) {
            pares.push(options.returno
                ? [registrationIds[j], registrationIds[i]]
                : [registrationIds[i], registrationIds[j]]);
        }
    }
    return pares;
}

/**
 * Distribui os confrontos de um grupo entre rodadas — quem joga contra quem,
 * **e em qual rodada**.
 *
 * `buildRoundRobinPairings` responde só a primeira metade da pergunta. Esta
 * responde as duas, que é o que a geração de confrontos precisa.
 *
 * Usa o método do círculo: o primeiro atleta fica parado e os outros giram uma
 * casa por rodada, de modo que cada dupla se encontra exatamente uma vez. A
 * indexação foi escolhida para reproduzir a escalação que o clube já usava:
 *
 *   Rodada 1: 1º vs 2º · 3º vs 4º
 *   Rodada 2: 1º vs 3º · 2º vs 4º
 *   Rodada 3: 1º vs 4º · 2º vs 3º
 *
 * @param ids Inscrições **já em ordem de sorteio** — o 1º é o cabeça.
 * @returns Uma lista por rodada; cada par sai em ordem de sorteio (menor primeiro).
 */
export function buildRoundRobinSchedule(ids: string[]): [string, string][][] {
    const n = ids.length;
    if (n < 2) return [];

    // Exceção do clube: com 3 atletas são duas rodadas, e o 3º joga duas vezes
    // na segunda. Não é o método do círculo — é uma compressão deliberada, para
    // não estender o grupo por três rodadas com um atleta de folga em cada.
    if (n === 3) {
        return [
            [[ids[0], ids[1]]],
            [[ids[0], ids[2]], [ids[1], ids[2]]],
        ];
    }

    // Grupo ímpar ganha uma folga: quem cair contra ela descansa na rodada.
    const jogadores: (string | null)[] = n % 2 === 0 ? [...ids] : [...ids, null];
    const total = jogadores.length;
    const giradores = total - 1;
    const posicao = new Map(ids.map((id, i) => [id, i]));

    /** Cada par sai na ordem do sorteio, como o clube escreve a tabela. */
    const emOrdem = (a: string, b: string): [string, string] =>
        posicao.get(a)! <= posicao.get(b)! ? [a, b] : [b, a];

    const rodadas: [string, string][][] = [];

    for (let r = 0; r < giradores; r++) {
        const rodada: [string, string][] = [];

        const parado = jogadores[0];
        const adversario = jogadores[1 + r];
        if (parado && adversario) rodada.push(emOrdem(parado, adversario));

        for (let i = 1; i < total / 2; i++) {
            const a = jogadores[1 + ((r + i) % giradores)];
            const b = jogadores[1 + ((r - i + giradores) % giradores)];
            if (a && b) rodada.push(emOrdem(a, b));
        }

        rodadas.push(rodada);
    }

    return rodadas;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Distribui os atletas em `groupCount` grupos, espalhando os cabeças de chave
 * um por grupo antes de sortear o resto. O RNG é injetável para o sorteio ser
 * determinístico nos testes.
 */
export function distributeIntoGroups(
    athletes: RoundRobinAthlete[],
    groupCount: number,
    rng: () => number = Math.random
): DrawnGroup[] {
    if (groupCount < 1) throw new Error('É preciso ao menos 1 grupo.');
    if (athletes.length < groupCount) {
        throw new Error(`Há ${athletes.length} atletas para ${groupCount} grupos; não dá para formar todos os grupos.`);
    }

    const grupos: GroupMember[][] = Array.from({ length: groupCount }, () => []);

    const cabecas = shuffle(athletes.filter(a => a.isSeed), rng);
    const resto = shuffle(athletes.filter(a => !a.isSeed), rng);

    // Um cabeça por grupo; se sobrarem, voltam para o bolo comum.
    cabecas.slice(0, groupCount).forEach((athlete, i) => {
        grupos[i].push({ registrationId: athlete.registrationId, isSeed: true, drawOrder: 1 });
    });

    const restantes = [...cabecas.slice(groupCount), ...resto];
    restantes.forEach((athlete, i) => {
        const destino = grupos[i % groupCount];
        destino.push({
            registrationId: athlete.registrationId,
            isSeed: athlete.isSeed,
            drawOrder: destino.length + 1,
        });
    });

    return grupos.map((members, i) => ({ name: groupNameFor(i), members }));
}
