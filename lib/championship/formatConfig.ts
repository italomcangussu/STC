export type ChampionshipFormat = 'mata-mata' | 'pontos-corridos' | 'grupo-mata-mata';

/**
 * Tamanho do quadro principal, no vocabulário de `final_phase` do banco.
 * Não confundir com `championship_rounds.phase`, que usa nomes em português
 * ('oitavas', 'quartas', 'final') reconhecidos por resolve_championship_final_phases.
 * O mapeamento entre os dois vive em lib/championship/rounds.ts (Fase 2).
 */
export type BracketSize = 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal';

export const BRACKET_SLOTS: Record<BracketSize, number> = {
    round_of_32: 32,
    round_of_16: 16,
    quarterfinal: 8,
    semifinal: 4,
};

export interface GroupKnockoutConfig {
    format: 'grupo-mata-mata';
    homeAndAway: boolean;
    groupCount: number;
    membersPerGroup: number;
    qualifiersPerGroup: number;
    bestThirdPlaces: number;
    seeded: boolean;
}

export interface RoundRobinConfig {
    format: 'pontos-corridos';
    homeAndAway: boolean;
    finalPhase: { startPhase: BracketSize } | null;
}

export interface KnockoutConfig {
    format: 'mata-mata';
    seeded: boolean;
    /** entrySlots são posições (1-based) do quadro principal ocupadas pelos vencedores. */
    qualifying: { matchCount: number; entrySlots: number[] } | null;
    mainDrawStartPhase: BracketSize;
}

export type FormatConfig = GroupKnockoutConfig | RoundRobinConfig | KnockoutConfig;

/**
 * Configuração por classe. Cada classe do campeonato tem formato, número de
 * inscritos e fases próprios — a 4ª pode ser mata-mata de 16 enquanto a 5ª é
 * grupos com 12. É o conteúdo de championships.format_config.
 */
export type ClassFormats = Record<string, FormatConfig>;

/**
 * Formato guardado na coluna `championships.format`, que é única e anterior ao
 * suporte multi-classe. Vale o da primeira classe; a verdade por classe está em
 * format_config.
 */
export function primaryFormat(classFormats: ClassFormats, classes: string[]): ChampionshipFormat {
    for (const classe of classes) {
        const config = classFormats[classe];
        if (config) return config.format;
    }
    const first = Object.values(classFormats)[0];
    return first ? first.format : 'mata-mata';
}

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0;

const result = (errors: string[]): ValidationResult => ({ ok: errors.length === 0, errors });

export function defaultConfigFor(format: ChampionshipFormat): FormatConfig {
    if (format === 'grupo-mata-mata') {
        return {
            format: 'grupo-mata-mata',
            homeAndAway: false,
            groupCount: 4,
            membersPerGroup: 4,
            qualifiersPerGroup: 2,
            bestThirdPlaces: 0,
            seeded: true,
        };
    }
    if (format === 'pontos-corridos') {
        return { format: 'pontos-corridos', homeAndAway: false, finalPhase: null };
    }
    return { format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16' };
}

/**
 * Consistência interna da configuração, sem olhar inscritos.
 * Usada no passo de criação, quando ainda não há inscrições.
 */
export function validateFormatShape(config: FormatConfig): ValidationResult {
    const errors: string[] = [];

    if (config.format === 'grupo-mata-mata') {
        if (config.groupCount < 1) {
            errors.push('É preciso ao menos 1 grupo.');
        }
        if (config.membersPerGroup < 2) {
            errors.push('Cada grupo precisa de ao menos 2 participantes.');
        }
        if (config.qualifiersPerGroup < 1) {
            errors.push('É preciso ao menos 1 classificado por grupo.');
        }
        if (config.qualifiersPerGroup >= config.membersPerGroup) {
            errors.push(
                `Classificados por grupo (${config.qualifiersPerGroup}) precisa ser menor que os membros do grupo (${config.membersPerGroup}).`
            );
        }
        if (config.bestThirdPlaces < 0 || config.bestThirdPlaces > config.groupCount) {
            errors.push(
                `Vagas para melhores terceiros (${config.bestThirdPlaces}) não pode passar do número de grupos (${config.groupCount}).`
            );
        }
        if (config.bestThirdPlaces > 0 && config.membersPerGroup < 3) {
            errors.push('Não há terceiro colocado em grupos com menos de 3 participantes.');
        }
        const knockoutSlots = config.qualifiersPerGroup * config.groupCount + config.bestThirdPlaces;
        if (!isPowerOfTwo(knockoutSlots)) {
            errors.push(
                `O mata-mata receberia ${knockoutSlots} classificados; precisa ser potência de 2 (2, 4, 8, 16, 32).`
            );
        }
        return result(errors);
    }

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        if (config.qualifying) {
            const { matchCount, entrySlots } = config.qualifying;
            if (matchCount < 1) {
                errors.push('As qualificatórias precisam de ao menos 1 jogo.');
            }
            if (matchCount > slots) {
                errors.push(`As qualificatórias têm ${matchCount} jogos, mas o quadro principal só tem ${slots} vagas.`);
            }
            if (entrySlots.length !== matchCount) {
                errors.push(
                    `Defina uma vaga para cada jogo das qualificatórias: ${matchCount} jogos, ${entrySlots.length} vagas informadas.`
                );
            }
            const foraDoQuadro = entrySlots.filter(slot => slot < 1 || slot > slots);
            if (foraDoQuadro.length > 0) {
                errors.push(`Vaga fora do quadro principal: ${foraDoQuadro.join(', ')}. O quadro vai de 1 a ${slots}.`);
            }
            if (new Set(entrySlots).size !== entrySlots.length) {
                errors.push('Há vaga repetida nas qualificatórias; cada vencedor precisa de uma vaga própria.');
            }
        }
        return result(errors);
    }

    if (config.finalPhase && !(config.finalPhase.startPhase in BRACKET_SLOTS)) {
        errors.push('Fase inicial da fase final inválida.');
    }
    return result(errors);
}

/**
 * Confronta a configuração com o número real de inscritos da classe.
 * Usada na Fase 2, ao fechar as inscrições.
 */
export function validateAgainstParticipants(config: FormatConfig, participantCount: number): ValidationResult {
    const errors: string[] = [];

    if (config.format === 'grupo-mata-mata') {
        const vagas = config.groupCount * config.membersPerGroup;
        if (vagas !== participantCount) {
            errors.push(
                `${config.groupCount} grupos de ${config.membersPerGroup} exigem ${vagas} participantes, mas há ${participantCount} inscritos.`
            );
        }
        return result(errors);
    }

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        const matchCount = config.qualifying?.matchCount ?? 0;
        const esperado = slots - matchCount + matchCount * 2;
        if (esperado !== participantCount) {
            errors.push(
                `Este formato comporta ${esperado} participantes (${slots - matchCount} diretos + ${matchCount * 2} nas qualificatórias), mas há ${participantCount} inscritos.`
            );
        }
        return result(errors);
    }

    if (participantCount < 2) {
        errors.push(`Pontos corridos exige ao menos 2 participantes; há ${participantCount}.`);
    }
    if (config.finalPhase) {
        const slots = BRACKET_SLOTS[config.finalPhase.startPhase];
        if (slots > participantCount) {
            errors.push(`A fase final começaria com ${slots} classificados, mas há apenas ${participantCount} inscritos.`);
        }
    }
    return result(errors);
}
