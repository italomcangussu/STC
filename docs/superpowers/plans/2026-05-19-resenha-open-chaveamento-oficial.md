# Resenha Open Official Brackets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active Resenha Open saved bracket with the official 4ª and 5ª Classe brackets from the published images and update the app logic to match the new format.

**Architecture:** Keep pure bracket generation in `lib/resenhaOpenDraw.ts`, winner propagation in `lib/resenhaOpenAdvance.ts`, database phase mapping in `lib/resenhaOpenService.ts`, and persisted bracket replacement in a Supabase migration. Existing registrations remain the identity source; matches reference registration IDs and source match IDs.

**Tech Stack:** React, TypeScript, Vitest, Supabase/Postgres migrations.

---

### Task 1: 5ª Classe Sequential Knockout

**Files:**
- Modify: `__tests__/resenhaOpenDraw.test.ts`
- Modify: `__tests__/resenhaOpenAdvance.test.ts`
- Modify: `lib/resenhaOpenDraw.ts`

- [ ] **Step 1: Update failing draw test for 5ª quarterfinal dependencies**

In `__tests__/resenhaOpenDraw.test.ts`, change the 5ª Classe quarterfinal expectation so J9-J12 depend on adjacent first-round matches:

```ts
it('quartas têm match_numbers 9-12 e referenciam pares adjacentes das oitavas', () => {
    const bracket = buildClasse5Bracket(oitavas);
    const expectedSources = [
        [9, 1, 2],
        [10, 3, 4],
        [11, 5, 6],
        [12, 7, 8],
    ];

    for (const [matchNumber, sourceA, sourceB] of expectedSources) {
        const match = bracket.find(m => m.match_number === matchNumber)!;
        expect(match.registration_a_id).toBeNull();
        expect(match.registration_b_id).toBeNull();
        expect(match.player_a_source_match_number).toBe(sourceA);
        expect(match.player_b_source_match_number).toBe(sourceB);
    }
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npx vitest run __tests__/resenhaOpenDraw.test.ts -t "quartas têm match_numbers"`

Expected: FAIL because J9 currently depends on J1 and J5.

- [ ] **Step 3: Update 5ª bracket implementation**

In `lib/resenhaOpenDraw.ts`, replace the quarterfinal loop inside `buildClasse5Bracket` with:

```ts
const quarterSources: [number, number][] = [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
];

quarterSources.forEach(([sourceA, sourceB], i) => {
    all.push({
        match_number: 9 + i,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: `Vencedor Jogo ${sourceA}`,
        player_b_label: `Vencedor Jogo ${sourceB}`,
        player_a_source_match_number: sourceA,
        player_b_source_match_number: sourceB,
    });
});
```

- [ ] **Step 4: Update failing advancement test for 5ª Classe**

In `__tests__/resenhaOpenAdvance.test.ts`, update the test named `após duas quartas...` so it fills J9 from J1/J2 and J10 from J3/J4 before playing J9/J10:

```ts
it('após duas quartas adjacentes, os slots da Semifinal correspondente são preenchidos', () => {
    let b = classe5Bracket;

    b = applyResult(b, 1);
    b = applyResult(b, 2);
    b = applyResult(b, 3);
    b = applyResult(b, 4);

    const wQ9 = b.find(m => m.match_number === 9)!.registration_a_id!;
    b = applyMatchResult(b, `m9`, wQ9);
    const wQ10 = b.find(m => m.match_number === 10)!.registration_a_id!;
    b = applyMatchResult(b, `m10`, wQ10);

    const semi13 = b.find(m => m.match_number === 13)!;
    expect(semi13.registration_a_id).toBe(wQ9);
    expect(semi13.registration_b_id).toBe(wQ10);
});
```

- [ ] **Step 5: Run 5ª tests and verify pass**

Run: `npx vitest run __tests__/resenhaOpenDraw.test.ts __tests__/resenhaOpenAdvance.test.ts`

Expected: all 5ª-related tests pass; old 4ª tests may still fail after Task 2 red changes.

### Task 2: 4ª Classe Official 20-Player Bracket

**Files:**
- Modify: `__tests__/resenhaOpenDraw.test.ts`
- Modify: `__tests__/resenhaOpenAdvance.test.ts`
- Modify: `lib/resenhaOpenDraw.ts`
- Modify: `lib/resenhaOpenAdvance.ts`

- [ ] **Step 1: Replace 4ª draw tests with official format expectations**

In `__tests__/resenhaOpenDraw.test.ts`, replace the old `drawClasse4Qualify`, `drawClasse4PrimeiraFase`, `drawClasse4CabecasDeChave`, and `buildClasse4Bracket` 4ª sections with tests for:

```ts
describe('buildClasse4OfficialBracket', () => {
    const athletes20 = Array.from({ length: 20 }, (_, i) => makeAthlete(`c4-${i + 1}`));
    const bracket = buildClasse4OfficialBracket(athletes20, identityRng);

    it('lança erro se não receber 20 atletas', () => {
        expect(() => buildClasse4OfficialBracket(athletes20.slice(0, 19))).toThrow('esperado 20 atletas');
        expect(() => buildClasse4OfficialBracket([...athletes20, makeAthlete('extra')])).toThrow('esperado 20 atletas');
    });

    it('cria 19 partidas de J1 a J19', () => {
        expect(bracket).toHaveLength(19);
        expect(bracket.map(m => m.match_number)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    });

    it('preliminares J1-J4 têm jogadores diretos', () => {
        for (const matchNumber of [1, 2, 3, 4]) {
            const match = bracket.find(m => m.match_number === matchNumber)!;
            expect(match.registration_a_id).toBeTruthy();
            expect(match.registration_b_id).toBeTruthy();
            expect(match.player_a_source_match_number).toBeUndefined();
            expect(match.player_b_source_match_number).toBeUndefined();
        }
    });

    it('oitavas recebem vencedores das preliminares nos slots corretos', () => {
        const j5 = bracket.find(m => m.match_number === 5)!;
        const j8 = bracket.find(m => m.match_number === 8)!;
        const j9 = bracket.find(m => m.match_number === 9)!;
        const j12 = bracket.find(m => m.match_number === 12)!;

        expect(j5.player_b_source_match_number).toBe(1);
        expect(j8.player_b_source_match_number).toBe(2);
        expect(j9.player_b_source_match_number).toBe(3);
        expect(j12.player_b_source_match_number).toBe(4);
    });

    it('quartas, semis e final seguem avanço adjacente até J19', () => {
        expect(bracket.find(m => m.match_number === 13)).toMatchObject({ player_a_source_match_number: 5, player_b_source_match_number: 6 });
        expect(bracket.find(m => m.match_number === 14)).toMatchObject({ player_a_source_match_number: 7, player_b_source_match_number: 8 });
        expect(bracket.find(m => m.match_number === 15)).toMatchObject({ player_a_source_match_number: 9, player_b_source_match_number: 10 });
        expect(bracket.find(m => m.match_number === 16)).toMatchObject({ player_a_source_match_number: 11, player_b_source_match_number: 12 });
        expect(bracket.find(m => m.match_number === 17)).toMatchObject({ player_a_source_match_number: 13, player_b_source_match_number: 14 });
        expect(bracket.find(m => m.match_number === 18)).toMatchObject({ player_a_source_match_number: 15, player_b_source_match_number: 16 });
        expect(bracket.find(m => m.match_number === 19)).toMatchObject({ player_a_source_match_number: 17, player_b_source_match_number: 18 });
    });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npx vitest run __tests__/resenhaOpenDraw.test.ts`

Expected: FAIL because `buildClasse4OfficialBracket` is not exported yet.

- [ ] **Step 3: Implement `buildClasse4OfficialBracket`**

In `lib/resenhaOpenDraw.ts`, add:

```ts
export function buildClasse4OfficialBracket(
    athletes: DrawAthlete[],
    rng?: () => number
): DrawMatch[] {
    if (athletes.length !== 20) {
        throw new Error(`buildClasse4OfficialBracket: esperado 20 atletas, recebido ${athletes.length}`);
    }
    const ids = athletes.map(a => a.id);
    if (new Set(ids).size !== ids.length) {
        throw new Error('buildClasse4OfficialBracket: atletas duplicados na entrada');
    }

    const shuffled = shuffle(athletes, rng);
    const direct = (matchNumber: number, a: DrawAthlete, b: DrawAthlete): DrawMatch => ({
        match_number: matchNumber,
        registration_a_id: a.id,
        registration_b_id: b.id,
        player_a_label: a.name,
        player_b_label: b.name,
    });
    const source = (matchNumber: number, sourceA: number, sourceB: number): DrawMatch => ({
        match_number: matchNumber,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: `Vencedor Jogo ${sourceA}`,
        player_b_label: `Vencedor Jogo ${sourceB}`,
        player_a_source_match_number: sourceA,
        player_b_source_match_number: sourceB,
    });

    return [
        direct(1, shuffled[0], shuffled[1]),
        direct(2, shuffled[2], shuffled[3]),
        direct(3, shuffled[4], shuffled[5]),
        direct(4, shuffled[6], shuffled[7]),
        {
            match_number: 5,
            registration_a_id: shuffled[8].id,
            registration_b_id: null,
            player_a_label: shuffled[8].name,
            player_b_label: 'Vencedor Jogo 1',
            player_b_source_match_number: 1,
        },
        direct(6, shuffled[9], shuffled[10]),
        direct(7, shuffled[11], shuffled[12]),
        {
            match_number: 8,
            registration_a_id: shuffled[13].id,
            registration_b_id: null,
            player_a_label: shuffled[13].name,
            player_b_label: 'Vencedor Jogo 2',
            player_b_source_match_number: 2,
        },
        {
            match_number: 9,
            registration_a_id: shuffled[14].id,
            registration_b_id: null,
            player_a_label: shuffled[14].name,
            player_b_label: 'Vencedor Jogo 3',
            player_b_source_match_number: 3,
        },
        direct(10, shuffled[15], shuffled[16]),
        direct(11, shuffled[17], shuffled[18]),
        {
            match_number: 12,
            registration_a_id: shuffled[19].id,
            registration_b_id: null,
            player_a_label: shuffled[19].name,
            player_b_label: 'Vencedor Jogo 4',
            player_b_source_match_number: 4,
        },
        source(13, 5, 6),
        source(14, 7, 8),
        source(15, 9, 10),
        source(16, 11, 12),
        source(17, 13, 14),
        source(18, 15, 16),
        source(19, 17, 18),
    ];
}
```

- [ ] **Step 4: Update 4ª advancement tests**

In `__tests__/resenhaOpenAdvance.test.ts`, replace the 4ª fixture with `buildClasse4OfficialBracket` and update expectations for J5/J8/J9/J12 and J13-J19 propagation.

- [ ] **Step 5: Update phase mapping**

In `lib/resenhaOpenAdvance.ts`, ensure `mapPhaseToCanonical` treats `preliminar` and `oitavas` as `round_of_16`:

```ts
case 'preliminar':
case 'oitavas':
case 'primeira_fase':
case 'qualify':
    return 'round_of_16';
```

- [ ] **Step 6: Run draw/advance tests**

Run: `npx vitest run __tests__/resenhaOpenDraw.test.ts __tests__/resenhaOpenAdvance.test.ts`

Expected: PASS.

### Task 3: Service Phase Mapping And Admin Count

**Files:**
- Modify: `lib/resenhaOpenService.ts`
- Modify: `components/AdminResenhaOpen.tsx`
- Modify: `components/ResenhaOpenBracketView.tsx`
- Modify: `__tests__/resenhaOpenService.test.ts`

- [ ] **Step 1: Update service test for new 4ª rounds**

In `__tests__/resenhaOpenService.test.ts`, change the existing 4ª round fixture to phases `preliminar`, `oitavas`, `quartas`, `semifinal`, `final`, and assert `phaseMap.get('preliminar')`.

- [ ] **Step 2: Run service test and verify it fails**

Run: `npx vitest run __tests__/resenhaOpenService.test.ts`

Expected: FAIL because service still expects old phases and six rounds.

- [ ] **Step 3: Update service round definitions**

In `lib/resenhaOpenService.ts`, change `CLASSE4_ROUNDS` to:

```ts
const CLASSE4_ROUNDS: RoundDef[] = [
    { phase: 'preliminar', roundNumber: 1, name: 'Preliminar', matchNumbers: [1,2,3,4] },
    { phase: 'oitavas',    roundNumber: 2, name: 'Oitavas de Final', matchNumbers: [5,6,7,8,9,10,11,12] },
    { phase: 'quartas',    roundNumber: 3, name: 'Quartas de Final', matchNumbers: [13,14,15,16] },
    { phase: 'semifinal',  roundNumber: 4, name: 'Semifinais', matchNumbers: [17,18] },
    { phase: 'final',      roundNumber: 5, name: 'Final', matchNumbers: [19] },
];
```

- [ ] **Step 4: Update admin expected count**

In `components/AdminResenhaOpen.tsx`, change:

```ts
const expectedCount = classe === '5ª Classe' ? 16 : 20;
```

- [ ] **Step 5: Update public phase ordering**

In `components/ResenhaOpenBracketView.tsx`, ensure `PHASE_ORDER` begins:

```ts
const PHASE_ORDER = ['preliminar', 'qualify', 'oitavas', 'primeira_fase', 'segunda_fase', 'quartas', 'semifinal', 'final'];
```

Add label/color entries for `preliminar`.

- [ ] **Step 6: Run service test**

Run: `npx vitest run __tests__/resenhaOpenService.test.ts`

Expected: PASS.

### Task 4: Persist Official Bracket In Database

**Files:**
- Create: `supabase/migrations/20260519080000_replace_resenha_open_official_brackets.sql`

- [ ] **Step 1: Create idempotent SQL migration**

Create a migration that:

- Resolves the active `resenha-open` championship.
- Resolves each required registration by class and current database spelling.
- Raises an exception if any required registration is missing.
- Deletes existing matches for the championship.
- Deletes and recreates only the Resenha Open rounds for the championship.
- Inserts official J1-J15 for `5ª Classe` and J1-J19 for `4ª Classe`.
- Writes `scheduled_date` and `scheduled_time` when available.
- Updates `player_a_source_match_id` and `player_b_source_match_id`.

- [ ] **Step 2: Apply migration**

Run: `/Users/italomendescangussu/.codex/skills/supabase-cli-mcp-guardrails/scripts/with_local_supabase_env.sh --project-root "$(git rev-parse --show-toplevel)" -- supabase db push --yes`

Expected: migration applies to remote project `smztsayzldjmkzmufqcz`.

- [ ] **Step 3: Verify persisted bracket**

Run a read-only query that checks:

- `4ª Classe` has 19 matches.
- `5ª Classe` has 15 matches.
- 4ª J19 depends on J17 and J18.
- 5ª J9 depends on J1 and J2.
- Derlan has entries in both classes.

Expected: all checks true.

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `npx vitest run __tests__/resenhaOpenDraw.test.ts __tests__/resenhaOpenAdvance.test.ts __tests__/resenhaOpenService.test.ts`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: only intended code, tests, docs, and migrations are modified/untracked.
