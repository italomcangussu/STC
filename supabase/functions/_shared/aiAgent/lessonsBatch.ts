// Aulas em lote (professor ou assessor de professor, no privado): a lista inteira numa proposta só.
// O modelo só extrai as aulas (dia, início, fim, alunos); o servidor resolve os alunos, o banco valida cada aula pelas
// regras do clube (`lessons_batch` em `ai_propose`) e um único aceite grava todas. A resposta é UM resumo, sem pingue-pongue.

import type { Ctx } from './promptTypes.ts';
import type { Decision, Lesson, Memory } from './turnTypes.ts';
import { dayLabel, listaNomes } from './serverTexts.ts';
import { resolve } from './turnOutcome.ts';
import type { DecideInput } from './decide.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LESSONS = 30;

const isoDate = (v: unknown) => (typeof v === 'string' && ISO.test(v) ? v : null);
const hhmm = (v: unknown) => (typeof v === 'string' && HHMM.test(v) ? v : null);
const names = (v: unknown) => (Array.isArray(v) ? v.map((n) => String(n ?? '').trim()).filter(Boolean).slice(0, 8) : []);

function parseLesson(x: unknown): Lesson[] {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const date = isoDate(o.date);
  const start = hhmm(o.start);
  return date && start ? [{ date, start, end: hhmm(o.end), student_names: names(o.student_names) }] : [];
}

/** Aulas que o modelo extraiu; item sem data ou início válido é descartado (o banco valida o resto). */
export function parseLessons(v: unknown): Lesson[] | null {
  return Array.isArray(v) ? v.flatMap(parseLesson).slice(0, MAX_LESSONS) : null;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const addNames = (into: Lesson, from: Lesson) => { for (const n of from.student_names) if (!into.student_names.includes(n)) into.student_names.push(n); };

/** Alunos no mesmo dia e horário viram UMA aula com todos eles (é assim que a Agenda grava aula em grupo). */
export function groupLessons(lessons: Lesson[]): Lesson[] {
  const porHorario = new Map<string, Lesson>();
  for (const l of lessons) {
    const k = `${l.date} ${l.start} ${l.end ?? ''}`;
    const atual = porHorario.get(k);
    if (atual) addNames(atual, l); else porHorario.set(k, { ...l, student_names: [...l.student_names] });
  }
  return [...porHorario.values()];
}

export const lessonDuration = (l: Lesson) => (l.end ? toMin(l.end) - toMin(l.start) : 30);

type Item = { label: string; date: string; start: string; duration: number; participant_ids: string[]; non_socio_student_ids: string[] };
type Rejected = { label: string; date: string; start: string; code?: string; message?: string; confirm?: boolean };

/** Motivo dito em linguagem de quem marca aula, não em código do sistema. */
const REASONS: Record<string, string> = {
  INVALID_START: 'a aula começa em hora cheia ou meia hora (ex.: 19:00 ou 19:30)',
  INVALID_DURATION: 'a aula tem 30 minutos',
  SLOT_TAKEN: 'a Quadra Rápida já está ocupada nesse horário',
  NON_MEMBER_HOURS: 'aluno que não é sócio só tem aula de manhã (5h–12h) ou a partir das 20h, exceto domingo',
  IN_PAST: 'esse horário já passou',
  AFTER_CLOSING: 'passaria das 23h, quando o clube fecha',
};
const reason = (r: Rejected) => (r.code && REASONS[r.code]) || r.message || 'não deu para conferir';

type Slot = { date: unknown; start: unknown; end?: unknown; label: unknown };
const line = (a: Slot, today: string) => `• ${dayLabel(String(a.date), today)} ${a.start}${a.end ? `–${a.end}` : ''} · ${a.label}`;
const rejectedLines = (rs: Rejected[], today: string) => rs.map((r) => `${line(r, today)}: ${reason(r)}`).join('\n');

/** Aulas que dependem de o professor confirmar o nome do aluno: perguntadas à parte, nunca recusadas. */
const toConfirmSection = (rs: Rejected[], today: string) =>
  `Confirme com o professor o nome do aluno:\n${rs.map((r) => `${line(r, today)}: ${r.message}`).join('\n')}`;

function issuesSections(all: Rejected[], today: string): { parts: string[]; confirm: Rejected[]; nao: Rejected[] } {
  const confirm = all.filter((r) => r.confirm);
  const nao = all.filter((r) => !r.confirm);
  const parts = [...(nao.length ? [`Não dá para marcar:\n${rejectedLines(nao, today)}`] : []), ...(confirm.length ? [toConfirmSection(confirm, today)] : [])];
  return { parts, confirm, nao };
}

export function lessonsProposalMessage(summary: Ctx, extra: Rejected[], today: string): string {
  const ok = (summary.accepted ?? []) as Ctx[];
  const { parts, confirm, nao } = issuesSections([...((summary.rejected ?? []) as Rejected[]), ...extra], today);
  const fecho = confirm.length ? ' Sobre os nomes, me diga quem é que eu confiro essas também.' : nao.length ? ' As outras, me mande ajustadas que eu confiro.' : '';
  return [`Conferi a Quadra Rápida. Posso marcar ${ok.length === 1 ? '1 aula' : `${ok.length} aulas`}:`, ok.map((a) => line(a as Slot, today)).join('\n'),
    ...parts, `Confirma ${ok.length === 1 ? 'essa aula' : `essas ${ok.length}`}?${fecho}`].join('\n\n');
}

export function lessonsRejectedMessage(rejected: Rejected[], today: string): string {
  const { parts, confirm } = issuesSections(rejected, today);
  const fecho = confirm.length ? 'Me diga quem são os alunos (e os horários ajustados, se for o caso) que eu confiro de novo.' : 'Me mande os horários ajustados que eu confiro de novo.';
  return ['Conferi a Quadra Rápida e ainda não consigo marcar nenhuma dessas aulas.', ...parts, fecho].join('\n\n');
}

export function lessonsSuccessMessage(summary: Ctx, today: string): string {
  const feitas = (summary.created ?? []) as Ctx[];
  const falhas = (summary.failed ?? []) as Rejected[];
  const topo = `Pronto: ${feitas.length === 1 ? '1 aula marcada' : `${feitas.length} aulas marcadas`} na Quadra Rápida.\n${feitas.map((a) => line(a as Slot, today)).join('\n')}`;
  return falhas.length ? `${topo}\n\nNão entraram (mudou desde a conferência):\n${rejectedLines(falhas, today)}` : topo;
}

/** Resolve os alunos de cada aula; quem não for achado vira recusa daquela aula, sem travar as outras. */
async function toItems(i: DecideInput, groups: Lesson[]): Promise<{ items: Item[]; rejected: Rejected[] }> {
  const items: Item[] = [];
  const rejected: Rejected[] = [];
  for (const g of groups) {
    const label = listaNomes(g.student_names) || 'sem aluno';
    if (!g.student_names.length) { rejected.push({ label, date: g.date, start: g.start, message: 'faltou o nome do aluno' }); continue; }
    const r = await resolve(i.deps.db, g.student_names, 'student');
    if (r.suggest) { rejected.push({ label, date: g.date, start: g.start, confirm: true, message: suggestIssue(r.suggest) }); continue; }
    if (r.ask) { rejected.push({ label, date: g.date, start: g.start, message: studentIssue(r.ask) }); continue; }
    items.push({ label: listaNomes(r.names), date: g.date, start: g.start, duration: lessonDuration(g),
      participant_ids: r.matches.filter((m) => m.kind === 'socio').map((m) => m.id),
      non_socio_student_ids: r.matches.filter((m) => m.kind === 'non_socio').map((m) => m.id) });
  }
  return { items, rejected };
}

/** Aluno não achado ou ambíguo, dito como algo que o professor resolve (cadastro no STC ou nome certo). */
export function suggestIssue(s: { query: string; names: string[] }): string {
  return `no STC tem ${listaNomes(s.names)}; é ${s.names.length > 1 ? 'algum deles' : 'essa pessoa'}?`;
}

export function studentIssue(ask: string): string {
  const ausente = ask.match(/^Não encontrei o aluno "(.+)"/);
  if (ausente) return `${ausente[1]} não está cadastrado como aluno no STC (cadastre pelo app ou peça à diretoria)`;
  return ask.replace(/^Tenho mais de um/, 'há mais de um').replace(/\. Qual deles\?$/, '; diga qual');
}

const ask = (text: string, memory: Memory): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });

export async function aulasEmLote(i: DecideInput, memory: Memory): Promise<Decision> {
  const lessons = i.answer.slots.lessons ?? i.slots.lessons ?? [];
  if (!lessons.length) return ask('Me mande as aulas assim, uma por linha: dia, horário e aluno.', memory);
  const { items, rejected } = await toItems(i, groupLessons(lessons));
  if (!items.length) return { ...ask(lessonsRejectedMessage(rejected, i.today), memory), verbatim: true };
  const res = (await i.deps.db('conv_svc_ai_propose', { p_session: i.session, p: { action: 'lessons_batch', items } })).data as
    { ok: boolean; code?: string; message?: string; summary?: Ctx; rejected?: Rejected[] } | null;
  if (res?.ok && res.summary) {
    const pendentes = rejected.filter((r) => r.confirm);
    return { bubbles: [lessonsProposalMessage(res.summary, rejected, i.today)], awaiting: true, close: false, action: 'proposed_lessons',
      memory: { ...memory, lessons_to_confirm: pendentes }, verbatim: true };
  }
  if (res?.code === 'NOTHING_TO_BOOK') return { ...ask(lessonsRejectedMessage([...(res.rejected ?? []), ...rejected], i.today), memory), verbatim: true };
  return ask(res?.message ?? 'Não consegui conferir as aulas agora. Pode mandar de novo daqui a pouco?', memory);
}

/** Lote só para quem dá aula, no privado. */
export function canBatchLessons(ctx: Ctx): boolean {
  const p = ((ctx.requester ?? {}) as Ctx).profile as Ctx | null | undefined;
  return ctx.is_group !== true && Boolean(p?.professor_id);
}

type ConfirmResult = { ok: boolean; code?: string; message?: string; summary?: Ctx; failed?: Rejected[] } | null;

/** Resultado do aceite de um lote de aulas: o que entrou e o que mudou desde a conferência. */
export function lessonsConfirmed(res: ConfirmResult, i: DecideInput, memory: Memory): Decision {
  if (res?.ok && res.summary) {
    // Aulas que esperavam o nome confirmado continuam no assunto: o "Pronto" lembra delas, e a conversa não se perde.
    const pendentes = (Array.isArray(memory.lessons_to_confirm) ? memory.lessons_to_confirm : []) as Rejected[];
    const pronto = lessonsSuccessMessage(res.summary, i.today);
    return { bubbles: [pendentes.length ? `${pronto}\n\n${toConfirmSection(pendentes, i.today)}` : pronto], awaiting: pendentes.length > 0, close: !pendentes.length,
      action: 'confirmed_lessons', memory: { intent: i.answer.intent, slots: {}, ...(pendentes.length ? { lessons_to_confirm: pendentes } : {}) }, verbatim: true };
  }
  const texto = res?.failed?.length ? lessonsRejectedMessage(res.failed, i.today) : res?.message ?? 'Não consegui marcar as aulas. Quer que eu confira de novo?';
  return { bubbles: [texto], awaiting: true, close: false, action: `failed:${res?.code ?? 'UNKNOWN'}`, memory, verbatim: true };
}
