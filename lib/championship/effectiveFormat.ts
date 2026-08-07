import type { ChampionshipFormat, FormatConfig } from './formatConfig';

/**
 * O mínimo que precisa vir do banco para resolver o formato.
 *
 * A assinatura de índice não é decorativa: `Championship` em types.ts declara
 * `[key: string]: any`, então `Omit<Championship, …>` colapsa para só a
 * assinatura de índice e perde as propriedades nomeadas. Sem o índice aqui,
 * esta interface seria um "weak type" e o TypeScript recusaria o argumento
 * com TS2559.
 */
interface ChampionshipLike {
    format?: string | null;
    format_config?: unknown;
    [key: string]: unknown;
}

const FORMATS: ChampionshipFormat[] = ['mata-mata', 'pontos-corridos', 'grupo-mata-mata'];

const isFormat = (value: unknown): value is ChampionshipFormat =>
    typeof value === 'string' && (FORMATS as string[]).includes(value);

/**
 * format_config é um mapa classe → configuração. Campeonatos anteriores ao
 * multi-classe podem ter null ou, em bases intermediárias, uma configuração
 * solta — que não é um mapa por classe e deve ser ignorada.
 */
function asClassMap(formatConfig: unknown): Record<string, FormatConfig> | null {
    if (!formatConfig || typeof formatConfig !== 'object') return null;
    const entries = Object.entries(formatConfig as Record<string, unknown>);
    if (entries.length === 0) return null;

    const valido = entries.every(([, value]) =>
        !!value && typeof value === 'object' && isFormat((value as { format?: unknown }).format));

    return valido ? (formatConfig as Record<string, FormatConfig>) : null;
}

/**
 * Formato válido para uma classe. Cada classe pode ter o seu; campeonatos do
 * modelo antigo caem na coluna única `championships.format`.
 */
export function resolveClassFormat(
    championship: ChampionshipLike | null | undefined,
    classe: string | null | undefined
): ChampionshipFormat {
    const mapa = asClassMap(championship?.format_config);

    if (mapa && classe && classe !== 'Todas') {
        const config = mapa[classe];
        if (config && isFormat(config.format)) return config.format;
    }

    return isFormat(championship?.format) ? championship.format : 'mata-mata';
}

/** Classes que têm formato próprio configurado. Vazio no modelo antigo. */
export function classesWithFormat(championship: ChampionshipLike | null | undefined): string[] {
    const mapa = asClassMap(championship?.format_config);
    return mapa ? Object.keys(mapa) : [];
}

/** Verdadeiro quando as classes não compartilham o mesmo formato. */
export function hasMixedFormats(championship: ChampionshipLike | null | undefined): boolean {
    const classes = classesWithFormat(championship);
    if (classes.length < 2) return false;
    return new Set(classes.map(c => resolveClassFormat(championship, c))).size > 1;
}
