// Datas de Documentos e Assinaturas: sempre no horário do clube (Fortaleza), seja qual for o fuso do aparelho.

export const CLUB_TZ = 'America/Fortaleza';

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('pt-BR', { timeZone: CLUB_TZ, ...options }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

const toDate = (iso: string | Date | null | undefined): Date | null => {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `07/10/2026` */
export function formatDate(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = parts(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** `07/10/2026 às 14:32` */
export function formatDateTime(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = parts(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${formatDate(d)} às ${p.hour}:${p.minute}`;
}

/** `2026-10-07` no calendário do clube. */
function clubDay(d: Date): string {
  const p = parts(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.year}-${p.month}-${p.day}`;
}

const dayNumber = (isoDay: string) => Date.UTC(Number(isoDay.slice(0, 4)), Number(isoDay.slice(5, 7)) - 1, Number(isoDay.slice(8, 10))) / 86_400_000;

export type DueInfo = { label: string; tone: 'neutral' | 'warn' | 'bad'; days: number };

/** Quanto falta para o prazo (contado em dias do calendário do clube). `null` = documento sem prazo. */
export function dueInfo(dueAt: string | null | undefined, now: Date = new Date()): DueInfo | null {
  const due = toDate(dueAt);
  if (!due) return null;
  const days = dayNumber(clubDay(due)) - dayNumber(clubDay(now));
  const date = formatDate(due);
  if (days < 0) {
    const n = -days;
    return { days, tone: 'bad', label: `Prazo venceu há ${n} ${n === 1 ? 'dia' : 'dias'} (${date})` };
  }
  if (days === 0) return { days, tone: 'warn', label: 'Vence hoje' };
  if (days <= 3) return { days, tone: 'warn', label: `Vence em ${days} ${days === 1 ? 'dia' : 'dias'} (${date})` };
  return { days, tone: 'neutral', label: `Prazo: ${date}` };
}

/** `2 min 05 s` → usado na contagem do reenvio do código. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** `2026-10-07` para o `<input type="date">`, no calendário do clube (vazio se não houver prazo). */
export function toDateInput(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? clubDay(d) : '';
}

/**
 * Prazo escolhido num `<input type="date">` → instante no fim daquele dia, no horário do clube
 * (Fortaleza é UTC−3 o ano todo, sem horário de verão). Vazio ou inválido → `null` (sem prazo).
 */
export function endOfClubDay(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const d = new Date(`${dateInput}T23:59:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Menor data aceita no campo de prazo: hoje, no calendário do clube. */
export const todayInput = (now: Date = new Date()): string => clubDay(now);

/** `07/10/2026 às 14:32:08` no horário do clube; o comprovante precisa dos segundos. */
export function formatDateTimeSeconds(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = parts(d, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return `${formatDate(d)} às ${p.hour}:${p.minute}:${p.second}`;
}
