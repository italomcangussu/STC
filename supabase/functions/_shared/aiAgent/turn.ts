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

import { isAdminAssistant } from './promptAdmin.ts';
import { actingFor } from './promptContext.ts';
import { systemPrompt } from './promptSystem.ts';
import type { AiSettings, Ctx } from './promptTypes.ts';
import { userPrompt } from './prompts.ts';
import { loadTurnContext, pendingInbound } from './turnContext.ts';
import { keepMemberInChat, refreshGroupHumor, serverOverrides } from './turnAnswerGuards.ts';
import { type Turn, turnKit } from './turnKit.ts';
import { beforeModel } from './turnShortcuts.ts';
import { activeTopic, bringsNewData, openTopics, recordTopicTurn, restoreTopics, selectTopic, topicIdFromRef } from './topicState.ts';
import { mergeSlots, parseAnswer, turnTemperature } from './answerParse.ts';
import { cadence } from './cadence.ts';
import { noteMemories } from './memoryNotes.ts';
import { keepChampionshipInChat } from './championship.ts';
import { type DecideInput, baseSlotsFor, continuePlan, decide, proposalBelongsElsewhere, startsFresh } from './decide.ts';
import { looksLikeProTennisQuestion, proTennisContext, proTennisDirectMessages } from './proTennis.ts';
import { type Answer, type Decision, type Intent, type Memory, type TurnDeps, type TurnResult, answerBudget } from './turnTypes.ts';

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

/** Gatilho, buffer e contexto: monta o turno, ou devolve por que não há turno. */
async function startTurn(messageId: string, deps: TurnDeps): Promise<Turn | TurnResult> {
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
  await loadProTennis(ctx, buffered, today);
  return turnKit({ deps, messageId, session, conversation, isGroup, ctx, settings, latest, pendentes, buffered, soMidia, ultima, today });
}

const isTurn = (x: Turn | TurnResult): x is Turn => 'ctx' in x;

/* Circuito profissional: a MESMA fonte da rotina diária do João (ESPN), consultada só quando o assunto pede dado atual. */
const tennisQuery = (ctx: Ctx, buffered: string) => [
  buffered,
  ...((ctx.group_context ?? []) as Ctx[]).slice(-8).map((m) => `${String(m.sender ?? '')}: ${String(m.body ?? '')}`),
].join(' ');
const asksProTennis = (ctx: Ctx, buffered: string) => looksLikeProTennisQuestion(buffered, (ctx.group_context ?? []) as Ctx[]);

async function loadProTennis(ctx: Ctx, buffered: string, today: string): Promise<void> {
  if (!asksProTennis(ctx, buffered)) return;
  try {
    ctx.pro_tennis = await proTennisContext(String(ctx.now_local), tennisQuery(ctx, buffered));
  } catch {
    ctx.pro_tennis = { source: 'ESPN', checked_at: new Date().toISOString(), date: today, matches: [], unavailable: true };
  }
}

function proTennisReply(t: Turn, memory: Memory): Promise<TurnResult> | null {
  const tennis = t.ctx.pro_tennis as Ctx | undefined;
  if (!tennis || !asksProTennis(t.ctx, t.buffered)) return null;
  const messages = proTennisDirectMessages(tennisQuery(t.ctx, t.buffered), tennis);
  if (!messages?.length) return null;
  return t.say(messages, 'pro_tennis_info', (sent) => ({
    source: String(tennis.source ?? 'ESPN'), date: String(tennis.date ?? t.today), query: t.buffered.slice(0, 300), bubbles: sent,
  }), { memory });
}

/** Uma chamada ao modelo por turno; falhou → null (o turno transfere, nunca inventa). */
async function askModel(t: Turn, memory: Memory): Promise<Answer | null> {
  try {
    const r = await t.deps.chat!([
      { role: 'system', content: systemPrompt(t.settings, t.ctx) },
      { role: 'user', content: userPrompt(t.ctx, memory, t.buffered) },
    ], { model: t.settings.model, temperature: turnTemperature(t.isGroup, t.ctx, memory), maxTokens: answerBudget(t.ctx), json: true });
    return parseAnswer(r.output);
  } catch {
    return null;
  }
}

/** Reação sozinha só vale para conversa solta: nada operacional, sem proposta aberta e sem pergunta pendente. */
const onlyReaction = (t: Turn, a: Answer) => a.messages.length === 0 && !a.awaiting && !a.ready && !a.customer_confirmed && !a.declined
  && !t.ctx.open_proposal && (a.intent === 'informar' || a.intent === 'outro');

/**
 * Turnos sem fala: outro assistente só avisou ("vou conferir e te mando") → silêncio, a conversa não vira pingue-pongue;
 * reação com emoji → um amigo curte a mensagem antes de (ou em vez de) falar.
 */
async function silentOrReaction(t: Turn, answer: Answer, memory: Memory): Promise<TurnResult | null> {
  if (answer.silent && actingFor(t.ctx) && !answer.ready && !answer.customer_confirmed && !answer.declined) {
    await t.save({ ...memory, ...(answer.summary ? { summary: answer.summary } : {}) }, 'delegate_silent', { intent: answer.intent }, { awaiting: false, close: false });
    return { status: 'skip', reason: 'delegate_silent' };
  }
  if (!answer.reaction || answer.transfer) return null;
  const reagiu = await t.reagir(answer.reaction);
  if (!onlyReaction(t, answer)) return null;
  const resumo = answer.summary ?? memory.summary;
  await t.save({ ...memory, intent: answer.intent, ...(resumo ? { summary: resumo } : {}) }, 'reaction',
    { intent: answer.intent, reaction: answer.reaction, delivered: reagiu }, { awaiting: false, close: answer.close });
  return { status: 'replied', bubbles: 0, handoff: null, action: reagiu ? 'reacted' : null };
}

/**
 * Resposta curta ("isso", "R$ 30", "Outras receitas") que o modelo classificou como informar/outro mas traz dado ou
 * decisão para o assunto ativo continua ESSE assunto; plano composto do administrador é sempre ação administrativa.
 */
function settleIntent(t: Turn, answer: Answer, memory: Memory): Answer {
  const ativo = activeTopic(memory);
  if (ativo && (answer.intent === 'informar' || answer.intent === 'outro') && !answer.transfer
    && (bringsNewData(answer.slots, ativo.slots) || answer.ready || answer.customer_confirmed || answer.declined)) {
    answer = { ...answer, intent: ativo.intent as Intent };
  }
  return answer.plan && isAdminAssistant(t.ctx) && answer.intent !== 'admin_financeiro' ? { ...answer, intent: 'admin_acao' } : answer;
}

/** O servidor decide (proposta, confirmação, consulta, ação) dentro do assunto certo e registra o estado de cada assunto. */
async function decideTurn(t: Turn, answer: Answer, memory: Memory, anotados: string[]): Promise<{ d: Decision; closeSession: boolean }> {
  const topico = selectTopic(memory, answer.intent, answer.topic_mode, topicIdFromRef(memory, answer.topic_ref));
  // Assuntos independentes não se misturam: retomar usa só os dados daquele assunto; tarefa nova começa limpa.
  const slots = mergeSlots(baseSlotsFor(memory, answer, topico), answer.slots, !topico && startsFresh(memory, answer));
  // Resumo: o que o modelo reescreveu agora; senão o anterior; senão o do atendimento anterior da mesma pessoa.
  const summary = answer.summary ?? memory.summary ?? (typeof t.ctx.prior_summary === 'string' ? t.ctx.prior_summary : undefined);
  const nextMemory: Memory = { ...memory, intent: answer.intent, slots, ...(summary ? { summary } : {}) };

  // A proposta aberta pertence a um assunto: "pode"/"não" sobre OUTRO assunto não confirma nem cancela a dela.
  const ctxDoTurno = proposalBelongsElsewhere(t.ctx, topico) ? { ...t.ctx, open_proposal: null } : t.ctx;
  const entrada: DecideInput = { deps: t.deps, ctx: ctxDoTurno, answer, slots, memory: nextMemory, session: t.session, ultimaId: t.ultima?.id as string | undefined, today: t.today };
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
  return { d, closeSession: d.close && openTopics(d.memory).length === 0 };
}

/** O que fica registrado quando o João não conseguiu atender (para a diretoria ver o que falta ensinar). */
function limitationNote(t: Turn, d: Decision, fallback: 'reformulada' | 'pronta' | null) {
  const limitado = fallback || d.bubbles.some((b) => b.includes('Ainda não consigo realizar esse pedido'));
  return limitado ? { fallback: fallback ?? 'limitacao', limitation: true, asked: t.buffered.slice(0, 200) } : {};
}

/** Fala o que foi decidido (texto e arquivos) e salva o turno. */
async function finishTurn(t: Turn, answer: Answer, { d, closeSession }: { d: Decision; closeSession: boolean }, fallback: 'reformulada' | 'pronta' | null): Promise<TurnResult> {
  if (d.handoff) return t.handoff(d.bubbles, d.handoff, d.memory, d.action);
  let enviadas = await t.entregar(d.verbatim ? [{ text: d.bubbles.join('\n\n'), delayMs: 900 }] : cadence(d.bubbles));
  if (d.files?.length) enviadas += await t.entregarArquivos(d.files);
  if (answer.transfer && !t.isGroup) {
    await t.deps.db('conv_svc_ai_handoff', { p_session: t.session, p_kind: answer.handoff_kind ?? 'hard', p_note: answer.handoff_note || 'Transferida pela IA' });
  }
  const decision = answer.transfer ? `handoff_${answer.handoff_kind}` : d.close ? 'close' : d.action ?? 'reply';
  await t.save(d.memory, decision, { action: d.action, intent: answer.intent, bubbles: enviadas, ...limitationNote(t, d, fallback) },
    { awaiting: d.awaiting, close: closeSession || (answer.transfer && answer.handoff_kind === 'hard') });
  return { status: 'replied', bubbles: enviadas, handoff: answer.transfer ? answer.handoff_kind : null, action: d.action };
}

export async function runTurn(messageId: string, deps: TurnDeps): Promise<TurnResult> {
  const t = await startTurn(messageId, deps);
  if (!isTurn(t)) return t;
  const early = await beforeModel(t);
  if (early) return early;

  // Assuntos pendentes do solicitante voltam do banco em qualquer sessão; a autorização de uma proposta antiga, não.
  const memory = restoreTopics(t.sessionMemory,
    { durable: t.ctx.durable_topics, openProposalId: (t.ctx.open_proposal as Ctx | null)?.id as string | undefined, today: t.today });
  const tennis = proTennisReply(t, memory);
  if (tennis) return tennis;

  const raw = await askModel(t, memory);
  if (!raw) return t.transferir('hard', 'Falha ao chamar o modelo de IA.', memory);
  // Travas do servidor sobre a resposta: disponibilidade é núcleo; grupo e sócio no privado não vão para humano; piada repetida é trocada.
  const guard = { deps, ctx: t.ctx, settings: t.settings, memory, buffered: t.buffered, isGroup: t.isGroup, messageId };
  let answer = keepChampionshipInChat(serverOverrides(raw, guard));
  let fallback: 'reformulada' | 'pronta' | null = null;
  if (t.socioNoPrivado) ({ answer, fallback } = await keepMemberInChat(answer, guard));
  answer = await refreshGroupHumor(answer, guard);

  const anotados = await noteMemories(t, answer);
  if (answer.transfer && answer.messages.length === 0) {
    return t.transferir(answer.handoff_kind ?? 'hard', answer.handoff_note || 'A IA pediu ajuda da equipe.', memory);
  }
  const quiet = await silentOrReaction(t, answer, memory);
  if (quiet) return quiet;
  answer = settleIntent(t, answer, memory);
  return finishTurn(t, answer, await decideTurn(t, answer, memory, anotados), fallback);
}
