# Arquitetura — STC (reserva-sct)
> Camada semântica. Fatos estruturais exatos (arquivos, símbolos, dependentes, testes) → agentmap.

## Visão geral
App de gestão de clube de tênis (reservas, desafios, campeonatos, ranking, financeiro, alunos/professores). React + Vite + TypeScript (raiz do repo, sem `src/`), Supabase (auth, Postgres, realtime, edge functions), PWA (`public/sw.js`, `manifest.json`). Testes: Vitest (`__tests__/`, `*.test.ts`). Deploy via Dockerfile; versão checada por `useVersionCheck` + `scripts/generate-version.js`.

## Módulos
| Módulo | Faz | Entrada/hub | Consulta útil |
|---|---|---|---|
| `App.tsx` / `index.tsx` | shell, navegação por estado (sem react-router), rotas públicas | `App.tsx` | `--relates App.tsx` |
| `components/` | telas (Agenda, Challenges, Ranking, Championships*, Admin*, Financeiro, SuperSet, Klanches, TenisProPlayer) | `Layout.tsx`, `StandardModal.tsx` | `--relates components/StandardModal.tsx` |
| `components/creator/` | assistente de criação de campeonato | `ChampionshipCreator.tsx` | `--any "Creator"` |
| `lib/championship/` | regras de campeonato: formato, chaves, rounds, grupos, sorteio, agendamento | `formatConfig.ts`, `bracket.ts` | `--relates lib/championship/bracket.ts` |
| `lib/` (resto) | serviços: ranking, resenha open, notificações/push, export PDF/PNG, auth, logs | `supabase.ts`, `logger.ts`, `notifications.ts` | `--relates lib/notifications.ts` |
| `hooks/`, `contexts/` | dados realtime/desafios/reservas; `AuthContext` | `AuthContext.tsx` | `--relates contexts/AuthContext.tsx` |
| `types.ts`, `utils.ts` | tipos de domínio e utilidades (data Fortaleza, papéis) | `types.ts` (hub nº1) | `--relates types.ts` |
| `bracket-lab.*` | laboratório isolado de chaves | `bracket-lab.tsx` | — |

## Fronteiras
- Autenticação: `contexts/AuthContext.tsx`, `lib/authHelpers.ts`, `lib/phoneAuth.ts`; login por telefone; `AdminProtect` guarda telas admin; edge function `admin-athlete-access`.
- Dados (Supabase): client único em `lib/supabase.ts` (há duplicata `supabase.ts` na raiz); migrations em `migrations/` (fora de `supabase/`); tabelas/RLS/funções → `.fabuloso/db/indice.md`.
- Rotas: sem router; `App.tsx` + `lib/publicRoutes.ts` (páginas públicas de campeonato e formulários).
- UI: Tailwind via `index.css`, padrão de modal em `MODAL_PATTERN.md`, design em `DESIGN_SYSTEM.md`/`DESIGN_QUICK_REF.md`.
- Integrações: Web Push (`supabase/functions/send-push`, `lib/pushNotifications.ts`), export PDF/PNG (`lib/pdfExportPremium.ts`, `lib/exportTools.ts`).

## Fora do alcance do agentmap
- `migrations/*.sql` e SQLs soltos na raiz (`check_*.sql`) — schema/RLS; muitos "fix_*" históricos
- `supabase/functions/*` — edge functions Deno
- `public/sw.js`, `manifest.json` — PWA
- `*.md` na raiz — documentação/auditorias (muitas, não são fonte de verdade)

## Convenções que o código não mostra
- Fuso do clube: Fortaleza (`getNowInFortaleza` em `utils.ts`).
- Papéis de membro em `MEMBER_ROLES` (`utils.ts`); confirmações via `useConfirm`.
- Erros: `lib/logger.ts` + `lib/humanErrors.ts`.
