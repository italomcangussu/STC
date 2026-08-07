# Criador de Campeonatos — Fases 2 a 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o Criador de Campeonatos: gerar rodadas ao fechar inscrições para qualquer formato, inscrever alunos e semear cabeças pelo ranking, montar a chave por sorteio ou à mão num editor visual, e dar ao Campeonato Admin a visualização e edição da pontuação por fase.

**Architecture:** Continua a extração em camadas da Fase 1. Toda lógica de derivação de rodadas, semeadura, montagem de chave e apuração de grupos vive em `lib/championship/` como funções puras testáveis; os componentes em `components/creator/` só coletam entrada e exibem. `saveBracket` do Resenha é generalizado recebendo o mapa `match_number → fase` em vez de derivá-lo da classe.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind v4, Supabase (Postgres 17.6), Vitest + Testing Library.

## Global Constraints

- Fases de rodada emitidas precisam ser reconhecidas por `resolve_championship_final_phases`: ele casa `phase ILIKE 'mata-mata-final%'`, `phase IN ('final','Final')`, `name = 'Final'`, e exclui `'%semi%'`. Usar exatamente o vocabulário definido em `ROUND_PHASES` (Task 7).
- Não alterar `resenhaOpenDraw.ts` nem os dados do campeonato "Resenha Open 2026" (`3383d2ba-787e-4206-b7aa-d7375c1c60a1`).
- Rodadas do modelo antigo têm `class = NULL`. O Criador recusa gerar rodadas em campeonatos que já tenham rodadas com `class` nulo.
- Nenhum valor semeado em `championship_phase_points` por migration. Fase sem linha vale 5 por `apply_championship_edition_points`. O editor da Task 14 é a única via de mudança.
- Testes em `__tests__/<nome>.test.ts`, padrão de mock de `__tests__/championshipCreation.test.ts` (`vi.hoisted` + `makeChain`).
- `npm run lint` e `npx tsc --noEmit` limpos antes de cada commit. Warning pré-existente permitido: `ResenhaOpenTournamentBoard.tsx:76`. Nenhum warning novo.
- Não exportar constantes ou funções de arquivos de componente (dispara `react-refresh/only-export-components`). Valores compartilhados vão para `lib/championship/`.
- Commit ao fim de cada fase, além dos commits por tarefa.

## Nota sobre completude do código

As tarefas de lógica pura (7, 8, 10, 11, 13) trazem código e testes completos — é onde os erros custam caro e onde o TDD paga. As tarefas de UI (9, 12, 14) especificam props, estados, comportamento e a estrutura do JSX, seguindo os padrões já estabelecidos em `CreatorSetup.tsx` e `CreatorFormat.tsx` da Fase 1, sem repetir cada classe do Tailwind. Essa é uma escolha deliberada para manter um plano de três fases utilizável.

---

## File Structure

| Arquivo | Fase | Responsabilidade |
|---|---|---|
| `lib/championship/rounds.ts` | 2 | `ROUND_PHASES`, `deriveRounds`, `createRounds` |
| `lib/championship/seeding.ts` | 2 | `pickSeedsByRanking` (puro), `applySeeds` |
| `lib/championship/registration.ts` | 2 | `registerAluno`, `fetchEligibleStudents` |
| `components/creator/CreatorRegistration.tsx` | 2 | Passo 3 genérico |
| `lib/championship/bracket.ts` | 3 | `seedSlots`, `buildEmptyBracket`, `assignToSlot`, `validateBracket`, `saveGenericBracket` |
| `components/creator/BracketEditor.tsx` | 3 | Passo 4 — chave visual clicável |
| `lib/championship/groupStage.ts` | 4 | `rankQualifiers` com N grupos, N classificados, melhores terceiros |
| `components/admin/PhasePointsEditor.tsx` | 4 | Seção de pontuação no Campeonato Admin |

Modificados: `components/ChampionshipCreator.tsx` (passos 3 e 4), `components/ChampionshipAdmin.tsx` (aba Pontuação), `lib/resenhaOpenService.ts` (`saveBracket` delega para `saveGenericBracket`).

---

# FASE 2 — Rodadas, semeadura e inscrições genéricas

### Task 7: Derivação e criação de rodadas

**Files:**
- Create: `lib/championship/rounds.ts`
- Test: `__tests__/championshipRounds.test.ts`

**Interfaces:**
- Consumes: `FormatConfig`, `BracketSize`, `BRACKET_SLOTS`, `validateAgainstParticipants` de `formatConfig.ts`
- Produces:
  - `interface RoundDef { phase: string; roundNumber: number; name: string; matchNumbers: number[] }`
  - `const ROUND_PHASES: Record<BracketSize, { phase: string; name: string }>`
  - `function deriveRounds(config: FormatConfig, participantCount: number): RoundDef[]`
  - `async function createRounds(params: CreateRoundsParams): Promise<Map<string, string>>` — devolve `phase → round_id`
  - `interface CreateRoundsParams { championshipId: string; classe: string; config: FormatConfig; participantCount: number; startDate: string; endDate: string }`

O vocabulário de `phase` é a parte crítica: `resolve_championship_final_phases` procura a final por `phase IN ('final','Final')` e exclui qualquer coisa com `semi`. Emitir `'final'` e `'semifinal'` exatamente assim é o que mantém a apuração de pontos funcionando.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { ROUND_PHASES, deriveRounds } from '../lib/championship/rounds';
import type { GroupKnockoutConfig, KnockoutConfig, RoundRobinConfig } from '../lib/championship/formatConfig';

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16', ...over,
});
const pontos = (over: Partial<RoundRobinConfig> = {}): RoundRobinConfig => ({
    format: 'pontos-corridos', homeAndAway: false, finalPhase: null, ...over,
});
const grupos = (over: Partial<GroupKnockoutConfig> = {}): GroupKnockoutConfig => ({
    format: 'grupo-mata-mata', homeAndAway: false, groupCount: 4, membersPerGroup: 4,
    qualifiersPerGroup: 2, bestThirdPlaces: 0, seeded: true, ...over,
});

describe('championship/rounds', () => {
    describe('ROUND_PHASES', () => {
        it('usa o vocabulário reconhecido por resolve_championship_final_phases', () => {
            expect(ROUND_PHASES.semifinal.phase).toBe('semifinal');
            expect(ROUND_PHASES.semifinal.phase).toContain('semi');
            expect(ROUND_PHASES.quarterfinal.phase).toBe('quartas');
            expect(ROUND_PHASES.round_of_16.phase).toBe('oitavas');
            expect(ROUND_PHASES.round_of_32.phase).toBe('16avos');
        });
    });

    describe('deriveRounds — mata-mata', () => {
        it('gera oitavas até final para quadro de 16', () => {
            const rounds = deriveRounds(mataMata(), 16);
            expect(rounds.map(r => r.phase)).toEqual(['oitavas', 'quartas', 'semifinal', 'final']);
            expect(rounds.map(r => r.roundNumber)).toEqual([1, 2, 3, 4]);
            expect(rounds[0].matchNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
            expect(rounds[1].matchNumbers).toEqual([9, 10, 11, 12]);
            expect(rounds[2].matchNumbers).toEqual([13, 14]);
            expect(rounds[3].matchNumbers).toEqual([15]);
        });

        it('emite a final com phase e name exatos que o SQL procura', () => {
            const final = deriveRounds(mataMata(), 16).at(-1)!;
            expect(final.phase).toBe('final');
            expect(final.name).toBe('Final');
        });

        it('prefixa qualificatórias e desloca a numeração dos jogos', () => {
            const config = mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } });
            const rounds = deriveRounds(config, 20);
            expect(rounds.map(r => r.phase)).toEqual(['qualify', 'oitavas', 'quartas', 'semifinal', 'final']);
            expect(rounds[0].matchNumbers).toEqual([1, 2, 3, 4]);
            expect(rounds[1].matchNumbers).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
        });

        it('gera só a final para quadro de 2', () => {
            const rounds = deriveRounds(mataMata({ mainDrawStartPhase: 'semifinal' }), 4);
            expect(rounds.map(r => r.phase)).toEqual(['semifinal', 'final']);
        });
    });

    describe('deriveRounds — pontos corridos', () => {
        it('gera um turno para 6 participantes sem ida e volta', () => {
            const rounds = deriveRounds(pontos(), 6);
            expect(rounds).toHaveLength(1);
            expect(rounds[0].phase).toBe('classificatoria');
            // 6 participantes = 15 confrontos
            expect(rounds[0].matchNumbers).toHaveLength(15);
        });

        it('dobra os confrontos com ida e volta', () => {
            const rounds = deriveRounds(pontos({ homeAndAway: true }), 6);
            expect(rounds).toHaveLength(2);
            expect(rounds[0].matchNumbers).toHaveLength(15);
            expect(rounds[1].matchNumbers).toHaveLength(15);
            expect(rounds[1].phase).toBe('classificatoria-volta');
        });

        it('acrescenta a fase final quando configurada', () => {
            const rounds = deriveRounds(pontos({ finalPhase: { startPhase: 'quarterfinal' } }), 8);
            expect(rounds.map(r => r.phase)).toEqual(['classificatoria', 'quartas', 'semifinal', 'final']);
        });
    });

    describe('deriveRounds — grupos + mata-mata', () => {
        it('gera uma rodada de grupos e o mata-mata dos classificados', () => {
            const rounds = deriveRounds(grupos(), 16);
            // 4 grupos de 4 = 6 confrontos por grupo = 24; 8 classificados = quartas/semi/final
            expect(rounds.map(r => r.phase)).toEqual(['grupos', 'quartas', 'semifinal', 'final']);
            expect(rounds[0].matchNumbers).toHaveLength(24);
            expect(rounds[1].matchNumbers).toHaveLength(4);
        });

        it('gera turno e returno nos grupos com ida e volta', () => {
            const rounds = deriveRounds(grupos({ homeAndAway: true }), 16);
            expect(rounds[0].phase).toBe('grupos');
            expect(rounds[1].phase).toBe('grupos-volta');
            expect(rounds[1].matchNumbers).toHaveLength(24);
        });

        it('considera melhores terceiros no tamanho do mata-mata', () => {
            const config = grupos({ groupCount: 6, membersPerGroup: 4, qualifiersPerGroup: 2, bestThirdPlaces: 4 });
            const rounds = deriveRounds(config, 24);
            // 12 + 4 = 16 classificados
            expect(rounds.map(r => r.phase)).toEqual(['grupos', 'oitavas', 'quartas', 'semifinal', 'final']);
        });
    });

    describe('deriveRounds — validação', () => {
        it('recusa configuração incompatível com o número de inscritos', () => {
            expect(() => deriveRounds(mataMata(), 13)).toThrow(/13/);
        });
    });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run __tests__/championshipRounds.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/championship/rounds"`

- [ ] **Step 3: Implementar**

```ts
// lib/championship/rounds.ts
import { supabase } from '../supabase';
import { BRACKET_SLOTS, validateAgainstParticipants, type BracketSize, type FormatConfig } from './formatConfig';

export interface RoundDef {
    phase: string;
    roundNumber: number;
    name: string;
    matchNumbers: number[];
}

/**
 * Vocabulário de `championship_rounds.phase`.
 * resolve_championship_final_phases procura a final por phase IN ('final','Final')
 * ou name = 'Final', e exclui qualquer phase contendo 'semi'. Mudar estes valores
 * quebra a apuração de pontos silenciosamente.
 */
export const ROUND_PHASES: Record<BracketSize, { phase: string; name: string }> = {
    round_of_32: { phase: '16avos', name: '16 avos de Final' },
    round_of_16: { phase: 'oitavas', name: 'Oitavas de Final' },
    quarterfinal: { phase: 'quartas', name: 'Quartas de Final' },
    semifinal: { phase: 'semifinal', name: 'Semifinais' },
};

const FINAL_ROUND = { phase: 'final', name: 'Final' };

/** Fases do mata-mata a partir de um tamanho de quadro, até a final. */
const knockoutChain = (start: BracketSize): { phase: string; name: string }[] => {
    const order: BracketSize[] = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal'];
    const from = order.indexOf(start);
    return [...order.slice(from).map(size => ROUND_PHASES[size]), FINAL_ROUND];
};

/** Numera sequencialmente os jogos de cada fase a partir de `startAt`. */
const numberRounds = (
    defs: { phase: string; name: string; matchCount: number }[],
    startAt = 1,
    firstRoundNumber = 1
): RoundDef[] => {
    let n = startAt;
    return defs.map((def, i) => {
        const matchNumbers = Array.from({ length: def.matchCount }, () => n++);
        return { phase: def.phase, name: def.name, roundNumber: firstRoundNumber + i, matchNumbers };
    });
};

const roundRobinMatchCount = (participants: number) => (participants * (participants - 1)) / 2;

export function deriveRounds(config: FormatConfig, participantCount: number): RoundDef[] {
    const check = validateAgainstParticipants(config, participantCount);
    if (!check.ok) throw new Error(check.errors.join(' '));

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        const defs: { phase: string; name: string; matchCount: number }[] = [];

        if (config.qualifying) {
            defs.push({ phase: 'qualify', name: 'Qualificatórias', matchCount: config.qualifying.matchCount });
        }

        let remaining = slots;
        for (const link of knockoutChain(config.mainDrawStartPhase)) {
            defs.push({ ...link, matchCount: remaining / 2 });
            remaining /= 2;
        }

        return numberRounds(defs);
    }

    if (config.format === 'pontos-corridos') {
        const perTurn = roundRobinMatchCount(participantCount);
        const defs: { phase: string; name: string; matchCount: number }[] = [
            { phase: 'classificatoria', name: 'Fase Classificatória', matchCount: perTurn },
        ];
        if (config.homeAndAway) {
            defs.push({ phase: 'classificatoria-volta', name: 'Returno', matchCount: perTurn });
        }
        if (config.finalPhase) {
            let remaining = BRACKET_SLOTS[config.finalPhase.startPhase];
            for (const link of knockoutChain(config.finalPhase.startPhase)) {
                defs.push({ ...link, matchCount: remaining / 2 });
                remaining /= 2;
            }
        }
        return numberRounds(defs);
    }

    const perGroup = roundRobinMatchCount(config.membersPerGroup) * config.groupCount;
    const defs: { phase: string; name: string; matchCount: number }[] = [
        { phase: 'grupos', name: 'Fase de Grupos', matchCount: perGroup },
    ];
    if (config.homeAndAway) {
        defs.push({ phase: 'grupos-volta', name: 'Fase de Grupos — Returno', matchCount: perGroup });
    }

    const qualifiers = config.qualifiersPerGroup * config.groupCount + config.bestThirdPlaces;
    let remaining = qualifiers;
    const startSize = (Object.keys(BRACKET_SLOTS) as BracketSize[]).find(k => BRACKET_SLOTS[k] === qualifiers);
    if (startSize) {
        for (const link of knockoutChain(startSize)) {
            defs.push({ ...link, matchCount: remaining / 2 });
            remaining /= 2;
        }
    } else {
        // qualifiers === 2 → só a final
        defs.push({ ...FINAL_ROUND, matchCount: 1 });
    }

    return numberRounds(defs);
}

export interface CreateRoundsParams {
    championshipId: string;
    classe: string;
    config: FormatConfig;
    participantCount: number;
    startDate: string;
    endDate: string;
}

/**
 * Persiste as rodadas da classe. Idempotente: se a classe já tem rodadas,
 * devolve o mapa existente sem inserir. Recusa campeonatos do modelo antigo,
 * cujas rodadas têm class nulo e são compartilhadas entre classes.
 */
export async function createRounds(params: CreateRoundsParams): Promise<Map<string, string>> {
    const { data: legacy, error: legacyError } = await supabase
        .from('championship_rounds')
        .select('id')
        .eq('championship_id', params.championshipId)
        .is('class', null)
        .limit(1);

    if (legacyError) throw new Error(`Erro ao verificar rodadas: ${legacyError.message}`);
    if (legacy && legacy.length > 0) {
        throw new Error(
            'Este campeonato foi criado no modelo antigo, em que as classes compartilham rodadas. ' +
            'Crie um campeonato novo pelo Criador para usar rodadas por classe.'
        );
    }

    const { data: existing, error: existingError } = await supabase
        .from('championship_rounds')
        .select('id, phase')
        .eq('championship_id', params.championshipId)
        .eq('class', params.classe);

    if (existingError) throw new Error(`Erro ao verificar rodadas: ${existingError.message}`);
    if (existing && existing.length > 0) {
        return new Map(existing.map((r: any) => [r.phase, r.id]));
    }

    const defs = deriveRounds(params.config, params.participantCount);
    const rows = defs.map(def => ({
        championship_id: params.championshipId,
        class: params.classe,
        round_number: def.roundNumber,
        name: def.name,
        phase: def.phase,
        start_date: params.startDate,
        end_date: params.endDate,
        status: 'pending',
    }));

    const { data, error } = await supabase
        .from('championship_rounds')
        .insert(rows)
        .select('id, phase');

    if (error || !data) throw new Error(`Erro ao criar rodadas: ${error?.message}`);
    return new Map(data.map((r: any) => [r.phase, r.id]));
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx vitest run __tests__/championshipRounds.test.ts`
Expected: PASS

- [ ] **Step 5: Verificar e commitar**

```bash
npx tsc --noEmit && npm run lint
git add lib/championship/rounds.ts __tests__/championshipRounds.test.ts
git commit -m "feat(championship): derivacao e criacao de rodadas por formato e classe"
```

---

### Task 8: Semeadura de cabeças de chave

**Files:**
- Create: `lib/championship/seeding.ts`
- Test: `__tests__/championshipSeeding.test.ts`

**Interfaces:**
- Consumes: `fetchRanking` de `lib/rankingService.ts` (assinatura `fetchRanking(categoryFilter?: string, forceRefresh?: boolean): Promise<PlayerStats[]>`)
- Produces:
  - `interface SeedCandidate { registrationId: string; userId: string | null; name: string }`
  - `function pickSeedsByRanking(candidates: SeedCandidate[], rankedUserIds: string[], count: number): string[]` — puro
  - `async function applySeeds(championshipId: string, classe: string, registrationIds: string[]): Promise<void>`
  - `async function suggestSeedsFromRanking(candidates: SeedCandidate[], classe: string, count: number): Promise<string[]>`

`pickSeedsByRanking` é puro para poder testar a regra sem rede: percorre o ranking em ordem e escolhe os inscritos correspondentes; convidados e alunos (sem `userId`) nunca entram por ranking, só manualmente.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { applySeeds, pickSeedsByRanking, type SeedCandidate } from '../lib/championship/seeding';

const cand = (id: string, userId: string | null, name: string): SeedCandidate => ({
    registrationId: id, userId, name,
});

function makeChain(result: any = { data: null, error: null }) {
    const chain: Record<string, any> = {};
    for (const m of ['select', 'eq', 'in', 'update']) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: any) => Promise.resolve(result).then(resolve);
    return chain;
}

describe('championship/seeding', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('pickSeedsByRanking', () => {
        const candidates = [
            cand('r1', 'u1', 'Thieslley'),
            cand('r2', 'u2', 'Diego'),
            cand('r3', null, 'Convidado'),
            cand('r4', 'u4', 'Daniel'),
        ];

        it('escolhe na ordem do ranking', () => {
            expect(pickSeedsByRanking(candidates, ['u4', 'u1', 'u2'], 2)).toEqual(['r4', 'r1']);
        });

        it('ignora quem está no ranking mas não está inscrito', () => {
            expect(pickSeedsByRanking(candidates, ['u9', 'u2'], 1)).toEqual(['r2']);
        });

        it('nunca semeia participante sem userId (convidado ou aluno)', () => {
            const result = pickSeedsByRanking(candidates, ['u1', 'u2', 'u4'], 4);
            expect(result).not.toContain('r3');
            expect(result).toHaveLength(3);
        });

        it('devolve lista vazia quando count é zero', () => {
            expect(pickSeedsByRanking(candidates, ['u1'], 0)).toEqual([]);
        });

        it('não repete inscrito quando o ranking traz o mesmo usuário duas vezes', () => {
            expect(pickSeedsByRanking(candidates, ['u1', 'u1', 'u2'], 3)).toEqual(['r1', 'r2']);
        });
    });

    describe('applySeeds', () => {
        it('marca os escolhidos e desmarca o resto da classe', async () => {
            const clearChain = makeChain();
            const setChain = makeChain();
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? clearChain : setChain));

            await applySeeds('champ-1', '5ª Classe', ['r1', 'r2']);

            expect(clearChain.update).toHaveBeenCalledWith({ cabeca_de_chave: false });
            expect(setChain.update).toHaveBeenCalledWith({ cabeca_de_chave: true });
            expect(setChain.in).toHaveBeenCalledWith('id', ['r1', 'r2']);
        });

        it('apenas limpa quando a lista vem vazia', async () => {
            const clearChain = makeChain();
            supabaseMock.from.mockReturnValue(clearChain);

            await applySeeds('champ-1', '5ª Classe', []);

            expect(clearChain.update).toHaveBeenCalledWith({ cabeca_de_chave: false });
            expect(supabaseMock.from).toHaveBeenCalledTimes(1);
        });
    });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run __tests__/championshipSeeding.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar**

```ts
// lib/championship/seeding.ts
import { supabase } from '../supabase';
import { fetchRanking } from '../rankingService';

export interface SeedCandidate {
    registrationId: string;
    userId: string | null;
    name: string;
}

/**
 * Escolhe até `count` inscritos seguindo a ordem do ranking.
 * Participantes sem userId (convidados e alunos) não têm posição no ranking
 * e só podem ser marcados manualmente.
 */
export function pickSeedsByRanking(
    candidates: SeedCandidate[],
    rankedUserIds: string[],
    count: number
): string[] {
    if (count <= 0) return [];

    const byUserId = new Map<string, string>();
    for (const c of candidates) {
        if (c.userId && !byUserId.has(c.userId)) byUserId.set(c.userId, c.registrationId);
    }

    const seeds: string[] = [];
    const used = new Set<string>();
    for (const userId of rankedUserIds) {
        if (seeds.length >= count) break;
        const registrationId = byUserId.get(userId);
        if (!registrationId || used.has(registrationId)) continue;
        seeds.push(registrationId);
        used.add(registrationId);
    }
    return seeds;
}

export async function suggestSeedsFromRanking(
    candidates: SeedCandidate[],
    classe: string,
    count: number
): Promise<string[]> {
    const ranking = await fetchRanking(classe);
    return pickSeedsByRanking(candidates, ranking.map(p => p.id), count);
}

/** Substitui o conjunto de cabeças da classe pelos ids informados. */
export async function applySeeds(
    championshipId: string,
    classe: string,
    registrationIds: string[]
): Promise<void> {
    const { error: clearError } = await supabase
        .from('championship_registrations')
        .update({ cabeca_de_chave: false })
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (clearError) throw new Error(`Erro ao limpar cabeças de chave: ${clearError.message}`);
    if (registrationIds.length === 0) return;

    const { error } = await supabase
        .from('championship_registrations')
        .update({ cabeca_de_chave: true })
        .in('id', registrationIds);

    if (error) throw new Error(`Erro ao marcar cabeças de chave: ${error.message}`);
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx vitest run __tests__/championshipSeeding.test.ts`
Expected: PASS — 7 testes

- [ ] **Step 5: Verificar e commitar**

```bash
npx tsc --noEmit && npm run lint
git add lib/championship/seeding.ts __tests__/championshipSeeding.test.ts
git commit -m "feat(championship): semeadura de cabecas manual e por ranking"
```

---

### Task 9: Passo 3 — inscrições genéricas

**Files:**
- Create: `lib/championship/registration.ts`
- Create: `components/creator/CreatorRegistration.tsx`
- Modify: `components/ChampionshipCreator.tsx` — substituir o bloco `{step === 'registering' && …}`

**Interfaces:**
- Consumes: `registerSocio`, `registerGuest`, `removeRegistration`, `fetchRegistrations` de `resenhaOpenService.ts`; `suggestSeedsFromRanking`, `applySeeds`, `SeedCandidate` de `seeding.ts`; `createRounds` de `rounds.ts`; `CHAMPIONSHIP_CLASSES` de `setupValues.ts`
- Produces:
  - `lib/championship/registration.ts`: `async function registerAluno(params: { championshipId, studentId, classe }): Promise<string>`; `async function fetchActiveStudents(): Promise<{ id: string; name: string }[]>`
  - `components/creator/CreatorRegistration.tsx`: `const CreatorRegistration: React.FC<Props>` com
    `Props = { championshipId, classes, config, allowGuests, allowStudents, onAllowGuestsChange, onAllowStudentsChange, onRoundsCreated, startDate, endDate }`

**Comportamento:**

1. Seletor de classe entre `classes` (as escolhidas no passo 1). A lista de inscritos e a contagem são por classe.
2. Três abas de origem, condicionadas aos toggles: **Sócio** (busca em `profiles` com `MEMBER_ROLES`), **Convidado** (nome, cidade, idade — campos já existentes em `registerGuest`), **Aluno** (busca em `non_socio_students` ativos; a classe vem do seletor, decisão D7 da spec).
3. Bloco de cabeças de chave com duas vias: botão "Puxar do ranking" com campo numérico `N` chamando `suggestSeedsFromRanking`, e alternância manual por inscrito. Ambos escrevem no mesmo estado local `seedIds`; `applySeeds` só é chamado ao fechar.
4. Botão "Fechar inscrições e gerar rodadas": chama `validateAgainstParticipants` para a classe corrente; em erro, exibe as mensagens e não grava. Em sucesso, chama `applySeeds` e `createRounds`, e dispara `onRoundsCreated(classe, phaseToRoundId)`.

**Estrutura visual:** cartões `bg-white rounded-2xl border border-stone-100 p-5`, seguindo `CreatorSetup.tsx`. Toggles reusam a mesma marcação do `Toggle` de `CreatorFormat.tsx` — extrair esse `Toggle` para `components/creator/Toggle.tsx` e importar nos dois, em vez de duplicar.

- [ ] **Step 1: Extrair o Toggle compartilhado**

Criar `components/creator/Toggle.tsx` com o componente hoje em `CreatorFormat.tsx`, e trocar a definição local por um import nos dois arquivos.

- [ ] **Step 2: Implementar `lib/championship/registration.ts`**

```ts
import { supabase } from '../supabase';

export interface StudentOption { id: string; name: string }

export async function fetchActiveStudents(): Promise<StudentOption[]> {
    const { data, error } = await supabase
        .from('non_socio_students')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

    if (error) throw new Error(`Erro ao buscar alunos: ${error.message}`);
    return (data ?? []) as StudentOption[];
}

export async function registerAluno(params: {
    championshipId: string;
    studentId: string;
    classe: string;
}): Promise<string> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .insert({
            championship_id: params.championshipId,
            participant_type: 'aluno',
            student_id: params.studentId,
            class: params.classe,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao inscrever aluno: ${error?.message}`);
    return data.id;
}
```

- [ ] **Step 3: Implementar `CreatorRegistration.tsx`** conforme o comportamento acima.

- [ ] **Step 4: Ligar no `ChampionshipCreator.tsx`**

O passo `registering` passa a renderizar `CreatorRegistration` quando o campeonato veio do fluxo novo (há `setupValues.classes`), e mantém o bloco atual do Resenha quando o campeonato foi retomado pelo seletor de existentes. A distinção é o estado `setupValues.classes.length > 0`.

**Remover o desvio Resenha da criação.** A Fase 1 fazia o passo `format` chamar `createResenhaOpenRounds` quando o formato era mata-mata numa única classe 4ª/5ª, porque não havia geração genérica. Com `createRounds` disponível isso vira um bug: aquela função gera as rodadas fixas da classe (16 ou 20 atletas) e **ignora o `format_config`**, além de deixar `class` nulo. O `onConfirm` passa a apenas criar o campeonato e ir para `registering`; as rodadas nascem ao fechar as inscrições, como manda a decisão D2. O passo `created` fica órfão e sai junto.

- [ ] **Step 5: Verificar**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```
Expected: tsc limpo, só o warning pré-existente, todos os testes passando.

- [ ] **Step 6: Commitar**

```bash
git add lib/championship/registration.ts components/creator/ components/ChampionshipCreator.tsx
git commit -m "feat(creator): inscricoes genericas com alunos e cabecas por ranking"
```

---

### Fase 2 — fechamento

- [ ] **Verificar no navegador:** criar um mata-mata de 4 vagas numa classe, inscrever 4 sócios, puxar 2 cabeças do ranking, fechar inscrições, e confirmar no banco que as rodadas nasceram com `class` preenchido:

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select c.name, r.class, r.round_number, r.phase from championship_rounds r join championships c on c.id=r.championship_id where r.class is not null order by c.created_at desc, r.round_number;"}'
```

- [ ] **Commit da fase:** `git commit --allow-empty -m "chore: fecha Fase 2 do Criador de Campeonatos"`

---

# FASE 3 — Montagem de chave

### Task 10: Posicionamento de cabeças e chave vazia

**Files:**
- Create: `lib/championship/bracket.ts`
- Test: `__tests__/championshipBracket.test.ts`

**Interfaces:**
- Consumes: `FormatConfig`, `BRACKET_SLOTS` de `formatConfig.ts`; `RoundDef`, `deriveRounds` de `rounds.ts`
- Produces:
  - `interface BracketSlot { matchNumber: number; phase: string; a: string | null; b: string | null; aSourceMatch?: number; bSourceMatch?: number }`
  - `function seedSlots(bracketSize: number): number[]` — índice i (0-based) = número do cabeça que ocupa a vaga i+1
  - `function seedPositionFor(bracketSize: number, seedNumber: number): number`
  - `function buildEmptyBracket(config: FormatConfig, participantCount: number): BracketSlot[]`
  - `function assignToSlot(bracket: BracketSlot[], matchNumber: number, side: 'a' | 'b', registrationId: string | null): BracketSlot[]`
  - `function validateBracket(bracket: BracketSlot[], seedIds: string[]): { ok: boolean; errors: string[]; warnings: string[] }`

`seedSlots` implementa a distribuição padrão do tênis: cabeça 1 no topo, cabeça 2 na base, 3 e 4 nos quartos opostos, e assim por diante. Para quadro de 8 a ordem de vagas é `[1, 8, 5, 4, 3, 6, 7, 2]`, o que põe 1 contra 8 na primeira rodada e 1 contra 2 só na final.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import {
    assignToSlot, buildEmptyBracket, seedPositionFor, seedSlots, validateBracket,
} from '../lib/championship/bracket';
import type { KnockoutConfig } from '../lib/championship/formatConfig';

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16', ...over,
});

describe('championship/bracket', () => {
    describe('seedSlots', () => {
        it('distribui 8 vagas no padrão do tênis', () => {
            expect(seedSlots(8)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
        });

        it('põe cabeça 1 na primeira vaga e cabeça 2 na última', () => {
            for (const size of [4, 8, 16, 32]) {
                const slots = seedSlots(size);
                expect(slots[0]).toBe(1);
                expect(slots[size - 1]).toBe(2);
            }
        });

        it('gera uma permutação completa sem repetição', () => {
            const slots = seedSlots(16);
            expect([...slots].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
        });
    });

    describe('seedPositionFor', () => {
        it('mantém cabeças 1 e 2 em metades opostas', () => {
            expect(seedPositionFor(16, 1)).toBe(1);
            expect(seedPositionFor(16, 2)).toBe(16);
        });

        it('mantém cabeças 3 e 4 em quartos opostos aos dois primeiros', () => {
            const p3 = seedPositionFor(8, 3);
            const p4 = seedPositionFor(8, 4);
            expect(p3).toBe(5);
            expect(p4).toBe(4);
        });
    });

    describe('buildEmptyBracket', () => {
        it('gera as vagas do quadro de 16 com ligações de vencedor', () => {
            const bracket = buildEmptyBracket(mataMata(), 16);
            expect(bracket).toHaveLength(15);
            expect(bracket[0]).toMatchObject({ matchNumber: 1, phase: 'oitavas', a: null, b: null });

            const quartas1 = bracket.find(s => s.matchNumber === 9)!;
            expect(quartas1.phase).toBe('quartas');
            expect(quartas1.aSourceMatch).toBe(1);
            expect(quartas1.bSourceMatch).toBe(2);

            const final = bracket.find(s => s.matchNumber === 15)!;
            expect(final.phase).toBe('final');
            expect(final.aSourceMatch).toBe(13);
            expect(final.bSourceMatch).toBe(14);
        });

        it('liga vencedores das qualificatórias às vagas configuradas', () => {
            const config = mataMata({ qualifying: { matchCount: 2, entrySlots: [2, 15] } });
            const bracket = buildEmptyBracket(config, 18);
            const qualify = bracket.filter(s => s.phase === 'qualify');
            expect(qualify).toHaveLength(2);
            // vaga 2 do quadro cai no jogo 1 das oitavas, lado b
            const jogo1 = bracket.find(s => s.phase === 'oitavas' && s.matchNumber === 3)!;
            expect(jogo1.bSourceMatch).toBe(qualify[0].matchNumber);
        });
    });

    describe('assignToSlot', () => {
        it('preenche a vaga sem mutar o array original', () => {
            const bracket = buildEmptyBracket(mataMata(), 16);
            const next = assignToSlot(bracket, 1, 'a', 'r1');
            expect(next.find(s => s.matchNumber === 1)!.a).toBe('r1');
            expect(bracket.find(s => s.matchNumber === 1)!.a).toBeNull();
        });

        it('limpa a vaga quando recebe null', () => {
            const bracket = assignToSlot(buildEmptyBracket(mataMata(), 16), 1, 'a', 'r1');
            expect(assignToSlot(bracket, 1, 'a', null).find(s => s.matchNumber === 1)!.a).toBeNull();
        });
    });

    describe('validateBracket', () => {
        const cheia = () => {
            let b = buildEmptyBracket(mataMata({ mainDrawStartPhase: 'semifinal' }), 4);
            b = assignToSlot(b, 1, 'a', 'r1');
            b = assignToSlot(b, 1, 'b', 'r2');
            b = assignToSlot(b, 2, 'a', 'r3');
            b = assignToSlot(b, 2, 'b', 'r4');
            return b;
        };

        it('aceita chave completa e sem repetição', () => {
            const r = validateBracket(cheia(), []);
            expect(r.ok).toBe(true);
            expect(r.errors).toEqual([]);
        });

        it('recusa vaga vazia', () => {
            const b = assignToSlot(cheia(), 2, 'b', null);
            const r = validateBracket(b, []);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('vaga');
        });

        it('recusa atleta em duas vagas', () => {
            const b = assignToSlot(cheia(), 2, 'b', 'r1');
            const r = validateBracket(b, []);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('duas vagas');
        });

        it('avisa, sem bloquear, quando dois cabeças caem no mesmo lado', () => {
            const r = validateBracket(cheia(), ['r1', 'r2']);
            expect(r.ok).toBe(true);
            expect(r.warnings.join(' ')).toContain('mesmo lado');
        });

        it('não avisa quando os cabeças estão em lados opostos', () => {
            const r = validateBracket(cheia(), ['r1', 'r3']);
            expect(r.ok).toBe(true);
            expect(r.warnings).toEqual([]);
        });
    });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run __tests__/championshipBracket.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar `seedSlots`, `seedPositionFor`, `buildEmptyBracket`, `assignToSlot` e `validateBracket`**

```ts
// lib/championship/bracket.ts
import { BRACKET_SLOTS, type FormatConfig } from './formatConfig';
import { deriveRounds } from './rounds';

export interface BracketSlot {
    matchNumber: number;
    phase: string;
    a: string | null;
    b: string | null;
    aSourceMatch?: number;
    bSourceMatch?: number;
}

/**
 * Ordem padrão de cabeças no quadro. Para 8 vagas devolve [1,8,5,4,3,6,7,2]:
 * o cabeça 1 enfrenta o 8 na primeira rodada e só encontra o 2 na final.
 */
export function seedSlots(bracketSize: number): number[] {
    let slots = [1, 2];
    while (slots.length < bracketSize) {
        const sum = slots.length * 2 + 1;
        const next: number[] = [];
        // O espelhamento nas posições ímpares é o que mantém o cabeça 2 na base
        // do quadro. A duplicação simples (sempre push(p, sum-p)) o joga para o
        // meio, quebrando a convenção do tênis.
        slots.forEach((seed, index) => {
            if (index % 2 === 0) next.push(seed, sum - seed);
            else next.push(sum - seed, seed);
        });
        slots = next;
    }
    return slots;
}

export function seedPositionFor(bracketSize: number, seedNumber: number): number {
    return seedSlots(bracketSize).indexOf(seedNumber) + 1;
}

export function buildEmptyBracket(config: FormatConfig, participantCount: number): BracketSlot[] {
    const rounds = deriveRounds(config, participantCount);
    const knockoutRounds = rounds.filter(r => r.phase !== 'qualify');
    const qualifyRound = rounds.find(r => r.phase === 'qualify');

    const slots: BracketSlot[] = [];

    if (qualifyRound) {
        for (const n of qualifyRound.matchNumbers) {
            slots.push({ matchNumber: n, phase: 'qualify', a: null, b: null });
        }
    }

    knockoutRounds.forEach((round, roundIndex) => {
        const previous = knockoutRounds[roundIndex - 1];
        round.matchNumbers.forEach((n, i) => {
            const slot: BracketSlot = { matchNumber: n, phase: round.phase, a: null, b: null };
            if (previous) {
                slot.aSourceMatch = previous.matchNumbers[i * 2];
                slot.bSourceMatch = previous.matchNumbers[i * 2 + 1];
            }
            slots.push(slot);
        });
    });

    // Vencedores do qualify entram nas vagas configuradas do quadro principal.
    if (qualifyRound && config.format === 'mata-mata' && config.qualifying) {
        const firstRound = knockoutRounds[0];
        config.qualifying.entrySlots.forEach((position, i) => {
            const matchIndex = Math.floor((position - 1) / 2);
            const side: 'a' | 'b' = (position - 1) % 2 === 0 ? 'a' : 'b';
            const target = slots.find(s => s.matchNumber === firstRound.matchNumbers[matchIndex]);
            if (!target) return;
            if (side === 'a') target.aSourceMatch = qualifyRound.matchNumbers[i];
            else target.bSourceMatch = qualifyRound.matchNumbers[i];
        });
    }

    return slots;
}

export function assignToSlot(
    bracket: BracketSlot[],
    matchNumber: number,
    side: 'a' | 'b',
    registrationId: string | null
): BracketSlot[] {
    return bracket.map(slot =>
        slot.matchNumber === matchNumber ? { ...slot, [side]: registrationId } : slot
    );
}

export function validateBracket(
    bracket: BracketSlot[],
    seedIds: string[]
): { ok: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Só as vagas de entrada precisam de atleta: as demais recebem vencedores.
    const entrySlots = bracket.filter(s => !s.aSourceMatch || !s.bSourceMatch);

    for (const slot of entrySlots) {
        if (!slot.aSourceMatch && !slot.a) {
            errors.push(`Jogo ${slot.matchNumber}: vaga A está vazia.`);
        }
        if (!slot.bSourceMatch && !slot.b) {
            errors.push(`Jogo ${slot.matchNumber}: vaga B está vazia.`);
        }
    }

    const seen = new Map<string, number>();
    for (const slot of bracket) {
        for (const id of [slot.a, slot.b]) {
            if (!id) continue;
            if (seen.has(id)) {
                errors.push(`Um atleta está em duas vagas: jogos ${seen.get(id)} e ${slot.matchNumber}.`);
            } else {
                seen.set(id, slot.matchNumber);
            }
        }
    }

    // Cabeças no mesmo lado do quadro: aviso, não bloqueio.
    if (seedIds.length >= 2) {
        const entry = bracket.filter(s => s.phase !== 'qualify' && (!s.aSourceMatch || !s.bSourceMatch));
        const metade = Math.ceil(entry.length / 2);
        const ladoPorSeed = new Map<string, number>();
        entry.forEach((slot, i) => {
            const lado = i < metade ? 0 : 1;
            for (const id of [slot.a, slot.b]) {
                if (id && seedIds.includes(id)) ladoPorSeed.set(id, lado);
            }
        });
        const lados = [...ladoPorSeed.values()];
        if (lados.length >= 2 && lados.every(l => l === lados[0])) {
            warnings.push('Os cabeças de chave estão no mesmo lado do quadro e se enfrentariam antes da final.');
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx vitest run __tests__/championshipBracket.test.ts`
Expected: PASS

- [ ] **Step 5: Verificar e commitar**

```bash
npx tsc --noEmit && npm run lint
git add lib/championship/bracket.ts __tests__/championshipBracket.test.ts
git commit -m "feat(championship): montagem e validacao de chave"
```

---

### Task 11: Persistência genérica de chave

**Files:**
- Modify: `lib/championship/bracket.ts` — acrescentar `saveGenericBracket`
- Modify: `lib/resenhaOpenService.ts:264` — `saveBracket` passa a delegar
- Test: `__tests__/championshipBracket.test.ts` — acrescentar bloco

**Interfaces:**
- Produces: `async function saveGenericBracket(params: { championshipId: string; slots: BracketSlot[]; phaseToRoundId: Map<string, string>; registrationUserMap: Map<string, string | null> }): Promise<void>`

`saveBracket` do Resenha já faz exatamente isto; a única parte específica é derivar a fase de cada jogo via `buildPhaseMap(classe)`. Como `BracketSlot` já carrega `phase`, a generalização é direta e o Resenha passa a chamar a função nova, mantendo seu comportamento.

- [ ] **Step 1: Escrever o teste** cobrindo: insere todas as vagas numa chamada; faz o segundo passe de `update` só para as vagas com `aSourceMatch`/`bSourceMatch`; lança erro legível quando falta round para uma fase.

- [ ] **Step 2: Implementar `saveGenericBracket`** com a mesma estrutura de dois passes de `saveBracket`, lendo `slot.phase` em vez de `phaseMap.get(match_number)`.

- [ ] **Step 3: Fazer `saveBracket` delegar** — converte `DrawMatch[]` + `buildPhaseMap(classe)` em `BracketSlot[]` e chama `saveGenericBracket`. Os testes existentes de `resenhaOpenService` precisam continuar passando sem alteração.

- [ ] **Step 4: Verificar**

Run: `npx vitest run`
Expected: todos passando, incluindo os testes existentes do Resenha.

- [ ] **Step 5: Commitar**

```bash
git add lib/championship/bracket.ts lib/resenhaOpenService.ts __tests__/championshipBracket.test.ts
git commit -m "feat(championship): persistencia generica de chave, reutilizada pelo Resenha"
```

---

### Task 12: Passo 4 — editor visual de chave

**Files:**
- Create: `components/creator/BracketEditor.tsx`
- Modify: `components/ChampionshipCreator.tsx` — passo `drawing` para campeonatos do fluxo novo

**Interfaces:**
- Consumes: `BracketSlot`, `buildEmptyBracket`, `assignToSlot`, `validateBracket`, `seedPositionFor`, `saveGenericBracket` de `bracket.ts`
- Produces: `const BracketEditor: React.FC<Props>` com
  `Props = { config, participantCount, athletes: { registrationId, name, isSeed }[], phaseToRoundId, championshipId, registrationUserMap, onSaved }`

**Comportamento:**

1. Estado local `slots` iniciado por `buildEmptyBracket`. Duas ações no topo: **Sortear automaticamente** (posiciona cabeças por `seedPositionFor` e distribui o resto aleatoriamente) e **Limpar**.
2. Fases em colunas horizontais roláveis (`overflow-x: auto`), da esquerda para a direita: qualify, quadro principal até a final. Cada vaga é um botão.
3. Vaga vazia mostra "+ vaga livre" tracejado. Tocar abre uma lista dos inscritos ainda não alocados; escolher preenche via `assignToSlot`. Tocar numa vaga preenchida a libera.
4. Vagas com `aSourceMatch`/`bSourceMatch` são exibidas como "vencedor do jogo N", não editáveis.
5. Cabeças de chave em destaque (`border-saibro-500 bg-saibro-50`, com ★).
6. `validateBracket` roda a cada mudança: erros em vermelho bloqueiam o salvar; avisos em âmbar não bloqueiam.
7. Salvar chama `saveGenericBracket` e depois `onSaved()`.

**Acessibilidade:** cada vaga é `<button>` com `aria-label` descrevendo fase, número do jogo e ocupante ("Oitavas, jogo 3, vaga A, livre"). A rolagem horizontal fica num contêiner próprio para o corpo da página nunca rolar lateralmente.

- [ ] **Step 1: Implementar o componente** conforme acima.

- [ ] **Step 2: Ligar no `ChampionshipCreator.tsx`** — o passo `drawing` renderiza `BracketEditor` quando o campeonato veio do fluxo novo, e mantém o sorteio Resenha quando retomado pelo seletor de existentes.

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```

- [ ] **Step 4: Commitar**

```bash
git add components/creator/BracketEditor.tsx components/ChampionshipCreator.tsx
git commit -m "feat(creator): editor visual de chave com sorteio e montagem manual"
```

---

### Fase 3 — fechamento

- [ ] **Verificar no navegador:** num mata-mata de 4 vagas, montar a chave à mão, confirmar o aviso de cabeças no mesmo lado, corrigir, salvar, e checar as partidas no banco:

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select m.match_number, m.registration_a_id is not null as tem_a, m.player_a_source_match_id is not null as tem_origem, r.phase from matches m join championship_rounds r on r.id=m.round_id where r.class is not null order by m.match_number;"}'
```

- [ ] **Commit da fase:** `git commit --allow-empty -m "chore: fecha Fase 3 do Criador de Campeonatos"`

---

# FASE 4 — Grupos generalizados e pontuação

### Task 13: Classificação de grupos com N grupos e melhores terceiros

**Files:**
- Create: `lib/championship/groupStage.ts`
- Test: `__tests__/championshipGroupStage.test.ts`

**Interfaces:**
- Consumes: `calculateGroupStandings` de `lib/championshipUtils.ts`
- Produces:
  - `interface GroupStanding { registrationId: string; groupName: string; position: number; points: number; setDiff: number; gameDiff: number }`
  - `function rankQualifiers(standings: GroupStanding[], qualifiersPerGroup: number, bestThirdPlaces: number): GroupStanding[]`
  - `function bestThirds(standings: GroupStanding[], count: number): GroupStanding[]`

`buildGroupKnockoutBracketData` em `lib/groupKnockout.ts:115` é fixo em dois grupos (`groupName === 'A' | 'B'`) e dois classificados (`standings.slice(0, 2)`). Este módulo substitui essa regra; o `groupKnockout.ts` continua existindo para a exibição do chaveamento já montado.

- [ ] **Step 1: Escrever o teste** cobrindo: 4 grupos com 2 classificados devolve 8 na ordem grupo/posição; melhores terceiros ordenados por pontos e depois saldo de sets e games; empate resolvido de forma determinística; `bestThirdPlaces` maior que o número de grupos é truncado.

- [ ] **Step 2: Implementar `rankQualifiers` e `bestThirds`.**

- [ ] **Step 3: Rodar os testes.**

- [ ] **Step 4: Commitar**

```bash
git add lib/championship/groupStage.ts __tests__/championshipGroupStage.test.ts
git commit -m "feat(championship): classificacao de grupos com N grupos e melhores terceiros"
```

---

### Task 14: Editor de pontuação por fase no Campeonato Admin

**Files:**
- Create: `components/admin/PhasePointsEditor.tsx`
- Modify: `components/ChampionshipAdmin.tsx:156` — acrescentar `'points'` ao `activeTab` e a aba correspondente

**Interfaces:**
- Produces: `const PhasePointsEditor: React.FC` (sem props; lê e escreve `championship_phase_points` direto)

**Comportamento:**

1. Lista as linhas de `championship_phase_points` ordenadas por pontos decrescentes, com rótulo em português: champion "Campeão", finalist "Vice", semifinal "Semifinal", quarterfinal "Quartas", round_of_16 "Oitavas", round_of_32 "16 avos", qualifying "Qualificatória", participation "Participação".
2. Cada linha tem um campo numérico e salva no blur, com estado de "salvando" e mensagem de erro por linha.
3. Fases sem linha aparecem numa seção "Sem pontuação definida", explicando que valem **5 pontos** por padrão (`apply_championship_edition_points` cai em 5 quando `get_championship_phase_points` devolve NULL), com botão para criar a linha.
4. Um aviso no topo: mudanças afetam a apuração de campeonatos finalizados a partir da próxima execução de `finish_championship`, não retroativamente.

- [ ] **Step 1: Implementar o componente.**

- [ ] **Step 2: Acrescentar a aba** em `ChampionshipAdmin.tsx` — o tipo do `activeTab` (linha 156) ganha `'points'` e um `TabButton` "Pontuação" entra na barra da linha 641.

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```

- [ ] **Step 4: Commitar**

```bash
git add components/admin/PhasePointsEditor.tsx components/ChampionshipAdmin.tsx
git commit -m "feat(admin): visualizacao e edicao da pontuacao por fase"
```

---

### Fase 4 — fechamento

- [ ] **Verificar no navegador:** abrir Campeonato Admin → aba Pontuação, confirmar os 6 valores atuais (champion 125, finalist 64, semifinal 35, quarterfinal 16, round_of_16 8, participation 5) e que `round_of_32` e `qualifying` aparecem como sem pontuação definida.

- [ ] **Rodar a suíte completa e o build:**

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

- [ ] **Commit da fase:** `git commit --allow-empty -m "chore: fecha Fase 4 do Criador de Campeonatos"`

---

## Fora do escopo

- Sorteio novo para grupos+mata-mata: o `GroupDrawPage` existente segue em uso
- Backfill do Resenha Open 2026
- Alterações em `resenhaOpenDraw.ts`
- Remoção dos wizards órfãos `NewChampionship.tsx` e `AdminTournaments.tsx`
