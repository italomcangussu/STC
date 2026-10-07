# João, assessor financeiro e administrativo dos administradores — mapa de evolução

> Estado em 2026-10-07. Fontes: `.fabuloso/db/` (banco real), `components/admin/adminSections.ts` (16 seções do painel),
> `supabase/functions/_shared/aiAgent/{prompts,turn}.ts`. Itens marcados **(a confirmar)** não foram verificados no código.

## 1. Onde o João está hoje

| Capacidade | Estado |
|---|---|
| Quem é administrador | `isAdminAssistant(ctx)`: conversa privada + solicitante com `is_admin`. Grupo nunca é assessor. |
| Leitura financeira | Um bloco único (`conv_svc_ai_financial_context`) entra inteiro no prompt: alunos/cards, Day Cards, pendências de sócio, preço do Day Card, PIX. **Novo:** saldo das contas (`conv_svc_ai_club_balances`). |
| Escrita financeira | 5 ações em `admin_financeiro`: `lancar`, `cobrar`, `pausar`, `retomar`, `baixa`. Protocolo: o servidor monta o resumo, só grava após o "sim" do administrador (`conv_svc_ai_admin_finance_propose` → `conv_svc_ai_confirm`). |
| Fora do financeiro | Reservas (reservar, cancelar, remarcar, consultar disponibilidade), ranking, tênis profissional, participantes. Vale para qualquer sócio, não é assessoria. |
| Mídia | Áudio é transcrito (Whisper); figurinha sozinha agora é ignorada; imagem/documento sem texto ainda transfere para a equipe. |

Limite estrutural: despejar todo o contexto no prompt não escala (cada novo domínio incharia o prompt e o custo). A evolução precisa de **consulta por domínio**.

## 2. Arquitetura-alvo (um padrão só, para tudo)

1. **Registro de capacidades** (`aiAgent/capabilities.ts`): cada capacidade é uma entrada `{ id, domínio, tipo, intenção, leitura (RPC), escrita (RPC), slots, nível de risco, texto do resumo }`. Criar capacidade nova = adicionar uma entrada + RPC + teste, sem mexer no fluxo do turno.
2. **Leitura sob demanda:** o modelo escolhe `intent` + `domain`; o servidor chama a RPC de leitura do domínio e entrega um recorte (top N, filtrado), não o banco inteiro. Ordem: classificar → buscar → responder.
3. **Escrita em 3 níveis de risco** (extensão do protocolo atual propor→"sim"→gravar):
   - **N0 leitura:** responde direto.
   - **N1 reversível/operacional** (lançar aviso, pausar cobrança, aprovar acesso): resumo + "sim".
   - **N2 financeiro** (baixa, ajuste, estorno, despesa, plano): resumo com valores, conta e data + "sim" explícito, proposta expira em minutos, uma por vez.
   - **N3 destrutivo ou irreversível** (apagar, resetar ranking, encerrar plano em massa): o João **não executa**; entrega o link da tela do painel.
4. **Identidade e auditoria:** toda escrita roda como o administrador que pediu (RPC `SECURITY DEFINER` que valida `is_admin` do telefone vinculado), grava em `admin_audit_logs` com origem "João/WhatsApp" e referencia a mensagem.
5. **Anti-alucinação:** o João nunca afirma que gravou antes do retorno da RPC; número que não veio da RPC não é dito ("não chutar", como já ocorre).
6. **Painel é a fonte da verdade:** o João chama as mesmas RPCs do painel (`fin_*`, `conv_*`, `sig_*`), nunca duplica regra de negócio.
7. **Evolução com rede:** cada capacidade nasce com teste de turno completo (PGlite + modelo roteirizado), como `aiAdminFinance.test.ts`.

## 3. Matriz por domínio (seção do painel → RPCs que já existem → João hoje → lacuna)

Prioridade: **A** alta (valor diário), **B** média, **C** baixa. Risco: N0–N3 (seção 2).

### Financeiro (seção `financeiro`)
| Função | RPCs existentes | João hoje | Lacuna / próximo passo | Prio |
|---|---|---|---|---|
| Saldo das contas | `fin_account_balances` | Lê (novo) | — | feito |
| Caixa e fluxo | `fin_cash_flow`, `fin_movements`, `fin_monthly_trend` | Não | "Quanto entrou/saiu esta semana/mês?" (N0) | A |
| DRE | `fin_dre_lines`, `fin_dre_detail`, `fin_dre_memo` | Não | Resultado do mês por categoria (N0) | B |
| A receber / a pagar | `fin_receivables_summary`, `fin_payables_summary` | Parcial (só pendências de sócio) | Inadimplência total, vencidos, previsão (N0) | A |
| Extrato de cobranças | `fin_charge_statements`, `fin_charge_statements_by_ids` | Parcial | Juros/multa por cobrança (N0) | B |
| Pendência de sócio | `fin_create_member_pendency`, `fin_send_pendency_now`, `fin_set_pendency_collection` | **Escreve** (lançar/cobrar/pausar/retomar) | — | feito |
| Baixa de pagamento | `fin_register_payment` | **Escreve** (baixa) | Baixa parcial/vários itens num "sim" (N2) | B |
| Ajustar/cancelar cobrança | `fin_adjust_charge`, `fin_cancel_charge` | Não | Desconto, correção de valor, cancelar (N2) | A |
| Estornar pagamento | `fin_reverse_payment`, `fin_reverse_entry_payment` | Não | Estorno com motivo (N2) | B |
| Perdoar juros/multa | `fin_private.waive_fees` (via painel) **(a confirmar RPC pública)** | Não | N2 | C |
| Créditos | `fin_resolve_credit` | Não | Aplicar/devolver crédito (N2) | C |
| Comprovantes | `fin_receipt_queue`, `fin_start_receipt_review`, `fin_approve_receipt`, `fin_reject_receipt`, `fin_link_receipt_charges` | Não (a baixa automática roda no servidor) | Fila ("2 comprovantes aguardando"), aprovar/rejeitar com resumo (N2) | A |
| Lançamentos (receita/despesa) | `fin_create_entry`, `fin_update_entry`, `fin_pay_entry`, `fin_cancel_entry`, `fin_attach_file` | Não | "Lança despesa de R$ X na categoria Y" (N2) | A |
| Recorrências | `fin_save_recurrence`, `fin_generate_recurrences`, `fin_delete_recurrence` | Não | Consultar; criar (N2); excluir = N3 | C |
| Planos e preços de sócio | `fin_create_member_plan`, `fin_update_member_plan`, `fin_end_member_plan`, `fin_set_plan_price`, `fin_generate_member_charges` | Não | Consultar plano/preço (N0); gerar cobranças do mês (N2) | B |
| Contas, categorias, feriados, configurações | `fin_save_account`, `fin_save_category`, `fin_save_holiday`, `fin_save_settings` | Não | Só consulta; edição fica no painel (N3 por política) | C |
| Alunos: receita | `fin_student_revenue`, `student_payments` | Parcial (cards) | Receita de aulas por professor (N0) | B |

### Pessoas
| Seção | O que o painel faz | João hoje | Próximo passo | Prio |
|---|---|---|---|---|
| `acessos` | Aprovar novos cadastros (`access_requests`) | Não | "Quem está esperando?" + aprovar/recusar (N1) | A |
| `socios` | Editar sócio, papel, ativo/inativo (`profiles`, `members`) | Só nome/ranking | Consultar ficha e situação (N0); ativar/inativar (N1); trocar papel = N3 | B |
| `alunos` | Alunos, dependentes, planos, níveis (`non_socio_students`, `student_profiles`) | Cards no contexto | Consultar aluno; pausar/reativar (N1); renovar card com baixa (N2) | A |
| `professores` | Professores e agenda (`professors`) | Não | Agenda do dia/semana por professor (N0) | B |

### Quadra e competições
| Seção | O que o painel faz | João hoje | Próximo passo | Prio |
|---|---|---|---|---|
| `reservas` | Ver/cancelar horários (`reservations`) | Reserva/cancela/remarca como sócio | Visão administrativa: ocupação, cancelar em nome de outro, bloquear horário (N1) | A |
| `desafios`, `lancamentos`, `superset` | Desafios, jogos, pontos, reset de ranking (`challenges`, `matches`, `point_history`) | Só lê ranking | Lançar resultado (N1); reset = N3 | C |
| `torneios`, `formularios` | Campeonatos, chaves, inscrições, votações (`championship_*`, `club_form_*`) | Não | Consultar inscritos/chaves (N0); inscrever (N1) | C |

### Clube
| Seção | O que o painel faz | João hoje | Próximo passo | Prio |
|---|---|---|---|---|
| `conversas` | Inbox, notas, follow-ups, automações, IA (`conv_*`) | É o próprio canal | "Resumo das conversas sem resposta", criar follow-up, aprovar execução de automação (`conv_automation_approve_run`) (N1) | B |
| `documentos` | Assinaturas dos sócios (`sig_*`) | Não | Quem ainda não assinou (N0), reenviar falhas (`sig_resend_failed`, N1) | B |
| `avisos` | Comunicados (`announcements`) | Não | Publicar aviso com texto aprovado pelo administrador (N1) | B |
| `regras` | Configurações do clube | Não | Consulta apenas | C |
| `dashboard` | Indicadores | Não | Resumo diário/semanal proativo (ver seção 4, onda 4) | A |

## 4. Roadmap em ondas (cada onda entrega valor sozinha e mantém o padrão)

- **Onda 0 — fundação (faz tudo o resto ficar barato):** registro de capacidades, leitura por domínio (sai o bloco único), níveis N0–N3, auditoria com origem WhatsApp, `intent` de domínio no prompt, testes de contrato do registro. Migra as 5 ações atuais para o registro sem mudar comportamento.
- **Onda 1 — ver tudo (só N0, risco zero):** caixa/fluxo, a receber/a pagar, DRE, saldo (feito), receita de alunos, acessos pendentes, fila de comprovantes, quem não assinou, ocupação da quadra.
- **Onda 2 — financeiro completo (N2):** ajustar/cancelar cobrança, estornar, lançar despesa/receita, aprovar/rejeitar comprovante, gerar cobranças do mês, baixa em lote.
- **Onda 3 — administrativo (N1):** aprovar acessos, ativar/inativar sócio e aluno, publicar aviso, follow-ups, reenviar assinaturas, bloquear/cancelar horário.
- **Onda 4 — proativo:** resumo diário/semanal enviado ao administrador (fechamento de caixa, inadimplência, comprovantes parados, documentos vencendo), alertas por regra (saldo abaixo do mínimo, cobrança vencida há N dias). Usa o motor de automações que já existe.
- **Onda 5 — memória e inteligência:** preferências do administrador (formato do relatório, contas padrão), comparativos mês a mês, "por que a receita caiu?", sugestão de ação com confirmação.

## 5. Decisões que são suas
1. **Quem é "administrador" para o João?** Hoje é `is_admin` do telefone vinculado. Haverá níveis (ex.: tesoureiro só financeiro, secretário só pessoas)? Recomendo permissões por domínio desde a Onda 0.
2. **O que é N3 (nunca por chat)?** Proposta: apagar qualquer coisa, reset de ranking, trocar papel de sócio, editar configurações, encerrar plano. Diga o que sai ou entra.
3. **Limite de valor:** acima de R$ X o João exige confirmação em dois passos ou manda para o painel?
4. **Resumos proativos:** quais, em que horário, para quais administradores.
5. **Grupo de administradores:** o assessor deve funcionar também num grupo só de admins ou só no privado (hoje só privado)?
