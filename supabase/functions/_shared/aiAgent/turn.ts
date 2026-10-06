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

import { extrairObjeto, repararJson, stripCodeFence } from './jsonRepair.ts';
import type { Chat } from './llm.ts';
import { systemPrompt, userPrompt, type AiSettings, type Ctx } from './prompts.ts';
import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from '../uazChat.ts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export type TurnDeps = {
  db: Db;
  chat: Chat | null;
  uaz: UazCaller | null;
  sleep: (ms: number) => Promise<void>;
};

export type Slots = {
  type?: 'Play' | 'Aula' | null;
  date?: string | null;
  start?: string | null;
  duration?: number | null;
  court_label?: string | null;
  participant_names?: string[];
  participants_known?: boolean;
  guest_name?: string | null;
  professor_name?: string | null;
  student_names?: string[];
  reservation_ref?: string | null;
  /** Mexer nos atletas de uma reserva existente (sair, retirar, adicionar). */
  add_names?: string[];
  remove_names?: string[];
  remove_guest?: boolean;
};

export type Intent = 'reservar' | 'cancelar' | 'remarcar' | 'consultar' | 'informar' | 'entrar' | 'participantes' | 'outro';

export type Answer = {
  messages: string[];
  intent: Intent;
  slots: Slots;
  ready: boolean;
  customer_confirmed: boolean;
  declined: boolean;
  awaiting: boolean;
  transfer: boolean;
  handoff_kind: 'soft' | 'hard' | null;
  handoff_note: string | null;
  close: boolean;
  /** Resumo compactado da conversa (o agente reescreve a cada turno); ausente = manter o anterior. */
  summary?: string | null;
};

/* ------------------------------- Parse (soft-fail) ------------------------------- */

function lerJson(output: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(repararJson(extrairObjeto(stripCodeFence(output))));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8) : []);
const INTENTS: Intent[] = ['reservar', 'cancelar', 'remarcar', 'consultar', 'informar', 'entrar', 'participantes', 'outro'];
const ACTIONABLE: Intent[] = ['reservar', 'cancelar', 'remarcar'];

/**
 * Só o que o modelo realmente escreveu: chave ausente fica `undefined` (não apaga o que já se sabia);
 * lista presente — mesmo vazia — substitui (o modelo reescreve o estado inteiro a cada turno).
 */
export function parseSlots(raw: unknown): Slots {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Slots = {};
  if (o.type === 'Play' || o.type === 'Aula') out.type = o.type; else if ('type' in o) out.type = null;
  if (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) out.date = o.date; else if ('date' in o) out.date = null;
  if (typeof o.start === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.start)) out.start = o.start; else if ('start' in o) out.start = null;
  if (typeof o.duration === 'number' && [30, 60, 90, 120].includes(o.duration)) out.duration = o.duration; else if ('duration' in o) out.duration = null;
  if ('court_label' in o) out.court_label = str(o.court_label);
  if ('participant_names' in o) out.participant_names = strList(o.participant_names);
  if ('participants_known' in o) out.participants_known = o.participants_known === true;
  if ('guest_name' in o) out.guest_name = str(o.guest_name);
  if ('professor_name' in o) out.professor_name = str(o.professor_name);
  if ('student_names' in o) out.student_names = strList(o.student_names);
  if ('reservation_ref' in o) out.reservation_ref = str(o.reservation_ref);
  if ('add_names' in o) out.add_names = strList(o.add_names);
  if ('remove_names' in o) out.remove_names = strList(o.remove_names);
  if ('remove_guest' in o) out.remove_guest = o.remove_guest === true;
  return out;
}

const SUMMARY_MAX = 600;
/** Resumo do histórico: texto corrido, sem quebras, no máximo 600 caracteres (a conta do prompt não cresce com a conversa). */
export function clipSummary(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : t;
}

/** Falha vira transferência com mensagens vazias: nunca silêncio, nunca invenção. */
export function parseAnswer(output: string): Answer {
  const obj = lerJson(output);
  if (!obj) {
    return { messages: [], intent: 'outro', slots: {}, ready: false, customer_confirmed: false, declined: false, awaiting: false,
      transfer: true, handoff_kind: 'hard', handoff_note: 'Falha ao interpretar a resposta da IA.', close: false, summary: null };
  }
  const msgs = Array.isArray(obj.messages) ? obj.messages : obj.message ? [obj.message] : [];
  const transfer = obj.transfer === true;
  const intent = INTENTS.includes(obj.intent as Intent) ? obj.intent as Intent : 'outro';
  return {
    messages: msgs.map((m) => String(m ?? '').trim()).filter(Boolean).slice(0, 4),
    intent, slots: parseSlots(obj.slots),
    ready: obj.ready === true && !transfer, customer_confirmed: obj.customer_confirmed === true && !transfer,
    declined: obj.declined === true, awaiting: obj.awaiting === true,
    transfer, handoff_kind: obj.handoff_kind === 'soft' || obj.handoff_kind === 'hard' ? obj.handoff_kind : transfer ? 'hard' : null,
    handoff_note: str(obj.handoff_note)?.slice(0, 500) ?? null, close: obj.close === true && !transfer,
    summary: clipSummary(obj.summary),
  };
}

/**
 * Soma o que o modelo disse ao que já se sabia. Valor nulo/ausente não apaga um campo preenchido (o modelo
 * "esquece" às vezes); lista informada (inclusive vazia) substitui; `participants_known` só sobe.
 */
export function mergeSlots(prev: Slots | undefined, next: Slots, reset = false): Slots {
  const base: Slots = reset ? {} : { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(next) as [keyof Slots, unknown][]) {
    if (v === undefined) continue;
    if (Array.isArray(v)) (base as Record<string, unknown>)[k] = v;
    else if (typeof v === 'boolean') (base as Record<string, unknown>)[k] = v || (reset ? false : Boolean((base as Record<string, unknown>)[k]));
    else if (v !== null && v !== '') (base as Record<string, unknown>)[k] = v;
  }
  return base;
}

/* ------------------------------- Cadência de bolhas ------------------------------- */

const MAX_BUBBLES = 4;
const MAX_CHARS = 320;

/** Cada item vindo do modelo já é uma microbolha. Só quebramos automaticamente linhas explícitas ou textos muito longos. */
function naturalParts(message: string): string[] {
  const seeds = message.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const seed of seeds) {
    let rest = seed;
    while (rest.length > MAX_CHARS) {
      const janela = rest.slice(0, MAX_CHARS + 1);
      let corte = -1;
      const fim = /[.!?;…,:](?=\s)/g;
      let x: RegExpExecArray | null;
      while ((x = fim.exec(janela)) !== null) if (x.index + 1 >= MAX_CHARS / 2) corte = x.index + 1;
      if (corte < 0) corte = janela.lastIndexOf(' ') > 0 ? janela.lastIndexOf(' ') : MAX_CHARS;
      out.push(rest.slice(0, corte).trim());
      rest = rest.slice(corte).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/** No máximo 4 microbolhas, com tempo de "digitando" inclusive antes da primeira. */
export function cadence(messages: string[]): { text: string; delayMs: number }[] {
  const partes = messages.flatMap(naturalParts);
  const bolhas = partes.slice(0, MAX_BUBBLES);
  if (partes.length > MAX_BUBBLES) bolhas[MAX_BUBBLES - 1] = partes.slice(MAX_BUBBLES - 1).join(' ');
  return bolhas.map((text, i) => ({
    text,
    delayMs: i === 0
      ? Math.max(450, Math.min(1400, 280 + text.length * 11))
      : Math.max(700, Math.min(4200, 500 + text.length * 24)),
  }));
}

/* ------------------------------- Regras que não dependem do modelo ------------------------------- */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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

/** O texto do modelo afirma que algo foi feito? Quem afirma isso é o sistema, não o modelo. */
const SUCCESS_CLAIM = /\b(reservei|reservad[oa]s?|marquei|marcad[oa]s?|agendei|agendad[oa]s?|confirmei|confirmad[oa]s?|cancelei|cancelad[oa]s?|remarquei|remarcad[oa]s?|retirei|removi|tirei|adicionei|coloquei|inclu[ií]|alterei|atualizei|editei|j[aá] est[aá] (garantid[oa]|feit[oa]|ok))\b/i;
export function claimsSuccess(text: string): boolean {
  return SUCCESS_CLAIM.test(text);
}

const TRANSFER_DIRECT = 'Vou passar a sua conversa para alguém da equipe, tá? Eles te respondem por aqui mesmo.';
const TRANSFER_GROUP = 'Vou pedir para alguém da equipe te ajudar com isso por aqui, tá?';

/* ------------------------------- Textos escritos pelo servidor ------------------------------- */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "hoje", "amanhã" ou "sábado, 10/10". */
export function dayLabel(date: string, todayIso: string): string {
  const d = date.slice(0, 10);
  const t = new Date(`${todayIso.slice(0, 10)}T12:00:00Z`);
  const diff = Math.round((new Date(`${d}T12:00:00Z`).getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  const dow = DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
  return `${dow}, ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

const listaNomes = (nomes: string[]) => (nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

type Summary = Record<string, any>; // payload normalizado de `validate_reservation`

export function describeReservation(n: Summary, today: string, names: string[] = []): string {
  const quando = `${dayLabel(String(n.date), today)}, ${n.start}${n.end ? `–${n.end}` : ''}`;
  const onde = n.court_name ? ` na ${n.court_name}` : '';
  const quem = names.length ? ` para ${listaNomes(names)}` : '';
  return `${n.type === 'Aula' ? 'aula' : 'reserva'} ${quando}${onde}${quem}`;
}

export function proposalMessage(action: 'create' | 'cancel' | 'reschedule', n: Summary, today: string, names: string[]): string {
  if (action === 'cancel') return `Vou cancelar a ${describeReservation(n, today)}. Posso cancelar? Responda "sim" para confirmar.`;
  if (action === 'reschedule') return `Verifiquei agora e dá para remarcar para ${describeReservation(n, today, names)}. A anterior será cancelada. Posso confirmar?`;
  return `Verifiquei agora: o horário está livre. Seria ${describeReservation(n, today, names)}. Posso confirmar essa reserva?`;
}

/** Jogo que ocupa o horário, como o banco devolve (`conv_svc_ai_slot_games`). */
export type Game = { reservation_id: string; type: string; date: string; start: string; end: string; court_name: string | null;
  names: string[]; participants: number; spots_left: number; joinable: boolean; reason?: string | null };

const jogoDe = (g: Pick<Game, 'date' | 'start' | 'end' | 'court_name'>, today: string) =>
  `${dayLabel(String(g.date), today)}, ${g.start}–${g.end}${g.court_name ? ` na ${g.court_name}` : ''}`;

/** Horário ocupado por um jogo com vaga: mostra quem está e oferece entrar (o "sim" é confirmado pelo banco). */
export function joinOfferMessage(g: Game, today: string, levando: string[] = []): string {
  const quem = g.names.length ? `, com ${listaNomes(g.names)}` : '';
  const vagas = g.spots_left === 1 ? 'resta 1 vaga' : `restam ${g.spots_left} vagas`;
  const junto = levando.length ? ` com ${listaNomes(levando)}` : '';
  if (g.participants >= 4) {
    return `Rapaz, esse play já tá com uma galera, viu: ${jogoDe(g, today)}${quem} (${vagas}). Se quiser entrar${junto}, cabe; ou eu vejo outra quadra/horário pra você.`;
  }
  return `Esse horário já está reservado: ${jogoDe(g, today)}${quem} (${vagas}). Quer entrar nesse jogo${junto}? Responda "sim" que eu ${levando.length ? 'adiciono vocês' : 'te adiciono'}.`;
}

/** O jogo tem vaga, mas não para todo mundo que a pessoa quer levar. */
export function notEnoughSpotsMessage(g: Game, spots: number, wanted: number, today: string): string {
  const vagas = spots === 1 ? 'só resta 1 vaga' : spots === 0 ? 'não há mais vagas' : `só restam ${spots} vagas`;
  return `Já existe um jogo nesse horário (${jogoDe(g, today)}, com ${listaNomes(g.names)}), mas ${vagas} e você quer entrar com ${wanted} ${wanted === 1 ? 'pessoa' : 'pessoas'}. Quer entrar com menos gente?`;
}

/** Horário ocupado por algo em que a pessoa não pode entrar (lotado, já está, aula, campeonato). */
export function busyMessage(g: Game, today: string): string {
  if (g.reason === 'ALREADY_IN') return `Você já está nesse jogo: ${jogoDe(g, today)}${g.names.length ? `, com ${listaNomes(g.names)}` : ''}.`;
  if (g.reason === 'GAME_FULL') return `Esse horário já tem jogo com 8 pessoas: ${jogoDe(g, today)}, com ${listaNomes(g.names)}. Está lotado.`;
  if (g.type === 'Aula') return `Esse horário está reservado para uma aula (${jogoDe(g, today)}).`;
  if (g.type === 'Play') return `Esse horário já está reservado: ${jogoDe(g, today)}${g.names.length ? `, com ${listaNomes(g.names)}` : ''}.`;
  return `Esse horário está ocupado (${jogoDe(g, today)}).`;
}

/** Reserva da agenda que o agente enxerga (`ai_agenda`). */
export type AgendaItem = { ref: string; id: string; type: string; date: string; start: string; end: string; court: string | null;
  people: { id: string; name: string }[]; guest: string | null; spots_left: number | null; mine: boolean;
  can: { leave: boolean; people: boolean; edit: boolean; cancel: boolean } };

const quandoDe = (n: Record<string, any>, today: string) =>
  `${dayLabel(String(n.date), today)}, ${n.start}${n.end ? `–${n.end}` : ''}${n.court_name ?? n.court ? ` na ${n.court_name ?? n.court}` : ''}`;
const comVoce = (nomes: string[], me?: string) => nomes.map((x) => (me && x === me ? 'você' : x));

/** O que o servidor entendeu do pedido de mexer nos atletas — mostrado ANTES de gravar. */
export function participantsProposalMessage(n: Summary, today: string, me?: string): string {
  const quando = quandoDe(n, today);
  if (n.cancel_all) return `Você é o último atleta da reserva de ${quando}: ao sair, a reserva inteira é cancelada. Posso cancelar?`;
  const tira = [...comVoce((n.remove_names ?? []) as string[], me), ...(n.remove_guest && !n.add_guest ? ['o convidado'] : [])];
  const poe = [...((n.add_names ?? []) as string[]), ...(n.add_guest ? [`${n.add_guest} (convidado)`] : [])];
  const partes = [tira.length ? `retirar ${listaNomes(tira)}` : '', poe.length ? `adicionar ${listaNomes(poe)}` : ''].filter(Boolean);
  const ficam = comVoce((n.after_names ?? []) as string[], me);
  return `Vou ${partes.join(' e ')} ${poe.length ? 'na' : 'da'} reserva de ${quando}. Ficam: ${listaNomes(ficam)}. Posso confirmar?`;
}

export function successMessage(action: 'create' | 'cancel' | 'reschedule' | 'join' | 'participants', n: Summary, today: string, names: string[], me?: string): string {
  if (action === 'participants') {
    const quando = quandoDe(n, today);
    if (n.cancel_all) return `Pronto, você saiu e a reserva de ${quando} foi cancelada.`;
    const soEu = n.self_leaving && (n.remove_names ?? []).length === 1 && !(n.add_names ?? []).length && !n.add_guest && !n.remove_guest;
    return soEu
      ? `Pronto, você saiu da reserva de ${quando}. Continuam: ${listaNomes(comVoce((n.after_names ?? []) as string[], me))}.`
      : `Pronto, atualizei a reserva de ${quando}. Agora jogam: ${listaNomes(comVoce((n.after_names ?? []) as string[], me))}.`;
  }
  if (action === 'join') {
    const ordem = [...((n.names ?? []) as string[]).filter((x) => x !== me), ...(me ? ['você'] : [])];
    return `Pronto, ${Number(n.added ?? 1) > 1 ? 'vocês entraram' : 'você entrou'} no jogo de ${jogoDe(n as Game, today)}. Jogam: ${listaNomes(ordem)}.`;
  }
  if (action === 'cancel') return `Pronto, a ${describeReservation(n, today)} foi cancelada.`;
  if (action === 'reschedule') return `Pronto, remarcado: ${describeReservation(n, today, names)}.`;
  return `Reserva confirmada: ${describeReservation(n, today, names)}.`;
}

/** Mensagens para os códigos que o banco devolve. `null` = o caso pede transferência para a equipe. */
export const CODE_TEXT: Record<string, string | null> = {
  IN_PAST: 'Esse horário já passou. Qual outro dia ou horário fica bom?',
  INVALID_START: 'Os horários começam das 05:00 às 22:30, de 30 em 30 minutos. Qual horário você prefere?',
  INVALID_DURATION: 'A duração do Play pode ser 60, 90 ou 120 minutos (a aula tem 30). Qual você prefere?',
  AFTER_CLOSING: 'Essa reserva passaria das 23:00, quando o clube fecha. Quer um horário mais cedo ou menos tempo?',
  INVALID_DATE: 'Não entendi a data. Pode me dizer o dia?',
  COURT_NOT_FOUND: 'Não encontrei essa quadra ativa. Quer saibro ou rápida?',
  AULA_ONLY_FAST_COURT: 'Aulas só acontecem na Quadra Rápida. Posso procurar nela?',
  NOT_ALLOWED_AULA: 'Só professor ou administrador marca aula por aqui. Posso te ajudar com uma reserva de quadra (Play)?',
  PROFESSOR_REQUIRED: 'Qual professor vai dar a aula?',
  STUDENT_REQUIRED: 'Quem são os alunos da aula?',
  TOO_MANY_PARTICIPANTS: 'Uma reserva tem no máximo 8 participantes. Quem fica de fora?',
  NON_MEMBER_HOURS: 'Aula só com não-sócios ou dependentes: de manhã (até 12h) ou à noite (a partir das 20h). Qual horário serve?',
  INVALID_GUEST: 'Qual o nome do convidado?',
  PARTICIPANT_NOT_MEMBER: 'Algum participante não está ativo como sócio. A equipe precisa conferir.',
  REQUESTER_NOT_MEMBER: null,
  REQUESTER_NOT_IDENTIFIED: null,
  NEEDS_HUMAN: null,
  CARD_INVALID: null,
  STUDENT_PAUSED: null,
  NOT_IN_RESERVATION: 'Essa pessoa não está nessa reserva. Quem está nela eu posso te dizer; quer ver?',
  NOT_PLAY: 'Só consigo mexer nos atletas de reservas de Play (aula e campeonato é com a equipe).',
  NOTHING_TO_DO: 'Não vi nada para alterar nessa reserva. O que você quer mudar?',
  RESERVATION_STARTED: 'Esse jogo já começou: agora só dá para sair dele. Quer sair?',
  CREATOR_PROTECTED: 'Só quem criou a reserva (ou um administrador) pode retirar o criador.',
  GUEST_ALREADY: 'Esse jogo já tem um convidado. Quer trocar por outro (retiro o atual e coloco o novo)?',
  NOT_YOUR_RESERVATION: 'Só quem criou a reserva (ou um administrador) pode cancelar ou remarcar.',
  RESERVATION_NOT_FOUND: 'Não encontrei essa reserva entre as suas futuras.',
  NOT_EXPLICIT: 'Não entendi como confirmação. Para eu seguir, responda "sim" à proposta acima — ou me diga o que mudar.',
  NOT_AUTHORIZED_TO_CONFIRM: 'Só quem pediu (ou um administrador) pode confirmar. Quem pediu pode responder "sim".',
  PROPOSAL_EXPIRED: 'A proposta venceu. Quer que eu monte outra com os mesmos dados?',
  PROPOSAL_CLOSED: 'Essa proposta já não está aberta. Quer que eu monte outra?',
  CONFIRMATION_NOT_AFTER_PROPOSAL: 'Para confirmar, responda "sim" depois do resumo que enviei.',
};

/* ------------------------------- Quem foi marcado: do número para o sócio ------------------------------- */

export type MencaoResolvida = { id: string; is_bot: boolean; name: string | null; profile_id: string | null; via: string | null };
const MENCAO = /@(\d{8,16})\b/g;

/** "@61809058967781" → "@Emerson Souza" (sócio conciliado), "@STC" (a própria conta) ou "@(pessoa não identificada)". */
export function substituirMencoes(texto: string, mapa: Map<string, MencaoResolvida>, conta = 'STC'): string {
  return texto.replace(MENCAO, (m, id: string) => {
    const r = mapa.get(id);
    if (!r) return m;
    return r.is_bot ? `@${conta}` : r.name ? `@${r.name}` : '@(pessoa não identificada)';
  });
}

/**
 * Concilia cada "@número" dos textos com o cadastro de sócios: pelo contato do WhatsApp com esse LID e pelo TELEFONE. O que o cadastro
 * não resolve sozinho (o LID de quem nunca escreveu) é perguntado à UazAPI — os participantes do grupo trazem LID e telefone juntos —
 * e conciliado de novo pelo telefone. Nada é gravado; o que não for achado fica sem nome (o agente pergunta).
 */
export async function conciliarMencoes(deps: TurnDeps, conversation: string, isGroup: boolean, textos: string[]): Promise<Map<string, MencaoResolvida>> {
  const ids = [...new Set(textos.flatMap((t) => [...t.matchAll(MENCAO)].map((m) => m[1])))];
  const mapa = new Map<string, MencaoResolvida>();
  if (ids.length === 0) return mapa;
  const resolver = async (items: { id: string; phone: string | null }[]) =>
    ((await deps.db('conv_svc_ai_resolve_mentions', { p_items: items })).data ?? []) as MencaoResolvida[];
  for (const r of await resolver(ids.map((id) => ({ id, phone: null })))) mapa.set(r.id, r);
  const faltam = ids.filter((id) => { const r = mapa.get(id); return r && !r.is_bot && !r.name; });
  if (faltam.length && isGroup && deps.uaz) {
    const dest = (await deps.db('conv_svc_conversation_contact', { p_conversation: conversation })).data;
    const grupo = (Array.isArray(dest) ? dest[0] : dest) as { destination?: string } | null;
    const req = grupo?.destination ? buildChatRequest({ action: 'groupInfo', groupJid: grupo.destination }) : null;
    const res = req ? await deps.uaz(req).catch(() => null) : null;
    const lista = res && res.ok ? ((res.body.Participants ?? res.body.participants ?? []) as Record<string, unknown>[]) : [];
    const telefones = new Map<string, string>();
    for (const p of lista) {
      const lid = String(p.LID ?? p.lid ?? '').split('@')[0].split(':')[0];
      const fone = String(p.PhoneNumber ?? p.phoneNumber ?? p.phone ?? '').split('@')[0].replace(/\D/g, '');
      if (lid && fone) telefones.set(lid, fone);
    }
    const comTelefone = faltam.filter((id) => telefones.has(id)).map((id) => ({ id, phone: telefones.get(id)! }));
    if (comTelefone.length) for (const r of await resolver(comTelefone)) if (r.name || r.is_bot) mapa.set(r.id, r);
  }
  return mapa;
}


/** Lista os sócios reconhecidos que estão AGORA no grupo, sem expor telefone/LID ao modelo. */
export async function membrosAtuaisDoGrupo(deps: TurnDeps, conversation: string): Promise<string[]> {
  if (!deps.uaz) return [];
  try {
    const destRaw = (await deps.db('conv_svc_conversation_contact', { p_conversation: conversation })).data;
    const dest = (Array.isArray(destRaw) ? destRaw[0] : destRaw) as { destination?: string } | null;
    const req = dest?.destination ? buildChatRequest({ action: 'groupInfo', groupJid: dest.destination }) : null;
    const res = req ? await deps.uaz(req) : null;
    if (!res?.ok) return [];
    const lista = (res.body.Participants ?? res.body.participants ?? []) as Record<string, unknown>[];
    const items = lista.map((p) => {
      const lid = String(p.LID ?? p.lid ?? '').split('@')[0].split(':')[0];
      const phone = String(p.PhoneNumber ?? p.phoneNumber ?? p.phone ?? '').split('@')[0].replace(/\D/g, '');
      return { id: lid || phone, phone: phone || null };
    }).filter((x) => x.id);
    if (!items.length) return [];
    const rr = await deps.db('conv_svc_ai_resolve_mentions', { p_items: items });
    const resolved = (rr.data ?? []) as MencaoResolvida[];
    return [...new Set(resolved.filter((x) => !x.is_bot && x.name).map((x) => String(x.name)))];
  } catch {
    return [];
  }
}

/* ------------------------------- Agenda: localizar a reserva de que a pessoa fala ------------------------------- */

const agendaDe = (ctx: Ctx): AgendaItem[] => ((ctx.agenda ?? []) as AgendaItem[]);

/** Reserva por referência do modelo (aN ou id), entre as da agenda e as da própria pessoa. */
function reservaPorRef(ctx: Ctx, ref: string | null | undefined): { id: string; type: string; date: string; start: string } | undefined {
  if (!ref) return undefined;
  const minha = ((ctx.my_reservations ?? []) as Ctx[]).find((r) => r.id === ref);
  if (minha) return { id: String(minha.id), type: String(minha.type), date: String(minha.date), start: String(minha.start) };
  const a = agendaDe(ctx).find((x) => x.ref === ref || x.id === ref);
  return a ? { id: a.id, type: a.type, date: a.date, start: a.start } : undefined;
}

/** Acha a reserva por referência ou pelo que a pessoa disse (dia, horário, quadra); sem pista, a única reserva dela. */
export function acharReserva(ctx: Ctx, slots: Slots): { item?: AgendaItem; candidatas: AgendaItem[] } {
  const ag = agendaDe(ctx).filter((a) => a.type === 'Play');
  const exata = ag.find((a) => a.ref === slots.reservation_ref || a.id === slots.reservation_ref);
  if (exata) return { item: exata, candidatas: [exata] };
  let pool = ag;
  const temPista = Boolean(slots.date || slots.start || slots.court_label);
  if (slots.date) pool = pool.filter((a) => String(a.date).slice(0, 10) === slots.date);
  if (slots.start) pool = pool.filter((a) => toMin(a.start) <= toMin(slots.start!) && toMin(slots.start!) < toMin(a.end));
  if (slots.court_label) {
    const l = norm(slots.court_label);
    pool = pool.filter((a) => norm(a.court ?? '').includes(l.replace(/^quadra\s+/, '')) || l.includes(norm(a.court ?? '')));
  }
  if (!temPista) pool = pool.filter((a) => a.mine);
  if (pool.length > 1) { const minhas = pool.filter((a) => a.mine); if (minhas.length === 1) pool = minhas; }
  return { item: pool.length === 1 ? pool[0] : undefined, candidatas: pool };
}

const EU = new Set(['eu', 'me', 'mim', 'eu mesmo', 'eu mesma', 'meu nome', 'meu']);

/** Quem, entre os que estão na reserva, a pessoa quer dizer? Único ou pergunta; nunca escolhe por aproximação. */
function acharNaReserva(item: AgendaItem, nome: string): { ids: string[]; ask?: string } {
  const q = norm(nome).trim();
  const palavras = q.split(/\s+/).filter(Boolean);
  const exatos = item.people.filter((p) => norm(p.name) === q);
  const achados = exatos.length ? exatos : item.people.filter((p) => palavras.length > 0 && palavras.every((w) => norm(p.name).includes(w)));
  if (achados.length === 1) return { ids: [achados[0].id] };
  if (achados.length > 1) return { ids: [], ask: `Na reserva tem mais de um "${nome}": ${listaNomes(achados.map((p) => p.name))}. Qual deles?` };
  return { ids: [], ask: `Não achei "${nome}" nessa reserva. Estão nela: ${listaNomes(item.people.map((p) => p.name))}. Quem você quer retirar?` };
}

/* ------------------------------- Quadras e horários ------------------------------- */

type Court = { id: string; name: string; type: string };

/** Quadras candidatas, na ordem em que o servidor tenta. Play sem preferência = saibro; Aula = rápida. */
export function pickCourts(courts: Court[], type: 'Play' | 'Aula', label: string | null | undefined): Court[] {
  const t = (c: Court) => norm(c.type);
  if (type === 'Aula') return courts.filter((c) => /r.?pida/.test(t(c)));
  const l = label ? norm(label) : '';
  if (l) {
    const porNome = courts.filter((c) => norm(c.name).includes(l) || l.includes(norm(c.name)));
    const porTipo = courts.filter((c) => t(c).includes(l.replace(/^quadra\s+/, '')) || (l.includes('rapida') && /r.?pida/.test(t(c))) || (l.includes('saibro') && t(c).includes('saibro')));
    const achadas = porNome.length ? porNome : porTipo;
    if (achadas.length) return achadas;
    return [];
  }
  const saibro = courts.filter((c) => t(c).includes('saibro'));
  return saibro.length ? saibro : courts;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Os horários livres mais próximos do pedido, até `n`. */
export function nearest(slots: string[], wanted: string | null | undefined, n = 4): string[] {
  const w = wanted ? toMin(wanted) : 12 * 60;
  return [...slots].sort((a, b) => Math.abs(toMin(a) - w) - Math.abs(toMin(b) - w)).slice(0, n).sort();
}

/* ------------------------------- Turno ------------------------------- */

const first = <T,>(r: RpcResult): T | null => (Array.isArray(r.data) ? (r.data[0] as T) ?? null : (r.data as T) ?? null);

export type TurnResult = { status: string; reason?: string; bubbles?: number; handoff?: string | null; action?: string | null };

type Memory = { intent?: Intent; slots?: Slots; proposal_names?: string[]; pending_guest?: string | null; summary?: string; [k: string]: unknown };

type Decision = { bubbles: string[]; awaiting: boolean; close: boolean; action: string | null; memory: Memory; handoff?: { kind: 'soft' | 'hard'; note: string } };

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

  // Contexto extra continua barato: SQL compacto + uma única chamada ao modelo por turno.
  try {
    const roster = await db('conv_svc_ai_club_roster', {});
    ctx.club_roster = Array.isArray(roster.data) ? roster.data : [];
  } catch { ctx.club_roster = []; }
  if (isGroup) {
    try {
      const gc = await db('conv_svc_ai_group_context', { p_session: session });
      ctx.group_context = Array.isArray(gc.data) ? gc.data : [];
    } catch { ctx.group_context = []; }
    const membros = await membrosAtuaisDoGrupo(deps, conversation);
    const requesterName = String((ctx.requester?.profile as Ctx | undefined)?.name ?? '').trim();
    if (requesterName && !membros.includes(requesterName)) membros.push(requesterName);
    ctx.group_members = membros;
  }

  // "@61809058967781" vira nome ANTES de o modelo ler tanto a solicitação quanto o papo recente do grupo.
  const textosComMencoes = [
    ...((ctx.transcript ?? []) as Ctx[]).map((t) => String(t.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).map((t) => String(t.body ?? '')),
  ];
  const mencoes = await conciliarMencoes(deps, conversation, isGroup, textosComMencoes);
  if (mencoes.size) {
    const conta = String(ctx.institutional_name ?? 'STC');
    ctx.transcript = ((ctx.transcript ?? []) as Ctx[]).map((t) => ({ ...t, body: substituirMencoes(String(t.body ?? ''), mencoes, conta) }));
    if (isGroup) ctx.group_context = ((ctx.group_context ?? []) as Ctx[]).map((t) => ({ ...t, body: substituirMencoes(String(t.body ?? ''), mencoes, conta) }));
  }
  const trail = ((ctx.transcript ?? []) as Ctx[]).slice().reverse();
  const ultimaDaIa = trail.findIndex((t) => t.direction === 'outbound');
  const pendentes = (ultimaDaIa < 0 ? trail : trail.slice(0, ultimaDaIa)).filter((t) => t.direction === 'inbound').reverse();
  const buffered = pendentes.map((t) => t.body || (t.kind !== 'text' ? `[${t.kind}]` : '')).filter(Boolean).join('\n');
  const soMidia = pendentes.length > 0 && pendentes.every((t) => t.kind && t.kind !== 'text' && !t.body);
  const ultima = pendentes[pendentes.length - 1] as Ctx | undefined;
  const today = String(ctx.now_local).slice(0, 10);

  const entregar = async (bolhas: { text: string; delayMs: number }[]) => {
    let enviadas = 0;
    for (const [i, b] of bolhas.entries()) {
      if (b.delayMs) {
        if (deps.uaz) {
          const dest = first<{ destination: string }>(await db('conv_svc_conversation_contact', { p_conversation: conversation }));
          const p = dest ? buildChatRequest({ action: 'presence', number: dest.destination, state: 'composing' }) : null;
          if (p) await deps.uaz(p).catch(() => undefined);
        }
        await deps.sleep(b.delayMs);
      }
      // Guarda de takeover: chegou mensagem nova do solicitante ou a equipe assumiu → para de falar.
      if (!(await latest())) break;
      const q = first<{ message_id: string; destination: string; reply_provider_id: string | null }>(await db('conv_svc_queue_message', {
        p_conversation: conversation,
        p: { kind: 'text', body: b.text, reply_to_message_id: isGroup && i === 0 && ultima?.id ? ultima.id : null },
        p_author: null, p_key: crypto.randomUUID(), p_origin: 'ai', p_session: session,
      }));
      if (!q) break;
      const pedido = buildChatRequest({ action: 'send', number: q.destination, kind: 'text', text: b.text, replyId: q.reply_provider_id });
      const res = deps.uaz && pedido ? await deps.uaz(pedido) : { ok: false as const, error: 'WHATSAPP_NOT_CONFIGURED' };
      await db('conv_svc_finish_message', { p_message: q.message_id, p_sent: res.ok, p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
      if (!res.ok) break;
      enviadas += 1;
    }
    return enviadas;
  };

  const save = (memory: Memory | null, decision: string, payload: Record<string, unknown>, awaiting: boolean, close: boolean) =>
    db('conv_svc_ai_save_turn', { p_session: session, p_memory: memory, p_decision: decision, p_payload: payload, p_awaiting: awaiting, p_close: close });

  const transferir = async (kind: 'soft' | 'hard', note: string, memory: Memory | null, falar = true) => {
    if (falar) await entregar(cadence([isGroup ? TRANSFER_GROUP : TRANSFER_DIRECT]));
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: kind, p_note: note });
    await save(memory, `handoff_${kind}`, { reason: note.slice(0, 200) }, false, kind === 'hard');
    return { status: 'handoff', handoff: kind } as TurnResult;
  };

  // Regras que não dependem do modelo.
  if (!deps.chat || !settings.model) return transferir('hard', 'Agente de IA sem provedor ou modelo configurado.', null, false);
  if (Number(ctx.session?.turns ?? 0) >= settings.max_turns) return transferir('hard', `Atendimento passou de ${settings.max_turns} turnos com a IA sem concluir.`, null);
  if (wantsHuman(buffered, settings.handoff_keywords ?? [])) return transferir('hard', 'A pessoa pediu atendimento humano.', null);
  if (soMidia && !isGroup) return transferir('hard', `Chegou ${[...new Set(pendentes.map((t) => t.kind))].join(', ')} sem texto; a IA não lê mídia.`, null);

  const memory = (ctx.session?.memory ?? {}) as Memory;
  let answer: Answer;
  try {
    const r = await deps.chat([
      { role: 'system', content: systemPrompt(settings, ctx) },
      { role: 'user', content: userPrompt(ctx, memory, buffered) },
    ], { model: settings.model, temperature: 0.2, maxTokens: 850, json: true });
    answer = parseAnswer(r.output);
  } catch {
    return transferir('hard', 'Falha ao chamar o modelo de IA.', memory);
  }
  for (const candidate of answer.memory_candidates ?? []) {
    await Promise.resolve(deps.db('conv_svc_ai_memory_candidate', { p: { ...candidate, source_message_id: messageId } })).catch(() => undefined);
  }
  if (answer.transfer && answer.messages.length === 0) {
    return transferir(answer.handoff_kind ?? 'hard', answer.handoff_note || 'A IA pediu ajuda da equipe.', memory);
  }

  // Trocar de ação no meio ("na verdade quero cancelar") recomeça os dados; o resto soma ao que já se sabia.
  const trocouDeAcao = memory.intent !== undefined && ACTIONABLE.includes(memory.intent) && ACTIONABLE.includes(answer.intent) && memory.intent !== answer.intent;
  const slots = mergeSlots(memory.slots, answer.slots, trocouDeAcao);
  // Resumo: o que o modelo reescreveu agora; senão o anterior; senão o do atendimento anterior da mesma pessoa.
  const summary = answer.summary ?? memory.summary ?? (typeof ctx.prior_summary === 'string' ? ctx.prior_summary : undefined);
  const nextMemory: Memory = { ...memory, intent: answer.intent, slots, ...(summary ? { summary } : {}) };

  const d = await decide({ deps, ctx, answer, slots, memory: nextMemory, session, ultimaId: ultima?.id as string | undefined, today });
  // Os fechamentos (confirmou, desistiu) zeram os dados do pedido, mas o resumo da conversa fica.
  if (summary && !d.memory.summary) d.memory = { ...d.memory, summary };
  if (d.handoff) {
    await entregar(cadence(d.bubbles));
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: d.handoff.kind, p_note: d.handoff.note });
    await save(d.memory, `handoff_${d.handoff.kind}`, { action: d.action, reason: d.handoff.note.slice(0, 200) }, false, d.handoff.kind === 'hard');
    return { status: 'handoff', handoff: d.handoff.kind, action: d.action };
  }
  const enviadas = await entregar(cadence(d.bubbles));
  if (answer.transfer) {
    await db('conv_svc_ai_handoff', { p_session: session, p_kind: answer.handoff_kind ?? 'hard', p_note: answer.handoff_note || 'Transferida pela IA' });
  }
  await save(d.memory, answer.transfer ? `handoff_${answer.handoff_kind}` : d.close ? 'close' : d.action ?? 'reply',
    { action: d.action, intent: answer.intent, bubbles: enviadas }, d.awaiting, d.close || (answer.transfer && answer.handoff_kind === 'hard'));
  return { status: 'replied', bubbles: enviadas, handoff: answer.transfer ? answer.handoff_kind : null, action: d.action };
}

/* ------------------------------- Decisão: o que o servidor executa ------------------------------- */

type DecideInput = { deps: TurnDeps; ctx: Ctx; answer: Answer; slots: Slots; memory: Memory; session: string; ultimaId?: string; today: string };

async function decide(i: DecideInput): Promise<Decision> {
  const { deps, ctx, answer, session, today } = i;
  const { db } = deps;
  const memory = { ...i.memory };
  const hasProposal = Boolean(ctx.open_proposal);
  const plain = (extra: Partial<Decision> = {}): Decision => {
    // Nenhuma frase do modelo pode afirmar que algo foi reservado/confirmado/cancelado.
    const seguro = answer.messages.some(claimsSuccess)
      ? ['Ainda não registrei nada. Me diga o que falta e eu monto o resumo para você confirmar.']
      : answer.messages;
    // Sem texto e sem transferência, o modelo falhou em dizer algo: nunca fica silêncio.
    const bubbles = seguro.length || answer.transfer || answer.close ? seguro : ['Não entendi bem. Pode me explicar de outro jeito?'];
    return { bubbles, awaiting: answer.awaiting || (!seguro.length && !answer.transfer && !answer.close), close: answer.close, action: null, memory, ...extra };
  };

  // 1) Desistência da proposta.
  if (answer.declined && hasProposal) {
    await db('conv_svc_ai_cancel_proposal', { p_session: session });
    return { bubbles: answer.messages.length ? answer.messages : ['Tudo bem, não vou fazer nada. Se precisar, é só chamar.'],
      awaiting: false, close: true, action: 'declined', memory: { intent: answer.intent, slots: {} } };
  }

  // 2) Confirmação: o banco decide (mensagem inequívoca, solicitante ou admin, depois da proposta, revalidando).
  if (hasProposal && answer.customer_confirmed) {
    if (!i.ultimaId) return plain({ bubbles: [CODE_TEXT.NOT_EXPLICIT as string], awaiting: true });
    const res = (await db('conv_svc_ai_confirm', { p_proposal: (ctx.open_proposal as Ctx).id, p_message: i.ultimaId })).data as
      { ok: boolean; code?: string; message?: string; action?: 'create' | 'cancel' | 'reschedule' | 'join' | 'participants'; summary?: Summary } | null;
    if (res?.ok && res.summary) {
      const names = (memory.proposal_names ?? []) as string[];
      const me = String(((ctx.requester as Ctx | undefined)?.profile as Ctx | undefined)?.name ?? '') || undefined;
      return { bubbles: [successMessage(res.action ?? 'create', res.summary, today, names, me)], awaiting: false, close: true, action: res.action === 'join' ? 'joined' : res.action === 'participants' ? 'participants_changed' : 'confirmed',
        memory: { intent: answer.intent, slots: {} } };
    }
    return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, ctx.open_proposal as Ctx);
  }

  // 2a) Sair, retirar ou adicionar atletas de uma reserva existente (e convidado): o servidor entende, valida e propõe.
  if (answer.intent === 'participantes' && !answer.transfer) return participantes(i, memory);

  // 2b) "Quem marcou esse horário?" / "me adiciona nessa reserva": o servidor mostra quem está e oferece entrar. O modelo não escreve nada.
  if (answer.intent === 'entrar' && !answer.transfer) return entrarNoJogo(i, memory);

  // 3) Pedido pronto: o servidor resolve pessoas, confere disponibilidade e monta a PROPOSTA.
  if (answer.ready && (answer.intent === 'reservar' || answer.intent === 'cancelar' || answer.intent === 'remarcar')) {
    return propose(i, memory);
  }

  // 4) Resto: texto do modelo (dúvida, pergunta de dado faltante, despedida).
  return plain();
}

async function propose(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, answer, slots, session, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string, extra: Partial<Decision> = {}): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory, ...extra });
  const soft = (text: string, note: string): Decision => ({ bubbles: [text], awaiting: false, close: false, action: 'handoff', memory,
    handoff: { kind: 'soft', note } });

  if (!profile?.is_member) {
    return soft('Não consegui identificar o seu cadastro de sócio por este telefone, então não posso reservar por aqui. Vou pedir para alguém da equipe te ajudar.',
      'Pedido de reserva por telefone sem cadastro de sócio identificado.');
  }
  const courts = (ctx.courts ?? []) as Court[];
  let payload: Record<string, unknown>;
  let action: 'create' | 'cancel' | 'reschedule' = answer.intent === 'cancelar' ? 'cancel' : answer.intent === 'remarcar' ? 'reschedule' : 'create';
  let names: string[] = [];
  let candidates: Court[] = [];

  if (action !== 'create') {
    const achada = acharReserva(ctx, slots).item;
    const ref = reservaPorRef(ctx, slots.reservation_ref) ?? (achada && { id: achada.id, type: achada.type, date: achada.date, start: achada.start });
    if (!ref) return ask('Qual reserva? Me diga o dia e o horário que eu confiro na agenda.');
    payload = { action, reservation_id: ref.id };
    if (action === 'reschedule') {
      if (!slots.date && !slots.start && !slots.court_label) return ask('Para quando você quer remarcar?');
      if (slots.date) payload.date = slots.date; else payload.date = String(ref.date);
      payload.start = slots.start ?? ref.start;
      if (slots.duration) payload.duration = slots.duration;
      if (slots.court_label) {
        candidates = pickCourts(courts, ref.type === 'Aula' ? 'Aula' : 'Play', slots.court_label);
        if (candidates.length === 0) return ask('Não encontrei essa quadra. Quer saibro ou rápida?');
      }
    }
  } else {
    const type = slots.type ?? 'Play';
    if (!slots.date || !slots.start) return ask(!slots.date ? 'Para qual dia?' : 'Que horas você quer começar?');
    const duration = slots.duration ?? (type === 'Aula' ? 30 : 60);
    candidates = pickCourts(courts, type, slots.court_label);
    if (candidates.length === 0) return ask(slots.court_label ? 'Não encontrei essa quadra. Quer saibro ou rápida?' : 'Não achei quadra ativa para esse tipo de reserva.');
    payload = { action: 'create', type, date: slots.date, start: slots.start, duration };
    const me = norm(String(profile.name));

    if (type === 'Play') {
      if (!slots.participants_known && (slots.participant_names ?? []).length === 0 && !slots.guest_name) return ask('Quem vai jogar com você? (Se for só você, é só dizer.)');
      const pedidos = (slots.participant_names ?? []).filter((n) => norm(n) !== me && norm(n) !== 'eu');
      const r = await resolve(db, pedidos, 'member');
      if (r.ask) return ask(r.ask);
      payload.participant_ids = r.ids;
      payload.guest_name = slots.guest_name ?? null;
      names = [String(profile.name), ...r.names, ...(slots.guest_name ? [`${slots.guest_name} (convidado)`] : [])];
    } else {
      const student = await resolve(db, slots.student_names ?? [], 'student');
      if (!(slots.student_names ?? []).length) return ask('Quem são os alunos da aula?');
      if (student.ask) return ask(student.ask);
      payload.participant_ids = student.matches.filter((m) => m.kind === 'socio').map((m) => m.id);
      payload.non_socio_student_ids = student.matches.filter((m) => m.kind === 'non_socio').map((m) => m.id);
      if (profile.is_admin) {
        if (!slots.professor_name) return ask('Qual professor vai dar a aula?');
        const prof = await resolve(db, [slots.professor_name], 'professor');
        if (prof.ask) return ask(prof.ask);
        payload.professor_id = prof.ids[0];
      }
      names = student.names;
    }
  }

  // Tenta cada quadra candidata até uma validar (saibro 1, saibro 2…). SLOT_TAKEN passa para a próxima.
  let res: { ok: boolean; code?: string; message?: string; proposal_id?: string; action?: string; summary?: Summary } | null = null;
  const tentativas = action === 'cancel' || candidates.length === 0 ? [null] : candidates;
  for (const court of tentativas) {
    const p = court ? { ...payload, court_id: court.id } : payload;
    res = (await db('conv_svc_ai_propose', { p_session: session, p })).data as typeof res;
    if (res?.ok || (res?.code !== 'SLOT_TAKEN' && res?.code !== 'COURT_NOT_FOUND')) break;
  }

  if (res?.ok && res.summary) {
    memory.proposal_names = names;
    memory.pending_guest = null;
    return { bubbles: [proposalMessage(((res.action as 'create' | 'cancel' | 'reschedule' | undefined) ?? action), res.summary, today, names)], awaiting: true, close: false, action: 'proposed', memory };
  }
  return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, null, { candidates, payload });
}

/**
 * Sair da reserva, retirar ou adicionar pessoas, convidado — pelo contexto da conversa e da agenda. O modelo só diz o QUE a pessoa quer
 * (reserva + nomes); o servidor acha a reserva, resolve cada nome entre quem está nela (ou no cadastro), valida pelas regras da Agenda
 * e mostra o resumo antes de gravar.
 */
async function participantes(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, answer, slots, session, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  if (!profile?.is_member) {
    return { bubbles: ['Não consegui identificar o seu cadastro de sócio por este telefone, então não posso mexer em reservas por aqui. Vou pedir para alguém da equipe te ajudar.'],
      awaiting: false, close: false, action: 'handoff', memory, handoff: { kind: 'soft', note: 'Pedido para mexer em atletas de reserva por telefone sem cadastro de sócio identificado.' } };
  }
  const me = String(profile.name);
  const { item, candidatas } = acharReserva(ctx, slots);
  if (!item) {
    if (candidatas.length === 0) return ask('Não achei essa reserva na agenda. Me diga o dia e o horário que eu confiro.');
    const lista = candidatas.slice(0, 4).map((a) => `${dayLabel(a.date, today)} ${a.start}–${a.end} na ${a.court}`);
    return ask(`Qual dessas reservas? ${lista.join(' · ')}`);
  }

  // Quem sai: "eu" (a própria pessoa) ou nomes entre os que estão na reserva.
  const removeIds: string[] = [];
  let tiraConvidado = slots.remove_guest === true || (slots.remove_names ?? []).some((n) => /^o?\s*convidad/.test(norm(n)));
  for (const nome of (slots.remove_names ?? []).filter((n) => !/^o?\s*convidad/.test(norm(n)))) {
    if (EU.has(norm(nome).trim()) || norm(nome) === norm(me)) { if (!removeIds.includes(String(profile.id))) removeIds.push(String(profile.id)); continue; }
    const r = acharNaReserva(item, nome);
    if (r.ask) return ask(r.ask);
    for (const id of r.ids) if (!removeIds.includes(id)) removeIds.push(id);
  }
  // Quem entra: nomes do cadastro de sócios ("eu" = a própria pessoa).
  const addIds: string[] = [];
  const quemEntra = (slots.add_names ?? []);
  if (quemEntra.some((n) => EU.has(norm(n).trim()) || norm(n) === norm(me)) && !item.people.some((p) => p.id === profile.id)) addIds.push(String(profile.id));
  const pedidos = quemEntra.filter((n) => !EU.has(norm(n).trim()) && norm(n) !== norm(me) && !item.people.some((p) => norm(p.name) === norm(n)));
  const r = await resolve(db, pedidos, 'member');
  if (r.ask) return ask(r.ask);
  for (const id of r.ids) if (!addIds.includes(id) && !item.people.some((p) => p.id === id)) addIds.push(id);
  const convidado = answer.slots.guest_name ? String(answer.slots.guest_name) : null;
  if (convidado && tiraConvidado && !item.guest) tiraConvidado = false;
  if (addIds.length + removeIds.length === 0 && !convidado && !tiraConvidado) return ask('O que você quer fazer nessa reserva: sair, retirar alguém ou adicionar alguém?');

  const res = (await db('conv_svc_ai_propose', { p_session: session, p: { action: 'participants', reservation_id: item.id,
    add_ids: addIds, remove_ids: removeIds, add_guest: convidado, remove_guest: tiraConvidado } })).data as
    { ok: boolean; code?: string; message?: string; summary?: Summary; spots_left?: number; wanted?: number } | null;
  if (res?.ok && res.summary) {
    return { bubbles: [participantsProposalMessage(res.summary, today, me)], awaiting: true, close: false, action: 'proposed_participants', memory };
  }
  if (res?.code === 'NOT_ENOUGH_SPOTS') {
    const vagas = Number(res.spots_left ?? 0);
    return ask(`Nessa reserva ${vagas === 0 ? 'não há mais vagas' : vagas === 1 ? 'só resta 1 vaga' : `só restam ${vagas} vagas`} e você quer adicionar ${res.wanted ?? 1}. Quer adicionar menos gente?`);
  }
  return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, null);
}

/**
 * A pessoa quer saber quem está num horário já reservado e/ou entrar nesse jogo. Quem responde é o servidor, com o que o banco
 * devolve: horário livre (nenhum jogo), jogo com vaga (oferta de entrar), lotado, aula, ou ela já está no jogo.
 */
async function entrarNoJogo(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, slots, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  if (!profile?.is_member) {
    return { bubbles: ['Não consegui identificar o seu cadastro de sócio por este telefone, então não posso mexer em reservas por aqui. Vou pedir para alguém da equipe te ajudar.'],
      awaiting: false, close: false, action: 'handoff', memory, handoff: { kind: 'soft', note: 'Pedido para entrar em jogo por telefone sem cadastro de sócio identificado.' } };
  }
  if (!slots.date) return ask('De que dia é esse jogo?');
  if (!slots.start) return ask('Que horas é o jogo?');
  const courts = (ctx.courts ?? []) as Court[];
  const candidates = slots.court_label ? pickCourts(courts, 'Play', slots.court_label) : courts;
  if (candidates.length === 0) return ask('Não encontrei essa quadra. Quer saibro ou rápida?');
  const dur = slots.duration ?? 60;
  const me = norm(String(profile.name));
  const r = await resolve(db, (slots.participant_names ?? []).filter((n) => norm(n) !== me && norm(n) !== 'eu'), 'member');
  if (r.ask) return ask(r.ask);
  const payload: Record<string, unknown> = { type: 'Play', date: slots.date, start: slots.start, duration: dur, participant_ids: r.ids, guest_name: slots.guest_name ?? null };

  const ini = toMin(slots.start);
  let algum = false;
  for (const c of candidates) {
    const g = ((await db('conv_svc_ai_slot_games', { p_court: c.id, p_date: slots.date, p_start_min: ini, p_end_min: ini + dur, p_requester: profile.id })).data ?? []) as Game[];
    if (g.length) { algum = true; break; }
  }
  if (!algum) {
    const onde = candidates.length === 1 ? ` na ${candidates[0].name}` : '';
    return ask(`Não há nenhum jogo marcado ${dayLabel(slots.date, today)} às ${slots.start}${onde}: o horário está livre. Quer que eu faça a reserva?`);
  }
  // Há jogo: a mesma lógica do horário ocupado (oferta de entrar, ou quem está + horários livres).
  return failure('SLOT_TAKEN', undefined, i, memory, null, { candidates, payload });
}

/** Resolve nomes no cadastro. Ambíguo ou ausente vira PERGUNTA (nunca escolha por aproximação). */
async function resolve(db: Db, names: string[], scope: 'member' | 'student' | 'professor') {
  const out = { ids: [] as string[], names: [] as string[], matches: [] as { id: string; name: string; kind: string }[], ask: null as string | null };
  if (names.length === 0) return out;
  const list = ((await db('conv_svc_ai_resolve_people', { p_names: names, p_scope: scope })).data ?? []) as
    { query: string; status: 'unique' | 'ambiguous' | 'none'; matches: { id: string; name: string; kind: string }[] }[];
  for (const r of list) {
    if (r.status === 'unique') {
      const m = r.matches[0];
      if (!out.ids.includes(m.id)) { out.ids.push(m.id); out.names.push(m.name); out.matches.push(m); }
    } else if (r.status === 'ambiguous') {
      out.ask = `Tenho mais de um "${r.query}": ${listaNomes(r.matches.map((m) => m.name))}. Qual deles?`;
      return out;
    } else {
      out.ask = scope === 'member'
        ? `Não encontrei "${r.query}" entre os sócios. Essa pessoa é convidada sua? Se for, me diga o nome completo.`
        : scope === 'professor' ? `Não encontrei o professor "${r.query}". Qual o nome completo?`
        : `Não encontrei o aluno "${r.query}". Qual o nome completo?`;
      return out;
    }
  }
  return out;
}

async function failure(code: string, message: string | undefined, i: DecideInput, memory: Memory, proposal: Ctx | null,
  extra?: { candidates: Court[]; payload: Record<string, unknown> }): Promise<Decision> {
  const { deps, ctx, today } = i;
  const base: Decision = { bubbles: [], awaiting: true, close: false, action: `failed:${code}`, memory };

  if (code === 'SLOT_TAKEN') {
    // Alternativas só se o motor de reservas disse que estão realmente livres.
    const date = String(extra?.payload?.date ?? (proposal?.payload as Ctx | undefined)?.date ?? '');
    const dur = Number(extra?.payload?.duration ?? (proposal?.payload as Ctx | undefined)?.duration ?? 60);
    const wanted = String(extra?.payload?.start ?? (proposal?.payload as Ctx | undefined)?.start ?? '');
    const cs = (extra?.candidates?.length ? extra.candidates : (ctx.courts as Court[]).filter((c) => c.id === (proposal?.payload as Ctx | undefined)?.court_id)) as Court[];
    // Quem ocupa o horário? Se for um jogo de Play com vaga, a IA oferece entrar (pedido novo de Play, não na falha de uma confirmação).
    const profile = ((ctx.requester as Ctx | undefined)?.profile ?? null) as Ctx | null;
    let jogos: Game[] = [];
    if (extra && String(extra.payload.type ?? 'Play') === 'Play' && profile?.id && /^\d{2}:\d{2}$/.test(wanted)) {
      const ini = toMin(wanted);
      for (const c of cs) {
        const g = ((await deps.db('conv_svc_ai_slot_games', { p_court: c.id, p_date: date, p_start_min: ini, p_end_min: ini + dur, p_requester: profile.id })).data ?? []) as Game[];
        jogos = jogos.concat(g);
      }
      const entrar = jogos.find((g) => g.joinable);
      if (entrar) {
        // Entra o solicitante e quem ele disse que joga com ele (e o convidado, se houver).
        const p = (await deps.db('conv_svc_ai_propose', { p_session: i.session, p: { action: 'join', reservation_id: entrar.reservation_id,
          participant_ids: extra.payload.participant_ids ?? [], guest_name: extra.payload.guest_name ?? null } })).data as
          { ok: boolean; code?: string; spots_left?: number; wanted?: number; summary?: Game & { add_names?: string[] } } | null;
        if (p?.ok && p.summary) return { ...base, bubbles: [joinOfferMessage(entrar, today, p.summary.add_names ?? [])], action: 'proposed_join', memory };
        if (p?.code === 'NOT_ENOUGH_SPOTS') return { ...base, bubbles: [notEnoughSpotsMessage(entrar, Number(p.spots_left ?? 0), Number(p.wanted ?? 1), today)], action: 'failed:NOT_ENOUGH_SPOTS' };
        if (p?.code === 'GUEST_ALREADY') return { ...base, bubbles: ['Esse jogo já tem um convidado, então não consigo adicionar o seu. Quer entrar sem o convidado?'], action: 'failed:GUEST_ALREADY' };
        if (p?.code === 'PARTICIPANT_NOT_MEMBER') return { ...base, bubbles: [CODE_TEXT.PARTICIPANT_NOT_MEMBER as string], action: 'failed:PARTICIPANT_NOT_MEMBER' };
      }
    }
    const linhas: string[] = [];
    for (const c of cs) {
      const livres = ((await deps.db('conv_svc_available_slots', { p_date: date, p_court: c.id, p_duration: dur })).data ?? []) as string[];
      const perto = nearest(livres, wanted);
      if (perto.length) linhas.push(`${c.name}: ${perto.join(', ')}`);
    }
    const ocupado = jogos.length ? busyMessage(jogos[0], today) : 'Esse horário não está livre.';
    return { ...base, bubbles: [linhas.length
      ? `${ocupado} Livres ${dayLabel(date, today)}: ${linhas.join(' · ')}. Algum serve?`
      : `${ocupado} Não há outro horário disponível ${dayLabel(date, today)} para ${dur} min. Quer outro dia?`] };
  }
  const texto = code in CODE_TEXT ? CODE_TEXT[code] : undefined;
  if (texto === null) {
    return { ...base, awaiting: false, action: `handoff:${code}`, bubbles: [isGroupText(ctx) ? TRANSFER_GROUP : TRANSFER_DIRECT],
      handoff: { kind: 'hard', note: `${message ?? code}` .slice(0, 400) } };
  }
  if (typeof texto === 'string') return { ...base, awaiting: true, bubbles: [texto], close: false, memory };
  // Código que o servidor não conhece: nada é anunciado, a equipe assume.
  return { ...base, awaiting: false, action: 'handoff:UNKNOWN', bubbles: [isGroupText(ctx) ? TRANSFER_GROUP : TRANSFER_DIRECT],
    handoff: { kind: 'hard', note: `Não consegui concluir a operação (${code}).` } };
}

const isGroupText = (ctx: Ctx) => ctx.is_group === true;
