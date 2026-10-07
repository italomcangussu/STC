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

## 1b. Onda 0 entregue (2026-10-07)
- `supabase/functions/_shared/aiAgent/capabilities.ts`: registro (domínio, risco N0–N3, leitura, escrita), limite de R$ 400 e regras N3. Migradas as 5 ações + saldo.
- Leituras do administrador carregadas pelo registro (`ADMIN_READS`), só para admin no privado.
- N3: o servidor recusa e indica a seção do painel, sem chamar o modelo.
- R$ 400 ou mais: segunda confirmação repetindo o valor, **no banco** (`20261007210000_conversations_admin_second_confirm.sql`; `ai_confirm` envolve o ramo financeiro).
- Auditoria com origem WhatsApp já existia (`conv_private.audit('ai_admin_finance', …, source: 'whatsapp')`).
- Ainda não feito da onda: leitura **sob demanda por domínio** do bloco financeiro (hoje segue inteiro no prompt); entra junto com a Onda 1, quando houver mais de uma leitura grande.

## 1c. Onda 1 entregue (2026-10-07) — ver tudo, só leitura (N0)
Intent `admin_consulta` + `conv_svc_ai_admin_read(session, domínio, args)`: roda como o administrador (mesmas funções do painel), só no privado com admin, audita (`ai_admin_read`). O servidor escreve o texto (`aiAgent/adminReads.ts`); o modelo só escolhe domínio e período. Resposta numa mensagem só (`verbatim`).
Domínios: `caixa`, `receber_pagar`, `dre` (com período anterior), `receita_alunos`, `comprovantes`, `acessos`, `assinaturas`, `ocupacao`. Todos verificados contra o banco real. Limite de período: 731 dias.
Próximo: Onda 2 (financeiro completo, N2).

## 1d. Onda 2 entregue (2026-10-07) — financeiro completo (N2)
Novas ações em `admin_financeiro` (proposta com resumo → "sim" → segunda confirmação a partir de R$ 400 → grava pelas funções do painel, como o administrador, com auditoria): `cancelar_pendencia` (`fin_cancel_charge`; o banco recusa se já há pagamento), `ajustar` (`fin_adjust_charge`: desconto, acréscimo ou perdão de juros/multa), `estornar` (`fin_reverse_payment`: último pagamento da pendência ou do sócio), `rejeitar_comprovante` (`fin_reject_receipt`: por sócio e dia) e `despesa`/`receita` (`fin_create_entry`: categoria e conta pelo nome). Motivo é obrigatório em cancelar, ajustar, estornar e recusar. Migration `20261007240000` (encadeia com a de renovar Card: `ai_confirm` → … → `ai_confirm_single_step` → `ai_confirm_pendency_step`).
**Ficam só no painel (decisão técnica):** aprovar comprovante (exige alocar cobranças e conta) e gerar cobranças do mês (por plano). O João indica o painel.
Próximo: Onda 3 (administrativo, N1).

## 1e. Onda 3 entregue (2026-10-07) — administrativo (N1, reversível)
Intent `admin_acao` + `conv_svc_ai_admin_adm_propose` (ações `adm_*`; mesmo protocolo: resumo → "sim" → grava como o administrador, auditoria `ai_admin_action`): `aviso` (publica no app, mostra o texto inteiro antes), `aviso_desativar`, `aluno_status` (pausar/reativar), `socio_status` (inativar/reativar; acha inativo pelo nome; **administrador é protegido**), `assinatura_reenviar` (`sig_resend_failed`), `reserva_cancelar` (por dia, horário, quadra e quem reservou; ambígua pede detalhe). A CHECK de `conv_booking_proposals.action` agora é lida do banco e só acrescentada (nunca mais apaga ação de outra migration).
**Ficam só no painel:** aprovar/recusar pedido de acesso (função de borda que cria o usuário) e criar follow-up (depende de conversa).
Próximo: Onda 4 (resumo proativo da manhã para Hermeson e Henrique).

## 1f. Onda 4 entregue (2026-10-07) — resumo da manhã
Edge function `joao-admin-briefing` (sem JWT; só com `x-dispatch-secret`, igual às outras varreduras) chamada pelo cron `joao-admin-briefing` às **11:00 e 11:30 UTC (08h00 e 08h30 de Fortaleza; a segunda é só reenvio)**. Destinatários: tabela `conv_admin_briefing_recipients` (hoje **Hermeson Veras e Henrique Coelho**; para incluir/tirar alguém: inserir/apagar a linha ou `enabled = false`). Cada um recebe uma mensagem na conversa direta dele com o João (a resposta cai no mesmo fio), com: caixa e saldo, ontem e mês, a receber e a pagar (vencido), comprovantes parados, assinaturas incompletas com prazo, pedidos de acesso e reservas de hoje; o que está zerado some. Números lidos como o administrador (`conv_svc_admin_briefing_data`), texto montado sem IA (`_shared/adminBriefing.ts`). Idempotente por dia e administrador; só envia entre 08h e 12h de Fortaleza; respeita opt-out; `{"dry_run": true}` devolve os textos sem enviar.
**Onda 5 (parcial, 2026-10-07):** consulta `comparativo` ("por que a receita caiu?": período contra o anterior de mesma duração, com as categorias que mais mudaram, texto escrito pelo servidor) e sugestões no resumo da manhã (só apontam para consultas). **Fora:** memória de preferências do administrador (esperar uso real do resumo para saber o que guardar) e ações sugeridas pelo próprio João.

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

## 5. Decisões do clube (2026-10-07)
1. **Um único nível de administrador.** Todo `is_admin` tem o mesmo acesso; perde as funções do João assim que deixa de ser administrador (a checagem é feita a cada turno, sem lista própria). Sem permissões por domínio.
2. **N3 (nunca por chat) confirmado:** apagar qualquer coisa, reset de ranking, trocar papel de sócio, editar configurações, encerrar plano. O João só entrega o link da tela do painel.
3. **Limite de valor: R$ 400.** Operação N2 de R$ 400 ou mais exige confirmação em dois passos (resumo + "sim", depois confirmação do valor por extenso). A regra vale por operação e também para a soma de um lote.
4. **Resumo proativo pela manhã** para **Hermeson** e **Henrique** (horário a fixar na Onda 4; sugestão 08h00 de Fortaleza). Conteúdo inicial: caixa e saldo das contas, a receber vencido, comprovantes parados, documentos sem assinatura vencendo.
5. **Só no privado.** O assessor não funciona em grupo, nem de administradores.


## Onda 6 (2026-10-07)
Entregue: aprovar comprovante (valor lido, distribuído da cobrança mais antiga para a mais nova; ilegível ou sobra vão ao painel) e gerar cobranças do mês (idempotente). Ambos N2, com segundo passo a partir de R$ 400. Fora, sem função própria para reutilizar: aprovar/recusar acesso (borda cria o usuário), follow-up e bloquear horário; baixa em lote é coberta pela aprovação de comprovante.
