# Histórico do contexto (fabuloso)

Uma entrada por sessão: data, o que mudou no contexto e por quê.

## 2026-10-05 — bootstrap completo
Orquestrador Sonnet 5.5 (sem subagentes). Modo agentmap; banco em modo conector (mapa gerado na 1ª tarefa de banco). Skills obrigatórias ausentes: refatorar-ui, uncle-bob, performance-profile, supabase, hig.
Observações: (1) `supabase.ts` duplicado na raiz e em `lib/`; (2) migrations em `migrations/` com muitos `fix_*` ad hoc, sem timestamp; (3) sem router, navegação por estado em App.tsx; (4) muitos .md de auditoria na raiz; (5) sem CLAUDE.md.
