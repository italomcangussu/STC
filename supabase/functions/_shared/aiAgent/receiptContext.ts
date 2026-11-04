// Evidência limitada ao comprovante atual. Finalidade e competência vêm da conversa; valor não resolve ambiguidade.

import type { Ctx } from './promptTypes.ts';

export type ReceiptTopic = 'campeonato' | 'mensalidade' | 'card' | 'donation' | 'ambiguous';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const TOPICS: [ReceiptTopic, RegExp][] = [
  ['campeonato', /\b(inscri[cç][aã]o|inscrev|campeonato|serra e sertao|torneio|classe|camisa)/],
  ['mensalidade', /\b(mensalidade|mes de|cobranca do mes)/],
  ['card', /\b(card|aluno)/],
  ['donation', /\b(campanha|doacao|contribuicao|brinquedos)/],
];

const MAX_MESSAGES = 10;

/** Assunto da conversa que o comprovante provavelmente paga; null quando nada nas últimas mensagens aponta. */
export function receiptTopic(transcript: Ctx[]): ReceiptTopic | null {
  const recentes = transcript.filter((m) => m.body).slice(-MAX_MESSAGES).reverse();
  // A declaração da pessoa prevalece sobre uma pergunta equivocada do próprio agente.
  const evidence = [...recentes.filter(m => m.direction === 'inbound'), ...recentes.filter(m => m.direction !== 'inbound')];
  for (const m of evidence) {
    const texto = fold(String(m.body));
    const achados = TOPICS.filter(([, re]) => re.test(texto));
    // Uma lista de opções do agente é pergunta, não evidência da finalidade.
    if (achados.length > 1) {
      if (m.direction === 'inbound') return 'ambiguous';
      continue;
    }
    if (achados.length) return achados[0][0];
  }
  return null;
}

const MINE = /\bminha mensalidade|\bmeu (?:comprovante(?: de pagamento)?|pagamento) (?:da|de) mensalidade/;
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_WORD = new RegExp(`\\b(${MONTHS.join('|')})\\b`);

function namedOwner(text: string): string | null {
  const owner = /mensalidade\s+(?:(?:do|da|de)\s+)?([^\n.,!?]+)/.exec(text)?.[1]?.trim();
  if (!owner) return null;
  if (MONTH_WORD.test(owner)) {
    const named = /\bde ([a-z][a-z ]+)$/.exec(owner)?.[1];
    return named && !MONTH_WORD.test(named) ? named : null;
  }
  return /^(?:pagamento|mes|clube\b|stc\b|socio\b|tenis\b|\d)/.test(owner) ? null : owner;
}

export function membershipIsForAnother(transcript: Ctx[], ownName: string): boolean {
  const owner = declaredMembershipOwner(transcript);
  if (!owner || owner === 'self') return false;
  const name = fold(ownName).trim();
  return owner.trim() !== name;
}

/** Um comprovante não herda instruções de outro arquivo nem de uma conversa de dias atrás. */
export function receiptEvidence(transcript: Ctx[], stage: { source_message_id: string; created_at?: string | null }): Ctx[] {
  const current = transcript.findIndex(m => m.id === stage.source_message_id);
  let start = 0;
  for (let i = 0; i < (current < 0 ? transcript.length : current); i++) {
    if (transcript[i].id && (transcript[i].kind === 'image' || transcript[i].kind === 'document')) start = i + 1;
  }
  const since = stage.created_at ? Date.parse(stage.created_at) - 24 * 60 * 60 * 1000 : NaN;
  return transcript.slice(start).filter(m => !Number.isFinite(since) || !m.created_at || Date.parse(String(m.created_at)) >= since);
}

/**
 * O administrador disse que a mensalidade é DELE ("meu comprovante da mensalidade", "mensalidade de Hermeson Veras").
 * Sem isso, comprovante de mensalidade que o admin manda é de outro sócio e nunca baixa a cobrança dele por coincidência de valor.
 */
export function talksAboutOwnMembership(transcript: Ctx[], ownName: string): boolean {
  const nome = fold(ownName).trim();
  const owner = declaredMembershipOwner(transcript);
  return owner === 'self' || Boolean(owner && nome.length > 3 && owner === nome);
}

function declaredMembershipOwner(transcript: Ctx[]): string | null {
  const statements = transcript.filter(m => m.direction === 'inbound' && m.body).slice().reverse();
  for (const msg of statements) {
    const texto = fold(String(msg.body));
    if (!/mensalidade/.test(texto)) continue;
    const titular = namedOwner(texto);
    if (titular) return titular.trim();
    if (MINE.test(texto)) return 'self';
  }
  return null;
}

/** Pergunta do João quando o Pix do admin bate com a mensalidade dele; a resposta "sim" confirma a finalidade. */
export const OWN_MEMBERSHIP_QUESTION = 'É a sua mensalidade de';
const YES = /^(?:sim|isso|isso mesmo|exato|pode|pode dar baixa|confirmo|e sim|e a minha|e minha|ok)\b[\s!.,]*(?:obrigad[oa])?[\s!.]*$/;

/** "sim" logo depois de "É a sua mensalidade de 11/2026?": devolve o mês (AAAA-MM-01); qualquer outra resposta, null. */
export function confirmedOwnMembershipMonth(transcript: Ctx[]): string | null {
  const falas = transcript.filter(m => m.body);
  const resposta = falas.at(-1);
  if (resposta?.direction !== 'inbound' || !YES.test(fold(String(resposta.body)).trim())) return null;
  // A pergunta pode ter saído em mais de um balão: vale qualquer balão do João entre a fala anterior dele e o "sim".
  const antes = falas.slice(0, -1);
  const inicio = antes.map(m => m.direction).lastIndexOf('inbound') + 1;
  const pergunta = new RegExp(`${OWN_MEMBERSHIP_QUESTION} (\\d{2})/(20\\d{2})\\?`);
  const mes = antes.slice(inicio).map(m => pergunta.exec(String(m.body))).find(Boolean);
  return mes ? `${mes[2]}-${mes[1]}-01` : null;
}

/** Competência vem do pedido; a data do Pix não prova qual mês foi pago. */
export function membershipReference(transcript: Ctx[], today: string): { month: string | null; ambiguous: boolean } {
  const msg = transcript.filter(m => m.direction === 'inbound' && m.body).slice().reverse()
    .find(m => /mensalidade|mes passado|deste mes|desse mes|\b\d{1,2}\/20\d{2}\b/.test(fold(String(m.body))) || MONTH_WORD.test(fold(String(m.body))));
  if (!msg) return { month: null, ambiguous: false };
  const text = fold(String(msg.body));
  const year = Number(/\b(20\d{2})\b/.exec(text)?.[1] ?? today.slice(0, 4));
  const months = new Set<string>();
  MONTHS.forEach((name, i) => { if (new RegExp(`\\b${name}\\b`).test(text)) months.add(`${year}-${String(i + 1).padStart(2, '0')}-01`); });
  for (const match of text.matchAll(/(?<![\d/])(0?[1-9]|1[0-2])\/(20\d{2})\b/g)) months.add(`${match[2]}-${match[1].padStart(2, '0')}-01`);
  if (/\b(?:deste|desse|este|esse) mes\b/.test(text)) months.add(`${today.slice(0, 7)}-01`);
  if (/\bmes passado\b/.test(text)) {
    const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    months.add(date.toISOString().slice(0, 10));
  }
  const invalidMonth = /(?<![\d/])(?:0|00|1[3-9]|[2-9]\d)\/20\d{2}\b/.test(text);
  const years = new Set(text.match(/\b20\d{2}\b/g));
  return { month: months.size === 1 ? [...months][0] : null, ambiguous: months.size > 1 || years.size > 1 || invalidMonth };
}
