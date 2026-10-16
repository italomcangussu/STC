// Leitura da resposta do modelo (soft-fail): JSON reparado, slots validados, reação e temperatura do turno.

import type { Ctx } from './promptTypes.ts';
import { extrairObjeto, repararJson, stripCodeFence } from './jsonRepair.ts';
import { isAdminReadDomain } from './adminReads.ts';
import { isFileKind } from './adminFiles.ts';
import { parsePlan } from './adminPlan.ts';
import { parseBirthday } from './adminAssistant.ts';
import { participantes } from './decide.ts';
import { ADJUST_KINDS, ADM_ACTIONS, type AdmAction, type Answer, FIN_ACTIONS, type FinAction, type FormQuestionSlot, type Intent, PAY_METHODS, PENDENCY_KINDS, type PayMethod, type PendencyKind, QUESTION_TYPES, type Slots } from './turnTypes.ts';

export const REACTIONS = ['👍', '😂', '🎾', '🔥', '👏', '❤️', '🙌', '💪', '😅', '🤝'] as const;
const stripVs = (e: string) => e.replace(/️/g, '');
export function parseReaction(v: unknown): string | null {
  const e = typeof v === 'string' ? stripVs(v.trim()) : '';
  return e ? REACTIONS.find((r) => stripVs(r) === e) ?? null : null;
}

/**
 * Conversa solta de grupo (nada em andamento) aguenta mais soltura de humor; reserva e proposta ficam
 * firmes para o modelo não "criar" dado. Temperatura mais alta só onde o erro não custa nada.
 */
const SLOT_KEYS: (keyof Slots)[] = ['date', 'start', 'court_label', 'participant_names', 'reservation_ref', 'add_names', 'remove_names', 'guest_name', 'professor_name', 'student_names'];
/** Resenha solta no grupo: temperatura alta para a tirada sair espontânea; assunto operacional fica firme. */
const HUMOR_TEMPERATURE = 0.75;

export function turnTemperature(isGroup: boolean, ctx: Ctx, memory: { slots?: Slots }): number {
  if (!isGroup || ctx.open_proposal) return 0.2;
  const slots = memory.slots ?? {};
  const emAndamento = SLOT_KEYS.some((k) => { const v = slots[k]; return Array.isArray(v) ? v.length > 0 : Boolean(v); });
  return emAndamento ? 0.2 : HUMOR_TEMPERATURE;
}

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
const INTENTS: Intent[] = ['reservar', 'cancelar', 'remarcar', 'consultar', 'consultar_disponibilidade', 'informar', 'entrar', 'participantes', 'admin_financeiro', 'admin_consulta', 'admin_acao', 'outro'];
export const ACTIONABLE: Intent[] = ['reservar', 'cancelar', 'remarcar'];

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
  if (typeof o.availability_from === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.availability_from)) out.availability_from = o.availability_from; else if ('availability_from' in o) out.availability_from = null;
  if (typeof o.availability_to === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.availability_to)) out.availability_to = o.availability_to; else if ('availability_to' in o) out.availability_to = null;
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
  const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if ('fin_action' in o) out.fin_action = FIN_ACTIONS.includes(o.fin_action as FinAction) ? o.fin_action as FinAction : null;
  if ('member_name' in o) out.member_name = str(o.member_name);
  if ('description' in o) out.description = str(o.description)?.slice(0, 300) ?? null;
  if ('amount' in o) {
    const v = typeof o.amount === 'string' ? Number(o.amount.replace(/\./g, '').replace(',', '.')) : o.amount;
    out.amount = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }
  if ('due_date' in o) out.due_date = isoDate(o.due_date);
  if ('pendency_kind' in o) out.pendency_kind = PENDENCY_KINDS.includes(o.pendency_kind as PendencyKind) ? o.pendency_kind as PendencyKind : null;
  if ('guest_date' in o) out.guest_date = isoDate(o.guest_date);
  if ('send_now' in o) out.send_now = o.send_now === true;
  if ('pendency_ref' in o) out.pendency_ref = str(o.pendency_ref)?.toLowerCase() ?? null;
  if ('paid_on' in o) out.paid_on = isoDate(o.paid_on);
  if ('method' in o) out.method = PAY_METHODS.includes(o.method as PayMethod) ? o.method as PayMethod : null;
  if ('account_name' in o) out.account_name = str(o.account_name);
  if ('reason' in o) out.reason = str(o.reason)?.slice(0, 200) ?? null;
  if ('adjust_kind' in o) out.adjust_kind = (ADJUST_KINDS as readonly unknown[]).includes(o.adjust_kind) ? o.adjust_kind as typeof ADJUST_KINDS[number] : null;
  if ('category_name' in o) out.category_name = str(o.category_name);
  if ('receipt_date' in o) out.receipt_date = isoDate(o.receipt_date);
  if ('entry_status' in o) out.entry_status = o.entry_status === 'paid' || o.entry_status === 'pending' ? o.entry_status : null;
  if ('adm_action' in o) out.adm_action = (ADM_ACTIONS as readonly unknown[]).includes(o.adm_action) ? o.adm_action as AdmAction : null;
  if ('ann_title' in o) out.ann_title = str(o.ann_title)?.slice(0, 80) ?? null;
  if ('ann_message' in o) out.ann_message = str(o.ann_message)?.slice(0, 600) ?? null;
  if ('active' in o) out.active = typeof o.active === 'boolean' ? o.active : null;
  if ('doc_title' in o) out.doc_title = str(o.doc_title);
  if ('by_name' in o) out.by_name = str(o.by_name);
  if ('phone' in o) out.phone = str(o.phone);
  if ('email' in o) out.email = str(o.email);
  if ('note' in o) out.note = str(o.note);
  if ('send_body' in o) out.send_body = str(o.send_body);
  if ('dependent_name' in o) out.dependent_name = str(o.dependent_name)?.slice(0, 120) ?? null;
  if ('relationship' in o) out.relationship = ['esposa', 'esposo', 'filho', 'filha', 'outro'].includes(o.relationship as string) ? o.relationship as Slots['relationship'] : null;
  if ('pref' in o) out.pref = ['resumo', 'estilo', 'alertas', 'saldo_minimo', 'dias_atraso', 'conta_padrao'].includes(o.pref as string) ? o.pref as Slots['pref'] : null;
  if ('pref_value' in o) out.pref_value = str(o.pref_value);
  if ('birthday' in o) out.birthday = parseBirthday(o.birthday);
  if ('file_kind' in o) out.file_kind = isFileKind(o.file_kind) ? o.file_kind : null;
  if ('read_domain' in o) out.read_domain = isAdminReadDomain(o.read_domain) ? o.read_domain : null;
  if ('read_from' in o) out.read_from = isoDate(o.read_from);
  if ('read_to' in o) out.read_to = isoDate(o.read_to);
  if ('form_ref' in o) out.form_ref = str(o.form_ref)?.slice(0, 120) ?? null;
  if ('form_title' in o) out.form_title = str(o.form_title)?.slice(0, 120) ?? null;
  if ('form_questions' in o) out.form_questions = parseFormQuestions(o.form_questions);
  if ('form_secret' in o) out.form_secret = typeof o.form_secret === 'boolean' ? o.form_secret : null;
  if ('form_multiple' in o) out.form_multiple = typeof o.form_multiple === 'boolean' ? o.form_multiple : null;
  return out;
}

/** Perguntas ditadas pelo administrador; o que não tem texto ou tipo reconhecido é descartado (o banco valida o resto). */
export function parseFormQuestions(v: unknown): FormQuestionSlot[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((x): FormQuestionSlot[] => {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const title = str(q.title)?.slice(0, 200);
    const type = QUESTION_TYPES[String(q.type ?? 'texto')];
    if (!title || !type) return [];
    return [{ title, type, required: q.required !== false, options: Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean).slice(0, 12) : [] }];
  });
  return out.slice(0, 20);
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
export function parseCuratorAsk(v: unknown): Answer['ask_curator'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const subject = typeof o.subject_name === 'string' ? o.subject_name.trim().slice(0, 120) : '';
  const question = typeof o.question === 'string' ? o.question.trim().slice(0, 500) : '';
  return subject.length >= 2 && question.length >= 10 ? { subject_name: subject, question } : null;
}

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
    topic_mode: obj.topic_mode === 'new' || obj.topic_mode === 'resume' ? obj.topic_mode : 'continue',
    topic_ref: str(obj.topic_ref)?.slice(0, 4) ?? null,
    plan: parsePlan(obj.plan, { fin: FIN_ACTIONS, adm: ADM_ACTIONS }),
    summary: clipSummary(obj.summary),
    reaction: parseReaction(obj.reaction),
    ask_curator: parseCuratorAsk(obj.ask_curator),
    memory_candidates: Array.isArray(obj.memory_candidates)
      ? obj.memory_candidates.slice(0, 2).map((x) => {
          const m = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
          return {
            subject_name: str(m.subject_name)?.slice(0, 120) ?? '',
            kind: str(m.kind)?.slice(0, 40) ?? '',
            content: str(m.content)?.slice(0, 500) ?? '',
            confidence: typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : undefined,
          };
        }).filter((x) => x.subject_name && x.kind && x.content)
      : [],
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
