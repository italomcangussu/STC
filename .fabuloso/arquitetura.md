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
| `lib/finance/` | motores puros do financeiro (centavos, datas/feriados, mensalidade, encargos, DRE/indicadores, comprovantes/OCR, exportação) e `financeApi.ts` (única porta para o banco: RPCs `fin_*`) | `financeApi.ts`, `money.ts` | `--relates lib/finance/financeApi.ts` |
| `components/finance/` | hub financeiro do admin (abas lazy em `tabs/`) e `MemberFinance` (sócio); `FinanceiroAdmin.tsx` (painel de alunos) vive dentro da aba "Alunos e Day Card" | `FinanceHub.tsx`, `ui.tsx` | `--relates components/finance/FinanceHub.tsx` |
| `lib/` (resto) | serviços: ranking, resenha open, notificações/push, export PDF/PNG, auth, logs | `supabase.ts`, `logger.ts`, `notifications.ts` | `--relates lib/notifications.ts` |
| `hooks/`, `contexts/` | dados realtime/desafios/reservas; `AuthContext` | `AuthContext.tsx` | `--relates contexts/AuthContext.tsx` |
| `types.ts`, `utils.ts` | tipos de domínio e utilidades (data Fortaleza, papéis) | `types.ts` (hub nº1) | `--relates types.ts` |
| `bracket-lab.*` | laboratório isolado de chaves | `bracket-lab.tsx` | — |

## Fronteiras
- Autenticação: `contexts/AuthContext.tsx`, `lib/authHelpers.ts`, `lib/phoneAuth.ts`; login por telefone; `AdminProtect` guarda telas admin; edge function `admin-athlete-access`.
- Dados (Supabase): client único em `lib/supabase.ts` (há duplicata `supabase.ts` na raiz); migrations em `migrations/` (fora de `supabase/`); tabelas/RLS/funções → `.fabuloso/db/indice.md`.
- Financeiro: tabelas `fin_*` + schema privado `fin_private` (sem grant) em `supabase/migrations/20261006100*`; escrita só por RPC `SECURITY DEFINER` com `request_id` (idempotência) e auditoria em `admin_audit_logs` (`source='finance'`); papéis = `profiles.role`/`is_admin()` (sem papel novo; professor e lanchonete não acessam); buckets privados `fin-receipts` e `fin-docs`; OCR roda no aparelho (`tesseract.js`/`pdfjs-dist`, sugere, nunca quita). Docs: `docs/financeiro/`. Testes de SQL em PGlite: `__tests__/finance/sql/`.
- Rotas: sem router; `App.tsx` + `lib/publicRoutes.ts` (páginas públicas de campeonato e formulários).
- UI: Tailwind via `index.css`, padrão de modal em `MODAL_PATTERN.md`, design em `DESIGN_SYSTEM.md`/`DESIGN_QUICK_REF.md`.
- Integrações: Web Push (`supabase/functions/send-push`, `lib/pushNotifications.ts`), export PDF/PNG (`lib/pdfExportPremium.ts`, `lib/exportTools.ts`).

## Fora do alcance do agentmap
- `migrations/*.sql` e SQLs soltos na raiz (`check_*.sql`) — schema/RLS; muitos "fix_*" históricos
- `supabase/functions/*` — edge functions Deno
- `public/sw.js`, `manifest.json` — PWA
- `*.md` na raiz — documentação/auditorias (muitas, não são fonte de verdade)

## Convenções que o código não mostra
- Fuso do clube: Fortaleza (`getNowInFortaleza` em `utils.ts`). Dinheiro do financeiro: sempre centavos inteiros (`*_cents`); `student_payments.amount` (NUMERIC legado) só é convertido na leitura.
- Papéis de membro em `MEMBER_ROLES` (`utils.ts`); confirmações via `useConfirm`.
- Erros: `lib/logger.ts` + `lib/humanErrors.ts`.
