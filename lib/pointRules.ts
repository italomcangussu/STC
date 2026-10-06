/**
 * Regras puras da tela de pontuação (Painel Admin › Regras). Ficam fora do
 * componente para serem testadas sem renderizar nada.
 */

/** Inteiro com sinal opcional. `null` = o que está no campo não é um número que dê para gravar. */
export const parsePoints = (text: string): number | null => (/^-?\d+$/.test(text.trim()) ? parseInt(text.trim(), 10) : null);

export type PointRuleCategory = 'victory' | 'match' | 'ranking' | 'bonus';

/** `wo` só vale como palavra inteira: antes, qualquer chave com "two", "workshop"… caía em "Resultados de partida". */
const isWalkover = (key: string) => /(^|[^a-z])wo([^a-z]|$)/.test(key);

export const categoryOf = (ruleKey: string): PointRuleCategory => {
    const key = ruleKey.toLowerCase();
    if (key.includes('victory') || key.includes('defeat') || isWalkover(key)) return 'victory';
    if (key.includes('set') || key.includes('game')) return 'match';
    if (key.includes('ranking') || key.includes('final')) return 'ranking';
    return 'bonus';
};
