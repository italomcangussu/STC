/**
 * Datas do financeiro: sempre `YYYY-MM-DD` (texto), sempre calculadas em UTC.
 *
 * Datas de calendário (vencimento, competência, feriado) não têm fuso: tratá-las
 * como `Date` local é a origem clássica de "venceu um dia antes". Aqui nada
 * depende do fuso da máquina. O "hoje" do clube é o de Fortaleza.
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function parts(iso: IsoDate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Data inválida: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');
const make = (y: number, m: number, d: number): IsoDate => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

const toUtc = (iso: IsoDate) => {
  const { y, m, d } = parts(iso);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): IsoDate => {
  const dt = new Date(ms);
  return make(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

const DAY_MS = 86_400_000;

export const addDays = (iso: IsoDate, days: number): IsoDate => fromUtc(toUtc(iso) + days * DAY_MS);

/** `b - a` em dias (positivo se `b` é depois de `a`). */
export const diffDays = (a: IsoDate, b: IsoDate): number => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

/** 0 = domingo … 6 = sábado. */
export const weekday = (iso: IsoDate): number => new Date(toUtc(iso)).getUTCDay();

export const firstOfMonth = (iso: IsoDate): IsoDate => {
  const { y, m } = parts(iso);
  return make(y, m, 1);
};

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const lastOfMonth = (iso: IsoDate): IsoDate => {
  const { y, m } = parts(iso);
  return make(y, m, daysInMonth(y, m));
};

/** Soma meses a uma data, preservando o dia 1 (use com `firstOfMonth`). */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const { y, m, d } = parts(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return make(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export const monthKey = (iso: IsoDate): string => iso.slice(0, 7);

export const isBefore = (a: IsoDate, b: IsoDate) => a < b;
export const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
export const minDate = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

/** Meses (dia 1) de `from` até `to`, inclusive. */
export function monthsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cursor = firstOfMonth(from);
  const end = firstOfMonth(to);
  while (cursor <= end) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** "Hoje" no fuso do clube (America/Fortaleza). Aceita um instante para teste. */
export function todayInFortaleza(now: Date = new Date()): IsoDate {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return f.format(now);
}

/** "05/09/2026". */
export function brDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "setembro de 2026". */
export function monthLabel(iso: IsoDate): string {
  const { y, m } = parts(iso);
  return `${MESES[m - 1]} de ${y}`;
}

/** "set/26". */
export function monthShort(iso: IsoDate): string {
  const { y, m } = parts(iso);
  return `${MESES[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
}
