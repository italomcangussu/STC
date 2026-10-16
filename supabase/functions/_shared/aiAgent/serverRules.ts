// Regras que não dependem do modelo: pedido de humano, consulta de disponibilidade, anúncio de sucesso e textos fixos.

import { LIMITATION_PHRASE } from './capabilities.ts';
import type { Slots } from './turnTypes.ts';

/* ------------------------------- Regras que não dependem do modelo ------------------------------- */

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function asksForHuman(text: string, keywords: string[]): boolean {
  const t = norm(text);
  return keywords.some((k) => k && t.includes(norm(k)));
}

/** Pedido claro por pessoa/atendente, em qualquer tamanho de frase. */
const STRONG_HUMAN = /\b(atendente|humano|gerente|secretaria|alguem da equipe|pessoa de verdade|falar com (alguem|uma pessoa|um humano|uma atendente|a equipe)|reclamacao|reclamar)\b/;

/**
 * Atalho SEM modelo para "quero falar com alguém": a palavra-gatilho sozinha não basta. Vale se a mensagem é curta
 * (até 5 palavras) ou traz um pedido claro; "eu e mais uma pessoa jogamos amanhã" segue para o modelo, que entende o contexto.
 */
export function wantsHuman(text: string, keywords: string[]): boolean {
  if (!asksForHuman(text, keywords)) return false;
  const palavras = text.trim().split(/\s+/).filter(Boolean).length;
  return palavras <= 5 || STRONG_HUMAN.test(norm(text));
}

/** Consulta de disponibilidade é uma capacidade central do João e nunca deve cair em handoff genérico. */
export function looksLikeAvailabilityQuery(text: string): boolean {
  const t = norm(text).replace(/\s+/g, ' ').trim();
  return /\b(horarios?|quadras?)\s+(livres?|disponiveis?)\b/.test(t)
    || /\b(quais?|qual|tem|ha|confere|olha|veja)\b.{0,80}\b(quadra|horario|play)\b.{0,80}\b(livre|disponivel|vaga)\b/.test(t)
    || /\b(quadra|horario|play)\b.{0,80}\b(livre|disponivel|vaga)\b/.test(t);
}

const addIsoDays = (iso: string, days: number) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Fallback determinístico para consultas óbvias, caso o modelo tente transferir ou esqueça a janela. */
export function availabilityFallbackSlots(text: string, nowLocal: string, current: Slots = {}): Slots {
  const t = norm(text);
  const out: Slots = { ...current };
  const today = nowLocal.slice(0, 10);
  if (!out.date) {
    if (/\bamanha\b/.test(t)) out.date = addIsoDays(today, 1);
    else if (/\bhoje\b/.test(t)) out.date = today;
  }
  if (!out.availability_from && !out.availability_to) {
    if (/\b(manha|pela manha|de manha)\b/.test(t)) { out.availability_from = '05:00'; out.availability_to = '12:00'; }
    else if (/\b(tarde|a tarde|de tarde)\b/.test(t)) { out.availability_from = '12:00'; out.availability_to = '18:00'; }
    else if (/\b(noite|a noite|de noite)\b/.test(t)) { out.availability_from = '18:00'; out.availability_to = '23:00'; }
  }
  const depois = t.match(/\bdepois\s+d(?:as?|e)\s+(\d{1,2})(?::(\d{2}))?\s*h?\b/);
  if (depois) {
    const hh = Math.max(0, Math.min(23, Number(depois[1])));
    const mm = depois[2] ? Number(depois[2]) : 0;
    out.availability_from = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    out.availability_to = out.availability_to ?? '23:00';
  }
  const hora = t.match(/\b(?:as|a)\s+(\d{1,2})(?::(\d{2}))?\s*h?\b/);
  if (!out.start && hora) {
    const hh = Number(hora[1]), mm = hora[2] ? Number(hora[2]) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) out.start = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  return out;
}

/** O texto do modelo afirma que algo foi feito? Quem afirma isso é o sistema, não o modelo. */
const SUCCESS_BY_ME = /\b(reservei|marquei|agendei|confirmei|cancelei|remarquei|retirei|removi|tirei|adicionei|coloquei|inclu[ií]|alterei|atualizei|editei|j[aá] est[aá] (garantid[oa]|feit[oa]|ok))\b/i;
const SUCCESS_STATE = /\b(reservad[oa]s?|marcad[oa]s?|agendad[oa]s?|confirmad[oa]s?|cancelad[oa]s?|remarcad[oa]s?)\b/i;
// "A Rápida tem aula marcada às 18h" relata a agenda; não é o João dizendo que fez algo.
const AGENDA_REPORT = /\b(tem|t[eê]m|h[aá]|tinha|teve)\s+(\S+\s+){0,3}(reservad|marcad|agendad|confirmad|cancelad)/i;
export function claimsSuccess(text: string): boolean {
  if (SUCCESS_BY_ME.test(text)) return true;
  return SUCCESS_STATE.test(text) && !AGENDA_REPORT.test(text);
}

export const TRANSFER_DIRECT = 'Vou passar a sua conversa para alguém da equipe, tá? Eles te respondem por aqui mesmo.';
/** Sócio no privado nunca é transferido para a equipe: o João continua a conversa. */
const MEMBER_KEEPS = ['Deixa eu entender direito: o que exatamente você quer que eu faça?', 'Não peguei bem o pedido. Me diz de novo com outras palavras que eu resolvo por aqui.', 'Quero te ajudar nisso, só preciso entender melhor. O que você tem em mente?'];
const MEMBER_KEEP = MEMBER_KEEPS[0];
export const memberKeep = (seed: string) => MEMBER_KEEPS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % MEMBER_KEEPS.length];
export const ADMIN_LIMIT_RULE = `Se o pedido for algo que você não tem como executar (não está nas suas capacidades), diga exatamente esta frase, sem inventar que fez: "${LIMITATION_PHRASE}"`;
export const NO_TRANSFER_RULE = 'ATENÇÃO: você NÃO pode transferir nem encaminhar esta conversa para ninguém; é você quem atende. Responda você mesmo, de forma natural e específica ao que a pessoa escreveu: diga o que consegue fazer sobre isso (ou, com franqueza e sem enrolar, o que não consegue) e peça só o dado que falta. Nada de frases genéricas como "pode contar comigo" ou "me conta o que você precisa". Use transfer: false.';
export const MEMBER_FAIL = 'Não consegui concluir isso agora. Pode tentar de novo em instantes, ou me explicar de outro jeito?';
export const MEMBER_HANDOFF_TALK = /(vou|vamos|irei)\s+(te\s+)?(passar|encaminhar|transferir|pedir)|passar\s+(a|sua)\s+conversa|algu[eé]m\s+da\s+equipe\s+(te|vai)|atendente|transferi/i;
export const TRANSFER_GROUP = 'Vou pedir para alguém da equipe te ajudar com isso por aqui, tá?';
