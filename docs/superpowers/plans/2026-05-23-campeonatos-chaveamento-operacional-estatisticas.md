# Campeonatos Chaveamento Operacional Estatisticas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the championship bracket into the operational entry point and add current-championship statistics with an odds simulator.

**Architecture:** Keep existing `Championships.tsx` state and result/schedule handlers as the source of truth. Add pure helpers for phase targeting and statistics/odds, then wire focused React components into the existing page.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tailwind classes, Supabase client already present in the app.

---

## File Structure

- Create `lib/championshipStats.ts`: pure current-championship stat aggregation, set/game accounting, and odds calculation.
- Create `__tests__/championshipStats.test.ts`: unit coverage for stats, W.O., low-data odds, and favorite odds.
- Modify `lib/resenhaOpenBracketLayout.ts`: export `getCurrentPhaseForClass()` for current-phase selection.
- Modify `__tests__/resenhaOpenBracketLayout.test.ts`: cover current-phase selection.
- Create `components/ChampionshipMatchActionModal.tsx`: fixed overlay for a selected bracket match with action buttons.
- Create `components/ChampionshipStatistics.tsx`: statistics tab with class filter, athlete table/cards, and odds simulator.
- Modify `components/ResenhaOpenTournamentBoard.tsx`: open selected match through callback and auto-center current phase.
- Modify `components/ResenhaOpenBracketView.tsx`: pass selected match callback up and adapt bracket match data to existing `Match` shape.
- Modify `components/Championships.tsx`: remove Partidas/Jogos tabs from mata-mata flow, add Estatisticas tab, wire modal actions into existing `ResultModal` and `MatchScheduleModal`.

---

### Task 1: Current Phase Helper

**Files:**
- Modify: `lib/resenhaOpenBracketLayout.ts`
- Test: `__tests__/resenhaOpenBracketLayout.test.ts`

- [ ] **Step 1: Add failing tests for current phase**

Append tests that call:

```ts
import { getCurrentPhaseForClass } from '../lib/resenhaOpenBracketLayout';

it('selects the earliest pending playable phase', () => {
  const matches = [
    { id: 'j13', match_number: 13, round_phase: 'quartas', bracket_class: '4ª Classe', registration_a_id: 'a', registration_b_id: 'b', status: 'pending' },
    { id: 'j17', match_number: 17, round_phase: 'semifinal', bracket_class: '4ª Classe', registration_a_id: null, registration_b_id: null, status: 'pending' },
  ] as any[];
  expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('quartas');
});

it('selects the final when all class matches are finished', () => {
  const matches = [
    { id: 'j13', match_number: 13, round_phase: 'quartas', bracket_class: '4ª Classe', registration_a_id: 'a', registration_b_id: 'b', status: 'finished' },
    { id: 'j19', match_number: 19, round_phase: 'final', bracket_class: '4ª Classe', registration_a_id: 'c', registration_b_id: 'd', status: 'finished' },
  ] as any[];
  expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('final');
});
```

- [ ] **Step 2: Run phase helper tests**

Run: `npx vitest run __tests__/resenhaOpenBracketLayout.test.ts`

Expected: fail because `getCurrentPhaseForClass` does not exist.

- [ ] **Step 3: Implement helper**

Add to `lib/resenhaOpenBracketLayout.ts`:

```ts
export function getCurrentPhaseForClass(
    matches: BracketMatchWithPhase[],
    className: ResenhaClass,
): string {
    const phaseOrder = PHASES_BY_CLASS[className];
    const classMatches = getClassMatches(matches, className);
    if (classMatches.length === 0) return phaseOrder[0];

    const hasPlayableParticipants = (match: BracketMatchWithPhase) =>
        Boolean(match.registration_a_id || match.player_a_source_match_number) &&
        Boolean(match.registration_b_id || match.player_b_source_match_number);

    const pendingPlayable = classMatches.filter(match =>
        match.status !== 'finished' && hasPlayableParticipants(match),
    );

    for (const phase of phaseOrder) {
        if (pendingPlayable.some(match => match.round_phase === phase)) return phase;
    }

    if (classMatches.every(match => match.status === 'finished')) return phaseOrder[phaseOrder.length - 1];

    return phaseOrder[0];
}
```

- [ ] **Step 4: Re-run tests**

Run: `npx vitest run __tests__/resenhaOpenBracketLayout.test.ts`

Expected: pass.

---

### Task 2: Championship Statistics Helper

**Files:**
- Create: `lib/championshipStats.ts`
- Create: `__tests__/championshipStats.test.ts`

- [ ] **Step 1: Write tests**

Create tests for:

```ts
import { calculateChampionshipStats, calculateOddsSimulation } from '../lib/championshipStats';

const regs = [
  { id: 'ra', class: '4ª Classe', participant_type: 'socio', user: { name: 'Ana' } },
  { id: 'rb', class: '4ª Classe', participant_type: 'socio', user: { name: 'Bia' } },
  { id: 'rc', class: '4ª Classe', participant_type: 'guest', guest_name: 'Caio' },
] as any[];

it('aggregates wins, sets, games, and class stats from finished matches only', () => {
  const matches = [
    { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [2, 4], winner_registration_id: 'ra' },
    { id: 'm2', status: 'pending', registration_a_id: 'ra', registration_b_id: 'rc', scoreA: [], scoreB: [] },
  ] as any[];
  const stats = calculateChampionshipStats(matches, regs);
  expect(stats.byAthlete.ra.wins).toBe(1);
  expect(stats.byAthlete.ra.setsWon).toBe(2);
  expect(stats.byAthlete.rb.gamesWon).toBe(6);
  expect(stats.byClass['4ª Classe']).toHaveLength(3);
});

it('counts walkover without adding played games', () => {
  const matches = [
    { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [0, 0], winner_registration_id: 'ra', is_walkover: true, walkover_winner_registration_id: 'ra' },
  ] as any[];
  const stats = calculateChampionshipStats(matches, regs);
  expect(stats.byAthlete.ra.walkoversWon).toBe(1);
  expect(stats.byAthlete.rb.walkoversLost).toBe(1);
});

it('returns lower odd for the stronger athlete', () => {
  const stats = calculateChampionshipStats([
    { id: 'm1', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rb', scoreA: [6, 6], scoreB: [1, 1], winner_registration_id: 'ra' },
    { id: 'm2', status: 'finished', registration_a_id: 'ra', registration_b_id: 'rc', scoreA: [6, 6], scoreB: [2, 2], winner_registration_id: 'ra' },
  ] as any[], regs);
  const odds = calculateOddsSimulation(stats.byAthlete.ra, stats.byAthlete.rb);
  expect(odds.athleteA.probability).toBeGreaterThan(odds.athleteB.probability);
  expect(odds.athleteA.decimalOdd).toBeLessThan(odds.athleteB.decimalOdd);
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run __tests__/championshipStats.test.ts`

Expected: fail because the helper does not exist.

- [ ] **Step 3: Implement helper**

Implement exported types and functions:

```ts
export interface AthleteStat {
  registrationId: string;
  name: string;
  className: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  superTiesWon: number;
  superTiesLost: number;
  walkoversWon: number;
  walkoversLost: number;
  lastResult: 'V' | 'D' | null;
  strength: number;
}
```

Use current championship matches only. Ignore pending matches for totals, initialize every registration, count W.O. as match/win/loss but skip game/set totals when score arrays only represent administrative W.O. Use smoothing in `calculateOddsSimulation()` and return decimal odds rounded to two decimals.

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/championshipStats.test.ts`

Expected: pass.

---

### Task 3: Board Click and Current Phase Centering

**Files:**
- Modify: `components/ResenhaOpenTournamentBoard.tsx`
- Modify: `components/ResenhaOpenBracketView.tsx`

- [ ] **Step 1: Add props**

Add `onMatchSelect?: (match: BracketMatchWithPhase) => void` to both components.

- [ ] **Step 2: Center current phase**

In `ResenhaOpenTournamentBoard`, import `getCurrentPhaseForClass`. After layout is built, compute the current phase and scroll the viewport so the first match in that phase is centered:

```ts
const currentPhase = useMemo(
  () => getCurrentPhaseForClass(bracket, selectedClass),
  [bracket, selectedClass],
);

const centerPhase = (phase: string) => {
  const phaseLayout = layout.phases.find(item => item.phase === phase);
  if (!viewportRef.current || !phaseLayout) return;
  viewportRef.current.scrollTo({
    left: Math.max(0, phaseLayout.x * zoom - viewportRef.current.clientWidth / 3),
    top: 0,
    behavior: 'smooth',
  });
};
```

- [ ] **Step 3: Change card click behavior**

Keep selection highlight, but call `onMatchSelect?.(layoutMatch.match)` when a match is clicked.

- [ ] **Step 4: Run focused tests/build**

Run: `npx vitest run __tests__/ResenhaOpenTournamentBoard.test.tsx __tests__/resenhaOpenBracketLayout.test.ts`

Expected: pass.

---

### Task 4: Match Action Modal

**Files:**
- Create: `components/ChampionshipMatchActionModal.tsx`

- [ ] **Step 1: Implement modal component**

Create a fixed portal modal with props:

```ts
interface ChampionshipMatchActionModalProps {
  match: Match;
  registrations: Registration[];
  roundName: string;
  className: string;
  isAdmin: boolean;
  currentUserId: string;
  scheduleMode: 'schedule' | 'suggested';
  onClose: () => void;
  onLaunch?: () => void;
  onSchedule?: () => void;
}
```

Render athletes, `J${match.match_number}`, phase/round/class, schedule status, score/W.O. status, and buttons `Lancar` and `Editar horario` only when callbacks are provided and match is not finished.

- [ ] **Step 2: Keep overlay independent of scroll**

Use `createPortal(..., document.body)` and `fixed inset-0 z-999`.

---

### Task 5: Statistics Tab Component

**Files:**
- Create: `components/ChampionshipStatistics.tsx`

- [ ] **Step 1: Implement component**

Props:

```ts
interface Props {
  matches: Match[];
  registrations: Registration[];
}
```

Use `calculateChampionshipStats()` and render:

- Class segmented control.
- Summary counters for athletes, matches finished, total sets, total games.
- Athlete rows/cards sorted by wins, win rate, set balance, game balance.
- Two athlete selectors for the odds simulator, restricted to selected class.
- Odds result with favorite lower decimal odd and confidence label.

- [ ] **Step 2: Empty states**

If there are no registrations, show `Nenhum inscrito encontrado`. If no finished matches exist, show `Aguardando partidas finalizadas`.

---

### Task 6: Wire Championships Page

**Files:**
- Modify: `components/Championships.tsx`

- [ ] **Step 1: Update imports**

Import `BarChart3` from lucide, `ChampionshipStatistics`, and `ChampionshipMatchActionModal`.

- [ ] **Step 2: Update active tab type**

Change active tab union to include `estatisticas` and keep old values only where legacy content remains:

```ts
const [activeTab, setActiveTab] = useState<'partidas' | 'jogos' | 'classificacao' | 'chaveamento' | 'inscritos' | 'estatisticas'>('chaveamento');
```

- [ ] **Step 3: Add selected bracket match state**

```ts
const [selectedBracketMatch, setSelectedBracketMatch] = useState<Match | null>(null);
```

- [ ] **Step 4: Hide Partidas/Jogos for knockout formats**

Compute:

```ts
const isOperationalBracketChampionship = selectedChamp?.format === 'mata-mata' || selectedChamp?.format === 'grupo-mata-mata';
```

Render `Partidas` and `Jogos` only when this is false. Render `Chaveamento` and `Estatisticas` for knockout formats.

- [ ] **Step 5: Wire bracket selection**

Pass `onMatchSelect={setSelectedBracketMatch}` to `ResenhaOpenBracketView`.

- [ ] **Step 6: Render statistics tab**

When `activeTab === 'estatisticas'`, render:

```tsx
<ChampionshipStatistics matches={matches} registrations={registrations} />
```

- [ ] **Step 7: Render action modal**

When `selectedBracketMatch` exists, render `ChampionshipMatchActionModal`. Its `onLaunch` sets `editingMatch`, closes the action modal, and its `onSchedule` sets `schedulingMatch`, closes the action modal.

---

### Task 7: Verification

**Files:**
- Existing tests and build.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run __tests__/championshipStats.test.ts __tests__/resenhaOpenBracketLayout.test.ts __tests__/ResenhaOpenTournamentBoard.test.tsx
```

- [ ] **Step 2: Run build**

Run: `npm run build`

- [ ] **Step 3: Start dev server for user validation**

Run: `npm run dev -- --host 0.0.0.0`

Report the local URL.

