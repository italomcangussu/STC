// Leitura da resposta do modelo (soft-fail): JSON reparado, slots validados, reação e temperatura do turno.

import type { Ctx } from './promptTypes.ts';
import { extrairObjeto, repararJson, stripCodeFence } from './jsonRepair.ts';
import { isAdminReadDomain } from './adminReads.ts';
import { isFileKind } from './adminFiles.ts';
import { parsePlan } from './adminPlan.ts';
import { parseBirthday } from './adminAssistant.ts';
import { participantes } from './decide.ts';
import { parseLessons } from './lessonsBatch.ts';
import { ADJUST_KINDS, ADM_ACTIONS, type Answer, FIN_ACTIONS, type FormQuestionSlot, type Intent, PAY_METHODS, PENDENCY_KINDS, QUESTION_TYPES, type Slots } from './turnTypes.ts';

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
const INTENTS: Intent[] = ['reservar', 'cancelar', 'remarcar', 'consultar', 'consultar_disponibilidade', 'informar', 'entrar', 'participantes', 'aulas_lote', 'admin_financeiro', 'admin_consulta', 'admin_acao', 'outro'];
export const ACTIONABLE: Intent[] = ['reservar', 'cancelar', 'remarcar'];

/* Uma regra por campo: valor válido passa, inválido vira null (o modelo disse algo, mas não serve). */
type Rule = (v: unknown) => unknown;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const match = (re: RegExp): Rule => (v) => (typeof v === 'string' && re.test(v) ? v : null);
const oneOf = (list: readonly unknown[]): Rule => (v) => (list.includes(v) ? v : null);
const text = (max?: number): Rule => (v) => (max ? str(v)?.slice(0, max) ?? null : str(v));
const bool: Rule = (v) => (typeof v === 'boolean' ? v : null);
const onlyTrue: Rule = (v) => v === true;
const isoDate = match(DATE_RE);
const hhmm = match(HHMM_RE);
/** "1.250,50" ou 1250.5 → 1250.5; zero, negativo ou ilegível → null. */
const amount: Rule = (raw) => {
  const v = typeof raw === 'string' ? Number(raw.replace(/\./g, '').replace(',', '.')) : raw;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
};

const SLOT_RULES: { [K in keyof Slots]?: Rule } = {
  type: oneOf(['Play', 'Aula']),
  date: isoDate, start: hhmm, availability_from: hhmm, availability_to: hhmm,
  duration: oneOf([30, 60, 90, 120]),
  court_label: text(), participant_names: strList, participants_known: onlyTrue,
  guest_name: text(), professor_name: text(), student_names: strList,
  lessons: (v) => parseLessons(v) ?? [],
  reservation_ref: text(), add_names: strList, remove_names: strList, remove_guest: onlyTrue,
  fin_action: oneOf(FIN_ACTIONS), member_name: text(), description: text(300), amount,
  due_date: isoDate, pendency_kind: oneOf(PENDENCY_KINDS), guest_date: isoDate, send_now: onlyTrue,
  pendency_ref: (v) => str(v)?.toLowerCase() ?? null,
  paid_on: isoDate, method: oneOf(PAY_METHODS), account_name: text(), reason: text(200),
  adjust_kind: oneOf(ADJUST_KINDS), category_name: text(), category_new: onlyTrue, first_amount: amount, receipt_date: isoDate,
  entry_status: oneOf(['paid', 'pending']),
  adm_action: oneOf(ADM_ACTIONS), ann_title: text(80), ann_message: text(600), active: bool,
  doc_title: text(), by_name: text(), phone: text(), email: text(), note: text(), send_body: text(),
  dependent_name: text(120), student_name: text(120), student_plan: oneOf(['mensalista', 'kids', 'day_card']), paid: bool,
  relationship: oneOf(['esposa', 'esposo', 'filho', 'filha', 'outro']),
  pref: oneOf(['resumo', 'estilo', 'alertas', 'saldo_minimo', 'dias_atraso', 'conta_padrao']), pref_value: text(),
  birthday: parseBirthday,
  file_kind: (v) => (isFileKind(v) ? v : null),
  read_domain: (v) => (isAdminReadDomain(v) ? v : null), read_from: isoDate, read_to: isoDate,
  form_ref: text(120), form_title: text(120), form_questions: (v) => parseFormQuestions(v),
  form_secret: bool, form_multiple: bool,
};

/**
 * Só o que o modelo realmente escreveu: chave ausente fica `undefined` (não apaga o que já se sabia);
 * lista presente — mesmo vazia — substitui (o modelo reescreve o estado inteiro a cada turno).
 */
export function parseSlots(raw: unknown): Slots {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(SLOT_RULES) as [string, Rule][]) if (k in o) out[k] = rule(o[k]);
  return out as Slots;
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
    silent: obj.silent === true && !transfer,
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
