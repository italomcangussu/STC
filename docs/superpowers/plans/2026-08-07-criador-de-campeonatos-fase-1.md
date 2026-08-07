# Criador de Campeonatos — Fase 1 (Criação genérica) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin crie um campeonato de qualquer formato pela interface, com a configuração do formato validada e persistida, e renomear o menu de "Sorteador Resenha Open" para "Criador de Campeonatos".

**Architecture:** O `AdminResenhaOpen.tsx` (1012 linhas) vira `ChampionshipCreator.tsx` e passa a orquestrar passos extraídos. Os dois primeiros passos (Básico e Formato) nascem genéricos como componentes próprios em `components/creator/`. A lógica de validação e persistência sai para `lib/championship/`, testável sem UI. Os passos existentes de inscrição, sorteio e chaveamento do Resenha permanecem intocados e continuam funcionando.

**Tech Stack:** React 19 + TypeScript, Vite, Tailwind v4, Supabase (Postgres 17.6), Vitest + Testing Library.

## Global Constraints

- Fases de rodada emitidas precisam ser reconhecidas por `resolve_championship_final_phases`: ele casa `phase ILIKE 'mata-mata-final%'`, `phase IN ('final','Final')`, `name = 'Final'`, e exclui `'%semi%'`. (Restrição R9 da spec.)
- Não alterar `resenhaOpenDraw.ts` nem os dados do campeonato "Resenha Open 2026" (`3383d2ba-787e-4206-b7aa-d7375c1c60a1`). Decisão D5.
- Rodadas do modelo antigo têm `class = NULL` e continuam válidas; nenhum backfill.
- Nenhum valor novo é semeado em `championship_phase_points`. Fase sem linha vale 5 pontos por `apply_championship_edition_points`. Decisão D6.
- Migrations vão para `supabase/migrations/` com prefixo `YYYYMMDDHHMMSS_`. Após aplicar, registrar a versão em `supabase_migrations.schema_migrations`.
- Testes ficam em `__tests__/<nome>.test.ts` e usam o padrão de mock de `__tests__/resenhaOpenService.test.ts` (`vi.hoisted` + `makeChain`).
- Rodar `npm run lint` e `npx tsc --noEmit` antes de cada commit. O projeto tem 1 warning pré-existente em `ResenhaOpenTournamentBoard.tsx:76`; nenhum warning novo é aceitável.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260807140000_championship_creator_schema.sql` | M1–M4 da spec numa migration coesa |
| `lib/championship/formatConfig.ts` | Tipos das 3 configurações + validação estrutural e contra inscritos |
| `lib/championship/creation.ts` | `slugify`, `ensureSeries`, `createChampionship` (idempotente) |
| `components/creator/CreatorSetup.tsx` | Passo 1 — nome, série, formato, datas, classes, pontuação avançada |
| `components/creator/CreatorFormat.tsx` | Passo 2 — opções específicas do formato escolhido |
| `components/ChampionshipCreator.tsx` | Renomeado de `AdminResenhaOpen.tsx`; orquestra os passos |
| `__tests__/formatConfig.test.ts` | Testes da validação |
| `__tests__/championshipCreation.test.ts` | Testes de `slugify`/`ensureSeries`/`createChampionship` |

Modificados: `App.tsx:27,229`, `components/Layout.tsx:128,256,281`, `lib/publicRoutes.ts:32`.

---

### Task 1: Migrations do schema

**Files:**
- Create: `supabase/migrations/20260807140000_championship_creator_schema.sql`

**Interfaces:**
- Consumes: nada
- Produces: coluna `championships.format_config jsonb`; coluna `championship_rounds.class text` com `UNIQUE (championship_id, class, round_number)`; `participant_type` aceitando `'aluno'`; coluna `championship_registrations.student_id uuid`; `final_phase` aceitando `'round_of_32'` e `'qualifying'`

- [ ] **Step 1: Escrever a migration**

```sql
-- Criador de Campeonatos — schema (M1–M4 da spec 2026-08-07)

-- M1: rodadas por classe. Sem backfill: rodadas antigas ficam com class NULL
-- e seguem válidas porque Postgres trata NULL como distinto em índice único.
ALTER TABLE public.championship_rounds
    ADD COLUMN IF NOT EXISTS class TEXT;

ALTER TABLE public.championship_rounds
    DROP CONSTRAINT IF EXISTS championship_rounds_championship_id_round_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_championship_rounds_champ_class_number
    ON public.championship_rounds (championship_id, class, round_number);

COMMENT ON COLUMN public.championship_rounds.class IS
    'Classe a que esta rodada pertence. NULL = campeonato do modelo antigo (pré-Criador), cujas classes compartilham rodadas.';

-- M2: alunos como participantes.
ALTER TABLE public.championship_registrations
    ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.non_socio_students(id);

ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS championship_registrations_participant_type_check;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT championship_registrations_participant_type_check
    CHECK (participant_type = ANY (ARRAY['socio'::text, 'guest'::text, 'aluno'::text]));

ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS valid_participant;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT valid_participant CHECK (
        (participant_type = 'socio' AND user_id IS NOT NULL)
     OR (participant_type = 'guest' AND guest_name IS NOT NULL)
     OR (participant_type = 'aluno' AND student_id IS NOT NULL)
    );

-- M3: vocabulário de fases. Nenhum ponto semeado: fase sem linha em
-- championship_phase_points vale 5 via apply_championship_edition_points.
ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS championship_registrations_final_phase_check;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT championship_registrations_final_phase_check
    CHECK (final_phase = ANY (ARRAY[
        'champion'::text, 'finalist'::text, 'semifinal'::text,
        'quarterfinal'::text, 'round_of_16'::text, 'round_of_32'::text,
        'qualifying'::text, 'participation'::text
    ]));

-- M4: configuração do formato.
ALTER TABLE public.championships
    ADD COLUMN IF NOT EXISTS format_config JSONB;

COMMENT ON COLUMN public.championships.format_config IS
    'Configuração do formato escolhida no Criador. Formato do objeto em lib/championship/formatConfig.ts.';
```

- [ ] **Step 2: Aplicar no banco**

```bash
set -a; . ./.env.local; set +a
python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/20260807140000_championship_creator_schema.sql').read()}))" > /tmp/mig.json
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/mig.json
```

Expected: `[]` (sem erro).

- [ ] **Step 3: Verificar que as quatro mudanças existem**

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select (select count(*) from information_schema.columns where table_name='"'"'championship_rounds'"'"' and column_name='"'"'class'"'"') as rounds_class, (select count(*) from information_schema.columns where table_name='"'"'championships'"'"' and column_name='"'"'format_config'"'"') as format_config, (select count(*) from information_schema.columns where table_name='"'"'championship_registrations'"'"' and column_name='"'"'student_id'"'"') as student_id, (select count(*) from pg_indexes where indexname='"'"'uidx_championship_rounds_champ_class_number'"'"') as idx;"}'
```

Expected: `[{"rounds_class":1,"format_config":1,"student_id":1,"idx":1}]`

- [ ] **Step 4: Confirmar que o Resenha Open 2026 segue intacto**

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select count(*) as rodadas, count(class) as com_classe from championship_rounds where championship_id='"'"'3383d2ba-787e-4206-b7aa-d7375c1c60a1'"'"';"}'
```

Expected: `[{"rodadas":5,"com_classe":0}]` — 5 rodadas, nenhuma com classe (D5 respeitado).

- [ ] **Step 5: Registrar a versão e commitar**

```bash
set -a; . ./.env.local; set +a
python3 -c "
import json
sql=open('supabase/migrations/20260807140000_championship_creator_schema.sql').read()
q=\"insert into supabase_migrations.schema_migrations (version,name,statements) values (\$v\$20260807140000\$v\$,\$v\$championship_creator_schema\$v\$,array[\$v\$\"+sql+\"\$v\$]) on conflict (version) do nothing;\"
print(json.dumps({'query':q}))" > /tmp/reg.json
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/reg.json
git add supabase/migrations/20260807140000_championship_creator_schema.sql
git commit -m "feat(db): schema do Criador de Campeonatos (rodadas por classe, alunos, format_config)"
```

---

### Task 2: Tipos e validação do formato

**Files:**
- Create: `lib/championship/formatConfig.ts`
- Test: `__tests__/formatConfig.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type ChampionshipFormat = 'mata-mata' | 'pontos-corridos' | 'grupo-mata-mata'`
  - `type BracketSize = 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal'`
  - `const BRACKET_SLOTS: Record<BracketSize, number>`
  - `interface GroupKnockoutConfig`, `RoundRobinConfig`, `KnockoutConfig`, união `FormatConfig`
  - `interface ValidationResult { ok: boolean; errors: string[] }`
  - `function validateFormatShape(config: FormatConfig): ValidationResult`
  - `function validateAgainstParticipants(config: FormatConfig, participantCount: number): ValidationResult`
  - `function defaultConfigFor(format: ChampionshipFormat): FormatConfig`

A separação em duas validações é deliberada: no passo de criação o número de inscritos ainda não existe (as inscrições vêm no passo 3), então só a consistência estrutural pode ser checada. `validateAgainstParticipants` é consumida na Fase 2, ao fechar as inscrições.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import {
    BRACKET_SLOTS,
    defaultConfigFor,
    validateAgainstParticipants,
    validateFormatShape,
    type GroupKnockoutConfig,
    type KnockoutConfig,
    type RoundRobinConfig,
} from '../lib/championship/formatConfig';

const grupos = (over: Partial<GroupKnockoutConfig> = {}): GroupKnockoutConfig => ({
    format: 'grupo-mata-mata',
    homeAndAway: false,
    groupCount: 4,
    membersPerGroup: 4,
    qualifiersPerGroup: 2,
    bestThirdPlaces: 0,
    seeded: true,
    ...over,
});

const mataMata = (over: Partial<KnockoutConfig> = {}): KnockoutConfig => ({
    format: 'mata-mata',
    seeded: true,
    qualifying: null,
    mainDrawStartPhase: 'round_of_16',
    ...over,
});

const pontosCorridos = (over: Partial<RoundRobinConfig> = {}): RoundRobinConfig => ({
    format: 'pontos-corridos',
    homeAndAway: false,
    finalPhase: null,
    ...over,
});

describe('formatConfig', () => {
    describe('BRACKET_SLOTS', () => {
        it('mapeia cada fase para o número de vagas', () => {
            expect(BRACKET_SLOTS).toEqual({
                round_of_32: 32,
                round_of_16: 16,
                quarterfinal: 8,
                semifinal: 4,
            });
        });
    });

    describe('defaultConfigFor', () => {
        it('devolve um padrão estruturalmente válido para cada formato', () => {
            for (const format of ['mata-mata', 'pontos-corridos', 'grupo-mata-mata'] as const) {
                const config = defaultConfigFor(format);
                expect(config.format).toBe(format);
                expect(validateFormatShape(config).ok).toBe(true);
            }
        });
    });

    describe('validateFormatShape — grupos + mata-mata', () => {
        it('aceita 4 grupos de 4 com 2 classificados', () => {
            expect(validateFormatShape(grupos())).toEqual({ ok: true, errors: [] });
        });

        it('recusa quando classificados + melhores terceiros não é potência de 2', () => {
            const r = validateFormatShape(grupos({ groupCount: 3, qualifiersPerGroup: 2 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('potência de 2');
        });

        it('aceita 6 grupos de 4 com 2 classificados e 4 melhores terceiros', () => {
            const r = validateFormatShape(grupos({ groupCount: 6, qualifiersPerGroup: 2, bestThirdPlaces: 4 }));
            expect(r).toEqual({ ok: true, errors: [] });
        });

        it('recusa melhores terceiros acima do número de grupos', () => {
            const r = validateFormatShape(grupos({ bestThirdPlaces: 5 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('melhores terceiros');
        });

        it('recusa classificar todo mundo do grupo', () => {
            const r = validateFormatShape(grupos({ qualifiersPerGroup: 4 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('classificados por grupo');
        });

        it('recusa melhores terceiros com grupos de 2', () => {
            const r = validateFormatShape(grupos({ membersPerGroup: 2, qualifiersPerGroup: 1, bestThirdPlaces: 2 }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('terceiro colocado');
        });
    });

    describe('validateFormatShape — mata-mata', () => {
        it('aceita quadro de 16 sem qualificatórias', () => {
            expect(validateFormatShape(mataMata())).toEqual({ ok: true, errors: [] });
        });

        it('aceita qualificatórias com vagas dentro do quadro', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } }));
            expect(r).toEqual({ ok: true, errors: [] });
        });

        it('recusa quantidade de vagas diferente do número de jogos', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('uma vaga para cada jogo');
        });

        it('recusa vaga fora do quadro principal', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 1, entrySlots: [99] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('fora do quadro');
        });

        it('recusa vagas repetidas', () => {
            const r = validateFormatShape(mataMata({ qualifying: { matchCount: 2, entrySlots: [3, 3] } }));
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('repetida');
        });
    });

    describe('validateFormatShape — pontos corridos', () => {
        it('aceita sem fase final', () => {
            expect(validateFormatShape(pontosCorridos())).toEqual({ ok: true, errors: [] });
        });

        it('aceita com fase final começando nas quartas', () => {
            const r = validateFormatShape(pontosCorridos({ finalPhase: { startPhase: 'quarterfinal' } }));
            expect(r).toEqual({ ok: true, errors: [] });
        });
    });

    describe('validateAgainstParticipants', () => {
        it('exige que grupos × membros bata com os inscritos', () => {
            const r = validateAgainstParticipants(grupos(), 15);
            expect(r.ok).toBe(false);
            expect(r.errors.join(' ')).toContain('16');
            expect(r.errors.join(' ')).toContain('15');
        });

        it('aceita quando grupos × membros bate', () => {
            expect(validateAgainstParticipants(grupos(), 16)).toEqual({ ok: true, errors: [] });
        });

        it('mata-mata sem qualificatórias exige exatamente as vagas do quadro', () => {
            expect(validateAgainstParticipants(mataMata(), 16)).toEqual({ ok: true, errors: [] });
            expect(validateAgainstParticipants(mataMata(), 14).ok).toBe(false);
        });

        it('mata-mata com qualificatórias soma entradas diretas e disputantes', () => {
            const config = mataMata({ qualifying: { matchCount: 4, entrySlots: [2, 7, 10, 15] } });
            // 16 vagas - 4 preenchidas pelo qualify = 12 diretos, + 8 disputando = 20
            expect(validateAgainstParticipants(config, 20)).toEqual({ ok: true, errors: [] });
            expect(validateAgainstParticipants(config, 16).ok).toBe(false);
        });

        it('pontos corridos exige ao menos 2 inscritos', () => {
            expect(validateAgainstParticipants(pontosCorridos(), 1).ok).toBe(false);
            expect(validateAgainstParticipants(pontosCorridos(), 2)).toEqual({ ok: true, errors: [] });
        });

        it('fase final não pode ser maior que o número de inscritos', () => {
            const config = pontosCorridos({ finalPhase: { startPhase: 'round_of_16' } });
            expect(validateAgainstParticipants(config, 10).ok).toBe(false);
            expect(validateAgainstParticipants(config, 16)).toEqual({ ok: true, errors: [] });
        });
    });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run __tests__/formatConfig.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/championship/formatConfig"`

- [ ] **Step 3: Implementar**

```ts
// lib/championship/formatConfig.ts

export type ChampionshipFormat = 'mata-mata' | 'pontos-corridos' | 'grupo-mata-mata';

/**
 * Tamanho do quadro principal, no vocabulário de `final_phase` do banco.
 * Não confundir com `championship_rounds.phase`, que usa nomes em português
 * ('oitavas', 'quartas', 'final') reconhecidos por resolve_championship_final_phases.
 * O mapeamento entre os dois vive em lib/championship/rounds.ts (Fase 2).
 */
export type BracketSize = 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal';

export const BRACKET_SLOTS: Record<BracketSize, number> = {
    round_of_32: 32,
    round_of_16: 16,
    quarterfinal: 8,
    semifinal: 4,
};

export interface GroupKnockoutConfig {
    format: 'grupo-mata-mata';
    homeAndAway: boolean;
    groupCount: number;
    membersPerGroup: number;
    qualifiersPerGroup: number;
    bestThirdPlaces: number;
    seeded: boolean;
}

export interface RoundRobinConfig {
    format: 'pontos-corridos';
    homeAndAway: boolean;
    finalPhase: { startPhase: BracketSize } | null;
}

export interface KnockoutConfig {
    format: 'mata-mata';
    seeded: boolean;
    /** entrySlots são posições (1-based) do quadro principal ocupadas pelos vencedores. */
    qualifying: { matchCount: number; entrySlots: number[] } | null;
    mainDrawStartPhase: BracketSize;
}

export type FormatConfig = GroupKnockoutConfig | RoundRobinConfig | KnockoutConfig;

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0;

const result = (errors: string[]): ValidationResult => ({ ok: errors.length === 0, errors });

export function defaultConfigFor(format: ChampionshipFormat): FormatConfig {
    if (format === 'grupo-mata-mata') {
        return {
            format: 'grupo-mata-mata',
            homeAndAway: false,
            groupCount: 4,
            membersPerGroup: 4,
            qualifiersPerGroup: 2,
            bestThirdPlaces: 0,
            seeded: true,
        };
    }
    if (format === 'pontos-corridos') {
        return { format: 'pontos-corridos', homeAndAway: false, finalPhase: null };
    }
    return { format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16' };
}

/**
 * Consistência interna da configuração, sem olhar inscritos.
 * Usada no passo de criação, quando ainda não há inscrições.
 */
export function validateFormatShape(config: FormatConfig): ValidationResult {
    const errors: string[] = [];

    if (config.format === 'grupo-mata-mata') {
        if (config.groupCount < 1) {
            errors.push('É preciso ao menos 1 grupo.');
        }
        if (config.membersPerGroup < 2) {
            errors.push('Cada grupo precisa de ao menos 2 participantes.');
        }
        if (config.qualifiersPerGroup < 1) {
            errors.push('É preciso ao menos 1 classificado por grupo.');
        }
        if (config.qualifiersPerGroup >= config.membersPerGroup) {
            errors.push(
                `Classificados por grupo (${config.qualifiersPerGroup}) precisa ser menor que os membros do grupo (${config.membersPerGroup}).`
            );
        }
        if (config.bestThirdPlaces < 0 || config.bestThirdPlaces > config.groupCount) {
            errors.push(
                `Vagas para melhores terceiros (${config.bestThirdPlaces}) não pode passar do número de grupos (${config.groupCount}).`
            );
        }
        if (config.bestThirdPlaces > 0 && config.membersPerGroup < 3) {
            errors.push('Não há terceiro colocado em grupos com menos de 3 participantes.');
        }
        const knockoutSlots = config.qualifiersPerGroup * config.groupCount + config.bestThirdPlaces;
        if (!isPowerOfTwo(knockoutSlots)) {
            errors.push(
                `O mata-mata receberia ${knockoutSlots} classificados; precisa ser potência de 2 (2, 4, 8, 16, 32).`
            );
        }
        return result(errors);
    }

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        if (config.qualifying) {
            const { matchCount, entrySlots } = config.qualifying;
            if (matchCount < 1) {
                errors.push('As qualificatórias precisam de ao menos 1 jogo.');
            }
            if (matchCount > slots) {
                errors.push(`As qualificatórias têm ${matchCount} jogos, mas o quadro principal só tem ${slots} vagas.`);
            }
            if (entrySlots.length !== matchCount) {
                errors.push(
                    `Defina uma vaga para cada jogo das qualificatórias: ${matchCount} jogos, ${entrySlots.length} vagas informadas.`
                );
            }
            const foraDoQuadro = entrySlots.filter(slot => slot < 1 || slot > slots);
            if (foraDoQuadro.length > 0) {
                errors.push(`Vaga fora do quadro principal: ${foraDoQuadro.join(', ')}. O quadro vai de 1 a ${slots}.`);
            }
            if (new Set(entrySlots).size !== entrySlots.length) {
                errors.push('Há vaga repetida nas qualificatórias; cada vencedor precisa de uma vaga própria.');
            }
        }
        return result(errors);
    }

    if (config.finalPhase && !(config.finalPhase.startPhase in BRACKET_SLOTS)) {
        errors.push('Fase inicial da fase final inválida.');
    }
    return result(errors);
}

/**
 * Confronta a configuração com o número real de inscritos da classe.
 * Usada na Fase 2, ao fechar as inscrições.
 */
export function validateAgainstParticipants(config: FormatConfig, participantCount: number): ValidationResult {
    const errors: string[] = [];

    if (config.format === 'grupo-mata-mata') {
        const vagas = config.groupCount * config.membersPerGroup;
        if (vagas !== participantCount) {
            errors.push(
                `${config.groupCount} grupos de ${config.membersPerGroup} exigem ${vagas} participantes, mas há ${participantCount} inscritos.`
            );
        }
        return result(errors);
    }

    if (config.format === 'mata-mata') {
        const slots = BRACKET_SLOTS[config.mainDrawStartPhase];
        const matchCount = config.qualifying?.matchCount ?? 0;
        const esperado = slots - matchCount + matchCount * 2;
        if (esperado !== participantCount) {
            errors.push(
                `Este formato comporta ${esperado} participantes (${slots - matchCount} diretos + ${matchCount * 2} nas qualificatórias), mas há ${participantCount} inscritos.`
            );
        }
        return result(errors);
    }

    if (participantCount < 2) {
        errors.push(`Pontos corridos exige ao menos 2 participantes; há ${participantCount}.`);
    }
    if (config.finalPhase) {
        const slots = BRACKET_SLOTS[config.finalPhase.startPhase];
        if (slots > participantCount) {
            errors.push(`A fase final começaria com ${slots} classificados, mas há apenas ${participantCount} inscritos.`);
        }
    }
    return result(errors);
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx vitest run __tests__/formatConfig.test.ts`
Expected: PASS — 21 testes.

- [ ] **Step 5: Verificar tipos e lint, depois commitar**

```bash
npx tsc --noEmit && npm run lint
git add lib/championship/formatConfig.ts __tests__/formatConfig.test.ts
git commit -m "feat(championship): tipos e validacao de configuracao de formato"
```

---

### Task 3: Criação genérica de campeonato

**Files:**
- Create: `lib/championship/creation.ts`
- Test: `__tests__/championshipCreation.test.ts`

**Interfaces:**
- Consumes: `FormatConfig`, `ChampionshipFormat` de `lib/championship/formatConfig.ts`
- Produces:
  - `function slugify(value: string): string`
  - `interface ScoringRules { ptsVictory, ptsDefeat, ptsWoVictory, ptsSet, ptsGame, ptsTechnicalDraw, finalRankingPts }` — todos `number`
  - `const DEFAULT_SCORING: ScoringRules`
  - `async function ensureSeries(name: string): Promise<{ id: string; name: string; slug: string }>`
  - `interface CreateChampionshipParams { name, format, formatConfig, startDate, endDate, seriesId, scoring? }`
  - `async function createChampionship(params: CreateChampionshipParams): Promise<string>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
    supabaseMock: { from: vi.fn() },
}));

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import { createChampionship, ensureSeries, slugify, DEFAULT_SCORING } from '../lib/championship/creation';
import { defaultConfigFor } from '../lib/championship/formatConfig';

function makeChain(resultByTerminal: Record<string, any> = {}) {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'insert']) {
        chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(() => Promise.resolve(resultByTerminal.limit ?? { data: [], error: null }));
    chain.single = vi.fn(() => Promise.resolve(resultByTerminal.single ?? { data: null, error: null }));
    chain.maybeSingle = vi.fn(() => Promise.resolve(resultByTerminal.maybeSingle ?? { data: null, error: null }));
    return chain;
}

describe('championship/creation', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('slugify', () => {
        it('remove acentos, espaços e maiúsculas', () => {
            expect(slugify('Circuito de Inverno')).toBe('circuito-de-inverno');
            expect(slugify('3º Torneio Ação!')).toBe('3o-torneio-acao');
        });
    });

    describe('ensureSeries', () => {
        it('devolve a série existente sem inserir', async () => {
            const chain = makeChain({ maybeSingle: { data: { id: 's1', name: 'Circuito de Inverno', slug: 'circuito-de-inverno' }, error: null } });
            supabaseMock.from.mockReturnValue(chain);

            const serie = await ensureSeries('Circuito de Inverno');

            expect(serie.id).toBe('s1');
            expect(chain.insert).not.toHaveBeenCalled();
        });

        it('cria a série quando não existe', async () => {
            const lookup = makeChain({ maybeSingle: { data: null, error: null } });
            const insert = makeChain({ single: { data: { id: 's2', name: 'Copa Nova', slug: 'copa-nova' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            const serie = await ensureSeries('Copa Nova');

            expect(serie.id).toBe('s2');
            expect(insert.insert).toHaveBeenCalledWith({ name: 'Copa Nova', slug: 'copa-nova' });
        });
    });

    describe('createChampionship', () => {
        const params = {
            name: 'Copa Nova 2026',
            format: 'mata-mata' as const,
            formatConfig: defaultConfigFor('mata-mata'),
            startDate: '2026-09-01',
            endDate: '2026-09-05',
            seriesId: 's1',
        };

        it('reutiliza campeonato equivalente em vez de duplicar', async () => {
            const existing = makeChain({ limit: { data: [{ id: 'champ-1' }], error: null } });
            supabaseMock.from.mockReturnValue(existing);

            await expect(createChampionship(params)).resolves.toBe('champ-1');
            expect(existing.insert).not.toHaveBeenCalled();
        });

        it('insere com edition_year derivado da data de início e pontuação padrão', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: { id: 'champ-2' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await expect(createChampionship(params)).resolves.toBe('champ-2');

            expect(insert.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Copa Nova 2026',
                    format: 'mata-mata',
                    status: 'draft',
                    start_date: '2026-09-01',
                    end_date: '2026-09-05',
                    series_id: 's1',
                    edition_year: 2026,
                    format_config: params.formatConfig,
                    pts_victory: DEFAULT_SCORING.ptsVictory,
                })
            );
        });

        it('usa .is para série nula em vez de .eq', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: { id: 'champ-3' }, error: null } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await createChampionship({ ...params, seriesId: null });

            expect(lookup.is).toHaveBeenCalledWith('series_id', null);
            expect(insert.insert).toHaveBeenCalledWith(
                expect.objectContaining({ series_id: null, edition_year: null })
            );
        });

        it('propaga erro do banco com mensagem legível', async () => {
            const lookup = makeChain({ limit: { data: [], error: null } });
            const insert = makeChain({ single: { data: null, error: { message: 'duplicate key' } } });
            let call = 0;
            supabaseMock.from.mockImplementation(() => (call++ === 0 ? lookup : insert));

            await expect(createChampionship(params)).rejects.toThrow('duplicate key');
        });
    });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npx vitest run __tests__/championshipCreation.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/championship/creation"`

- [ ] **Step 3: Implementar**

```ts
// lib/championship/creation.ts
import { supabase } from '../supabase';
import type { ChampionshipFormat, FormatConfig } from './formatConfig';

export interface ScoringRules {
    ptsVictory: number;
    ptsDefeat: number;
    ptsWoVictory: number;
    ptsSet: number;
    ptsGame: number;
    ptsTechnicalDraw: number;
    finalRankingPts: number;
}

/** Espelha os defaults das colunas de championships. */
export const DEFAULT_SCORING: ScoringRules = {
    ptsVictory: 3,
    ptsDefeat: 0,
    ptsWoVictory: 3,
    ptsSet: 0,
    ptsGame: 0,
    ptsTechnicalDraw: 0,
    finalRankingPts: 200,
};

export function slugify(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // remove diacríticos
        .replace(/º/g, 'o')
        .replace(/ª/g, 'a')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export interface ChampionshipSeriesRow {
    id: string;
    name: string;
    slug: string;
}

export async function ensureSeries(name: string): Promise<ChampionshipSeriesRow> {
    const trimmed = name.trim();
    const slug = slugify(trimmed);

    const { data: existing, error: lookupError } = await supabase
        .from('championship_series')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();

    if (lookupError) throw new Error(`Erro ao buscar série: ${lookupError.message}`);
    if (existing) return existing as ChampionshipSeriesRow;

    const { data, error } = await supabase
        .from('championship_series')
        .insert({ name: trimmed, slug })
        .select('id, name, slug')
        .single();

    if (error || !data) throw new Error(`Erro ao criar série: ${error?.message}`);
    return data as ChampionshipSeriesRow;
}

export interface CreateChampionshipParams {
    name: string;
    format: ChampionshipFormat;
    formatConfig: FormatConfig;
    startDate: string;
    endDate: string | null;
    seriesId: string | null;
    scoring?: Partial<ScoringRules>;
}

/**
 * Cria o campeonato como rascunho. Idempotente: se já existir um campeonato
 * aberto com a mesma série, nome e datas, devolve o id dele em vez de duplicar.
 */
export async function createChampionship(params: CreateChampionshipParams): Promise<string> {
    let lookup = supabase
        .from('championships')
        .select('id')
        .eq('name', params.name)
        .eq('start_date', params.startDate)
        .in('status', ['draft', 'active', 'ongoing']);

    lookup = params.seriesId
        ? lookup.eq('series_id', params.seriesId)
        : lookup.is('series_id', null);

    const { data: existing, error: lookupError } = await lookup
        .order('created_at', { ascending: false })
        .limit(1);

    if (lookupError) throw new Error(`Erro ao verificar campeonato existente: ${lookupError.message}`);
    if (existing && existing.length > 0) return existing[0].id;

    const scoring: ScoringRules = { ...DEFAULT_SCORING, ...params.scoring };

    // edition_year só faz sentido com série: o índice único
    // uidx_championship_series_edition_year é (series_id, edition_year).
    const editionYear = params.seriesId ? Number(params.startDate.slice(0, 4)) : null;

    const { data, error } = await supabase
        .from('championships')
        .insert({
            name: params.name,
            format: params.format,
            format_config: params.formatConfig,
            status: 'draft',
            start_date: params.startDate,
            end_date: params.endDate,
            series_id: params.seriesId,
            edition_year: editionYear,
            pts_victory: scoring.ptsVictory,
            pts_defeat: scoring.ptsDefeat,
            pts_wo_victory: scoring.ptsWoVictory,
            pts_set: scoring.ptsSet,
            pts_game: scoring.ptsGame,
            pts_technical_draw: scoring.ptsTechnicalDraw,
            final_ranking_pts: scoring.finalRankingPts,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao criar campeonato: ${error?.message}`);
    return data.id;
}
```

- [ ] **Step 4: Rodar o teste para ver passar**

Run: `npx vitest run __tests__/championshipCreation.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Verificar tipos e lint, depois commitar**

```bash
npx tsc --noEmit && npm run lint
git add lib/championship/creation.ts __tests__/championshipCreation.test.ts
git commit -m "feat(championship): criacao generica de campeonato e series"
```

---

### Task 4: Passo 1 — Básico

**Files:**
- Create: `components/creator/CreatorSetup.tsx`

**Interfaces:**
- Consumes: `ensureSeries`, `ChampionshipSeriesRow`, `DEFAULT_SCORING`, `ScoringRules` de `lib/championship/creation.ts`; `ChampionshipFormat` de `lib/championship/formatConfig.ts`
- Produces:
  - `interface SetupValues { name, format, startDate, endDate, seriesId, classes, scoring }`
  - `const CHAMPIONSHIP_CLASSES: string[]`
  - `const CreatorSetup: React.FC<{ value: SetupValues; onChange: (v: SetupValues) => void; onNext: () => void }>`

Este passo não grava nada: só coleta e valida presença. A gravação acontece ao fim do passo 2, quando a configuração do formato existe.

- [ ] **Step 1: Implementar o componente**

```tsx
// components/creator/CreatorSetup.tsx
import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Plus, Settings, Trophy } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DEFAULT_SCORING, ensureSeries, type ChampionshipSeriesRow, type ScoringRules } from '../../lib/championship/creation';
import type { ChampionshipFormat } from '../../lib/championship/formatConfig';

/** Mesma lista usada por ChampionshipAdmin.tsx:122. */
export const CHAMPIONSHIP_CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

export interface SetupValues {
    name: string;
    format: ChampionshipFormat;
    startDate: string;
    endDate: string;
    seriesId: string | null;
    classes: string[];
    scoring: ScoringRules;
}

export const emptySetup = (): SetupValues => ({
    name: '',
    format: 'mata-mata',
    startDate: '',
    endDate: '',
    seriesId: null,
    classes: [],
    scoring: { ...DEFAULT_SCORING },
});

const FORMAT_LABELS: Record<ChampionshipFormat, string> = {
    'mata-mata': 'Mata-mata',
    'pontos-corridos': 'Pontos corridos',
    'grupo-mata-mata': 'Grupos + mata-mata',
};

interface Props {
    value: SetupValues;
    onChange: (value: SetupValues) => void;
    onNext: () => void;
}

export const CreatorSetup: React.FC<Props> = ({ value, onChange, onNext }) => {
    const [series, setSeries] = useState<ChampionshipSeriesRow[]>([]);
    const [newSeriesName, setNewSeriesName] = useState('');
    const [creatingSeries, setCreatingSeries] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        supabase
            .from('championship_series')
            .select('id, name, slug')
            .order('name')
            .then(({ data }) => setSeries((data ?? []) as ChampionshipSeriesRow[]));
    }, []);

    const set = <K extends keyof SetupValues>(key: K, v: SetupValues[K]) => onChange({ ...value, [key]: v });

    const setScoring = (key: keyof ScoringRules, v: number) =>
        onChange({ ...value, scoring: { ...value.scoring, [key]: v } });

    const toggleClass = (classe: string) =>
        set('classes', value.classes.includes(classe)
            ? value.classes.filter(c => c !== classe)
            : [...value.classes, classe]);

    const handleCreateSeries = async () => {
        if (!newSeriesName.trim()) return;
        setCreatingSeries(true);
        setError('');
        try {
            const created = await ensureSeries(newSeriesName);
            setSeries(prev => prev.some(s => s.id === created.id) ? prev : [...prev, created]);
            set('seriesId', created.id);
            setNewSeriesName('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreatingSeries(false);
        }
    };

    const missing: string[] = [];
    if (!value.name.trim()) missing.push('nome');
    if (!value.startDate) missing.push('data de início');
    if (value.classes.length === 0) missing.push('ao menos uma classe');

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Trophy size={18} className="text-saibro-600" /> Dados do campeonato
                </h2>

                <div>
                    <label htmlFor="creator-name" className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome</label>
                    <input
                        id="creator-name"
                        value={value.name}
                        onChange={e => set('name', e.target.value)}
                        placeholder="Ex.: Copa de Primavera 2026"
                        className="w-full p-3 border border-stone-200 rounded-xl"
                    />
                </div>

                <div>
                    <label htmlFor="creator-series" className="block text-xs font-bold text-stone-500 uppercase mb-1">
                        Série <span className="font-medium normal-case text-stone-400">(liga as edições para defesa de pontos)</span>
                    </label>
                    <select
                        id="creator-series"
                        value={value.seriesId ?? ''}
                        onChange={e => set('seriesId', e.target.value || null)}
                        className="w-full p-3 border border-stone-200 rounded-xl"
                    >
                        <option value="">Sem série</option>
                        {series.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="flex gap-2 mt-2">
                        <input
                            value={newSeriesName}
                            onChange={e => setNewSeriesName(e.target.value)}
                            placeholder="Criar nova série"
                            className="flex-1 p-2 border border-stone-200 rounded-xl text-sm"
                        />
                        <button
                            type="button"
                            onClick={handleCreateSeries}
                            disabled={!newSeriesName.trim() || creatingSeries}
                            className="px-3 py-2 bg-stone-900 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-1"
                        >
                            {creatingSeries ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar
                        </button>
                    </div>
                </div>

                <div>
                    <span className="block text-xs font-bold text-stone-500 uppercase mb-1">Formato</span>
                    <div className="grid grid-cols-3 gap-2">
                        {(Object.keys(FORMAT_LABELS) as ChampionshipFormat[]).map(f => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => set('format', f)}
                                aria-pressed={value.format === f}
                                className={`p-3 rounded-xl border-2 text-sm font-bold transition-colors ${
                                    value.format === f ? 'border-saibro-500 bg-saibro-50 text-saibro-700' : 'border-stone-100 text-stone-600'
                                }`}
                            >
                                {FORMAT_LABELS[f]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3">
                    <div className="flex-1">
                        <label htmlFor="creator-start" className="block text-xs font-bold text-stone-500 uppercase mb-1">Início</label>
                        <input id="creator-start" type="date" value={value.startDate}
                            onChange={e => set('startDate', e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl" />
                    </div>
                    <div className="flex-1">
                        <label htmlFor="creator-end" className="block text-xs font-bold text-stone-500 uppercase mb-1">Fim</label>
                        <input id="creator-end" type="date" value={value.endDate}
                            onChange={e => set('endDate', e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl" />
                    </div>
                </div>

                <div>
                    <span className="block text-xs font-bold text-stone-500 uppercase mb-1">Classes participantes</span>
                    <div className="flex flex-wrap gap-2">
                        {CHAMPIONSHIP_CLASSES.map(c => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => toggleClass(c)}
                                aria-pressed={value.classes.includes(c)}
                                className={`px-3 py-2 rounded-xl border text-sm font-bold transition-colors ${
                                    value.classes.includes(c) ? 'border-saibro-500 bg-saibro-50 text-saibro-700' : 'border-stone-200 text-stone-600'
                                }`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5">
                <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    aria-expanded={showAdvanced}
                    className="w-full flex items-center justify-between font-black text-stone-800"
                >
                    <span className="flex items-center gap-2"><Settings size={16} className="text-stone-400" /> Avançado — pontuação</span>
                    <span className="text-xs font-bold text-stone-400">{showAdvanced ? 'ocultar' : 'usando padrão'}</span>
                </button>

                {showAdvanced && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        {([
                            ['ptsVictory', 'Vitória'],
                            ['ptsWoVictory', 'Vitória por WO'],
                            ['ptsDefeat', 'Derrota'],
                            ['ptsTechnicalDraw', 'Empate técnico'],
                            ['ptsSet', 'Por set'],
                            ['ptsGame', 'Por game'],
                            ['finalRankingPts', 'Bônus do campeão'],
                        ] as [keyof ScoringRules, string][]).map(([key, label]) => (
                            <div key={key}>
                                <label htmlFor={`scoring-${key}`} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
                                <input
                                    id={`scoring-${key}`}
                                    type="number"
                                    value={value.scoring[key]}
                                    onChange={e => setScoring(key, Number(e.target.value))}
                                    className="w-full p-2 border border-stone-200 rounded-xl font-bold"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

            <button
                type="button"
                onClick={onNext}
                disabled={missing.length > 0}
                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
                Configurar formato <ChevronRight size={18} />
            </button>
            {missing.length > 0 && (
                <p className="text-xs text-stone-500 text-center">Falta preencher: {missing.join(', ')}.</p>
            )}
        </div>
    );
};
```

- [ ] **Step 2: Verificar tipos e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros; apenas o warning pré-existente em `ResenhaOpenTournamentBoard.tsx:76`.

- [ ] **Step 3: Commitar**

```bash
git add components/creator/CreatorSetup.tsx
git commit -m "feat(creator): passo basico de criacao de campeonato"
```

---

### Task 5: Passo 2 — Formato

**Files:**
- Create: `components/creator/CreatorFormat.tsx`

**Interfaces:**
- Consumes: `FormatConfig`, `BracketSize`, `BRACKET_SLOTS`, `defaultConfigFor`, `validateFormatShape` de `lib/championship/formatConfig.ts`
- Produces: `const CreatorFormat: React.FC<{ config: FormatConfig; onChange: (c: FormatConfig) => void; onBack: () => void; onConfirm: () => void; saving: boolean }>`

- [ ] **Step 1: Implementar o componente**

```tsx
// components/creator/CreatorFormat.tsx
import React from 'react';
import { ChevronLeft, Loader2, Trophy } from 'lucide-react';
import {
    BRACKET_SLOTS,
    validateFormatShape,
    type BracketSize,
    type FormatConfig,
    type GroupKnockoutConfig,
    type KnockoutConfig,
    type RoundRobinConfig,
} from '../../lib/championship/formatConfig';

const BRACKET_LABELS: Record<BracketSize, string> = {
    round_of_32: '16 avos (32 vagas)',
    round_of_16: 'Oitavas (16 vagas)',
    quarterfinal: 'Quartas (8 vagas)',
    semifinal: 'Semifinal (4 vagas)',
};

const Toggle: React.FC<{ id: string; label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ id, label, checked, onChange }) => (
    <label htmlFor={id} className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer">
        <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-saibro-500" />
        <span className="text-sm font-medium text-stone-700">{label}</span>
    </label>
);

const NumberField: React.FC<{ id: string; label: string; value: number; min: number; onChange: (v: number) => void }> = ({ id, label, value, min, onChange }) => (
    <div>
        <label htmlFor={id} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
        <input id={id} type="number" min={min} value={value} onChange={e => onChange(Number(e.target.value))}
            className="w-full p-2 border border-stone-200 rounded-xl font-bold" />
    </div>
);

const BracketSelect: React.FC<{ id: string; label: string; value: BracketSize; onChange: (v: BracketSize) => void }> = ({ id, label, value, onChange }) => (
    <div>
        <label htmlFor={id} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
        <select id={id} value={value} onChange={e => onChange(e.target.value as BracketSize)}
            className="w-full p-2 border border-stone-200 rounded-xl font-bold">
            {(Object.keys(BRACKET_LABELS) as BracketSize[]).map(k => <option key={k} value={k}>{BRACKET_LABELS[k]}</option>)}
        </select>
    </div>
);

interface Props {
    config: FormatConfig;
    onChange: (config: FormatConfig) => void;
    onBack: () => void;
    onConfirm: () => void;
    saving: boolean;
}

export const CreatorFormat: React.FC<Props> = ({ config, onChange, onBack, onConfirm, saving }) => {
    const validation = validateFormatShape(config);

    const renderGroups = (c: GroupKnockoutConfig) => {
        const set = <K extends keyof GroupKnockoutConfig>(k: K, v: GroupKnockoutConfig[K]) => onChange({ ...c, [k]: v });
        const vagas = c.groupCount * c.membersPerGroup;
        const classificados = c.qualifiersPerGroup * c.groupCount + c.bestThirdPlaces;
        return (
            <div className="space-y-4">
                <Toggle id="groups-home-away" label="Jogos de ida e volta na fase de grupos" checked={c.homeAndAway} onChange={v => set('homeAndAway', v)} />
                <div className="grid grid-cols-2 gap-3">
                    <NumberField id="group-count" label="Quantos grupos" min={1} value={c.groupCount} onChange={v => set('groupCount', v)} />
                    <NumberField id="group-members" label="Membros por grupo" min={2} value={c.membersPerGroup} onChange={v => set('membersPerGroup', v)} />
                    <NumberField id="group-qualifiers" label="Classificados por grupo" min={1} value={c.qualifiersPerGroup} onChange={v => set('qualifiersPerGroup', v)} />
                    <NumberField id="group-thirds" label="Vagas p/ melhores 3ºs" min={0} value={c.bestThirdPlaces} onChange={v => set('bestThirdPlaces', v)} />
                </div>
                <Toggle id="groups-seeded" label="Usar cabeças de chave no mata-mata" checked={c.seeded} onChange={v => set('seeded', v)} />
                <p className="text-xs text-stone-500">
                    {vagas} vagas na fase de grupos · {classificados} classificados para o mata-mata.
                </p>
            </div>
        );
    };

    const renderRoundRobin = (c: RoundRobinConfig) => {
        const set = <K extends keyof RoundRobinConfig>(k: K, v: RoundRobinConfig[K]) => onChange({ ...c, [k]: v });
        return (
            <div className="space-y-4">
                <Toggle id="rr-home-away" label="Jogos de ida e volta" checked={c.homeAndAway} onChange={v => set('homeAndAway', v)} />
                <Toggle
                    id="rr-final-phase"
                    label="Ter fase final (mata-mata) após os pontos corridos"
                    checked={c.finalPhase !== null}
                    onChange={v => set('finalPhase', v ? { startPhase: 'quarterfinal' } : null)}
                />
                {c.finalPhase && (
                    <BracketSelect
                        id="rr-start-phase"
                        label="A fase final começa em"
                        value={c.finalPhase.startPhase}
                        onChange={v => set('finalPhase', { startPhase: v })}
                    />
                )}
                <p className="text-xs text-stone-500">Todos da mesma classe se enfrentam; não há grupos.</p>
            </div>
        );
    };

    const renderKnockout = (c: KnockoutConfig) => {
        const set = <K extends keyof KnockoutConfig>(k: K, v: KnockoutConfig[K]) => onChange({ ...c, [k]: v });
        const slots = BRACKET_SLOTS[c.mainDrawStartPhase];
        // Capturado numa const para o TypeScript manter o narrowing dentro dos callbacks.
        const qualifying = c.qualifying;
        return (
            <div className="space-y-4">
                <BracketSelect id="ko-start-phase" label="Quadro principal começa em" value={c.mainDrawStartPhase} onChange={v => set('mainDrawStartPhase', v)} />
                <Toggle id="ko-seeded" label="Usar cabeças de chave" checked={c.seeded} onChange={v => set('seeded', v)} />
                <Toggle
                    id="ko-qualifying"
                    label="Ter qualificatórias (qualify)"
                    checked={qualifying !== null}
                    onChange={v => set('qualifying', v ? { matchCount: 4, entrySlots: [2, 7, 10, 15] } : null)}
                />
                {qualifying && (
                    <div className="space-y-3">
                        <NumberField
                            id="ko-qualify-matches"
                            label="Jogos nas qualificatórias"
                            min={1}
                            value={qualifying.matchCount}
                            onChange={v => set('qualifying', { matchCount: v, entrySlots: qualifying.entrySlots.slice(0, v) })}
                        />
                        <div>
                            <label htmlFor="ko-entry-slots" className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                                Vagas do quadro onde os vencedores entram (1 a {slots}, separadas por vírgula)
                            </label>
                            <input
                                id="ko-entry-slots"
                                value={qualifying.entrySlots.join(', ')}
                                onChange={e => set('qualifying', {
                                    matchCount: qualifying.matchCount,
                                    entrySlots: e.target.value.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)),
                                })}
                                className="w-full p-2 border border-stone-200 rounded-xl font-bold"
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Trophy size={18} className="text-saibro-600" /> Configuração do formato
                </h2>
                {config.format === 'grupo-mata-mata' && renderGroups(config)}
                {config.format === 'pontos-corridos' && renderRoundRobin(config)}
                {config.format === 'mata-mata' && renderKnockout(config)}
            </div>

            {!validation.ok && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    {validation.errors.map(err => (
                        <p key={err} className="text-sm text-amber-800">{err}</p>
                    ))}
                </div>
            )}

            <div className="flex gap-3">
                <button type="button" onClick={onBack}
                    className="px-5 py-3 rounded-xl border border-stone-200 text-stone-600 font-bold flex items-center gap-1">
                    <ChevronLeft size={18} /> Voltar
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={!validation.ok || saving}
                    className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Trophy size={18} />} Criar campeonato
                </button>
            </div>
        </div>
    );
};
```

- [ ] **Step 2: Verificar tipos e lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Commitar**

```bash
git add components/creator/CreatorFormat.tsx
git commit -m "feat(creator): passo de configuracao de formato"
```

---

### Task 6: Renomear e ligar os passos

**Files:**
- Modify: `components/AdminResenhaOpen.tsx` → renomear para `components/ChampionshipCreator.tsx`
- Modify: `App.tsx:27,229`
- Modify: `components/Layout.tsx:128,256,281`
- Modify: `lib/publicRoutes.ts:32`

**Interfaces:**
- Consumes: `CreatorSetup`, `emptySetup`, `SetupValues` de `components/creator/CreatorSetup.tsx`; `CreatorFormat` de `components/creator/CreatorFormat.tsx`; `createChampionship` de `lib/championship/creation.ts`; `defaultConfigFor` de `lib/championship/formatConfig.ts`
- Produces: `const ChampionshipCreator: React.FC` exportado de `components/ChampionshipCreator.tsx`; view id `championship-creator`

O passo `setup` atual do Resenha é substituído pelos dois passos novos. Os passos `registering`, `drawing` e `bracket` continuam exatamente como estão — o campeonato recém-criado entra neles pelo mesmo `setSelectedChampId` / `setStep('registering')` de hoje.

- [ ] **Step 1: Renomear o arquivo preservando o histórico**

```bash
git mv components/AdminResenhaOpen.tsx components/ChampionshipCreator.tsx
```

- [ ] **Step 2: Renomear o componente e adicionar os estados dos passos novos**

Em `components/ChampionshipCreator.tsx`, trocar a declaração do componente:

```tsx
export const ChampionshipCreator: React.FC = () => {
```

Adicionar os imports no topo do arquivo:

```tsx
import { CreatorSetup, emptySetup, type SetupValues } from './creator/CreatorSetup';
import { CreatorFormat } from './creator/CreatorFormat';
import { createChampionship } from '../lib/championship/creation';
import { defaultConfigFor, type FormatConfig } from '../lib/championship/formatConfig';
```

Trocar o tipo do passo e adicionar o estado (a linha `type AdminStep = 'setup' | 'registering' | 'drawing' | 'bracket';` vira):

```tsx
type AdminStep = 'setup' | 'format' | 'created' | 'registering' | 'drawing' | 'bracket';
```

`createResenhaOpenRounds` e `ResenhaClass` já são importados no topo do arquivo hoje — confirmar que continuam na lista de imports de `../lib/resenhaOpenService`.

Adicionar junto aos demais `useState` do componente:

```tsx
const [setupValues, setSetupValues] = useState<SetupValues>(emptySetup());
const [formatConfig, setFormatConfig] = useState<FormatConfig>(defaultConfigFor('mata-mata'));
```

- [ ] **Step 3: Trocar o corpo do passo `setup` e acrescentar o passo `format`**

Substituir todo o bloco `{step === 'setup' && ( … )}` (hoje em `components/ChampionshipCreator.tsx`, o JSX que começa em `{/* Step 1: Setup */}`) por:

```tsx
{step === 'setup' && (
    <CreatorSetup
        value={setupValues}
        onChange={setSetupValues}
        onNext={() => {
            setFormatConfig(defaultConfigFor(setupValues.format));
            setStep('format');
        }}
    />
)}

{step === 'format' && (
    <CreatorFormat
        config={formatConfig}
        onChange={setFormatConfig}
        onBack={() => setStep('setup')}
        saving={saving}
        onConfirm={async () => {
            setSaving(true);
            try {
                const id = await createChampionship({
                    name: setupValues.name,
                    format: setupValues.format,
                    formatConfig,
                    startDate: setupValues.startDate,
                    endDate: setupValues.endDate || null,
                    seriesId: setupValues.seriesId,
                    scoring: setupValues.scoring,
                });
                setSelectedChampId(id);
                await loadChampionships();

                // O caminho Resenha (mata-mata numa única classe 4ª ou 5ª) precisa das
                // rodadas criadas agora, porque phaseToRoundId alimenta saveBracket no
                // passo de sorteio. Os demais formatos só ganham rodadas na Fase 2.
                const unicaClasse = setupValues.classes.length === 1 ? setupValues.classes[0] : null;
                const ehCaminhoResenha =
                    setupValues.format === 'mata-mata' &&
                    (unicaClasse === '4ª Classe' || unicaClasse === '5ª Classe');

                if (ehCaminhoResenha) {
                    setClasse(unicaClasse as ResenhaClass);
                    const phaseMap = await createResenhaOpenRounds(id, unicaClasse as ResenhaClass, () => ({
                        startDate: setupValues.startDate,
                        endDate: setupValues.endDate || setupValues.startDate,
                    }));
                    setPhaseToRoundId(phaseMap);
                    setStep('registering');
                } else {
                    setStep('created');
                }
                toast.success('Campeonato criado!');
            } catch (e: any) {
                toast.error(e.message);
            } finally {
                setSaving(false);
            }
        }}
    />
)}

{step === 'created' && (
    <div className="bg-white rounded-2xl border border-stone-100 p-6 space-y-3 text-center">
        <h2 className="font-black text-stone-800">Campeonato criado como rascunho</h2>
        <p className="text-sm text-stone-600">
            A geração de rodadas e o chaveamento para este formato chegam na próxima fase do Criador.
            Por enquanto, gerencie as inscrições pelo Campeonato Admin.
        </p>
        <button
            type="button"
            onClick={() => { setSetupValues(emptySetup()); setStep('setup'); }}
            className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold"
        >
            Criar outro campeonato
        </button>
    </div>
)}
```

Trocar também o cabeçalho do painel, que hoje diz "Sorteador Resenha Open":

```tsx
<h1 className="text-2xl font-black">Criador de Campeonatos</h1>
<p className="text-saibro-100 text-sm">Painel exclusivo de administração</p>
```

- [ ] **Step 4: Atualizar as referências de rota e menu**

`App.tsx:27`:

```tsx
const ChampionshipCreator = lazy(() => import('./components/ChampionshipCreator').then(m => ({ default: m.ChampionshipCreator })));
```

`App.tsx:229`:

```tsx
{view === 'championship-creator' && <AdminProtect><ChampionshipCreator /></AdminProtect>}
```

`components/Layout.tsx:128`:

```tsx
navItems.push({ id: 'championship-creator', label: 'Criador de Campeonatos', icon: <Shuffle size={20} />, roles: ['admin'] });
```

`components/Layout.tsx:256` e `:281` — trocar as duas ocorrências de `item.id !== 'resenha-open-admin'` e `item.id === 'resenha-open-admin'` por `championship-creator`:

```bash
sed -i '' "s/'resenha-open-admin'/'championship-creator'/g" components/Layout.tsx lib/publicRoutes.ts
```

- [ ] **Step 5: Verificar que nada ficou para trás**

```bash
grep -rn "resenha-open-admin\|AdminResenhaOpen" --include='*.ts' --include='*.tsx' . --exclude-dir=node_modules --exclude-dir=dist
```

Expected: nenhuma saída.

- [ ] **Step 6: Rodar a suíte completa**

```bash
npx tsc --noEmit && npm run lint && npx vitest run
```

Expected: tsc limpo; lint com apenas o warning pré-existente; 155 testes passando (126 anteriores + 29 novos).

- [ ] **Step 7: Verificar no navegador**

Subir o app (`preview_start` na porta 3000), entrar como admin, abrir o menu e confirmar:
1. O item lê **"Criador de Campeonatos"**
2. O passo Básico aceita nome, série, formato, datas e classes
3. Escolher "Grupos + mata-mata" com 3 grupos de 4 e 2 classificados exibe o aviso de potência de 2 e mantém o botão desabilitado
4. Corrigir para 4 grupos habilita o botão; criar leva à tela "Campeonato criado como rascunho"
5. Criar um mata-mata só na 5ª Classe leva ao passo de inscrições do Resenha, com as rodadas já geradas
6. O campeonato criado aparece no Campeonato Admin

- [ ] **Step 8: Commitar**

```bash
git add -A
git commit -m "feat(creator): renomeia Sorteador para Criador de Campeonatos e liga os passos novos"
```

---

## Verificação final da fase

```bash
set -a; . ./.env.local; set +a
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select name, format, format_config, edition_year from championships order by created_at desc limit 3;"}'
```

Expected: o campeonato criado no passo 7 aparece com `format_config` preenchido e `edition_year` derivado da data de início.

## Fora do escopo desta fase

Geração de rodadas, inscrições genéricas (alunos, cabeças por ranking), sorteio, editor de chave e a seção de pontuação no Campeonato Admin. Ficam para as fases 2 a 4 da spec. Até lá, o passo de inscrições segue sendo o do Resenha Open, que continua funcionando como antes.
