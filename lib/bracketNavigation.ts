import type { BracketMatchWithPhase } from './resenhaOpenService';

/**
 * Navegação dentro do quadro de confrontos: em que fase a pessoa está olhando
 * e onde estão os jogos dela. Puro, sem DOM, para o quadro só ligar os fios.
 */

/**
 * Fração da largura visível onde a fase "mora" quando está em foco.
 *
 * É a mesma que o quadro usa para centralizar uma fase: assim, depois de tocar
 * num chip, a fase calculada pela rolagem é exatamente a que foi pedida.
 */
export const PHASE_FOCUS_FRACTION = 1 / 3;

interface PhasePosition {
    phase: string;
    x: number;
}

/** Onde o quadro está: rolagem horizontal, zoom e largura visível. */
export interface BoardView {
    scrollLeft: number;
    zoom: number;
    viewportWidth: number;
}

/** Fase em foco para uma posição de rolagem horizontal. */
export function phaseAtScroll(
    phases: PhasePosition[],
    { scrollLeft, zoom, viewportWidth }: BoardView,
): string | null {
    if (phases.length === 0) return null;
    const focusX = scrollLeft + viewportWidth * PHASE_FOCUS_FRACTION;

    let current = phases[0].phase;
    for (const { phase, x } of phases) {
        // Um pixel de folga: o arredondamento do scrollTo deixava a fase
        // recém-centralizada meio pixel antes do foco.
        if (x * zoom <= focusX + 1) current = phase;
    }
    return current;
}

function playsIn(match: BracketMatchWithPhase, userId: string): boolean {
    return match.registration_a_user_id === userId || match.registration_b_user_id === userId;
}

/** De que lado da partida a pessoa joga, se joga. */
export function sideOfUser(match: BracketMatchWithPhase, userId: string | undefined): 'a' | 'b' | null {
    if (!userId) return null;
    if (match.registration_a_user_id === userId) return 'a';
    if (match.registration_b_user_id === userId) return 'b';
    return null;
}

/**
 * Os jogos que a pessoa ainda tem pela frente, na ordem em que vai jogá-los.
 *
 * A ordem segue as classes como o quadro mostra e, dentro da classe, o número
 * do jogo — que é atribuído fase a fase. Quem já não tem jogo pendente (foi
 * eliminado ou é campeão) recebe o último que jogou, que é onde a história
 * dela no quadro termina.
 */
export function findMyMatches(
    bracket: BracketMatchWithPhase[],
    userId: string | undefined,
    classOrder: string[],
): BracketMatchWithPhase[] {
    if (!userId) return [];
    const mine = bracket.filter(match => playsIn(match, userId));
    if (mine.length === 0) return [];

    const classRank = (match: BracketMatchWithPhase) => {
        const rank = classOrder.indexOf(match.bracket_class ?? '');
        return rank === -1 ? classOrder.length : rank;
    };
    const byOrder = (a: BracketMatchWithPhase, b: BracketMatchWithPhase) =>
        classRank(a) - classRank(b) || a.match_number - b.match_number;

    const pending = mine.filter(match => match.status !== 'finished').sort(byOrder);
    if (pending.length > 0) return pending;

    const finished = [...mine].sort(byOrder);
    return [finished[finished.length - 1]];
}
