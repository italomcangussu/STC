# Uncle Bob Sem Regressao Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir risco estrutural do STC sem mudar comportamento observavel, restaurando uma suite verde, medindo cobertura real e refatorando primeiro os pontos com maior retorno.

**Architecture:** A execucao segue o modo IMPROVE da skill Uncle Bob: rede de testes primeiro, refatoracoes pequenas depois. A primeira trilha estabiliza a linha de base; a segunda remove o ciclo `resenhaOpenService` <-> `resenhaOpenOfficialBracket`; a terceira extrai logica pura de `Agenda` sem alterar UI nem contrato Supabase. Componentes grandes ficam para depois da rede de caracterizacao.

**Tech Stack:** React 19, TypeScript, Vite, Vitest 4.0.18, Testing Library, Supabase client, ESLint, Python auditor `audit_codebase.py`.

## Global Constraints

- Nao misturar mudanca de comportamento e refatoracao no mesmo commit.
- Nao iniciar refatoracao enquanto `npm test -- --run` estiver vermelho.
- Rodar `npm test -- --run` apos cada tarefa de codigo; se ficar vermelho, reverter a ultima tarefa antes de continuar.
- Rodar `npm run build` antes de cada commit.
- Rodar `python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --top 20 -o relatorio-uncle-bob.md` antes e depois das refatoracoes estruturais.
- Cobertura real depende de `@vitest/coverage-v8`; manter versao alinhada com `vitest@4.0.18`.
- Os arquivos `relatorio-uncle-bob*.md` sao artefatos de auditoria; decidir explicitamente se entram no commit ou se serao removidos antes do push.

---

## File Structure

- Modify: `package.json` and `package-lock.json` only for coverage tooling.
- Modify: `__tests__/agendaReservations.test.tsx` to make the failing test deterministic in Fortaleza time.
- Optionally modify: `components/Agenda.tsx` only if the failing test exposes production behavior, not test-data drift.
- Create: `lib/resenhaOpenTypes.ts` as the stable type boundary for `ResenhaClass` and `BracketMatchWithPhase`.
- Modify: `lib/resenhaOpenService.ts` to import shared types and keep Supabase operations only.
- Modify: `lib/resenhaOpenOfficialBracket.ts` to import shared types instead of importing from the service.
- Modify: type-only consumers: `components/ResenhaOpenTournamentBoard.tsx`, `components/ResenhaOpenBracketView.tsx`, `components/AdminResenhaOpen.tsx`, `lib/resenhaOpenBracketLayout.ts`, and related tests.
- Create: `lib/agendaMappers.ts` for pure mapping helpers after the suite is green.
- Test: add or update focused tests under `__tests__/` for each extraction.

---

### Task 1: Lock Coverage Tooling Without Broad Dependency Drift

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing `vitest` and `@vitest/ui` dev dependencies.
- Produces: working coverage provider for `vitest --coverage`.

- [ ] **Step 1: Inspect current diff**

Run:
```bash
git status --short
git diff -- package.json package-lock.json
```

Expected: only `@vitest/coverage-v8` is intentionally added; `vitest` and `@vitest/ui` remain in the `4.0.18` family.

- [ ] **Step 2: If dependency drift exists, realign Vitest packages**

Run:
```bash
npm install -D @vitest/coverage-v8@4.0.18 vitest@4.0.18 @vitest/ui@4.0.18
```

Expected: `package.json` contains:
```json
"@vitest/coverage-v8": "^4.0.18",
"@vitest/ui": "^4.0.18",
"vitest": "^4.0.18"
```

- [ ] **Step 3: Verify the tooling**

Run:
```bash
npm test -- __tests__/publicRoutes.test.ts --run
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit the tooling separately**

Run:
```bash
git add package.json package-lock.json
git commit -m "chore: add vitest coverage provider"
```

Expected: one commit with only package files.

---

### Task 2: Restore A Green Test Baseline

**Files:**
- Modify: `__tests__/agendaReservations.test.tsx`
- Modify only if necessary: `components/Agenda.tsx`

**Interfaces:**
- Consumes: `formatDate` and `getNowInFortaleza` from `../utils`.
- Produces: deterministic reservation date for tests that render the day view.

- [ ] **Step 1: Reproduce the failing test**

Run:
```bash
npm test -- __tests__/agendaReservations.test.tsx --run
```

Expected before fix: the test `keeps already loaded reservations visible when a refetch fails because of an unstable connection` fails at:
```ts
expect(await screen.findByText(/Italo/)).toBeInTheDocument();
```

- [ ] **Step 2: Make the test date use the same Fortaleza helper as production**

In `__tests__/agendaReservations.test.tsx`, change the imports to:
```ts
import { User } from '../types';
import { formatDate, getNowInFortaleza } from '../utils';
```

Change the failing test setup from:
```ts
tableData.reservations = [{ ...reservationRow, date: new Date().toISOString().slice(0, 10) }];
```

to:
```ts
tableData.reservations = [{ ...reservationRow, date: formatDate(getNowInFortaleza()) }];
```

Reason: production initializes `currentDate` with `getNowInFortaleza()`, while `new Date().toISOString()` uses UTC. Near midnight or in CI, UTC and Fortaleza can point to different dates, making the fixture invisible in the current day.

- [ ] **Step 3: Verify the targeted test passes**

Run:
```bash
npm test -- __tests__/agendaReservations.test.tsx --run
```

Expected: 2 tests pass.

- [ ] **Step 4: Verify the full suite**

Run:
```bash
npm test -- --run
```

Expected: 17 test files pass, 120 tests pass.

- [ ] **Step 5: Commit the baseline fix**

Run:
```bash
git add __tests__/agendaReservations.test.tsx
git commit -m "test: stabilize agenda reservation date"
```

Expected: one commit with only the test stabilization. If `components/Agenda.tsx` was required, stop and document the production root cause before committing.

---

### Task 3: Establish Measured Baseline

**Files:**
- Generate: `relatorio-uncle-bob.md`
- Generate: `relatorio-uncle-bob-run.md`
- Generate: `coverage/`

**Interfaces:**
- Consumes: green full test suite from Task 2.
- Produces: baseline numbers for cycles, complexity, size, coverage, and test health.

- [ ] **Step 1: Run static auditor**

Run:
```bash
python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --top 20 -o relatorio-uncle-bob.md
```

Expected: report shows current static baseline. Before improvements, known values are approximately:
```text
1 dependency cycle
105/405 functions above complexity 5
45 files above 200 lines
114 functions above 20 lines
~2.4% duplicate blocks
```

- [ ] **Step 2: Run coverage auditor**

Run:
```bash
python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --run --top 20 -o relatorio-uncle-bob-run.md
```

Expected: command exits `0` and records coverage instead of `Cobertura de testes: nao medido`.

- [ ] **Step 3: Decide artifact policy**

Use one of these two paths:
```bash
git add relatorio-uncle-bob.md relatorio-uncle-bob-run.md
git commit -m "docs: add uncle bob audit baseline"
```

or:
```bash
rm relatorio-uncle-bob.md relatorio-uncle-bob-run.md
git status --short
```

Expected: no accidental untracked audit artifacts remain.

---

### Task 4: Break The Resenha Open Dependency Cycle

**Files:**
- Create: `lib/resenhaOpenTypes.ts`
- Modify: `lib/resenhaOpenService.ts`
- Modify: `lib/resenhaOpenOfficialBracket.ts`
- Modify: `components/ResenhaOpenTournamentBoard.tsx`
- Modify: `components/ResenhaOpenBracketView.tsx`
- Modify: `components/AdminResenhaOpen.tsx`
- Modify: `lib/resenhaOpenBracketLayout.ts`
- Modify: `__tests__/ResenhaOpenTournamentBoard.test.tsx`
- Modify: `__tests__/resenhaOpenBracketLayout.test.ts`

**Interfaces:**
- Produces:
```ts
export type ResenhaClass = '4ª Classe' | '5ª Classe';

export interface BracketMatchWithPhase extends BracketMatch {
  round_phase: string;
  bracket_class?: ResenhaClass | string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  score_a?: number[];
  score_b?: number[];
}
```

- [ ] **Step 1: Write a cycle guard test**

Create `__tests__/dependencyCycles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('dependency boundaries', () => {
  it('keeps official Resenha Open bracket data independent from Supabase service', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/resenhaOpenOfficialBracket.ts'), 'utf8');

    expect(source).not.toContain("from './resenhaOpenService'");
    expect(source).not.toContain('from "./resenhaOpenService"');
  });
});
```

- [ ] **Step 2: Run the guard test and verify it fails**

Run:
```bash
npm test -- __tests__/dependencyCycles.test.ts --run
```

Expected: FAIL because `lib/resenhaOpenOfficialBracket.ts` imports `BracketMatchWithPhase` from `./resenhaOpenService`.

- [ ] **Step 3: Create the shared type module**

Create `lib/resenhaOpenTypes.ts`:
```ts
import type { BracketMatch } from './resenhaOpenAdvance';

export type ResenhaClass = '4ª Classe' | '5ª Classe';

export interface BracketMatchWithPhase extends BracketMatch {
    round_phase: string;
    bracket_class?: ResenhaClass | string;
    scheduled_date?: string | null;
    scheduled_time?: string | null;
    score_a?: number[];
    score_b?: number[];
}
```

- [ ] **Step 4: Move type imports to the shared module**

In `lib/resenhaOpenService.ts`, remove the local `ResenhaClass` and `BracketMatchWithPhase` declarations, then add:
```ts
export type { BracketMatchWithPhase, ResenhaClass } from './resenhaOpenTypes';
import type { BracketMatchWithPhase, ResenhaClass } from './resenhaOpenTypes';
```

In `lib/resenhaOpenOfficialBracket.ts`, replace:
```ts
import type { BracketMatchWithPhase } from './resenhaOpenService';
```

with:
```ts
import type { BracketMatchWithPhase } from './resenhaOpenTypes';
```

Keep existing external imports from `resenhaOpenService` working by re-exporting the type from the service during this task.

- [ ] **Step 5: Verify the guard and Resenha tests**

Run:
```bash
npm test -- __tests__/dependencyCycles.test.ts __tests__/resenhaOpenService.test.ts __tests__/ResenhaOpenTournamentBoard.test.tsx __tests__/resenhaOpenBracketLayout.test.ts --run
```

Expected: all selected tests pass.

- [ ] **Step 6: Verify audit cycle count improved**

Run:
```bash
python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --top 20 -o relatorio-uncle-bob.md
```

Expected: dependency cycles drop from `1` to `0`.

- [ ] **Step 7: Verify full regression suite and commit**

Run:
```bash
npm test -- --run
npm run build
git add lib/resenhaOpenTypes.ts lib/resenhaOpenService.ts lib/resenhaOpenOfficialBracket.ts components/ResenhaOpenTournamentBoard.tsx components/ResenhaOpenBracketView.tsx components/AdminResenhaOpen.tsx lib/resenhaOpenBracketLayout.ts __tests__/dependencyCycles.test.ts __tests__/ResenhaOpenTournamentBoard.test.tsx __tests__/resenhaOpenBracketLayout.test.ts
git commit -m "refactor: break resenha open type dependency cycle"
```

Expected: full suite and build pass; commit contains only type-boundary refactor and the guard test.

---

### Task 5: Extract Agenda Mapping Logic Behind Characterization Tests

**Files:**
- Create: `lib/agendaMappers.ts`
- Create: `__tests__/agendaMappers.test.ts`
- Modify: `components/Agenda.tsx`

**Interfaces:**
- Produces:
```ts
export type ReservationRow = {
  id: string;
  type: string;
  date: string;
  start_time: string;
  end_time: string;
  court_id: string;
  creator_id: string;
  participant_ids?: string[] | null;
  guest_name?: string | null;
  guest_responsible_id?: string | null;
  professor_id?: string | null;
  student_type?: string | null;
  non_socio_student_id?: string | null;
  non_socio_student_ids?: string[] | null;
  observation?: string | null;
  status?: string | null;
};

export function mapReservationRow(row: ReservationRow): Reservation;
export function dedupeReservationsBySlot(items: Reservation[]): Reservation[];
```

- [ ] **Step 1: Write characterization tests for current behavior**

Create `__tests__/agendaMappers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { dedupeReservationsBySlot, mapReservationRow } from '../lib/agendaMappers';
import type { Reservation } from '../types';

describe('agenda mappers', () => {
  it('maps reservation table rows to Agenda reservation objects', () => {
    expect(mapReservationRow({
      id: 'reservation-1',
      type: 'Play',
      date: '2026-06-18',
      start_time: '08:00',
      end_time: '09:00',
      court_id: 'court-1',
      creator_id: 'user-1',
      participant_ids: ['user-1'],
      guest_name: null,
      guest_responsible_id: null,
      professor_id: null,
      student_type: null,
      non_socio_student_id: null,
      non_socio_student_ids: null,
      observation: null,
      status: null,
    })).toMatchObject({
      id: 'reservation-1',
      type: 'Play',
      date: '2026-06-18',
      startTime: '08:00',
      endTime: '09:00',
      courtId: 'court-1',
      creatorId: 'user-1',
      participantIds: ['user-1'],
      nonSocioStudentIds: [],
      status: 'active',
    });
  });

  it('prefers championship match reservations over normal reservations in the same slot', () => {
    const normal = {
      id: 'reservation-1',
      date: '2026-06-18',
      startTime: '08:00',
      courtId: 'court-1',
    } as Reservation;
    const match = {
      id: 'match_match-1',
      date: '2026-06-18',
      startTime: '08:00',
      courtId: 'court-1',
    } as Reservation;

    expect(dedupeReservationsBySlot([normal, match])).toEqual([match]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail for missing module**

Run:
```bash
npm test -- __tests__/agendaMappers.test.ts --run
```

Expected: FAIL because `../lib/agendaMappers` does not exist.

- [ ] **Step 3: Add the pure mapper module**

Create `lib/agendaMappers.ts`:
```ts
import type { Reservation } from '../types';

export type ReservationRow = {
    id: string;
    type: string;
    date: string;
    start_time: string;
    end_time: string;
    court_id: string;
    creator_id: string;
    participant_ids?: string[] | null;
    guest_name?: string | null;
    guest_responsible_id?: string | null;
    professor_id?: string | null;
    student_type?: string | null;
    non_socio_student_id?: string | null;
    non_socio_student_ids?: string[] | null;
    observation?: string | null;
    status?: string | null;
};

export function mapReservationRow(row: ReservationRow): Reservation {
    return {
        id: row.id,
        type: row.type as Reservation['type'],
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        courtId: row.court_id,
        creatorId: row.creator_id,
        participantIds: row.participant_ids || [],
        guestName: row.guest_name,
        guestResponsibleId: row.guest_responsible_id,
        professorId: row.professor_id,
        studentType: row.student_type,
        nonSocioStudentId: row.non_socio_student_id,
        nonSocioStudentIds: row.non_socio_student_ids || [],
        observation: row.observation,
        status: row.status || 'active',
    };
}

export function dedupeReservationsBySlot(items: Reservation[]): Reservation[] {
    return Array.from(
        items.reduce((map, item) => {
            const key = `${item.date}_${item.startTime}_${item.courtId}`;
            const existing = map.get(key);

            if (!existing || item.id.startsWith('match_')) {
                map.set(key, item);
            }

            return map;
        }, new Map<string, Reservation>()).values()
    );
}
```

- [ ] **Step 4: Replace equivalent inline Agenda logic**

In `components/Agenda.tsx`, add:
```ts
import { dedupeReservationsBySlot, mapReservationRow } from '../lib/agendaMappers';
```

Replace the reservation mapping block with:
```ts
mappedReservations = reservationsData.map(mapReservationRow);
```

Replace the inline dedupe block with:
```ts
const uniqueReservations = dedupeReservationsBySlot(allCombined);
```

- [ ] **Step 5: Verify focused and full tests**

Run:
```bash
npm test -- __tests__/agendaMappers.test.ts __tests__/agendaReservations.test.tsx --run
npm test -- --run
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the extraction**

Run:
```bash
git add lib/agendaMappers.ts __tests__/agendaMappers.test.ts components/Agenda.tsx
git commit -m "refactor: extract agenda reservation mappers"
```

Expected: behavior is unchanged; `components/Agenda.tsx` loses pure mapping responsibility.

---

### Task 6: Add Quality Gates For Future Work

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces:
```json
"quality:audit": "python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --top 20 -o relatorio-uncle-bob.md",
"quality:coverage": "python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --run --top 20 -o relatorio-uncle-bob-run.md",
"quality:check": "npm run lint && npm test -- --run && npm run build && npm run quality:audit"
```

- [ ] **Step 1: Add scripts**

Modify `package.json` scripts:
```json
"quality:audit": "python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --top 20 -o relatorio-uncle-bob.md",
"quality:coverage": "python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --run --top 20 -o relatorio-uncle-bob-run.md",
"quality:check": "npm run lint && npm test -- --run && npm run build && npm run quality:audit"
```

- [ ] **Step 2: Run quality gate**

Run:
```bash
npm run quality:check
```

Expected: exits `0`. Existing lint warning in `components/ResenhaOpenTournamentBoard.tsx` may print, but ESLint exits `0`.

- [ ] **Step 3: Commit quality scripts**

Run:
```bash
git add package.json
git commit -m "chore: add quality audit scripts"
```

Expected: one commit containing only scripts.

---

### Task 7: Decide The Next Refactor Target From The New Baseline

**Files:**
- Read: `relatorio-uncle-bob.md`
- Read: `relatorio-uncle-bob-run.md`
- Candidate modify later: `components/Agenda.tsx`, `components/Championships.tsx`, `components/AdminPanel.tsx`

**Interfaces:**
- Consumes: post-cycle baseline and real coverage.
- Produces: one next plan focused on a single high-risk component.

- [ ] **Step 1: Compare before and after**

Run:
```bash
python3 /Users/italomendes/.codex/skills/uncle-bob/scripts/audit_codebase.py . --run --top 20 -o relatorio-uncle-bob-run.md
sed -n '1,120p' relatorio-uncle-bob-run.md
```

Expected: coverage is measured, dependency cycles are `0`, and complexity numbers are not worse than the baseline.

- [ ] **Step 2: Select exactly one next target**

Use this priority rule:
```text
1. A file with high complexity and low coverage
2. A file with user-facing production risk
3. A file whose logic can be extracted behind pure tests
```

Expected first candidates from the static report:
```text
components/Agenda.tsx
components/Championships.tsx
components/AdminPanel.tsx
```

- [ ] **Step 3: Write the next narrow plan**

Create a new plan under:
```text
docs/superpowers/plans/YYYY-MM-DD-<selected-target>-refactor.md
```

Expected: the plan contains only one target and starts with characterization tests before extraction.

