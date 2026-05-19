import type { BracketMatchWithPhase, ResenhaClass } from './resenhaOpenService';

export type ScoreSlot = {
    index: number;
    a: number | null;
    b: number | null;
    played: boolean;
};

export type WinnerSide = 'a' | 'b' | null;
export type ConnectorSlot = 'a' | 'b';

export interface LayoutMatch {
    match: BracketMatchWithPhase;
    x: number;
    y: number;
    centerY: number;
    phase: string;
}

export interface LayoutConnector {
    id: string;
    fromMatchNumber: number;
    toMatchNumber: number;
    toSlot: ConnectorSlot;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    active: boolean;
}

export interface BracketPhaseLayout {
    phase: string;
    label: string;
    x: number;
    matches: LayoutMatch[];
}

export interface BracketLayout {
    className: ResenhaClass;
    width: number;
    height: number;
    cardWidth: number;
    cardHeight: number;
    phases: BracketPhaseLayout[];
    matchesByNumber: Map<number, LayoutMatch>;
    connectors: LayoutConnector[];
}

export const PHASE_LABELS: Record<string, string> = {
    preliminar: 'Preliminar',
    oitavas: 'Oitavas',
    quartas: 'Quartas',
    semifinal: 'Semifinal',
    final: 'Final',
};

export const PHASES_BY_CLASS: Record<ResenhaClass, string[]> = {
    '4ª Classe': ['preliminar', 'oitavas', 'quartas', 'semifinal', 'final'],
    '5ª Classe': ['oitavas', 'quartas', 'semifinal', 'final'],
};

const CARD_WIDTH = 280;
const CARD_HEIGHT = 84;
const COLUMN_GAP = 180;
const ROW_GAP = 30;
const BOARD_PADDING_X = 32;
const BOARD_PADDING_Y = 64;

export function normalizeScoreSlots(scoreA: number[] = [], scoreB: number[] = []): ScoreSlot[] {
    return Array.from({ length: 3 }, (_, index) => {
        const a = typeof scoreA[index] === 'number' ? scoreA[index] : null;
        const b = typeof scoreB[index] === 'number' ? scoreB[index] : null;
        return { index, a, b, played: a !== null || b !== null };
    });
}

export function getMatchWinnerSide(match: BracketMatchWithPhase): WinnerSide {
    if (!match.winner_registration_id) return null;
    if (match.winner_registration_id === match.registration_a_id) return 'a';
    if (match.winner_registration_id === match.registration_b_id) return 'b';
    return null;
}

export function getClassMatches(
    bracket: BracketMatchWithPhase[],
    className: ResenhaClass,
): BracketMatchWithPhase[] {
    return bracket
        .filter(match => match.bracket_class === className)
        .sort((a, b) => a.match_number - b.match_number);
}

export function buildResenhaBracketLayout(
    matches: BracketMatchWithPhase[],
    className: ResenhaClass,
): BracketLayout {
    const phaseOrder = PHASES_BY_CLASS[className];
    const phases: BracketPhaseLayout[] = [];
    const matchesByNumber = new Map<number, LayoutMatch>();

    phaseOrder.forEach((phase, phaseIndex) => {
        const phaseMatches = matches
            .filter(match => match.round_phase === phase)
            .sort((a, b) => a.match_number - b.match_number);

        const x = BOARD_PADDING_X + phaseIndex * (CARD_WIDTH + COLUMN_GAP);
        const phaseLayout: BracketPhaseLayout = {
            phase,
            label: PHASE_LABELS[phase] ?? phase,
            x,
            matches: [],
        };

        phaseMatches.forEach((match, rowIndex) => {
            const y = BOARD_PADDING_Y + rowIndex * (CARD_HEIGHT + ROW_GAP);
            const layoutMatch = {
                match,
                x,
                y,
                centerY: y + CARD_HEIGHT / 2,
                phase,
            };
            phaseLayout.matches.push(layoutMatch);
            matchesByNumber.set(match.match_number, layoutMatch);
        });

        phases.push(phaseLayout);
    });

    const connectors: LayoutConnector[] = [];
    for (const destination of matchesByNumber.values()) {
        const sources: Array<{ slot: ConnectorSlot; matchNumber?: number }> = [
            { slot: 'a', matchNumber: destination.match.player_a_source_match_number },
            { slot: 'b', matchNumber: destination.match.player_b_source_match_number },
        ];

        for (const source of sources) {
            if (source.matchNumber == null) continue;
            const origin = matchesByNumber.get(source.matchNumber);
            if (!origin) continue;
            connectors.push({
                id: `${origin.match.match_number}-${destination.match.match_number}-${source.slot}`,
                fromMatchNumber: origin.match.match_number,
                toMatchNumber: destination.match.match_number,
                toSlot: source.slot,
                startX: origin.x + CARD_WIDTH,
                startY: origin.centerY,
                endX: destination.x,
                endY: destination.centerY,
                active: Boolean(origin.match.winner_registration_id),
            });
        }
    }

    const phaseHeights = phases.map(
        phase => phase.matches.length * CARD_HEIGHT + Math.max(0, phase.matches.length - 1) * ROW_GAP,
    );
    const width = BOARD_PADDING_X * 2 + phaseOrder.length * CARD_WIDTH + Math.max(0, phaseOrder.length - 1) * COLUMN_GAP;
    const height = BOARD_PADDING_Y * 2 + Math.max(CARD_HEIGHT, ...phaseHeights);

    return {
        className,
        width,
        height,
        cardWidth: CARD_WIDTH,
        cardHeight: CARD_HEIGHT,
        phases,
        matchesByNumber,
        connectors,
    };
}
