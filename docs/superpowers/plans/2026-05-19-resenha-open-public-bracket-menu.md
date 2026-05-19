# Resenha Open Public Bracket Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user-visible championship menu support the official Resenha Open 4ª and 5ª Classe brackets without group standings or game scheduling.

**Architecture:** Detect Resenha Open championships from existing championship metadata and route their public/internal display to the dedicated Resenha Open bracket view. Keep generic group-stage championship behavior unchanged. Reword the admin match timing modal so Resenha Open edits suggested times instead of scheduling games.

**Tech Stack:** React, TypeScript, Supabase, Vitest, Vite.

---

### Task 1: Public Championship Page

**Files:**
- Modify: `components/PublicChampionshipPage.tsx`

- [ ] Detect Resenha Open from `championship.name` or `championship.slug`.
- [ ] Default the Resenha Open page to the bracket tab.
- [ ] Hide the standings tab for Resenha Open.
- [ ] Render `ResenhaOpenBracketView` for the bracket tab instead of the group-stage `BracketView`.
- [ ] Replace the public scheduling copy with informational timing copy for Resenha Open.

### Task 2: Internal Championships Menu

**Files:**
- Modify: `components/Championships.tsx`

- [ ] Detect Resenha Open championships.
- [ ] Prevent regular users from seeing/using schedule buttons for Resenha Open matches.
- [ ] Show Resenha Open scheduled dates/times as suggested/informational.
- [ ] Keep admin result entry behavior unchanged.

### Task 3: Suggested Time Editing Language

**Files:**
- Modify: `components/MatchScheduleModal.tsx`
- Modify call sites in `components/Championships.tsx` and `components/ChampionshipInProgress.tsx` if needed.

- [ ] Add a display mode for suggested time editing.
- [ ] In suggested-time mode, change title/action/copy away from "agendar".
- [ ] Keep date range validation and time edit capability.

### Task 4: Verification

- [ ] Run focused tests for Resenha Open.
- [ ] Run type/build verification.
- [ ] Report any unrelated failing tests separately.
