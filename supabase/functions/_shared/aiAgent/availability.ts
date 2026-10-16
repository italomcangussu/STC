// Horários livres: consulta no mesmo motor das reservas e escreve a lista por período.

import { type Court, pickCourts, toMin } from './agendaLookup.ts';
import type { Decision, Memory } from './turnTypes.ts';
import { availabilityFallbackSlots } from './serverRules.ts';
import { dayLabel, listaNomes } from './serverTexts.ts';
import { hhmm } from './adminMessages.ts';
import type { DecideInput } from './decide.ts';

function ceilHalfHour(hhmm: string): string {
  const m = toMin(hhmm);
  const rounded = Math.ceil(m / 30) * 30;
  const h = Math.min(23, Math.floor(rounded / 60));
  const mm = rounded % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function availabilityPeriodLabel(from: string, to: string): string {
  if (from === '05:00' && to === '12:00') return 'pela manhã';
  if (from === '12:00' && to === '18:00') return 'à tarde';
  if (from === '18:00' && to === '23:00') return 'à noite';
  if (from === '05:00' && to === '23:00') return '';
  return `entre ${from} e ${to}`;
}

/** Consulta horários livres diretamente no mesmo motor usado pelas reservas. */
export async function consultarDisponibilidade(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, slots, today } = i;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask_availability', memory });
  const s = availabilityFallbackSlots('', String(ctx.now_local), slots);
  if (!s.date) return ask('Pra qual dia você quer ver os horários livres?');

  const type = s.type ?? 'Play';
  const duration = s.duration ?? (type === 'Aula' ? 30 : 60);
  const courts = (ctx.courts ?? []) as Court[];
  const candidates = s.court_label
    ? pickCourts(courts, type, s.court_label)
    : type === 'Aula'
      ? pickCourts(courts, 'Aula', null)
      : courts;
  if (!candidates.length) return ask(s.court_label ? 'Não encontrei essa quadra. Quer saibro ou rápida?' : 'Não achei quadra ativa para consultar agora.');

  let from = s.availability_from ?? '05:00';
  let to = s.availability_to ?? '23:00';
  if (s.start) { from = s.start; to = s.start; }

  // No dia atual não oferece horário que já passou; arredonda para o próximo início de 30 em 30 min.
  if (s.date === today && !s.start) {
    const localHm = String(ctx.now_local).slice(11, 16);
    if (/^\d{2}:\d{2}$/.test(localHm) && toMin(localHm) > toMin(from)) from = ceilHalfHour(localHm);
  }

  const byTime = new Map<string, string[]>();
  for (const court of candidates) {
    const raw = ((await deps.db('conv_svc_available_slots', { p_date: s.date, p_court: court.id, p_duration: duration })).data ?? []) as string[];
    for (const time of raw) {
      const tm = toMin(time);
      const exact = Boolean(s.start);
      const inWindow = exact ? time === s.start : tm >= toMin(from) && tm < toMin(to) && tm + duration <= toMin(to);
      if (!inWindow) continue;
      const names = byTime.get(time) ?? [];
      names.push(court.name);
      byTime.set(time, names);
    }
  }

  const entries = [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 8);
  const period = s.start ? `às ${s.start}` : availabilityPeriodLabel(s.availability_from ?? '05:00', s.availability_to ?? '23:00');
  const when = [dayLabel(s.date, today), period].filter(Boolean).join(' ');

  memory.intent = 'consultar_disponibilidade';
  memory.slots = { ...memory.slots, ...s };

  if (!entries.length) {
    return {
      bubbles: [`Não achei horário livre ${when} para ${duration} min.`, 'Quer que eu olhe outro período ou outro dia?'],
      awaiting: true, close: false, action: 'availability_empty', memory,
    };
  }

  const items = entries.map(([time, names]) => `${time} — ${listaNomes(names)}`);
  return {
    bubbles: [`${when.charAt(0).toUpperCase() + when.slice(1)} tem horário livre sim:`, items.join(' · ') + '. Qual fica melhor?'],
    awaiting: true, close: false, action: 'availability_listed', memory,
  };
}
