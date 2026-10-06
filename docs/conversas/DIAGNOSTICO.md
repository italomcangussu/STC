# Conversas e WhatsApp — diagnóstico (antes da implementação)

Escrito **antes** de qualquer migration ou código do módulo. Data: 2026-10-06.
Escopo: criar em `italomcangussu/STC` o módulo **Conversas** (chat administrativo + automações + IA) usando o
`italomcangussu/northjato` (NJ) como referência. O NJ **não foi alterado**; só lido.

> Limites desta investigação (ditos de início para não parecerem prova):
> 1. **O banco remoto do STC não foi inspecionado.** O conector Supabase da sessão recusou `execute_sql`,
>    `list_tables` e `list_migrations` ("sem permissão"). O modelo abaixo vem das **migrations versionadas** em
>    `supabase/migrations/` e do código. O remoto ainda tem a pasta legada `migrations/` e SQLs soltos, então pode
>    divergir; os pontos que dependem disso estão marcados como **a conferir**.
> 2. **A documentação primária do UazAPI e da Meta não pôde ser aberta** (o proxy de saída bloqueia
>    `docs.uazapi.com` e `developers.facebook.com`). O que se afirma sobre elas vem de buscas e de trechos de
>    terceiros, e está rotulado como tal na seção 4.

---

## 1. O que o Norte Jato já oferece para WhatsApp

Provedor: **UazAPI (uazapiGO)**, uma instância própria, números ligados por QR. Tudo abaixo foi lido no código.

| Capacidade | Onde está (NJ) | Reaproveitável no STC? |
|---|---|---|
| Cliente HTTP e contratos de envio (`/send/text`, `/send/media`, `/message/react|edit|delete|markread|presence|download`, `/chat/details`) | `supabase/functions/_shared/uazChat.ts` | **Sim, direto** (puro, sem domínio) |
| Instância: status, conectar, desconectar, registrar webhook | `_shared/whatsappInstance.ts` | **Sim**, trocando só os nomes das variáveis de ambiente |
| Normalização do webhook (mensagem, reação, edição, apagar, status, digitando) | `_shared/uazWebhook.ts` | **Com adaptação**: o NJ **descarta grupos** (`reason: 'grupo'`) e não lê menções |
| Gravação do webhook (RPC de ingestão idempotente por `provider_message_id`, mídia no Storage, retry de "[Undecryptable]") | `whatsapp-webhook/{handler,record,index}.ts` | **Com adaptação** (o NJ repassa também ao n8n; o STC não tem n8n para isto) |
| Autenticação do webhook por token na URL (comparação em tempo constante) | `whatsapp-webhook/handler.ts` | **Sim**, mas guardando só o **hash** do token |
| Modelo de conversa/mensagem (estados `queued/sent/delivered/read/failed/received`, não lida, status do provedor só avança, reações, edição, "apagar para todos", resposta citada, mídia) | migrations `20260926090000`, `20260926110000` | **Com adaptação** (o NJ liga a conversa a `nj_customers`; o STC não tem "cliente") |
| Envio com idempotência (chave do cliente = linha única; `queue → provedor → finish`) | `nj_private.queue_staff_message(_v2)`, `finish_staff_message` | **Sim** (mesmo desenho) |
| Telas: lista, conversa, compositor, painel do contato, respostas rápidas, encaminhar, busca, rascunho, digitando | `src/features/conversations/*` | **Com adaptação visual** (design system, ícones, tokens) |
| Notas e **retornos agendados** (lembrete ou mensagem que sai sozinha) | `nj_chat_notes`, `nj_chat_followups`, `_shared/chatFollowups.ts` | **Sim** |
| IA: dois agentes (Memória + Atendente), buffer, "vencedor" (só a última mensagem responde), guarda de takeover, cadência de bolhas, soft-fail em todo parse, transferência `soft`/`hard`, limite de turnos, palavras de transferência, versão de configuração por decisão | `_shared/aiAgent/*`, `20260926130000_ai_attendant.sql` | **Motor sim; prompts/ferramentas não** (são de lava-jato) |
| Agendar por IA = **proposta + confirmação explícita** (`ai_propose_booking`/`ai_confirm_booking`, prova = mensagem do cliente) | `ai_attendant.sql` | **Padrão sim**; as funções de agenda não (domínio) |
| Automações (regra versionada → execução → fila de jobs com `skip locked`, revalidação no envio, janela de horário, teto diário/semanal, opt-out, eventos imutáveis) | `20260927160000_crm_automations.sql`, `_shared/automations.ts` | **Padrões sim**; o motor de fluxo/lavagem não (cliente-centrado, multi-etapa) |
| Cliente de IA compatível com OpenAI (OpenRouter por padrão) e reparo de JSON | `_shared/aiAgent/llm.ts`, `jsonRepair.ts` | **Sim, direto** |
| Autorização das escritas (token → papel → permissão, nunca do corpo) | `_shared/staffRequest.ts` | **Com adaptação**: STC usa `profiles.role = 'admin'`, sem permissões finas |

**Descartado do NJ**: permissões `crm.read/crm.write/automation.*` (STC não tem esse sistema e a regra pede para
**não criar sistema paralelo de papéis**); `nj_customers`/OS/agendamento/fidelidade/lavagens; etapas de funil
("orçamento", "agendado"…); repasse ao n8n; push do NJ; a IA do NJ não responde em grupo.

**Observação importante sobre o NJ**: o NJ **ignora grupos de propósito** e **não tem nenhum tratamento de menção**.
Portanto, "reaproveitar" não comprova nada sobre grupos; isso é construção nova no STC e depende do provedor
(seção 4).

## 2. O que o STC já tem e deve ser preservado

Fonte da verdade de cada informação:

| Informação | Fonte da verdade no STC |
|---|---|
| Papel administrativo | `profiles.role = 'admin'` via `public.is_admin()` (SECURITY DEFINER). Papéis: `admin`, `socio`, `lanchonete` (enum `user_role`); professor = `profiles.is_professor` + tabela `professors`. **Admin também é sócio** (`MEMBER_ROLES`, view `members`). |
| Telefone do sócio | `profiles.phone` (único; guardado **local, sem DDI**: DDD+número, 10–11 dígitos — ver `lib/phoneAuth.ts`) |
| Aluno não-sócio / dependente / Card Mensal | `non_socio_students` (`plan_type` ∈ Day Card, Card Mensal, Dependente, Day Card Experimental; `plan_status`; `master_expiration_date`; `student_type` regular/dependent; `responsible_socio_id`; `phone`) + `student_profiles` (`student_status` active/paused/ended, `professor_id`) + `student_payments` (pagamentos). Regra do Card em `lib/students/studentRules.ts` (`getCardStatus`, `canParticipateInClass`). |
| Reservas | tabela `reservations` (`court_id`, `date`, `start_time`, `end_time`, `type` ∈ Play/Aula/Campeonato/Desafio, `status`, `participant_ids uuid[]`, `guest_name`, `guest_responsible_id`, `professor_id`, `student_type`, `non_socio_student_ids`, `observation`). **Não há RPC nem trigger de reserva**: o app grava por `INSERT` direto (RLS: qualquer autenticado insere). |
| Mensalidade e cobrança | módulo `fin_*` (já no repositório e aplicado no remoto segundo o histórico fabuloso): `fin_member_charges`, estado derivado por `fin_private.charge_rows` (`forecast/open/overdue/partial/paid/canceled/in_review`), encargos só se `fin_settings.late_fee_confirmed_at` |
| Comprovante em análise | `fin_receipt_submissions.status in ('submitted','in_review')` (já considerado em `charge_rows.in_review`) |
| Campeonatos, jogos, classificação | `championships`, `matches` (`status pending/finished`, `winner_id`, `winner_registration_id`, `registration_a_id/b_id`, `player_*_source_match_id`, `result_type`), `championship_registrations` (`user_id` ou convidado), `get_group_standings`; avanço de chave feito por trigger `propagate_bracket_winner` |
| Auditoria | `admin_audit_logs` + `public.admin_audit_insert_log(...)` (usado pelo financeiro com `source='finance'`) |
| Idempotência e RPC | padrão do financeiro: `SECURITY DEFINER`, `begin_op/finish_op` por `request_id`, schema privado, sem `INSERT/UPDATE/DELETE` direto |
| Navegação admin | `components/admin/adminNav.ts` (5 grupos, 14 seções; **15** com “Conversas”) + `AdminPanel.tsx`; telas por `lazy` |
| Fuso | `America/Fortaleza` (`getNowInFortaleza`, `fin_private.today`) |
| Idioma/UX | Tailwind, paleta `saibro`/`stone`, `StandardModal`, `useConfirm`, `notify` (sonner); componentes comuns em `components/finance/ui.tsx` |

**Já existiam tabelas `crm_leads/crm_conversations/crm_messages`** (migration `20260124215137`). Elas são de **outro
produto** que divide o mesmo projeto Supabase ("agentes N8N": têm `store_id → stores`, `webhook_payload`, RPC
`upsert_crm_lead`) e a RLS delas é **"qualquer usuário autenticado lê e escreve tudo"**. **Não foram reutilizadas**:
reaproveitá-las deixaria **qualquer sócio ler as conversas** (viola o requisito de acesso) e acoplaria o clube a um
modelo de loja. O módulo novo usa o prefixo `conv_` (como `fin_` no financeiro). Isso é decisão registrada, não
descuido: ver riscos (seção 6).

Não existia **nenhuma** integração de WhatsApp, webhook, fila de mensagens ou IA no STC (busca por `whatsapp`,
`uazapi`, `wa.me`, `webhook`: só links `wa.me` em telas e as tabelas `crm_*` acima). `support_messages` é um formulário
público de sugestões, sem relação.

## 3. O que falta no STC para este pedido

1. Canal WhatsApp (instância, token do webhook, identidade institucional "STC Institucional").
2. Contatos/conversas/mensagens e sua RLS **só-admin**; Storage privado para mídia.
3. Ingestão de webhook idempotente e segura; envio com idempotência/retry.
4. Estado de IA por conversa e histórico **no mesmo** `conv_messages` (sem histórico paralelo).
5. **Um motor de reserva no servidor.** Hoje as regras de reserva vivem só no componente `Agenda.tsx`
   (`AddReservationModal`): horário 05:00–22:30 em passos de 30 min, fim ≤ 23:00, Play 60 min / Aula 30 min por padrão,
   Aula só na **Quadra Rápida**, aula só com não-sócios/dependentes só de manhã (5h–12h) ou à noite (20h+),
   aluno `paused/ended` bloqueia, Card Mensal vencido bloqueia, máx. 8 participantes. O conflito de quadra é
   **só um aviso que o usuário pode ignorar** ("marcar assim mesmo"). Para a IA isso não serve: ela só cria o que o
   servidor valida. Foi preciso **espelhar** essas regras numa função SQL (`conv_private.validate_reservation`),
   com teste de paridade — e fica o débito: **o ideal é o app passar a chamar a mesma função**.
6. Automações com público real (mensalidade, campeonato, Card Mensal), dedupe, janela, opt-out e auditoria.
7. Tela "Conversas" no painel admin.

## 4. Documentação consultada e o que está (e não está) comprovado

Fontes (todas por busca/trecho; **a página primária não foi aberta** quando indicado):

- UazAPI — documentação oficial `docs.uazapi.com` (**bloqueada no ambiente**; só trechos de busca): "use o `chatid`
  do webhook recebido quando alguém envia mensagem no grupo, que termina em `@g.us`"; o envio aceita `mentions`
  (só para grupos); o webhook aceita `excludeMessages` com `wasSentByApi`, `wasNotSentByApi`, `fromMeYes/No`,
  **`isGroupYes/No`**; o payload traz `isGroup` (boolean). *Nenhum trecho acessível confirma o nome do campo que
  lista as menções recebidas.*
- Meta — *WhatsApp Business Platform, Groups API* (`developers.facebook.com/.../groups/groups-messaging`)
  (**bloqueada**; só trechos de busca/terceiros): a Cloud API passou a ter Groups API; exige **Official Business
  Account**; grupo limitado a **8 participantes**; não há endpoint para adicionar participante direto; webhooks de
  grupo `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`;
  mensagens recebidas em grupo chegam com `group_id`.
- Notícias do recurso `@all` (MacRumors, 9to5Google, WABetaInfo, ago/2026): `@all` notifica **todos**, inclusive
  grupos silenciados; em grupos com mais de 32 membros só admins usam.
- Evolution/Baileys (terceiros, só como indício): a menção chega em `contextInfo.mentionedJid` e o bot pode ser
  referenciado ora por JID de telefone (`…@s.whatsapp.net`) ora por **LID** (`…@lid`) — por isso o detector compara
  os dois.
- Código do NJ e do STC (primário, lido por inteiro).

### Respostas técnicas pedidas

| Pergunta | Resposta | Nível de prova |
|---|---|---|
| A conta institucional pode participar do grupo? | **Sim**, se for um número comum conectado por QR no UazAPI (é a base do NJ). Na **Cloud API oficial**, só com Groups API (OBA, grupo ≤ 8) — outra integração, **não adotada**. | App/provedor: plausível; **não testado aqui** |
| A integração recebe mensagens do grupo? | O UazAPI tem `isGroup`/`@g.us` e filtro `isGroupYes`; o NJ **registra o webhook sem esse filtro** e descarta no código. | **Não comprovado com payload real do STC** |
| O webhook identifica que veio de grupo? | `chatid` terminando em `@g.us` e/ou `isGroup: true` — **o NJ já lê os dois**. | Código existente + trechos de doc |
| O payload identifica o remetente individual? | O NJ lê `sender_pn`/`sender` (telefone/LID do remetente). Em grupo, `chatid` é o grupo e o remetente vem em `sender*`. | **A confirmar** com payload real de grupo |
| Informa que a conta institucional foi mencionada diretamente? | **Não confirmado.** Não há campo de menção recebida em nenhum material acessível do UazAPI. | **Não comprovado** |
| Dá para distinguir de `@all`/`@todos`/outra pessoa? | Só se o payload trouxer a lista **estruturada** de menções. `@all` pode vir como lista expandida ou como marcador próprio; **não se sabe**. | **Não comprovado** |
| Dá para associar resposta à pergunta anterior da IA? | O NJ já grava `reply_to_provider_id` a partir de `quoted`/`contextInfo.stanzaId` e guarda o id que o provedor devolve no envio. | Padrão do NJ em produção; **a confirmar no STC** |
| A conta responde no grupo? | `/send/text` com `number = <chatid do grupo>` (a doc cita o `chatid` do webhook). | Trecho de doc; **não testado** |
| Limites/elegibilidade | UazAPI = conexão **não oficial** (risco de bloqueio do número, termos do WhatsApp). Cloud API = OBA, 8 participantes, templates. | Ver riscos |

### Consequência de projeto (fail-closed)

Como a menção direta **não está comprovada**, a IA em grupo ficou assim:

- O detector (`_shared/groupMention.ts`) só devolve "menção direta" quando acha uma **lista estruturada** de menções
  que contém um identificador da conta institucional **configurado pelo administrador** (telefone e/ou LID) — nunca
  por texto digitado ("STC Institucional"), nunca por `@all`/`@todos`/`@everyone`, nunca se a lista for tão grande
  quanto o grupo, e nunca se a lista não existir.
- A IA em grupo **vem desligada** e só liga depois que um administrador marca "verifiquei a menção em payload real"
  (`conv_channel.mention_verified_at`). Sem isso, o grupo só é **gravado** (se estiver na lista permitida) e a IA
  não responde. A tela mostra o que o webhook de grupo trouxe (formato das chaves, sem conteúdo) para essa conferência.
- Sem o metadado, o sistema **diz que não consegue distinguir**; não aproxima.

## 5. Riscos que o desenho precisa travar

| Risco | Mitigação |
|---|---|
| **Duplicidade** (webhook repetido, retry, "sim" duplicado) | `provider_message_id` único; `request_id` único em mensagem enviada; proposta de reserva com `request_key` único e `reservation_id` gravado na mesma transação; função de criação idempotente |
| **Vazamento de conversas** | RLS `is_admin()` em todo `conv_*`; escrita só por RPC/`service_role`; webhook por token (hash); bucket privado; grupo só gravado se permitido; nada de `crm_*` |
| **Reserva criada errada** | IA nunca grava; só chama a função SQL que revalida disponibilidade e regras na hora da gravação, depois de proposta + confirmação do **mesmo solicitante** (ou admin); quadra ocupada = bloqueio duro (diferente do app, que deixa ignorar) |
| **IA responder o que não deve** | filtro no webhook antes do modelo; sessão por grupo+solicitante com TTL; limite de turnos; custo (buffer, máx. turnos, modelo configurável, 1 chamada de memória + 1 de resposta) |
| **Automação duplicada ou enganosa** | `dedupe_key` única por finalidade+janela; revalidação no envio; encargos só se configurados; variáveis só de fonte confirmada; pausa cancela o futuro |
| **Segredo exposto** | tokens só em variáveis de ambiente do Supabase; token do webhook só em hash; logs/auditoria sem payload bruto nem token |
| Débito pré-existente (fora do escopo, só registrado) | `supabase/functions/send-push/index.ts` contém chaves VAPID **no código** (a privada inclusive) — deve ir para Secrets e ser rotacionada; `support_messages` autoriza admin por **e-mail fixo**; `crm_*` com RLS aberta a autenticados |

## 6. Decisões de reaproveitamento (resumo)

- **Reutilizado quase literal**: `uazChat`, `whatsappInstance`, `jsonRepair`, `llm`, cadência de bolhas, regras de buffer/vencedor/takeover do `turn`, parsing de status/reação/edição/apagar, padrão queue→send→finish, política de presença/rascunho/timeline de mensagens (UI).
- **Adaptado**: `uazWebhook` (grupos + evidência de menção), `record` (sem n8n, grupos permitidos), modelo de conversa (contato/grupo em vez de cliente), `staffRequest` → `adminRequest` (`profiles.role='admin'`), prompts da IA (clube, reserva), automações (públicos do clube, dedupe, janela).
- **Descartado**: CRM do NJ (etapas, OS, lavagens, fidelidade), n8n, permissões `crm.*`, push do NJ.
- **Novo no STC**: detector de menção direta; sessão de IA por grupo; `validate_reservation`/`create_reservation_from_chat`; públicos de automação (mensalidade, campeonato, Card Mensal).
