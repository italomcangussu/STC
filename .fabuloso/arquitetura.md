# Arquitetura — STC (reserva-sct)
> Camada semântica. Fatos estruturais exatos (arquivos, símbolos, dependentes, testes) → agentmap.

## Visão geral
App de gestão de clube de tênis (reservas, desafios, campeonatos, ranking, financeiro, alunos/professores). React + Vite + TypeScript (raiz do repo, sem `src/`), Supabase (auth, Postgres, realtime, edge functions), PWA (`public/sw.js`, `manifest.json`). Testes: Vitest (`__tests__/`, `*.test.ts`). Deploy via Dockerfile; versão checada por `useVersionCheck` + `scripts/generate-version.js`.

## Módulos
| Módulo | Faz | Entrada/hub | Consulta útil |
|---|---|---|---|
| `App.tsx` / `index.tsx` | shell, navegação por estado (sem react-router), rotas públicas | `App.tsx` | `--relates App.tsx` |
| `components/` | telas (Agenda, Challenges, Ranking, Championships*, Admin*, Financeiro, SuperSet, Klanches, TenisProPlayer) | `Layout.tsx`, `StandardModal.tsx` | `--relates components/StandardModal.tsx` |
| `components/admin/` | casca do Painel Admin: navegação em 2 níveis (áreas → seções) com selos de pendência (`AdminNav`, `adminSections.ts` dados (não chamar de `adminNav.ts`: difere de `AdminNav.tsx` só na extensão e quebra no macOS), `adminNavMeta.ts` ícones/ids), busca por teclado, `useAdminPending`, `AdminEmbedContext` (tela embutida omite o próprio título), peças comuns em `ui.tsx` (`AdminPageHeader`, `AdminSearch`, `ChipGroup`, `AdminEmpty`, `AdminField`/`adminInputCls`, `StatusPill`, `StatTile`) | `AdminNav.tsx`, `ui.tsx` | `--relates components/admin/ui.tsx` |
| `components/creator/` | assistente de criação de campeonato | `ChampionshipCreator.tsx` | `--any "Creator"` |
| `lib/championship/` | regras de campeonato: formato, chaves, rounds, grupos, sorteio, agendamento | `formatConfig.ts`, `bracket.ts` | `--relates lib/championship/bracket.ts` |
| `lib/finance/` | motores puros do financeiro (centavos, datas/feriados, mensalidade, encargos, DRE/indicadores, comprovantes/OCR, exportação) e `financeApi.ts` (única porta para o banco: RPCs `fin_*`) | `financeApi.ts`, `money.ts` | `--relates lib/finance/financeApi.ts` |
| `components/finance/` | hub financeiro do admin (abas lazy em `tabs/`) e `MemberFinance` (sócio); `FinanceiroAdmin.tsx` (painel de alunos) vive dentro da aba "Alunos e Day Card" | `FinanceHub.tsx`, `ui.tsx` | `--relates components/finance/FinanceHub.tsx` |
| `lib/conversations/` | módulo Conversas (admin): `api.ts` (única porta do navegador: RPCs `conv_*` + função `conversation-operations`), `edge.ts` (transporte/erros), `automationModel.ts` (modelos e validação das automações; paridade com o SQL testada), `aiModel.ts`; helpers portados do North Jato (timeline, rascunho, presença, formatador de texto) | `api.ts`, `automationModel.ts` | `--relates lib/conversations/api.ts` |
| `components/conversations/` | `ConversationsHub` (abas lazy: caixa, automações, IA, canal); chat portado do North Jato (lista, bolha, compositor, painel do contato) em tokens saibro/stone | `ConversationsHub.tsx`, `InboxTab.tsx` | `--relates components/conversations/ConversationsHub.tsx` |
| `lib/` (resto) | serviços: ranking, resenha open, notificações/push, export PDF/PNG, auth, logs | `supabase.ts`, `logger.ts`, `notifications.ts` | `--relates lib/notifications.ts` |
| `hooks/`, `contexts/` | dados realtime/desafios/reservas; `AuthContext` | `AuthContext.tsx` | `--relates contexts/AuthContext.tsx` |
| `types.ts`, `utils.ts` | tipos de domínio e utilidades (data Fortaleza, papéis) | `types.ts` (hub nº1) | `--relates types.ts` |
| `bracket-lab.*` | laboratório isolado de chaves | `bracket-lab.tsx` | — |

## Fronteiras
- Autenticação: `contexts/AuthContext.tsx`, `lib/authHelpers.ts`, `lib/phoneAuth.ts`; login por telefone; `AdminProtect` guarda telas admin; edge function `admin-athlete-access`.
- Dados (Supabase): client único em `lib/supabase.ts` (há duplicata `supabase.ts` na raiz); migrations em `migrations/` (fora de `supabase/`); tabelas/RLS/funções → `.fabuloso/db/indice.md`.
- Financeiro: tabelas `fin_*` + schema privado `fin_private` (sem grant) em `supabase/migrations/20261006100*`; escrita só por RPC `SECURITY DEFINER` com `request_id` (idempotência) e auditoria em `admin_audit_logs` (`source='finance'`); papéis = `profiles.role`/`is_admin()` (sem papel novo; professor e lanchonete não acessam); buckets privados `fin-receipts` e `fin-docs`; OCR roda no aparelho (`tesseract.js`/`pdfjs-dist`, sugere, nunca quita). Docs: `docs/financeiro/`. Testes de SQL em PGlite: `__tests__/finance/sql/`.
- Conversas/WhatsApp: tabelas `conv_*` + schema privado `conv_private` em `supabase/migrations/20261007100*`–`1013*` (todas aplicadas em `smztsayzldjmkzmufqcz`, inclusive `101300_joao_pack` em 2026-10-07; `whatsapp-webhook` v27); acesso só admin (`is_admin()`), escrita só por RPC `SECURITY DEFINER`/`conv_svc_*` (service_role); UM histórico (`conv_messages`, `origin` customer/staff/ai/automation/system) e UMA instância UazAPI; edge functions `whatsapp-webhook` (token na URL, só hash no banco), `conversation-operations` (ações do admin que falam com o provedor), `conversations-dispatch` (agendador: automações, retornos), `joao-daily-greeting` (bom-dia diário, mantido pelo dono do clube, auth `x-joao-secret`) e `_shared/` (uazChat, uazWebhook, groupMention, aiAgent/*, adminRequest, dispatch); IA propõe e o SERVIDOR grava a reserva só após confirmação explícita (`conv_private.ai_confirm`, regras de reserva espelhadas em SQL); menção direta em grupo é fail-closed e a IA em grupo só liga após verificação humana. O João (persona da IA) é amigo da turma: reação com emoji de lista fixa, memória social só com aprovação da diretoria (`conv_ai_memory_candidates` → aba IA → volta ao prompt), resultados recentes e as próprias últimas falas num único RPC `conv_svc_ai_joao_pack` (ausente/falhou = segue sem). Repo e produção (`whatsapp-webhook` v21) estavam idênticos em 2026-10-07; deploy é manual pelo conector. Docs: `docs/conversas/`. Testes: `__tests__/conversations/` (SQL em PGlite, edge, IA, UI).
- Rotas: sem router; `App.tsx` + `lib/publicRoutes.ts` (páginas públicas de campeonato e formulários).
- UI: Tailwind via `index.css`, padrão de modal em `MODAL_PATTERN.md`, design em `DESIGN_SYSTEM.md`/`DESIGN_QUICK_REF.md`.
- Formulários em folha: `components/ui/Sheet.tsx` (sobe da borda no celular; o `Sheet` do financeiro é reexport). Regras puras de pontuação em `lib/pointRules.ts`. Editor de cadastro (`AdminUserEditor`) confirma mudança de função e descarte de dados.
- Administração: UMA porta, o Painel Admin (`view='admin-panel'`); Alunos, Professores, Financeiro, Formulários e Torneios são seções dele (o menu lateral não lista mais cada uma). As views antigas (`admin-students`, `financeiro-admin`…) seguem em `App.tsx` só por compatibilidade. Telas do painel usam `useAdminEmbedded()` para não repetir o título que o painel já mostra e `AdminPageHeader`/`AdminSearch`/`ChipGroup` (alvos de 44 px).
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
