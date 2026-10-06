# Histórico do contexto (fabuloso)

Uma entrada por sessão: data, o que mudou no contexto e por quê.

## 2026-10-05 — bootstrap completo
Orquestrador Sonnet 5.5 (sem subagentes). Modo agentmap; banco em modo conector (mapa gerado na 1ª tarefa de banco). Skills obrigatórias ausentes: refatorar-ui, uncle-bob, performance-profile, supabase, hig.
Observações: (1) `supabase.ts` duplicado na raiz e em `lib/`; (2) migrations em `migrations/` com muitos `fix_*` ad hoc, sem timestamp; (3) sem router, navegação por estado em App.tsx; (4) muitos .md de auditoria na raiz; (5) sem CLAUDE.md.

## 2026-10-06 — módulo financeiro completo (sem commit, a pedido)
Orquestrador Sonnet 5.5 (sem subagentes, a pedido). Estrutural: criados `lib/finance/`, `components/finance/`, `docs/financeiro/`, 5 migrations `fin_*` (NÃO aplicadas) e dependências `@electric-sql/pglite` (dev), `tesseract.js`, `pdfjs-dist`. `arquitetura.md` ganhou as linhas de módulo e a fronteira "Financeiro"; `capacidades-nuvem.md` refrescado. Banco remoto continua não inspecionado (sem permissão no conector); mapa `.fabuloso/db/` não gerado.

## 2026-10-06 (2) — correção de vocabulário e remoção do repasse a professor
Por orientação do clube: Day Card = taxa do convidado de sócio (acesso por um dia); Aula avulsa (mesmo valor) e Card Mensal = taxas do aluno não-sócio pagas ao clube; professor é pago pelo aluno e NÃO entra no financeiro. Removido todo o módulo de repasse (tabelas, RPCs, abas, testes) e o vínculo aula×pagamento; Aula avulsa/Card Mensal passam a contar só pelo pagamento registrado em `student_payments`; Day Card derivado só de reserva com convidado (configs renomeadas `day_card_*`). Migration 4 virou `20261006100300_finance_day_card.sql` (ainda não aplicada em lugar nenhum). `FinanceiroAdmin` deixou de somar a aula de aluno.

## 2026-10-06 (3) — migrations financeiras aplicadas no projeto "agentes N8N"
A pedido do clube (autorização explícita), as 5 migrations `fin_*` foram aplicadas no Supabase `smztsayzldjmkzmufqcz` (onde mora o STC), em partes pelo conector, e registradas em `supabase_migrations.schema_migrations` com as versões dos arquivos. Conferência: impressão digital local × remoto idêntica (82 funções, 257 colunas, 72 políticas, 34 gatilhos, 186 constraints, 63 índices); teste de fumaça com rollback; advisors sem achado novo em `fin_*`. Lição do conector: ele trava (sem erro do banco) com `DROP` e com `UPDATE` sem `WHERE` — a migration 1 foi ajustada (gatilho de `student_payments` com `if not exists`; `fin_save_settings` com `where id`; `revoke all` na visão `fin_entries_v` antes do `grant`). Sobrou a função inofensiva `fin_private.zz_probe3` (não removível pelo conector). Mapa `.fabuloso/db/` ainda não gerado (próxima tarefa de banco: rodar `db --conector`).
