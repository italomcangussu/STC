// Um turno do agente de atendimento: gatilho → buffer → contexto → modelo → ações do servidor → bolhas.
//
// Espinha do pipeline do North Jato (`_shared/aiAgent/turn.ts`, que veio do CRM Ibiapaba): buffer
// de mensagens seguidas, "vencedor" (só a última mensagem do solicitante responde), guarda de
// takeover antes de cada bolha, soft-fail em todo parse (falha vira transferência, nunca silêncio),
// cadência de bolhas. Todas as dependências são injetadas: o turno é testado sem rede.
//
// O que é do STC e muda a história:
//   * o modelo NUNCA anuncia sucesso. Proposta, confirmação, cancelamento e erros de reserva são
//     textos escritos aqui, a partir do que o banco devolveu (`conv_svc_ai_propose`/`_confirm`);
//   * a criação só acontece em `conv_svc_ai_confirm`, que exige confirmação inequívoca do
//     solicitante (ou de um administrador) DEPOIS da proposta, e revalida tudo na gravação;
//   * pessoas são resolvidas pelo cadastro (único/ambíguo/nenhum): nunca por aproximação;
//   * uma chamada ao modelo por turno (a memória volta no mesmo JSON).

import { n3Reply } from './capabilities.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import { actingFor } from './promptContext.ts';
import { systemPrompt } from './promptSystem.ts';
import type { AiSettings, Ctx } from './promptTypes.ts';
import { userPrompt } from './prompts.ts';
import { type ReceiptStage, handleReceiptIntent, loadReceiptStage } from './receiptIntent.ts';
import { deliverForward } from './receiptForward.ts';
import { turnDelivery } from './turnDelivery.ts';
import { loadTurnContext, pendingInbound } from './turnContext.ts';
import { keepMemberInChat, refreshGroupHumor, serverOverrides } from './turnAnswerGuards.ts';
import { UNCLEAR_AUDIO_REPLY, unheardOnly } from './audio.ts';
import { activeTopic, bringsNewData, openTopics, recordTopicTurn, restoreTopics, selectTopic, topicIdFromRef } from './topicState.ts';
import { delegateSilence } from './delegate.ts';
import { receiptReceivedMessage } from './studentCard.ts';
import { resolve } from './turnOutcome.ts';
import { mergeSlots, parseAnswer, turnTemperature } from './answerParse.ts';
import { cadence } from './cadence.ts';
import { type DecideInput, baseSlotsFor, continuePlan, decide, proposalBelongsElsewhere, startsFresh } from './decide.ts';
import { looksLikeProTennisQuestion, proTennisContext, proTennisDirectMessages } from './proTennis.ts';
import { MEMBER_FAIL, TRANSFER_DIRECT, memberKeep, wantsHuman } from './serverRules.ts';
import { type Answer, type Intent, type Memory, type TurnDeps, type TurnResult, answerBudget } from './turnTypes.ts';

export { ADM_ACTIONS } from './turnTypes.ts';
export type { AdmAction, Answer, Db, FinAction, FormQuestionSlot, Intent, Slots, TurnDeps, TurnResult } from './turnTypes.ts';
export { REACTIONS, clipSummary, mergeSlots, parseAnswer, parseCuratorAsk, parseFormQuestions, parseReaction, parseSlots, turnTemperature } from './answerParse.ts';
export { cadence } from './cadence.ts';
export { asksForHuman, availabilityFallbackSlots, claimsSuccess, looksLikeAvailabilityQuery, wantsHuman } from './serverRules.ts';
export { CODE_TEXT, busyMessage, dayLabel, describeReservation, joinOfferMessage, notEnoughSpotsMessage, participantsProposalMessage, proposalMessage, successMessage } from './serverTexts.ts';
export type { AgendaItem, Game } from './serverTexts.ts';
export { conciliarMencoes, membrosAtuaisDoGrupo, substituirMencoes } from './mentions.ts';
export type { MencaoResolvida } from './mentions.ts';
export { acharReserva, nearest, pickCourts } from './agendaLookup.ts';
export { birthdayParts } from './adminAssistant.ts';
export { adminProposalMessage, adminSuccessMessage, toCents } from './adminMessages.ts';

/* ------------------------------- Turno ------------------------------- */

export async function runTurn(messageId: string, deps: TurnDeps): Promise<TurnResult> {
  const { db } = deps;
  const trig = (await db('conv_svc_ai_trigger', { p_message: messageId })).data as
    { run?: boolean; reason?: string; session_id?: string; conversation_id?: string; is_group?: boolean } | null;
  if (!trig?.run || !trig.session_id || !trig.conversation_id) return { status: 'skip', reason: trig?.reason ?? 'sem_gatilho' };
  const session = trig.session_id;
  const conversation = trig.conversation_id;
  const isGroup = trig.is_group === true;
  const latest = async () => (await db('conv_svc_ai_is_latest', { p_message: messageId })).data === true;

  const ctx0 = (await db('conv_svc_ai_context', { p_session: session })).data as Ctx | null;
  const settings = ctx0?.settings as AiSettings | undefined;
  if (!ctx0 || !settings) return { status: 'skip', reason: 'sem_configuracao' };

  // Buffer: a pessoa costuma mandar várias mensagens seguidas. Espera e só segue se esta ainda for a última.
  await deps.sleep(Math.max(0, settings.buffer_seconds) * 1000);
  if (!(await latest())) return { status: 'superseded' };

  const ctx = ((await db('conv_svc_ai_context', { p_session: session })).data ?? ctx0) as Ctx;
  if (deps.mediaOnly && isGroup) return { status: 'skip', reason: 'media_only_group' };

  await loadTurnContext(ctx, deps, { session, conversation, isGroup });
  const { pendentes, buffered, soMidia, ultima } = pendingInbound(ctx);
  const today = String(ctx.now_local).slice(0, 10);

  // Perguntas sobre o circuito profissional usam a MESMA fonte da rotina diária do João (ESPN).
  // A consulta só acontece quando o assunto pede dados atuais, evitando latência/custo nos demais turnos.
  const tennisQueryContext = [
    buffered,
    ...((ctx.group_context ?? []) as Ctx[]).slice(-8).map((m) => `${String(m.sender ?? '')}: ${String(m.body ?? '')}`),
  ].join(' ');
  if (looksLikeProTennisQuestion(buffered, (ctx.group_context ?? []) as Ctx[])) {
    try {
      ctx.pro_tennis = await proTennisContext(String(ctx.now_local), tennisQueryContext);
    } catch {
      ctx.pro_tennis = { source: 'ESPN', checked_at: new Date().toISOString(), date: today, matches: [], unavailable: true };
    }
  }

  const { entregar, entregarArquivos, reagir } = turnDelivery({ deps, conversation, session, isGroup, replyTo: ultima?.id as string | undefined, latest });

  const save = (memory: Memory | null, decision: string, payload: Record<string, unknown>, awaiting: boolean, close: boolean) =>
    db('conv_svc_ai_save_turn', { p_session: session, p_memory: memory, p_decision: decision, p_payload: payload, p_awaiting: awaiting, p_close: close });

  // Trava: sócio (ou admin) e assessor de professor no privado nunca vão para atendimento humano. O banco também recusa (ai_handoff).
  const socioNoPrivado = !isGroup && (((ctx.requester as Ctx | undefined)?.profile as Ctx | undefined)?.is_member === true || actingFor(ctx) !== null);

  const transferir = async (kind: 'soft' | 'hard', note: string, memory: Memory | null, falar = true, opts: { texto?: string; fechar?: boolean } = {}) => {
    if (socioNoPrivado) {
      const enviadas = falar ? await entregar(cadence([opts.texto ?? memberKeep(messageId)])) : 0;
      await save(memory, 'member_no_handoff', { reason: note.slice(0, 200), kind }, !opts.fechar, opts.fechar === true);
      return { status: 'replied', bubbles: enviadas, handoff: null } as TurnResult;
    }
    if (isGroup) {
      const bolhas = falar ? ['Não tenho essa informação confirmada.'] : [];
      const enviadas = bolhas.length ? await entregar(cadence(bolhas)) : 0;
      await save(memory, 'group_no_handoff', { reason: note.slice(0, 200) }, false, false);
      return { status: 'replied', bubbles: enviadas, handoff: null } as TurnResult;
    }
    if (falar) await entregar(cadence([TRANSFER_DIRECT]));
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: kind, p_note: note });
    await save(memory, `handoff_${kind}`, { reason: note.slice(0, 200) }, false, kind === 'hard');
    return { status: 'handoff', handoff: kind } as TurnResult;
  };

  // Assessor de professor (outro robô): não responde cortesia nem entra em laço de resposta.
  const quieto = !isGroup && actingFor(ctx) ? delegateSilence((ctx.transcript ?? []) as Ctx[], soMidia ? '' : buffered) : null;
  if (quieto) {
    await save((ctx.session?.memory ?? {}) as Memory, quieto, {}, false, false);
    return { status: 'skip', reason: quieto };
  }
  // Regras que não dependem do modelo.
  if (!deps.chat || !settings.model) return transferir('hard', 'Agente de IA sem provedor ou modelo configurado.', null, socioNoPrivado);
  // max_turns é um limiar para resumir contexto, NUNCA para interromper um assunto.
  // O contexto enviado ao modelo já é limitado pelas últimas 8 trocas + memória estruturada.
  if (wantsHuman(buffered, settings.handoff_keywords ?? [])) return transferir('hard', 'A pessoa pediu atendimento humano.', null);
  const naoOuvido = unheardOnly(pendentes);
  if (naoOuvido === 'failed' && !isGroup) return transferir('hard', 'Chegou áudio e a transcrição automática falhou; ouça na conversa.', null, true, { texto: 'Não consegui ouvir seu áudio. Pode escrever, ou mandar de novo?' });
  if (naoOuvido) {
    // Ruído/silêncio/fala inaudível: pedir de novo é o que um atendente faria, sem chamar o modelo nem a equipe.
    const sent = await entregar(cadence([UNCLEAR_AUDIO_REPLY]));
    await save((ctx.session?.memory ?? {}) as Memory, 'audio_unclear', { bubbles: sent }, true, false);
    return { status: 'replied', bubbles: sent, handoff: null, action: 'audio_unclear' } as TurnResult;
  }
  // Figurinha sozinha é reação, não pedido: não chama a equipe nem responde.
  if (soMidia && !isGroup && pendentes.every((t) => t.kind === 'sticker')) {
    await save((ctx.session?.memory ?? {}) as Memory, 'sticker_ignored', {}, false, false);
    return { status: 'replied', bubbles: 0, handoff: null, action: 'sticker_ignored' } as TurnResult;
  }
  // Comprovante no privado: o OCR apenas prepara a leitura; finalidade e consentimento são obrigatórios.
  // Prioridade sobre o antigo fluxo de Card Mensal: evita classificação por valor e por cobrança aberta.
  // Administrador não passa por aqui: o comprovante dele é despesa ou pagamento de terceiro, tratado pelo assessor.
  if (!isGroup && !isAdminAssistant(ctx)) {
    let pendingReceipt: ReceiptStage | null = null;
    const comprovanteDaVez = (deps.mediaOnly === true || soMidia) && (ultima?.kind === 'image' || ultima?.kind === 'document');
    const midiaDaVez = comprovanteDaVez ? ultima?.id as string | undefined : undefined;
    try {
      pendingReceipt = await loadReceiptStage({ db, conversation, mediaMessageId: midiaDaVez, sleep: deps.sleep });
    } catch { /* implantação parcial: fluxo geral continua; jamais força baixa */ }
    if (pendingReceipt) {
      const handled = await handleReceiptIntent({
        stage: pendingReceipt, messageId: ultima?.id as string | undefined,
        mediaOnly: deps.mediaOnly === true || soMidia, text: buffered, transcript: (ctx.transcript ?? []) as Ctx[],
        db, chat: deps.chat, model: settings.model,
      });
      if (handled) {
        const sent = await entregar(cadence(handled.messages));
        const repassadas = handled.forward ? await deliverForward(handled.forward, { db, uaz: deps.uaz, signedUrl: deps.files?.signedUrl }) : 0;
        await save((ctx.session?.memory ?? {}) as Memory, handled.action, { receipt_stage_id: pendingReceipt.id, bubbles: sent, forwarded: repassadas }, true, false);
        return { status: 'replied', bubbles: sent, handoff: null, action: handled.action } as TurnResult;
      }
    }
  }
  // Mídia solta de quem não é administrador, sem comprovante em análise: segue só pelo financeiro, o João não pergunta nada.
  if (deps.mediaOnly && !isAdminAssistant(ctx)) return { status: 'skip', reason: 'media_only' };
  // Compatibilidade: só resposta genérica do assistente; nunca lançar ou quitar via mídia.
  // Administrador manda o comprovante: o servidor já leu (valor, data, favorecido); o João responde com o que leu, sem equipe.
  if (soMidia && !isGroup && isAdminAssistant(ctx) && ultima?.id && pendentes.every((t) => t.kind === 'image' || t.kind === 'document')) {
    let lido: Ctx | null = null;
    for (let tentativa = 0; tentativa < 6 && !lido?.found; tentativa++) {
      if (tentativa) await deps.sleep(2000);
      lido = (await db('conv_svc_ai_admin_receipt', { p_session: session, p_message: ultima.id as string })).data as Ctx | null;
    }
    const sent = await entregar(cadence([receiptReceivedMessage(lido)]));
    await save((ctx.session?.memory ?? {}) as Memory, 'admin_receipt_received', { found: lido?.found === true }, true, false);
    return { status: 'replied', bubbles: sent, handoff: null, action: 'admin_receipt_received' } as TurnResult;
  }
  if (soMidia && !isGroup) return transferir('hard', `Chegou ${[...new Set(pendentes.map((t) => t.kind))].join(', ')} sem texto; a IA não lê mídia.`, null, true, { texto: 'Recebi, mas não consigo ver imagem ou documento por aqui. Pode me dizer em texto o que você precisa?' });

  // N3 (destrutivo ou de configuração): o assessor não executa por chat, só indica a tela do painel.
  const n3 = isAdminAssistant(ctx) ? n3Reply(buffered) : null;
  if (n3) {
    const sent = await entregar(cadence([n3]));
    await save((ctx.session?.memory ?? {}) as Memory, 'admin_n3_refused', { bubbles: sent }, false, false);
    return { status: 'replied', bubbles: sent, handoff: null, action: 'admin_n3_refused' } as TurnResult;
  }

  // Assuntos pendentes do solicitante voltam do banco em qualquer sessão; a autorização de uma proposta antiga, não.
  const memory = restoreTopics((ctx.session?.memory ?? {}) as Memory,
    { durable: ctx.durable_topics, openProposalId: (ctx.open_proposal as Ctx | null)?.id as string | undefined, today });

  if (ctx.pro_tennis && looksLikeProTennisQuestion(buffered, (ctx.group_context ?? []) as Ctx[])) {
    const messages = proTennisDirectMessages(tennisQueryContext, ctx.pro_tennis);
    if (messages?.length) {
      const sent = await entregar(cadence(messages));
      await save(memory, 'pro_tennis_info', {
        source: String(ctx.pro_tennis.source ?? 'ESPN'),
        date: String(ctx.pro_tennis.date ?? today),
        query: buffered.slice(0, 300),
        bubbles: sent,
      }, false, false);
      return { status: 'replied', bubbles: sent, handoff: null } as TurnResult;
    }
  }

  let answer: Answer;
  try {
    const r = await deps.chat([
      { role: 'system', content: systemPrompt(settings, ctx) },
      { role: 'user', content: userPrompt(ctx, memory, buffered) },
    ], { model: settings.model, temperature: turnTemperature(isGroup, ctx, memory), maxTokens: answerBudget(ctx), json: true });
    answer = parseAnswer(r.output);
  } catch {
    return transferir('hard', 'Falha ao chamar o modelo de IA.', memory);
  }

  // Travas do servidor sobre a resposta: disponibilidade é núcleo; grupo e sócio no privado não vão para humano; piada repetida é trocada.
  const guard = { deps, ctx, settings, memory, buffered, isGroup, messageId };
  answer = serverOverrides(answer, guard);
  let fallback: 'reformulada' | 'pronta' | null = null;
  if (socioNoPrivado) ({ answer, fallback } = await keepMemberInChat(answer, guard));
  answer = await refreshGroupHumor(answer, guard);

  // Cargo informado ou corrigido por um administrador no privado já entra aprovado; o servidor confirma ("Anotei"), o modelo não.
  const anotados: string[] = [];
  for (const candidate of answer.memory_candidates ?? []) {
    const aprova = candidate.kind !== 'inside_joke' && !isGroup && isAdminAssistant(ctx);
    const r = await Promise.resolve(deps.db('conv_svc_ai_memory_candidate', { p: { ...candidate, source_message_id: messageId, approve: aprova } })).catch(() => null);
    if (aprova && r?.data) anotados.push(candidate.kind === 'role_title' ? `${candidate.subject_name} é ${candidate.content.replace(/^(o|a)\s+/i, '')}` : `${candidate.subject_name}: ${candidate.content}`);
  }
  if (isGroup && answer.ask_curator) {
    await Promise.resolve(deps.db('conv_svc_ai_curator_ask', { p_session: session, p: answer.ask_curator })).catch(() => null);
  }
  if (answer.transfer && answer.messages.length === 0) {
    return transferir(answer.handoff_kind ?? 'hard', answer.handoff_note || 'A IA pediu ajuda da equipe.', memory);
  }

  // Outro assistente mandou só um aviso ("vou conferir e te mando"): nada a responder, a conversa não vira pingue-pongue.
  if (answer.silent && actingFor(ctx) && !answer.ready && !answer.customer_confirmed && !answer.declined) {
    await save({ ...memory, ...(answer.summary ? { summary: answer.summary } : {}) }, 'delegate_silent', { intent: answer.intent }, false, false);
    return { status: 'skip', reason: 'delegate_silent' };
  }
  // Reação: um amigo curte a mensagem antes de (ou em vez de) falar. Sozinha só vale para conversa solta
  // (agradecimento, notícia boa, piada): nada operacional, sem proposta aberta e sem pergunta pendente.
  if (answer.reaction && !answer.transfer) {
    const reagiu = await reagir(answer.reaction);
    const soReacao = answer.messages.length === 0 && !answer.awaiting && !answer.ready && !answer.customer_confirmed && !answer.declined
      && !ctx.open_proposal && (answer.intent === 'informar' || answer.intent === 'outro');
    if (soReacao) {
      const resumo = answer.summary ?? memory.summary;
      await save({ ...memory, intent: answer.intent, ...(resumo ? { summary: resumo } : {}) }, 'reaction',
        { intent: answer.intent, reaction: answer.reaction, delivered: reagiu }, false, answer.close);
      return { status: 'replied', bubbles: 0, handoff: null, action: reagiu ? 'reacted' : null };
    }
  }

  // Resposta curta ("isso", "R$ 30", "Outras receitas") que o modelo classificou como informar/outro mas traz dado
  // ou decisão para o assunto ativo continua ESSE assunto, em vez de se perder na memória solta.
  const ativo = activeTopic(memory);
  if (ativo && (answer.intent === 'informar' || answer.intent === 'outro') && !answer.transfer
    && (bringsNewData(answer.slots, ativo.slots) || answer.ready || answer.customer_confirmed || answer.declined)) {
    answer = { ...answer, intent: ativo.intent as Intent };
  }
  if (answer.plan && isAdminAssistant(ctx) && answer.intent !== 'admin_financeiro') answer = { ...answer, intent: 'admin_acao' };
  const topico = selectTopic(memory, answer.intent, answer.topic_mode, topicIdFromRef(memory, answer.topic_ref));
  // Assuntos independentes não se misturam: retomar usa só os dados daquele assunto; tarefa nova começa limpa.
  const slots = mergeSlots(baseSlotsFor(memory, answer, topico), answer.slots, !topico && startsFresh(memory, answer));
  // Resumo: o que o modelo reescreveu agora; senão o anterior; senão o do atendimento anterior da mesma pessoa.
  const summary = answer.summary ?? memory.summary ?? (typeof ctx.prior_summary === 'string' ? ctx.prior_summary : undefined);
  const nextMemory: Memory = { ...memory, intent: answer.intent, slots, ...(summary ? { summary } : {}) };

  // A proposta aberta pertence a um assunto: "pode"/"não" sobre OUTRO assunto não confirma nem cancela a dela.
  const ctxDoTurno = proposalBelongsElsewhere(ctx, topico) ? { ...ctx, open_proposal: null } : ctx;
  const entrada: DecideInput = { deps, ctx: ctxDoTurno, answer, slots, memory: nextMemory, session, ultimaId: ultima?.id as string | undefined, today };
  let d = await decide(entrada);
  // Plano composto: o passo aceito foi feito; o servidor já emenda o próximo (ou fecha com o que fica no painel).
  if (d.action === 'admin_confirmed' && slots.plan) d = await continuePlan(entrada, d, slots.plan);
  if (anotados.length && !d.handoff) d.bubbles = [...d.bubbles, `📝 Anotei: ${anotados.join('; ')}.`];
  // Só o assunto deste turno muda de estado; os demais pendentes continuam como estavam (o ativo anterior fica suspenso).
  d.memory = recordTopicTurn({ ...nextMemory, ...d.memory, topics: nextMemory.topics, active_topic_id: nextMemory.active_topic_id }, {
    topic: topico, intent: answer.intent, slots: d.slots ?? slots, summary, action: d.action, awaiting: d.awaiting, close: d.close,
    declined: d.action === 'declined' || (answer.declined && d.close), lastQuestion: d.bubbles.at(-1) ?? null,
  });
  if (summary && !d.memory.summary) d.memory = { ...d.memory, summary };
  // Agradecer ou encerrar um assunto não fecha a sessão enquanto houver outro pendente (que, de todo modo, está salvo).
  const closeSession = d.close && openTopics(d.memory).length === 0;
  if (d.handoff && socioNoPrivado) {
    const enviadas = await entregar(cadence([MEMBER_FAIL]));
    await save(d.memory, 'member_no_handoff', { action: d.action, reason: d.handoff.note.slice(0, 200) }, false, false);
    return { status: 'replied', bubbles: enviadas, handoff: null, action: d.action };
  }
  if (d.handoff) {
    if (isGroup) {
      const enviadas = await entregar(cadence(['Não consegui concluir isso por aqui.']));
      await save(d.memory, 'group_no_handoff', { action: d.action, reason: d.handoff.note.slice(0, 200) }, false, false);
      return { status: 'replied', bubbles: enviadas, handoff: null, action: d.action };
    }
    await entregar(cadence(d.bubbles));
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: d.handoff.kind, p_note: d.handoff.note });
    await save(d.memory, `handoff_${d.handoff.kind}`, { action: d.action, reason: d.handoff.note.slice(0, 200) }, false, d.handoff.kind === 'hard');
    return { status: 'handoff', handoff: d.handoff.kind, action: d.action };
  }
  let enviadas = await entregar(d.verbatim ? [{ text: d.bubbles.join('\n\n'), delayMs: 900 }] : cadence(d.bubbles));
  if (d.files?.length) enviadas += await entregarArquivos(d.files);
  if (answer.transfer && !isGroup) {
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: answer.handoff_kind ?? 'hard', p_note: answer.handoff_note || 'Transferida pela IA' });
  }
  await save(d.memory, answer.transfer ? `handoff_${answer.handoff_kind}` : d.close ? 'close' : d.action ?? 'reply',
    { action: d.action, intent: answer.intent, bubbles: enviadas, ...(fallback || d.bubbles.some((b) => b.includes('Ainda não consigo realizar esse pedido')) ? { fallback: fallback ?? 'limitacao', limitation: true, asked: buffered.slice(0, 200) } : {}) }, d.awaiting, closeSession || (answer.transfer && answer.handoff_kind === 'hard'));
  return { status: 'replied', bubbles: enviadas, handoff: answer.transfer ? answer.handoff_kind : null, action: d.action };
}
