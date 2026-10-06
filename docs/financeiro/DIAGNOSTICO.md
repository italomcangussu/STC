# Financeiro do STC — diagnóstico (Etapa 1)

Escrito **antes** de qualquer alteração de código. Data: 2026-10-06.

> **Revisão (2026-10-06, por orientação do clube).** Dois entendimentos deste diagnóstico estavam errados e foram corrigidos
> (o que vale agora está nas seções 2.4, 3 e no `MODELO_FINANCEIRO.md`):
> 1. **Day Card** é a taxa cobrada de um **convidado** (não-sócio) de um sócio para ter acesso ao clube por um dia — **não tem a ver com aula**.
>    **Aula avulsa** (mesmo valor do Day Card) e **Card Mensal** são as taxas que o **aluno não-sócio** paga **ao clube** para ter acesso às aulas.
>    (No cadastro do aluno o app chama o plano de um dia de "Day Card"; no financeiro isso é **Aula avulsa**.)
> 2. **Não existe repasse a professor no financeiro do clube.** O professor é pago pelo próprio aluno, por hora/aula; isso não entra no financeiro
>    do clube. O módulo de repasse (regras, apuração, pagamento, "Meu repasse") foi **removido por completo**.
Base: leitura integral do STC (`/home/user/STC`, branch `main`, commit `635230a`) e do
North Jato (`/home/user/northjato`, somente leitura).

## 0. O que foi (e o que não pôde ser) inspecionado

| Fonte | Situação |
|---|---|
| Código do STC (componentes, libs, testes, migrations) | Lido. |
| `supabase/migrations/` (100 arquivos) e `migrations/` (arquivos avulsos, sem timestamp) | Lidos nos trechos de financeiro, alunos, professores, auditoria, storage e RLS. |
| Banco remoto do STC (`smztsayzldjmkzmufqcz`) | **Não inspecionado na Etapa 1** (o conector devolvia `permission denied`); o schema abaixo vem das migrations versionadas e do código. **Depois**, com o projeto acessível, as dependências e colunas foram conferidas, as migrations aplicadas e verificadas — ver `OPERACAO_E_MIGRATIONS.md`, seções 2 e 2.1. |
| Instruções do repositório | `.agent/` (protocolo de outro assistente, só como referência de estilo), `DESIGN_SYSTEM.md`, `DESIGN_QUICK_REF.md`, `MODAL_PATTERN.md`, `tasks/refatoracao-alunos-aulas-card-mensal.md`. Não existe `CLAUDE.md`. |
| Baseline de qualidade (antes de editar) | `vitest run`: 597 passam, **1 falha preexistente** (`__tests__/agendaReservations.test.tsx`, refetch com conexão instável). `tsc --noEmit`: limpo. `eslint .`: 0 erros, 13 avisos. `npm run build`: ok. |

## 1. Módulo financeiro do North Jato (referência)

Arquivos-chave: `supabase/migrations/20260926190000_finance_module.sql`, `…200000_finance_refinements.sql`,
`…20260927090000_finance_typed_reports.sql`, `…20260929220100_card_net_flow.sql`; front em `src/features/finance/`.

O que o NJ resolve e o que foi **adaptado** (nada foi copiado literalmente nem alterado no NJ):

| Padrão do NJ | Como funciona | No STC |
|---|---|---|
| "O que o sistema já sabe não é copiado" | Recebimentos, estornos, descontos, comissões são lidos **na origem** por `fin_cash_rows` e `fin_dre_rows`; nenhum gatilho replica fato. Só ganham tabela os fatos novos (conta de luz, aporte, transferência). | Mantido. Reservas, `student_payments`, `profiles`, `professors` continuam a fonte; só entram tabelas para fatos que não existem (mensalidades de sócio, contas, comprovantes, repasse). |
| DRE por competência × caixa por data real | Duas funções distintas (`fin_dre_rows` × `fin_cash_rows`). Aporte/retirada/transferência fora do DRE; transferência nem entra nas entradas/saídas consolidadas. | Mantido, com as mesmas regras. |
| Contas, categorias com `dre_line` e `system_key` | Categoria diz em que linha do DRE cai; as de uso automático são reservadas (`CATEGORY_RESERVED`). | Adaptado: categorias do clube (mensalidades, Card Mensal, Day Card, Day Use, multas e juros, repasse a professores…). |
| Recorrência gera lançamentos próprios | Índice único `(recurrence_id, competence_date)` torna a geração idempotente; pausar/encerrar cancela só pendentes futuros. | Mantido. |
| Auditoria + imutabilidade | Gatilho grava antes/depois; autor vem de `set_config` da transação; `before delete` bloqueia apagar. | Adaptado: usa a **auditoria que o STC já tem** (`admin_audit_logs` + `admin_audit_insert_log`) em vez de criar tabela paralela. |
| Idempotência | `nj_fin_requests` + `fin_begin/fin_finish` (mesma chave → mesmo resultado). | Mantido (`fin_requests`). |
| Permissões `finance.read/write/admin` | Tabela de permissões própria do NJ. | **Não portado**: o STC já tem papéis (`profiles.role`, `is_admin()`, `is_professor`). Não foi criado sistema paralelo. |
| Escritas por edge function com service role | O NJ chama como `service_role` e passa o ator. | Adaptado: RPC `SECURITY DEFINER` com `auth.uid()` como ator. Nenhuma edge function nova. |
| Relatórios tipados (`returns table`) | Contas feitas no banco; a tela só formata. | Mantido para fatos (linhas); os totais do DRE são compostos em TypeScript puro e testável. |
| Comprovantes de lançamento | Bucket privado, caminho `<id>/<arquivo>`, sem update/delete. | Mantido; novo bucket só para comprovantes de sócios. |

## 2. Fluxos atuais do STC

### 2.1 Sócios e vínculo com o clube
- `profiles` (role enum `admin | socio | lanchonete`, `is_professor`, `is_active`). **"Sócio" = role ∈ `MEMBER_ROLES` (`socio`,`admin`)**; a view `public.members` e `utils.isMember` espelham isso.
- **Não existe data de início/fim do vínculo.** O único sinal de saída é `profiles.is_active = false` (as telas de sócios filtram `is_active = true`) ou mudança de `role`. Consequência: a mensalidade precisa de plano próprio com `start_on`/`ended_on`, e o fim do vínculo precisa ser detectado por gatilho em `profiles`.
- Não existe cobrança de mensalidade de sócio hoje. `profiles.balance` e `consumptions` são da lanchonete (Klanches).

### 2.2 Alunos, dependentes, perfis estudantis, professores
- `non_socio_students` (plano `Day Card | Card Mensal | Dependente | Day Card Experimental`, `plan_status`, `master_expiration_date`, `student_type regular|dependent`, `responsible_socio_id`, `professor_id`, `is_active`).
- `student_profiles` (migration `20261005161200`): metadados do aluno ligados a `profile_id` **ou** `non_socio_student_id` (nunca os dois), `student_status active|paused|ended`, `professor_id`. Não duplica a pessoa. Pausar/reativar não apaga nada.
- `professors` (`user_id → profiles.id`). Regras de cartão em `lib/students/studentRules.ts` (`getCardStatus`, `canParticipateInClass`): sócio e dependente → "cartão não exigido"; não-sócio → Card Mensal válido por `master_expiration_date`.

### 2.3 Reservas, aulas, participantes, cancelamentos
- `reservations`: `type` (`Play|Aula|Campeonato|Desafio`), `status` (`active|cancelled|finished`), `professor_id`, `participant_ids uuid[]` (sócios), `non_socio_student_ids uuid[]` (+ legado `non_socio_student_id`, e legado de aluno em `participant_ids` quando `student_type='non-socio'`), `guest_name` (amistoso com convidado), `payment_status` (`paid|pending|exempt`, padrão `paid`).
- **Não existe presença/falta, reposição ou aula gratuita como conceito.** O único marcador financeiro é `payment_status='exempt'`, alternado no `FinanceiroAdmin`.
- Cancelamento = `status='cancelled'`; o relatório atual já ignora essas reservas.

### 2.4 Card Mensal, Aula avulsa, Day Card, `student_payments`
| Conceito | Onde vive | Natureza |
|---|---|---|
| **Card Mensal** (aluno não-sócio) | `student_payments` (`amount`, `payment_date`, `valid_until` = +1 mês) e `non_socio_students.master_expiration_date` | Taxa que o aluno paga **ao clube** para ter aulas por um mês; valor R$ 200 fixo no código (`CARD_MENSAL_PRICE`). |
| **Aula avulsa** (aluno não-sócio) | `student_payments` com `valid_until` no mesmo dia — no cadastro do aluno o app chama de plano **"Day Card"** / "Day Card Experimental" | Taxa que o aluno paga **ao clube** por aula, mesmo valor do Day Card (R$ 50 no código). Experimental convertido em Card Mensal é **estornado** (`status='cancelled'`, `related_payment_id`). |
| **Day Card** (convidado de sócio) | **Não é gravado como pagamento.** O `FinanceiroAdmin` deriva da reserva: amistoso (`type='Play'`) com `guest_name`, × `DAY_USE_PRICE` (R$ 50), exceto `payment_status='exempt'` (o app chama isso de "Day Use") | Taxa do convidado de um sócio: acesso ao clube por um dia. **Nada a ver com aula.** Receita **derivada** da reserva. |
| **Mensalidade do clube (sócio)** | **Não existe.** | Fato novo. |
| **Professor** | Pago **pelo aluno**, por hora/aula, fora do clube. `tasks/refatoracao-alunos-aulas-card-mensal.md` proíbe "comissão ou pagamento entre aluno e professor". | **Não entra no financeiro do clube** — nenhum repasse. |

Os conceitos **não são equivalentes** e o modelo novo os mantém separados.

Riscos que o código atual já tinha (1 e 2 foram corrigidos pela revisão acima; 3 e 4 seguem só sinalizados):
1. **Dupla contagem da aula de aluno:** o painel antigo somava R$ 50 por aula de aluno (derivado da reserva) **em cima** do pagamento registrado em `student_payments` (Aula avulsa/Card Mensal). Agora a aula de aluno **não gera receita**: vale o pagamento registrado.
2. **Cobrança de quem tem Card Mensal:** o filtro antigo cobrava R$ 50 por aula de qualquer aluno não-sócio regular, inclusive com Card Mensal. Some junto com o item 1.
3. `ProfessorProfile` faz `insert/update` em `student_payments`, mas a política conhecida só dá `SELECT` ao professor — conferir no remoto.
4. **Valores fixos no código** (R$ 50/R$ 200) e **exclusão física** de `student_payments` (`handleDeletePayment`) — o histórico pode sumir sem rastro (a auditoria nova passa a registrar).

### 2.5 FinanceiroAdmin e demais relatórios
- `components/FinanceiroAdmin.tsx` (534 linhas): receita do mês (versão original) = Day Use derivado (convidados **e** aulas de alunos) + pagamentos ativos de `student_payments`; estornados listados à parte; isentar Day Use; excluir pagamento. Hoje (após a revisão): Day Card só dos convidados + pagamentos de alunos. Montado em `AdminPanel` (`case 'financeiro'`) **e** em `App.tsx` (`financeiro-admin`, item "Financeiro" do menu admin).
- `components/AdminReports.tsx` não é importado em lugar nenhum (código morto; "receita" = consumo da lanchonete).

### 2.6 Funções administrativas, auth, RLS, Storage, notificações, auditoria
- Auth: telefone/e-mail (`AuthContext`), `AdminProtect`, edge `admin-athlete-access`. Papéis só no banco via `is_admin()`.
- Padrão de RLS: `is_admin()` para gestão; professor por `professors.user_id = auth.uid()`; sócio por `auth.uid()`.
- Storage: bucket `avatars` com política por dono (`<uid>/…`) — padrão reaproveitado para os comprovantes.
- Auditoria: `admin_audit_logs` (+ `admin_audit_insert_log`, gatilho genérico) — **reaproveitada**.
- Push: `lib/notificationService.ts` → edge `send-push`. Toasts: `lib/notifications.ts` (`notify`), erros: `lib/humanErrors.ts`, confirmações: `useConfirm`.
- Testes: Vitest + happy-dom; 56 arquivos. Não havia teste de SQL (adicionado `@electric-sql/pglite`, como no NJ, só para validar migrations/RLS localmente).

## 3. Reutilizar × estender × lacunas

**Reutilizar sem copiar:** `profiles`/`members`, `professors`, `non_socio_students`, `student_profiles`, `reservations`, `student_payments`, `admin_audit_logs`, `is_admin()`, `notify`, `sendPushNotification`, `StandardModal`, `useConfirm`, `FinanceiroAdmin` (vira a aba "Painel de alunos" dentro de "Alunos e Day Card"), `jspdf` (exportação), `recharts` (gráficos).

**Estender:** `FinanceiroAdmin` ganha prop opcional para o valor do Day Card (hoje constante) e deixa de somar a aula de aluno; `AdminPanel`/`App`/`Layout` ganham pontos de entrada; `student_payments` ganha gatilho de auditoria (sem mudar comportamento).

**Lacunas (fatos novos):** mensalidades individuais de sócios + histórico de preço; vencimento com dia útil/feriados; política de encargos; pagamentos (parcial/excedente/duplicado/estorno); comprovantes e decisões; contas do clube, categorias, lançamentos, recorrências, transferências, anexos; DRE/caixa/dashboard; exportação. (Não são lacunas: repasse a professor — o professor é pago pelo aluno — e vínculo aula×pagamento — a aula de aluno não gera receita derivada.)

**Riscos de regressão a cobrir em teste:** (a) `FinanceiroAdmin` continua funcionando (agora sem somar a aula de aluno, a pedido do clube) e sem tocar pagamentos, isenção e estorno; (b) fluxos de aluno/dependente/Card Mensal/reservas não são tocados (só leitura + gatilho de auditoria); (c) gatilho em `profiles` nunca pode bloquear a edição de perfil (falha vira `WARNING`); (d) um evento entra uma única vez no DRE e no caixa; (e) papéis: sócio só vê o próprio; professor e lanchonete não veem financeiro nenhum.
