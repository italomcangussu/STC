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
