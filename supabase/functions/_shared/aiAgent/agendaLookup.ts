// Agenda: localizar a reserva de que a pessoa fala; quadras e horários.

import type { Ctx } from './promptTypes.ts';
import { hhmm } from './adminMessages.ts';
import { norm } from './serverRules.ts';
import { type AgendaItem, listaNomes } from './serverTexts.ts';
import type { Slots } from './turnTypes.ts';

/* ------------------------------- Agenda: localizar a reserva de que a pessoa fala ------------------------------- */

const agendaDe = (ctx: Ctx): AgendaItem[] => ((ctx.agenda ?? []) as AgendaItem[]);

/** Reserva por referência do modelo (aN ou id), entre as da agenda e as da própria pessoa. */
export function reservaPorRef(ctx: Ctx, ref: string | null | undefined): { id: string; type: string; date: string; start: string } | undefined {
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

export const EU = new Set(['eu', 'me', 'mim', 'eu mesmo', 'eu mesma', 'meu nome', 'meu']);

/** Quem, entre os que estão na reserva, a pessoa quer dizer? Único ou pergunta; nunca escolhe por aproximação. */
export function acharNaReserva(item: AgendaItem, nome: string): { ids: string[]; ask?: string } {
  const q = norm(nome).trim();
  const palavras = q.split(/\s+/).filter(Boolean);
  const exatos = item.people.filter((p) => norm(p.name) === q);
  const achados = exatos.length ? exatos : item.people.filter((p) => palavras.length > 0 && palavras.every((w) => norm(p.name).includes(w)));
  if (achados.length === 1) return { ids: [achados[0].id] };
  if (achados.length > 1) return { ids: [], ask: `Na reserva tem mais de um "${nome}": ${listaNomes(achados.map((p) => p.name))}. Qual deles?` };
  return { ids: [], ask: `Não achei "${nome}" nessa reserva. Estão nela: ${listaNomes(item.people.map((p) => p.name))}. Quem você quer retirar?` };
}

/* ------------------------------- Quadras e horários ------------------------------- */

export type Court = { id: string; name: string; type: string };

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

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Os horários livres mais próximos do pedido, até `n`. */
export function nearest(slots: string[], wanted: string | null | undefined, n = 4): string[] {
  const w = wanted ? toMin(wanted) : 12 * 60;
  return [...slots].sort((a, b) => Math.abs(toMin(a) - w) - Math.abs(toMin(b) - w)).slice(0, n).sort();
}
