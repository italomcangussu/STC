# Resenha Open Bracket UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Resenha Open stacked bracket list with a premium navy tournament-board UI with class switch, compact score columns, rounded connector lines, pan/zoom, and silent realtime updates.

**Architecture:** Keep `ResenhaOpenBracketView` as the data-loading shell and move visual/layout logic into a focused `ResenhaOpenTournamentBoard` component plus pure helpers in `lib/resenhaOpenBracketLayout.ts`. The board renders one selected class at a time, calculates phase columns and match positions from bracket data, draws SVG connectors from the vertical center of each match card, and preserves local pan/zoom state across realtime data refreshes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS utilities, Supabase Realtime, Vitest, Testing Library, Playwright CLI for rendered verification.

---

### Task 1: Bracket Layout And Score Helpers

**Files:**
- Create: `lib/resenhaOpenBracketLayout.ts`
- Test: `__tests__/resenhaOpenBracketLayout.test.ts`
- Modify: `lib/resenhaOpenService.ts`

- [ ] **Step 1: Write failing helper tests**

Create `__tests__/resenhaOpenBracketLayout.test.ts` with tests for score normalization, class layout, and connector center points:

```ts
import { describe, expect, it } from 'vitest';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import {
    buildResenhaBracketLayout,
    normalizeScoreSlots,
    getMatchWinnerSide,
} from '../lib/resenhaOpenBracketLayout';

const match = (overrides: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m-${overrides.match_number ?? 1}`,
    match_number: overrides.match_number ?? 1,
    registration_a_id: overrides.registration_a_id ?? 'a1',
    registration_b_id: overrides.registration_b_id ?? 'b1',
    player_a_label: overrides.player_a_label ?? 'Player A',
    player_b_label: overrides.player_b_label ?? 'Player B',
    status: overrides.status ?? 'pending',
    winner_registration_id: overrides.winner_registration_id ?? null,
    is_walkover: overrides.is_walkover ?? false,
    round_phase: overrides.round_phase ?? 'oitavas',
    bracket_class: overrides.bracket_class ?? '5ª Classe',
    player_a_source_match_number: overrides.player_a_source_match_number,
    player_b_source_match_number: overrides.player_b_source_match_number,
    score_a: overrides.score_a,
    score_b: overrides.score_b,
});

describe('resenhaOpenBracketLayout', () => {
    it('normalizes score slots to exactly three set columns', () => {
        expect(normalizeScoreSlots([6, 6], [4, 3])).toEqual([
            { a: 6, b: 4, index: 0, played: true },
            { a: 6, b: 3, index: 1, played: true },
            { a: null, b: null, index: 2, played: false },
        ]);
    });

    it('detects the winner side from winner_registration_id', () => {
        expect(getMatchWinnerSide(match({ winner_registration_id: 'a1', status: 'finished' }))).toBe('a');
        expect(getMatchWinnerSide(match({ winner_registration_id: 'b1', status: 'finished' }))).toBe('b');
        expect(getMatchWinnerSide(match({ winner_registration_id: null, status: 'pending' }))).toBe(null);
    });

    it('builds 5ª Classe columns and connectors from match centers', () => {
        const layout = buildResenhaBracketLayout([
            match({ match_number: 1, round_phase: 'oitavas' }),
            match({ match_number: 2, round_phase: 'oitavas', registration_a_id: 'a2', registration_b_id: 'b2' }),
            match({
                match_number: 9,
                round_phase: 'quartas',
                registration_a_id: null,
                registration_b_id: null,
                player_a_source_match_number: 1,
                player_b_source_match_number: 2,
            }),
        ], '5ª Classe');

        expect(layout.phases.map(phase => phase.phase)).toEqual(['oitavas', 'quartas']);
        expect(layout.matchesByNumber.get(1)?.centerY).toBe(layout.matchesByNumber.get(1)!.y + layout.cardHeight / 2);
        expect(layout.connectors).toContainEqual(expect.objectContaining({
            fromMatchNumber: 1,
            toMatchNumber: 9,
            toSlot: 'a',
            startX: layout.matchesByNumber.get(1)!.x + layout.cardWidth,
            startY: layout.matchesByNumber.get(1)!.centerY,
            endY: layout.matchesByNumber.get(9)!.centerY,
        }));
    });

    it('builds 4ª Classe from preliminar through final', () => {
        const layout = buildResenhaBracketLayout([
            match({ bracket_class: '4ª Classe', match_number: 1, round_phase: 'preliminar' }),
            match({ bracket_class: '4ª Classe', match_number: 5, round_phase: 'oitavas', player_b_source_match_number: 1 }),
            match({ bracket_class: '4ª Classe', match_number: 13, round_phase: 'quartas', player_a_source_match_number: 5 }),
            match({ bracket_class: '4ª Classe', match_number: 17, round_phase: 'semifinal', player_a_source_match_number: 13 }),
            match({ bracket_class: '4ª Classe', match_number: 19, round_phase: 'final', player_a_source_match_number: 17 }),
        ], '4ª Classe');

        expect(layout.phases.map(phase => phase.phase)).toEqual(['preliminar', 'oitavas', 'quartas', 'semifinal', 'final']);
    });
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run: `npx vitest run __tests__/resenhaOpenBracketLayout.test.ts`

Expected: FAIL because `lib/resenhaOpenBracketLayout.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `lib/resenhaOpenBracketLayout.ts` exporting:

```ts
import type { ResenhaClass, BracketMatchWithPhase } from './resenhaOpenService';

export type ScoreSlot = { index: number; a: number | null; b: number | null; played: boolean };
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

const PHASES_BY_CLASS: Record<ResenhaClass, string[]> = {
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
            const layoutMatch = { match, x, y, centerY: y + CARD_HEIGHT / 2, phase };
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

    const phaseHeights = phases.map(phase => phase.matches.length * CARD_HEIGHT + Math.max(0, phase.matches.length - 1) * ROW_GAP);
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
```

- [ ] **Step 4: Add score fields to service mapping**

Modify `BracketMatchWithPhase` in `lib/resenhaOpenService.ts` to include optional `score_a?: number[]; score_b?: number[];`.

In `fetchBracket()`, return `score_a: m.score_a ?? []` and `score_b: m.score_b ?? []`.

In `getOfficialResenhaOpenBracket()`, include `score_a: []` and `score_b: []` for each official fallback match.

- [ ] **Step 5: Run helper tests and verify GREEN**

Run: `npx vitest run __tests__/resenhaOpenBracketLayout.test.ts __tests__/resenhaOpenService.test.ts`

Expected: PASS.

### Task 2: Tournament Board Component

**Files:**
- Create: `components/ResenhaOpenTournamentBoard.tsx`
- Modify: `components/ResenhaOpenBracketView.tsx`
- Test: `__tests__/ResenhaOpenTournamentBoard.test.tsx`

- [ ] **Step 1: Write failing rendered component tests**

Create `__tests__/ResenhaOpenTournamentBoard.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import { ResenhaOpenTournamentBoard } from '../components/ResenhaOpenTournamentBoard';

const baseMatch = (overrides: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m-${overrides.bracket_class ?? '5ª Classe'}-${overrides.match_number ?? 1}`,
    match_number: overrides.match_number ?? 1,
    registration_a_id: overrides.registration_a_id ?? 'a1',
    registration_b_id: overrides.registration_b_id ?? 'b1',
    player_a_label: overrides.player_a_label ?? 'Davi Arcelino',
    player_b_label: overrides.player_b_label ?? 'Williams Santos',
    status: overrides.status ?? 'pending',
    winner_registration_id: overrides.winner_registration_id ?? null,
    is_walkover: overrides.is_walkover ?? false,
    round_phase: overrides.round_phase ?? 'oitavas',
    bracket_class: overrides.bracket_class ?? '5ª Classe',
    player_a_source_match_number: overrides.player_a_source_match_number,
    player_b_source_match_number: overrides.player_b_source_match_number,
    score_a: overrides.score_a ?? [],
    score_b: overrides.score_b ?? [],
});

const bracket: BracketMatchWithPhase[] = [
    baseMatch({ bracket_class: '5ª Classe', match_number: 1, score_a: [6, 6], score_b: [4, 3], status: 'finished', winner_registration_id: 'a1' }),
    baseMatch({ bracket_class: '5ª Classe', match_number: 2, registration_a_id: 'a2', registration_b_id: 'b2', match_number: 2, player_a_label: 'Lucas Rodrigues', player_b_label: 'Macel Ponte' }),
    baseMatch({ bracket_class: '5ª Classe', match_number: 9, registration_a_id: null, registration_b_id: null, player_a_label: 'Davi Arcelino', player_b_label: 'Vencedor Jogo 2', round_phase: 'quartas', player_a_source_match_number: 1, player_b_source_match_number: 2 }),
    baseMatch({ bracket_class: '4ª Classe', match_number: 1, round_phase: 'preliminar', player_a_label: 'Hernades Soares', player_b_label: 'Claudio Sergio' }),
];

describe('ResenhaOpenTournamentBoard', () => {
    it('renders the internal class switch and defaults to 4ª Classe when available', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);
        expect(screen.getByRole('button', { name: '4ª Classe' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Hernades Soares')).toBeInTheDocument();
    });

    it('switches to 5ª Classe and renders compact three-set score columns', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);
        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        expect(screen.getByText('Davi Arcelino')).toBeInTheDocument();
        expect(screen.getByLabelText('Placar set 1: Davi Arcelino 6, Williams Santos 4')).toBeInTheDocument();
        expect(screen.getByLabelText('Placar set 3: não disputado')).toBeInTheDocument();
    });

    it('selects a match and exposes zoom controls', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);
        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        fireEvent.click(screen.getByRole('button', { name: /Jogo 1/ }));
        expect(screen.getByRole('button', { name: /Jogo 1/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Aumentar zoom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reduzir zoom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Resetar zoom' })).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npx vitest run __tests__/ResenhaOpenTournamentBoard.test.tsx`

Expected: FAIL because `components/ResenhaOpenTournamentBoard.tsx` does not exist.

- [ ] **Step 3: Implement `ResenhaOpenTournamentBoard`**

Create `components/ResenhaOpenTournamentBoard.tsx` with:

- `ResenhaOpenTournamentBoard({ bracket, championshipName })`.
- Internal state: `selectedClass`, `zoom`, `selectedMatchId`.
- Class switch buttons with `aria-pressed`.
- Navy board container with safe-area padding classes/styles.
- Zoom controls with `Aumentar zoom`, `Reduzir zoom`, `Resetar zoom`.
- Layout from `buildResenhaBracketLayout()`.
- SVG connectors with rounded caps/joins and `pointer-events-none`.
- Match cards as buttons with `aria-pressed`, match number, two player rows, and compact 3-set score grid.
- Selection centers the card using `scrollIntoView({ block: 'center', inline: 'center' })` when available.

- [ ] **Step 4: Replace old stacked rendering**

Modify `components/ResenhaOpenBracketView.tsx`:

- Keep loading/data fetching.
- Keep empty state.
- Replace the class/phase map with `<ResenhaOpenTournamentBoard bracket={bracket} championshipName={champName || 'Resenha Open'} />`.
- Remove obsolete `BracketMatchRow` and `PlayerLine` from the file.
- Remove unused imports such as `Star` and `formatDateBr`.

- [ ] **Step 5: Run component tests and verify GREEN**

Run: `npx vitest run __tests__/ResenhaOpenTournamentBoard.test.tsx __tests__/resenhaOpenBracketLayout.test.ts`

Expected: PASS.

### Task 3: Realtime Refresh And Verification

**Files:**
- Modify: `components/ResenhaOpenBracketView.tsx`
- Test: existing focused tests

- [ ] **Step 1: Add realtime refresh**

In `ResenhaOpenBracketView.tsx`:

- Extract a `loadBracket` function inside `useEffect`.
- Call `loadBracket()` initially.
- Subscribe to `supabase.channel('resenha-open-bracket-${championshipId}')`.
- Listen to `postgres_changes` for `public.matches` with `filter: championship_id=eq.${championshipId}`.
- On change, call `loadBracket()`.
- Cleanup with `supabase.removeChannel(channel)`.
- Keep updates silent with no toast.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run __tests__/resenhaOpenService.test.ts __tests__/resenhaOpenBracketLayout.test.ts __tests__/ResenhaOpenTournamentBoard.test.tsx __tests__/resenhaOpenDraw.test.ts __tests__/resenhaOpenAdvance.test.ts`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run browser QA**

Start dev server:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Use Playwright CLI:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://127.0.0.1:5173
```

Flow:

- Login with phone `88999990507`.
- Close notification modal with `Agora não` if it appears.
- Click `Campeonatos`.
- Confirm `Resenha Open 2026` and the navy bracket board render.
- Switch between `4ª Classe` and `5ª Classe`.
- Click a match and confirm it highlights.
- Use zoom controls and confirm percent changes.
- Capture desktop screenshot to `/tmp/reserva-sct-playwright/resenha-open-bracket-board-desktop.png`.
- Resize to mobile viewport and capture `/tmp/reserva-sct-playwright/resenha-open-bracket-board-mobile.png`.
- Run `"$PWCLI" console error` and expect 0 relevant errors.

- [ ] **Step 5: Final status**

Run `git status --short` and report changed files, test results, build result, and Playwright screenshot paths.
