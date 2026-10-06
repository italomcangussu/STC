# Modelo financeiro do STC (Etapa 2)

Princípios (herdados do North Jato, adaptados ao clube):

1. **Fato existente não é copiado.** Reservas, `student_payments`, `profiles`, `non_socio_students` seguem sendo a origem. Relatórios os leem; só nascem tabelas para fatos que o sistema não conhecia.
2. **Duas datas, nunca misturadas.** DRE = competência. Caixa = data em que o dinheiro entrou/saiu.
3. **Dinheiro em centavos inteiros** (`bigint`, sufixo `_cents`). `student_payments.amount` (NUMERIC(10,2), legado) é convertido na leitura com `round(amount*100)`.
4. **Histórico não se apaga.** Cancelar, estornar, encerrar ou arquivar — nunca `DELETE`. Gatilhos `before delete` bloqueiam as tabelas novas.
5. **Toda escrita passa por RPC `SECURITY DEFINER`** (ator = `auth.uid()`), com chave de idempotência e auditoria. `anon`/`authenticated` não têm `INSERT/UPDATE/DELETE` direto nas tabelas financeiras.
6. **Papéis existentes, sem sistema paralelo:** `admin` (`is_admin()`) gere tudo; sócio vê só o que é seu (`auth.uid()`); professor e `lanchonete` não veem financeiro nenhum.
7. **Quem paga o quê ao clube (vocabulário do clube):**
   - **Mensalidade** — o sócio.
   - **Day Card** — taxa do **convidado** (não-sócio) de um sócio, para ter acesso ao clube por um dia. Nada a ver com aula.
   - **Aula avulsa** (mesmo valor do Day Card) e **Card Mensal** — taxas que o **aluno não-sócio** paga **ao clube** para ter acesso às aulas.
   - **Professor** — é pago **pelo próprio aluno**, por hora/aula. **Não entra no financeiro do clube**: não há repasse, comissão nem conta a pagar ao professor.

## 1. Entidades

### Configuração (singleton) e calendário
| Tabela | Papel | Pontos-chave |
|---|---|---|
| `fin_settings` (1 linha, `id = true`) | Regra de vencimento, política de encargos, valor do Day Card, opção de caixa do Day Card | Encargos só valem depois de `late_fee_confirmed_at` (decisão explícita do admin; "sem encargos" também é decisão). Todos os valores monetários de encargo são `NULL` até configurar. `version` p/ concorrência otimista. |
| `fin_holidays` | Feriados considerados no dia útil | `holiday_date`, `name`, `scope` (`national`/`state`/`municipal`/`club`), `kind` (`holiday`/`optional`), `active`. Únicos por `(holiday_date, scope)`. Os **nacionais** são semeados por lei (`fin_seed_holidays(ano)`, que o admin aciona em Configurações › Feriados; as mensalidades também garantem os anos que usam); locais só o admin cadastra. |

### Sócios e mensalidades
| Tabela | Papel | Restrições |
|---|---|---|
| `fin_member_plans` | Plano de mensalidade **individual** de um sócio (`profile_id`) | `start_on`, `ended_on`, `status` (`active`/`paused`/`ended`), `period_months` ∈ {1,3,6,12}, `due_day`/`due_month_offset` opcionais (override), único plano não encerrado por sócio. FK `profiles` sem `ON DELETE CASCADE` (bloqueia a exclusão). |
| `fin_member_plan_prices` | **Histórico de preço** (append-only) | `(plan_id, effective_from)` único; `effective_from` = dia 1; valor > 0; motivo. Preço da competência M = o de maior `effective_from ≤ M`. |
| `fin_member_charges` | Cobrança por período (competência) | `unique(plan_id, competence_month)` ⇒ geração idempotente. **Snapshot** do valor (`original_amount_cents`) e do `due_date`: reajuste futuro não reescreve o passado. Status gravado: `open`/`partial`/`paid`/`canceled`. |
| `fin_charge_adjustments` | Desconto, acréscimo, dispensa de encargos (append-only) | `kind` (`discount`/`increase`/`fee_waiver`), valor, **justificativa obrigatória**, ator, `before_data`/`after_data`. |
| `fin_charge_payments` | Pagamentos e estornos (append-only) | `kind` (`payment`/`reversal`), `paid_on`, divisão `fine_cents`+`interest_cents`+`principal_cents`+`excess_cents` = valor; `reverses_payment_id` único; `submission_id` opcional (comprovante que originou). |
| `fin_member_credits` | **Excedente/duplicado** nunca é descartado | `status` (`open`/`applied`/`refunded`/`void`), origem = pagamento, motivo (`excess`/`duplicate`). |

**Estados exibidos** (derivados, não gravados): `forecast` (prevista: período ainda não terminou), `open` (aberta), `overdue` (vencida), `partial`, `paid`, `canceled`, `in_review` (há comprovante `submitted`/`in_review` apontando para a cobrança). `overdue` e `in_review` nunca são gravados.

### Comprovantes
| Tabela | Papel |
|---|---|
| `fin_receipt_submissions` | Envio do sócio: arquivo (bucket privado `fin-receipts`, caminho `<uid>/<id>/<arquivo>`), `content_sha256`, valores declarados/extraídos (só campos estruturados — **o texto bruto do OCR não é gravado**), estado `submitted → in_review → approved | rejected`, `superseded`; revisor, data, justificativa. |
| `fin_receipt_charges` | Cobranças que o sócio diz estar pagando (N:N). |

OCR/leitura **só sugere**. Quitação ocorre exclusivamente em `fin_approve_receipt` (admin), que cria linhas em `fin_charge_payments`.

### Contas, categorias, caixa (porte do NJ)
`fin_accounts` (saldo inicial + data; `is_default_receipts` p/ recebimentos legados sem conta), `fin_categories` (grupo/subcategoria, `dre_line`, `system_key`), `fin_entries` (despesa/receita manual/aporte/retirada/transferência/`member_refund`; `pending|partial|paid|canceled`; competência × vencimento; o dinheiro vive em `fin_entry_payments`, com estorno por linha nova), `fin_recurrences` (gera lançamentos próprios; único `(recurrence_id, competence_date)`), `fin_attachments` (+ bucket `fin-docs`, só admin), `fin_requests` (idempotência).

### Receitas dos não-sócios (nada novo é gravado)
Nenhuma tabela nova: os dois fatos já existem no STC.
| Taxa | Origem | Como entra |
|---|---|---|
| **Aula avulsa** e **Card Mensal** (aluno) | `student_payments` ativos (no app, o plano de um dia do aluno se chama "Day Card"; no financeiro é **Aula avulsa**). `valid_until` além do dia = Card Mensal; no próprio dia = Aula avulsa. | Pelo que foi **pago e registrado**, na data do pagamento. **A aula em si não gera receita**: o dinheiro já está no pagamento (ou coberto pelo Card Mensal). Cancelado/estornado não conta. |
| **Day Card** (convidado) | Reserva `Play` com `guest_name` (`fin_private.day_card_rows`) — não há pagamento registrado | **Derivado** da reserva: valor configurado (`day_card_price_cents`, hoje R$ 50), na data da reserva; reserva isenta vale R$ 0; cancelada fica de fora. No caixa só se `day_card_in_cash` estiver ligado. |

Decisão tomada com o clube: antes (versão inicial) a aula de aluno gerava um "Day Use" derivado de R$ 50 por participante em cima do pagamento, com vínculo manual aula×pagamento para evitar duplicidade. Isso foi **removido**: duplicava a Aula avulsa paga e cobrava quem tem Card Mensal.

## 2. Como cada conceito entra nos relatórios (uma única vez)

| Fato | Origem | DRE (competência) | Caixa (data real) |
|---|---|---|---|
| Mensalidade de sócio | `fin_member_charges` | mês(es) da competência, rateada por mês no período; descontos = dedução | — |
| Pagamento de mensalidade | `fin_charge_payments` | só encargos (multa/juros) no dia do pagamento | entrada no dia (`paid_on`), conta escolhida |
| Excedente/duplicado | `fin_member_credits` | **não é receita** | entrada (passivo até aplicar/devolver) |
| Estorno | `fin_charge_payments` (`reversal`) | estorno de encargos (dedução) | saída no dia do estorno |
| Card Mensal / Aula avulsa (aluno) | `student_payments` (ativos) | data do pagamento registrado | idem (conta padrão de recebimentos) |
| Day Card (convidado) | derivado de `reservations` com convidado (`fin_private.day_card_rows`) | data da reserva, **exceto** isentas (R$ 0) e canceladas | só se `day_card_in_cash` estiver ligado (padrão: não) |
| Despesa/receita manual | `fin_entries` | `competence_date` (mais juros/desconto da baixa, pela data da baixa) | `fin_entry_payments.paid_on` |
| Transferência | `fin_entries` (2 pernas) | **nunca** | só por conta; some no consolidado |
| Aporte/retirada | `fin_entries` | memo (fora do resultado) | entrada/saída |

## 3. Regras de negócio configuráveis (decisão do clube — sem valor padrão inventado)

- **Vencimento:** padrão informado pelo clube = dia 5 do mês seguinte ao período; não útil → próximo dia útil. Útil = segunda a sexta (sábado só se a opção `saturday_is_business` estiver ligada), exceto feriados ativos. Feriados nacionais (lei): 1/1, Sexta-feira Santa, 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11 (desde 2024) e 25/12. Opcionais (desligados): Carnaval (seg/ter) e Corpus Christi. Estaduais/municipais: cadastro manual.
- **Encargos:** multa única (fixa e/ou %) no 1º dia de atraso; juros diários (fixo e/ou %) sobre o **saldo principal em aberto** (juros simples, sem juros sobre juros), carência em dias. Tudo `NULL` até o admin **confirmar** a política.
- **Imputação de pagamento:** primeiro encargos (multa, depois juros), depois principal; sobra = crédito (`fin_member_credits`).
- **Valor do Day Card:** o app já usava R$ 50 (constante em `FinanceiroAdmin`); `fin_settings.day_card_price_cents` nasce com esse mesmo valor (5000) e passa a ser editável — o `FinanceiroAdmin` recebe o valor configurado (`dayCardPriceCents`). Aula avulsa e Card Mensal **não** usam esse valor: valem o que foi pago.
- **Day Card conta como caixa** (`day_card_in_cash`, padrão `false`: o Day Card é derivado da reserva, sem pagamento registrado).

## 4. Estados e transições

- **Cobrança:** `open → partial → paid`; `open|partial → open` (estorno do último pagamento); `open → canceled` (sem pagamentos efetivos). `paid`/`canceled` são terminais (estorno reabre `paid`).
- **Comprovante:** `submitted → in_review → approved | rejected`; `submitted|in_review|rejected → superseded` (sócio reenvia). Aprovado é terminal.
- **Lançamento:** `pending → partial → paid`; `pending → canceled` (sem dinheiro movimentado); estorno do pagamento volta a `pending`/`partial`. Aporte, retirada e transferência nascem pagos; estornar cancela.
- **Plano:** `active ⇄ paused → ended`. Encerrar cancela cobranças **futuras sem pagamento** (período iniciado depois de `ended_on`); passado e pagamentos ficam.

## 5. Índices e integridade (resumo)

Únicos de idempotência: `(plan_id, competence_month)`, `(recurrence_id, competence_date)`, `request_id` em pagamentos/ajustes/lançamentos, `reverses_payment_id`. Índices de consulta: `profile_id`, `due_date` parcial `status in ('open','partial')`, `paid_date` parcial, `content_sha256`, `status` dos comprovantes. `CHECK`s: valores > 0, tetos (R$ 1 bi), listas de estados, `kind` × categoria (despesa/receita exigem categoria), transferência exige conta de destino diferente da origem, `percent_bps` ≤ 10.000.

## 6. Exclusão e arquivamento

- Nada de `ON DELETE CASCADE` em dado financeiro; FKs para `profiles` bloqueiam a exclusão. **Nenhuma tabela financeira referencia `professors`, `reservations`, `non_socio_students` ou `student_payments`**: o app apaga esses registros e o financeiro não pode travar esse fluxo (o Day Card e as taxas de alunos são lidos na origem).
- Gatilhos `before delete` (`FINANCE_NO_DELETE`) em todas as tabelas `fin_*`.
- Sócio que sai: `profiles.is_active = false` (ou deixa de ser sócio) → gatilho encerra o plano e cancela só o futuro sem pagamento. Falha do gatilho **nunca** bloqueia a edição do perfil (vira `WARNING`).
- Aluno pausado/reativado, plano de Card alterado: nenhuma tabela `fin_*` é reescrita; os vínculos usam IDs imutáveis.
