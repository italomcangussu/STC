# Conversas e WhatsApp — modelo e garantias

Complementa o [diagnóstico](./DIAGNOSTICO.md) (escrito antes do código) e o [guia de operação](./OPERACAO_E_MIGRATIONS.md).
Aqui está **o que foi construído**, como as peças se ligam e **o que cada garantia depende**.

## 1. Um módulo, uma conexão, um histórico

```
 WhatsApp (UazAPI, 1 instância)  ──webhook──▶  whatsapp-webhook ──▶ conv_private.ingest_message ─┐
                                                                                                 ▼
 Administrador (tela Conversas) ─▶ conversation-operations ─▶ queue → provedor → finish ─▶  conv_messages
 IA (turno do agente)           ─▶ (mesma fila de saída)                                   (origin: customer | staff | ai | automation | system)
 Automações / retornos          ─▶ conversations-dispatch ─▶ (mesma fila de saída)
```

- **Uma única tabela de mensagens** (`conv_messages`) guarda o que o contato disse e o que saiu pela equipe, pela IA
  e pelas automações. A coluna `origin` identifica quem produziu; a tela mostra um selo “IA” ou “Automação” no
  balão. **Não existe histórico paralelo da IA**: o contexto do modelo é lido dessa mesma tabela.
- **Uma única conexão** de WhatsApp (a instância do clube). Nenhuma das três capacidades abre outra.
- Estados da mensagem (`queued → sent → delivered → read`, `failed`) só avançam com resposta **real** do provedor;
  `finish_message` é o único que marca “enviada”. Falha deixa `failed` com um código curto (nunca o corpo do provedor).

## 2. Tabelas (`public.conv_*`, schema privado `conv_private`)

| Tabela | Papel |
|---|---|
| `conv_channel` | singleton: identidade da conta institucional (`bot_phone`, `bot_lids`), hash do token do webhook, chaves da IA (1:1 e grupos), `mention_verified_at` |
| `conv_groups` | grupos detectados; `status` detectado/permitido/bloqueado; `ai_enabled`; só **nomes** de campos do último payload |
| `conv_contacts` | telefone/LID, nome, vínculo com sócio ou aluno (`link_status`), `opt_out` |
| `conv_conversations` | direta ou de grupo; estado, etiquetas, responsável, `ai_status` (ai/human/paused), transferência |
| `conv_messages` | histórico único (ver acima); `mention_direct` + `mention_evidence` por mensagem de grupo |
| `conv_quick_replies`, `conv_notes`, `conv_followups` | respostas rápidas, notas internas (imutáveis), retornos agendados |
| `conv_ai_settings`, `conv_ai_sessions`, `conv_booking_proposals`, `conv_ai_decisions` | configuração versionada, sessão por conversa (ou grupo+solicitante), propostas de reserva, decisões |
| `conv_automations`, `conv_automation_versions`, `conv_automation_runs`, `conv_automation_recipients`, `conv_automation_settings` | regras versionadas, execuções, destinatários com dedupe, regras gerais de envio |
| `conv_requests`, `conv_webhook_log` | idempotência das operações do administrador; registro sem conteúdo |

Nenhuma tabela existente do STC foi alterada. As tabelas `crm_*` (de outro produto, RLS aberta) **não** são usadas.

## 3. Quem acessa e como é imposto

- **Só administrador** (`profiles.role = 'admin'` via `public.is_admin()`, a mesma regra do financeiro). Não há
  papel novo.
- **Banco**: RLS habilitada em todas as `conv_*` com política `select … using (public.is_admin())`; `anon`/`authenticated`
  não têm `INSERT/UPDATE/DELETE` em nenhuma. Toda escrita é por função `SECURITY DEFINER` que começa em
  `conv_private.require_admin()`. As funções de serviço (`conv_svc_*`) só têm `EXECUTE` para `service_role`.
  O hash do token do webhook não é legível nem pelo administrador (grant por coluna).
- **Função de borda** `conversation-operations`: exige JWT, confere origem permitida e o papel de administrador **no
  banco** (o papel nunca vem do corpo). Recusa antes de qualquer ação.
- **Tela**: o item “Conversas” só existe no painel do administrador; esconder o botão **não** é a proteção.
- Testes: `sql/access.test.ts` (sócio, professor, lanchonete e anônimo não leem nada; ninguém escreve direto),
  `conversationOperations.test.ts` (token ausente/inválido, admin inativo, papel fora do corpo).

## 4. Webhook e mensagens individuais

- O provedor chama `whatsapp-webhook?token=…`. O token é gerado pelo painel, guardado **só como SHA-256**,
  comparado em tempo constante. Resposta 200 imediata; o processamento roda em segundo plano e é **idempotente**
  (`provider_message_id` único) — webhook repetido não duplica mensagem, conversa, contato nem resposta da IA.
- Mensagem enviada pelo celular do clube é gravada como equipe e **não** aciona a IA; o que o clube enviou pela API
  é ignorado na volta (já foi gravado ao enfileirar).
- Telefone → sócio/aluno: o vínculo é automático **só quando o candidato é único** (tolera o nono dígito); ambíguo
  fica “a confirmar” e o administrador decide no painel do contato.
- Mídia recebida: baixada já decifrada, guardada no bucket privado `conv-media` (`in/<id>/…`), ligada à mensagem;
  sem arquivo, a mensagem fica sem mídia (nunca se inventa).
- Resposta **manual** do administrador numa conversa direta assume a conversa (a IA para). IA, automação e retorno
  não assumem.

## 5. Grupos e menção direta — o que está e o que não está provado

**Construído** (`_shared/groupMention.ts`, `uazWebhook.ts`, `whatsapp-webhook/record.ts`, `conv_private.ai_trigger`):

- Um grupo novo vira só **“detectado”**: nenhuma mensagem, contato ou conversa é gravada. O administrador **permite**
  ou bloqueia. Só grupo permitido grava, com o **remetente individual**.
- A mensagem de grupo ganha `mention_direct` (sim/não) e `mention_evidence` (por quê). “Sim” exige uma **lista
  estruturada** de menções no payload que contenha o telefone ou LID **configurado** da conta institucional.
  Nunca vale: texto digitado (“STC Institucional”), `@all`/`@todos`/`@everyone`, menção a outra pessoa, lista com
  mais de 3 menções, identidade da conta não configurada, ausência de lista. Sem metadado, o sistema registra
  “não consigo distinguir” e **não aproxima**.
- A IA em grupo só liga com **três** condições juntas: chave de grupo ligada no canal, grupo com IA ligada e
  `mention_verified_at` preenchido por um administrador.
- Continuação no grupo: só o **mesmo solicitante**, enquanto a sessão vale (padrão 15 min) e a IA espera resposta;
  resposta que **cita** a fala da IA também vale (solicitante ou administrador); outro participante é ignorado.
  O contexto enviado ao modelo é só o solicitante + IA da sessão — nada das conversas dos outros.

**Não comprovado neste trabalho** (a documentação primária do UazAPI/Meta não pôde ser aberta e não houve payload
real de grupo do STC): o **nome do campo** em que o provedor entrega as menções recebidas; se `@all` chega expandido
ou como marcador; se o remetente de grupo chega como telefone ou LID. O detector lê os lugares conhecidos
(`contextInfo.mentionedJid` e variantes) e a tela **Canal → Menção direta** mostra, mensagem a mensagem, como cada
uma foi classificada e quais **campos** o provedor entregou — é com isso que o administrador confere antes de
marcar “verificada”. **Enquanto não houver essa conferência, a IA não atende grupos.**

## 6. IA de atendimento e reserva

- Um turno = **uma** chamada ao modelo (a memória volta no mesmo JSON). O modelo **não tem ferramentas**: devolve
  intenção e dados; o servidor resolve pessoas, consulta disponibilidade, monta a proposta e só grava depois do “sim”.
- Texto de **proposta, sucesso e erro de reserva é escrito pelo servidor** com o que o sistema retornou. Se o modelo
  tentar “anunciar” sucesso (“reservei”, “confirmado”…), o texto é trocado (`claimsSuccess`).
- Reservar exige: solicitante identificado como sócio ativo (ou admin/professor para aula); participantes
  resolvidos de forma única (ambíguo/inexistente → pergunta, nunca escolha por aproximação); quadra livre
  **no motor** (`conv_private.court_busy`); proposta aberta e dentro da validade.
- Confirmar exige: mensagem do **mesmo solicitante** (ou administrador) **posterior à proposta**, que passe na
  lista de confirmações explícitas (“sim”, “pode confirmar”, “fechado”; “talvez/vou ver” não valem).
- Na gravação (`conv_private.ai_confirm`): trava consultiva por quadra/dia, **revalidação completa** (disponibilidade
  e regras) e criação idempotente — a chave da proposta (`request_key`) e o `reservation_id` ficam na mesma
  transação; confirmação repetida devolve a mesma reserva. Falha ⇒ nenhuma reserva, nenhuma mensagem de sucesso.
- Cancelar e remarcar: só reservas **futuras** da própria pessoa (ou admin), sempre com proposta + confirmação;
  remarcar é atômico (nova reserva + antiga cancelada, sem conflito com a própria).
- **Origem rastreável**: `reservations.observation = 'Reserva via WhatsApp (IA)'`, `conv_booking_proposals.reservation_id`
  e linha de auditoria `ai_reservation_created` (`source = 'whatsapp'`, conversa e grupo). A tabela `reservations`
  não tem coluna de origem e **não foi alterada**.
- Regras de reserva **espelhadas** em SQL (`validate_reservation`): grade 05:00–22:30 de 30 em 30, fim ≤ 23:00,
  Play 60/90/120, Aula 30 min só na Quadra Rápida e só para admin/professor, ≤ 8 participantes, Card Mensal e
  aluno ativo, não-sócio fora do horário permitido. **Day Card Experimental → equipe.** Diferença deliberada do
  app: conflito de quadra é **bloqueio duro** (o app só avisa).
- Travas de custo/ruído: IA desligada ou sem modelo não chama ninguém; buffer; “só a última mensagem responde”;
  teto de turnos por dia (`daily_turn_budget`) e por conversa (`max_turns`); palavra de transferência e mídia sem
  texto vão para a equipe sem gastar o modelo; JSON inválido do modelo vira transferência.
- A IA **nunca** altera pagamento, comprovante, placar ou resultado e não fala de cobrança (transfere).

## 7. Automações

| Automação | Fonte da verdade | Implementado | Depende de configuração |
|---|---|---|---|
| Mensalidade: início do período, antes do vencimento, em atraso, comprovante em análise | `fin_private.charge_rows` (a mesma leitura do Financeiro) | ✔ público, dedupe, revalidação no envio | `{{encargos}}` só com a política de multa/juros **confirmada** (`fin_settings.late_fee_confirmed_at`) |
| Card Mensal a vencer / vencido | `non_socio_students` (`plan_type`, `plan_status`, `master_expiration_date`) + `student_profiles` | ✔ | — |
| Resultado de partida | `matches` encerradas com resultado completo e “assentado” (`settle_minutes`) | ✔ por evento | `result_set_at` do campeonato (ver limitações) |
| Avanço de fase | só quando o motor de chaveamento já pôs o vencedor na próxima partida | ✔ | — |
| Aviso a participantes de campeonato / a públicos (sócios, alunos, dependentes, professores, Card) | `championships`/`championship_registrations`, `profiles`, `non_socio_students` | ✔ manual (com revisão) ou agendado | — |

**Convivência com a regra de vencimento do Financeiro** (decisão do clube de 2026-10-06, migration `20261006100500`): a cobrança
vence no **mês cobrado** e só **fins de semana** são dia não útil. As automações **não recalculam nada**: leem `due_date`,
`days_late` etc. de `fin_private.charge_rows`, então já seguem a regra (testado com a cobrança gerada pelo próprio financeiro:
`sql/automations` › "regra do clube"). Efeito prático: como o vencimento agora cai no mesmo mês da competência, “Início do
período” e “Antes do vencimento” podem alcançar a **mesma cobrança em dias vizinhos** (ex.: 02–03/10 com vencimento 05/10).
O teto por contato segura a rajada (ver abaixo); se o clube quiser **uma só** mensagem antes do vencimento, ative apenas uma das duas.

Regras comuns: janela de horário e dias (Fortaleza), `min_hours_between`, teto diário e semanal **por contato somando
todas as automações, contando também o que já está em envio no mesmo lote**, opt-out (“parar”, “não quero receber”…) cancela o pendente, pausa/encerramento cancelam o que não
saiu, **variável sem valor ⇒ a mensagem não sai** (nunca texto com lacuna), uma pessoa não recebe duas vezes o mesmo
aviso (`purpose_key + dedupe_key`), falha de um destinatário não afeta os outros (3 tentativas: 10 e 20 min), disparo
manual fica em **revisão** até um administrador aprovar. O texto das automações **não é gerado por IA**.

## 8. Auditoria

Ações registradas em `admin_audit_logs` (`source = 'conversations'`, ou `'whatsapp'` para reservas da IA), sem
token, sem payload bruto, sem corpo de mensagem: `channel_save`, `token_rotate` (só “rotacionado”), `mention_verified`,
`ai_channel`, `group_set`, `ai_status` (assumir/devolver/pausar), `ai_handoff`, `ai_settings_save`,
`ai_reservation_created/canceled`, `contact_link`, `contact_opt_out`, `opt_out`, `automation_create/update/active/paused/ended`,
`automation_settings_save`, `manual_dispatch`, `run_canceled`, `run_retry`, `automation_send_failed`.

## 9. Mapa dos 40 itens de aceite → testes

Execução: `npx vitest run __tests__/conversations` (PGlite = Postgres real em memória, **todas as 4 migrations**).

| # | Item | Onde é provado |
|---|---|---|
| 1 | Admin acessa | `sql/access` (admin lê), `ui/conversationsHub` (módulo abre), `adminNav` (seção `conversas` em `adminSections`) |
| 2 | Não autorizados barrados (UI, API, banco) | **Banco**: `sql/access`; **API**: `conversationOperations` (401/403); **UI**: item só no painel do admin + erro de acesso em frase (`ui/conversationsApi`, `ui/conversationsHub`) |
| 3 | Layout/ações = chat do NJ | componentes portados do NJ (lista, bolha, compositor, painel, respostas rápidas, encaminhar, busca, rascunho, digitando); `ui/*` testa envio, assumir, histórico; **conferido por captura de tela** em 1280 px e 390 px (harness temporário, removido). Não há teste de regressão visual automatizado |
| 4 | Ordem e estados só do provedor | `sql/ingest` (`finish_message` único a marcar enviada; estados só avançam), `ui/messageTimeline` |
| 5 | Erro de envio sem credencial | `uazChat` (erro = só código), `conversationOperations` (502 com código), `ui/conversationsHub` (frase + “tentar de novo”) |
| 6 | Individuais seguem os fluxos | `sql/ingest`, `webhookFunction` |
| 7 | Webhook duplicado | `sql/ingest` (mesmo evento), `webhookFunction` (gatilho da IA uma vez) |
| 8 | Grupo identificado | `uazWebhook`, `sql/ingest` (grupo detectado/permitido) |
| 9 | Menção direta só com metadado | `uazWebhook`, `webhookFunction`, `sql/ai` (grupo), `aiTurn` |
| 10 | `@all`, `@todos`, terceiro, texto digitado não acionam | `uazWebhook`, `aiTurn` (“sem menção direta o modelo nem é chamado”) |
| 11 | Resposta associada à conversa certa | `sql/ai` (citação e continuação), `aiTurn` |
| 12 | Sem herdar contexto de outro grupo/remetente | `sql/ai` (contexto só do solicitante), `aiTurn` |
| 13 | Sem metadado, não finge | `uazWebhook` (“sem lista = sem metadado”), `webhookFunction` (evidência diz por quê) |
| 14 | Falha/evento desconhecido/payload inválido | `webhookFunction`, `uazWebhook`, `sql/ingest` |
| 15 | Pedido incompleto → pergunta | `aiTurn` |
| 16 | Sem inventar data/hora/pessoa/quadra | `aiTurn`, `aiPure`, `sql/reservation` (resolução de pessoas, quadras) |
| 17 | Ambíguo/não identificado bloqueia | `aiTurn`, `sql/reservation` |
| 18 | Disponibilidade do motor real | `aiTurn` (turno × SQL real), `sql/reservation` |
| 19 | Resumo + pedido de confirmação | `aiTurn` |
| 20 | Sem reserva sem confirmação explícita | `sql/reservation` (“talvez” não vale), `aiTurn` |
| 21 | Confirmação de outra pessoa | `sql/reservation` |
| 22 | Revalidação antes de gravar | `sql/reservation` |
| 23 | Mesmo fluxo/tabela, origem rastreável | `sql/reservation` (cria em `reservations`, observação, auditoria) — **ver limitação 3** |
| 24 | Retry/duplicidade | `sql/reservation` (confirmação repetida, dois pedidos para o mesmo horário), `webhookFunction` |
| 25 | Falha não anuncia sucesso | `aiTurn` (“o modelo diz que reservou…”), `aiPure` (`claimsSuccess`) |
| 26 | Cancelar/remarcar com confirmação | `sql/reservation`, `aiTurn` |
| 27 | Agendamento no momento e fuso | `sql/automations2` (horário de Fortaleza, uma vez) |
| 28 | Mensalidade: só elegíveis | `sql/automations` |
| 29 | Paga/cancelada/inelegível não recebe | `sql/automations` (inclui pagamento entre varredura e envio) |
| 30 | Variável/encargos indisponíveis | `sql/automations`, `ui/automationModel` (paridade com o banco) |
| 31 | Campeonato: estado confirmado | `sql/automations2` |
| 32 | Card Mensal: estado e validade reais | `sql/automations` |
| 33 | Sem duplicidade entre públicos | `sql/automations`, `sql/automations2` |
| 34 | Pausar interrompe | `sql/automations` |
| 35 | Retry não duplica | `sql/automations`, `dispatch` |
| 36 | Falha de um não marca os outros | `sql/automations`, `dispatch` |
| 37 | Opt-out | `sql/ingest`, `sql/automations` |
| 38 | Permissões e RLS por papel | `sql/access` |
| 39 | Auditoria sem secrets | `sql/access` (rastro sem token), `sql/automations2`, `conversationOperations` (token não volta) |
| 40 | Sem regressão | suíte completa: 100 arquivos / 1137 testes; `tsc` limpo; `eslint` 0 erro (13 avisos, os mesmos de antes); `build` ok |

## 10. Limitações e débitos conhecidos (não escondidos)

1. **Banco remoto não inspecionado** (o conector recusou `execute_sql`/`list_tables`/`list_migrations`). As migrations
   foram escritas contra as migrations versionadas e validadas em PGlite; **podem divergir do remoto** (pasta legada
   `migrations/`, SQLs soltos). Conferir no ambiente de teste antes de produção.
2. **Documentação primária do UazAPI/Meta não foi aberta** e **nenhum payload real de grupo foi visto**: menção,
   remetente em grupo e `@all` são **não comprovados** (seção 5). A IA em grupo fica bloqueada até a verificação humana.
3. **Não há motor de reserva no servidor** (o app grava por `INSERT` direto). A IA grava na mesma tabela com as regras
   **espelhadas** em SQL; se o app mudar uma regra, a função precisa mudar junto. Débito: o app deveria chamar a mesma função.
4. **Aula e Day Card Experimental**: aula só para admin/professor com aluno informado; Day Card Experimental sempre vai para a equipe.
5. **Resultado/avanço de campeonato**: o resultado só é avisado com `result_set_at` preenchido e “assentado”;
   **classificação de grupo** (avanço de grupos) não é inferida — só o que o motor de chaveamento já definiu.
6. **Agendador não está instalado por esta entrega** (`conversations-dispatch` precisa ser chamada periodicamente) —
   ver operação. Sem ele, automações agendadas, retornos e expiração de sessão não rodam; o chat e a IA funcionam.
7. **UazAPI não é oficial** (número ligado por QR): risco de bloqueio do número pelo WhatsApp; a Cloud API oficial é outra
   integração, não adotada.
8. Custos de IA dependem do modelo escolhido; o teto diário de turnos limita, mas não converte em reais.
9. Débitos **anteriores** vistos e **não alterados**: `send-push` com chaves VAPID no código, `support_messages` com
   admin por e-mail fixo, `crm_*` com RLS aberta.
