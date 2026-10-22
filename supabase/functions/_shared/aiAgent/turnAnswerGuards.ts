// Travas do servidor sobre a resposta do modelo, antes de qualquer ação. O modelo propõe o texto; quem decide
// se ele sai é o servidor: disponibilidade de quadra é núcleo, grupo e sócio no privado não vão para humano,
// e piada repetida no grupo é trocada.

import type { AiSettings, Ctx } from './promptTypes.ts';
import { systemPrompt } from './promptSystem.ts';
import { userPrompt } from './prompts.ts';
import { parseAnswer } from './answerParse.ts';
import { humorTopic, looksHumorous, noveltyHint, repeatedHumor } from './humor.ts';
import { ADMIN_LIMIT_RULE, MEMBER_HANDOFF_TALK, NO_TRANSFER_RULE, availabilityFallbackSlots, claimsSuccess, looksLikeAvailabilityQuery, memberKeep } from './serverRules.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import { type Answer, type Intent, type Memory, type TurnDeps, answerBudget } from './turnTypes.ts';

export type GuardInput = { deps: TurnDeps; ctx: Ctx; settings: AiSettings; memory: Memory; buffered: string; isGroup: boolean; messageId: string };

const GROUP_NOT_CONFIRMED = 'Não tenho essa informação confirmada.';
const GROUP_HANDOFF_TALK = /\b(equipe|atendente|humano|transfer|transferir|encaminh|passar a conversa|passar sua conversa|pedir para algu[eé]m)\b/i;

/** Mais uma resposta do modelo com o mesmo contexto e uma regra extra; temperatura e regra mudam por motivo. */
async function askAgain(g: GuardInput, extraRule: string, temperature: number): Promise<Answer> {
  const r = await g.deps.chat!([
    { role: 'system', content: `${systemPrompt(g.settings, g.ctx)}\n\n${extraRule}` },
    { role: 'user', content: userPrompt(g.ctx, g.memory, g.buffered) },
  ], { model: g.settings.model, temperature, maxTokens: answerBudget(g.ctx), json: true });
  return parseAnswer(r.output);
}

/**
 * Defesa em profundidade: disponibilidade de quadra é núcleo do João. Mesmo se o modelo classificar como fora do
 * escopo, o servidor assume a consulta. No grupo, nada de "vou passar para a equipe": a fala sai e a transferência também.
 */
export function serverOverrides(answer: Answer, { buffered, ctx, isGroup }: Pick<GuardInput, 'buffered' | 'ctx' | 'isGroup'>): Answer {
  if (looksLikeAvailabilityQuery(buffered)) {
    answer = { ...answer, intent: 'consultar_disponibilidade', slots: availabilityFallbackSlots(buffered, String(ctx.now_local), answer.slots),
      transfer: false, handoff_kind: null, handoff_note: null, close: false, messages: [], awaiting: false };
  }
  if (!isGroup) return answer;
  const seguras = answer.messages.filter((m) => !GROUP_HANDOFF_TALK.test(m));
  if (answer.transfer) {
    return { ...answer, intent: 'outro', ready: false, customer_confirmed: false, awaiting: false, transfer: false,
      handoff_kind: null, handoff_note: null, close: false, messages: seguras.length ? seguras : [GROUP_NOT_CONFIRMED] };
  }
  return seguras.length !== answer.messages.length ? { ...answer, messages: seguras } : answer;
}

/**
 * Sócio (ou assessor de professor) no privado é atendido pelo João até o fim: fala de transferência sai e, se não
 * sobrar nada, pede ao modelo uma resposta de verdade sem a opção de transferir; só então usa a frase pronta.
 */
export async function keepMemberInChat(answer: Answer, g: GuardInput): Promise<{ answer: Answer; fallback: 'reformulada' | 'pronta' | null }> {
  const seguras = answer.messages.filter((m) => !MEMBER_HANDOFF_TALK.test(m));
  if (!answer.transfer && seguras.length === answer.messages.length) return { answer, fallback: null };
  let falas = seguras;
  let fallback: 'reformulada' | 'pronta' | null = null;
  if (!falas.length) {
    try {
      const rule = `${NO_TRANSFER_RULE}${isAdminAssistant(g.ctx) ? ` ${ADMIN_LIMIT_RULE}` : ''}`;
      falas = (await askAgain(g, rule, 0.6)).messages.filter((m) => !MEMBER_HANDOFF_TALK.test(m));
    } catch { falas = []; }
    fallback = falas.length ? 'reformulada' : 'pronta';
  }
  const semTransferir = answer.transfer
    ? { intent: 'outro' as Intent, ready: false, customer_confirmed: false, awaiting: true, transfer: false, handoff_kind: null, handoff_note: null, close: false }
    : {};
  return { answer: { ...answer, ...semTransferir, messages: falas.length ? falas : [memberKeep(g.messageId)] }, fallback };
}

/** Conversa solta do grupo (nada operacional em jogo): só aí o filtro de piada repetida age. */
const isLooseGroupTalk = (answer: Answer, g: GuardInput) => g.isGroup && !g.ctx.open_proposal && !answer.ready && !answer.awaiting
  && !answer.customer_confirmed && !answer.declined && !answer.transfer && !answer.close
  && (answer.intent === 'outro' || answer.intent === 'informar') && answer.messages.length > 0;

/** A segunda tentativa só troca o texto: nunca intenção nem ação, e não pode anunciar sucesso. */
const isPlainAlternative = (alt: Answer, older: string[]) => {
  const text = alt.messages.join(' ');
  return alt.messages.length > 0 && alt.messages.length <= 3 && !alt.ready && !alt.awaiting && !alt.customer_confirmed
    && !alt.transfer && !alt.declined && !alt.close && !repeatedHumor(text, older) && !claimsSuccess(text);
};

/** Sem piada nova: cumprimento vira cumprimento simples; comentário vira frase neutra; pergunta mantém a resposta. */
function neutralReply(buffered: string): string | null {
  const said = buffered.toLowerCase();
  if (/\b(bom dia|bom sabado|boa tarde|boa noite|otimo sabado)\b/i.test(said.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    const greeting = /boa noite/i.test(said) ? 'Boa noite!' : /boa tarde/i.test(said) ? 'Boa tarde!' : 'Bom dia!';
    return `${greeting} Tudo de bom para a turma do STC.`;
  }
  return said.includes('?') ? null : 'Boa! A turma está animada hoje.';
}

/** Piada que o João já contou no grupo: pede outra ao modelo; se não vier uma nova, cai no neutro. */
export async function refreshGroupHumor(answer: Answer, g: GuardInput): Promise<Answer> {
  if (!isLooseGroupTalk(answer, g)) return answer;
  const older = Array.isArray(g.ctx.joao_own_lines) ? g.ctx.joao_own_lines.map(String).filter(Boolean) : [];
  const initial = answer.messages.join(' ');
  if (!looksHumorous(initial)) return answer;
  const reason = repeatedHumor(initial, older);
  if (!reason || !g.deps.chat) return answer;
  let result: 'regenerated' | 'neutral' | 'normal' = 'normal';
  try {
    const alternative = await askAgain(g, noveltyHint(older), 0.74);
    if (isPlainAlternative(alternative, older)) { answer = { ...answer, messages: alternative.messages }; result = 'regenerated'; }
  } catch (e) {
    console.warn('JOAO_HUMOR_RETRY_ERROR', e instanceof Error ? e.name : 'unknown');
  }
  if (result !== 'regenerated') {
    const neutral = neutralReply(g.buffered);
    if (neutral) { answer = { ...answer, messages: [neutral] }; result = 'neutral'; }
  }
  console.info('JOAO_HUMOR_REPETITION', JSON.stringify({ reason, result, theme: humorTopic(initial), history: older.length }));
  return answer;
}
