# Receita dobrada de aluno com Card

Leia antes de mexer em `components/students/RevenueOverlapNotice.tsx`, `lib/finance/studentRevenueOverlap.ts`, no registro de Card em `AdminStudents`, em `askIfCardRenewal` (`supabase/functions/_shared/aiAgent/adminFinance.ts`) ou em `student_payments` / `fin_entries` no caixa e na DRE.

## O problema
- O caixa e a DRE somam `student_payments` (flow receipt) e `fin_entries` (flow revenue). O mesmo Pix lançado como receita solta e depois como Card conta em dobro.
- Caso real (24/11/2026): Cards de Matheus e José duplicados, −R$ 300 no caixa e na DRE de novembro quando corrigido. Achado: o Pix do comprovante é de 16/11 (OCR/E2E), os Cards estão com 09/11; a data certa só o Henrique confirma.

## Regra pura (`lib/finance/studentRevenueOverlap.ts`)
- Janela de 45 dias entre a receita solta e o Card.
- Casa quando o primeiro nome do aluno aparece como palavra inteira na descrição, ou quando a categoria é de aluno: "Aluno do/da…", "Aula mensal/avulsa", "Card Mensal".

## Painel
- `RevenueOverlapNotice` aparece nos modais de renovar e de converter de `AdminStudents`, lê `financeApi.listRecentRevenues` (`fin_entries_v`, kind revenue) + `listCategories` e pergunta "É o mesmo dinheiro?".
- Se sim, exclui pela via auditada `removeCashMovement('entry_payment', …)` (nunca DELETE direto).
- O aviso não foi visto na tela (precisa de login admin); a nota vem da leitura do código.

## João
- `askIfCardRenewal` (`adminFinance.ts`): receita cuja descrição cita pelo primeiro nome um aluno `non_socio` com Card Mensal (`conv_svc_ai_resolve_people`, status `unique`) pergunta "renovar Card" ou "receita mesmo" antes de lançar.
- Pergunta uma vez por descrição (`memory.revenue_card_checked`).
- Eval: `henrique-16-11-receita-de-aluno` em `evals/joao-admin.eval.jsonl`.

## Correção da produção
- Roteiro `docs/auditorias/2026-11-24-cards-matheus-jose.sql` (ensaiado: −R$ 300 no caixa e na DRE de novembro, Cards intactos). Aplicado em 24/11 com o "sim" do Ítalo: receita bad73f44 cancelada, Cards ligados ao comprovante 2a512c8b.
- Escrita SQL no remoto: pela Management API com `com-env`, porque os conectores MCP do Supabase deste projeto respondem sem permissão.
- Deploy de edge function pela CLI exige `--yes` (agent mode).
- Pendentes: Iago Ribeiro e José 19/10 aguardam o Henrique.
