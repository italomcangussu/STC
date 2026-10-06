/**
 * Calendário de dias úteis e regra de vencimento.
 *
 * O STC não tinha calendário de feriados. Esta é a solução configurável:
 *  - Fim de semana: sábado e domingo não são úteis (sábado pode ser ligado como
 *    útil em `fin_settings.saturday_is_business`).
 *  - Feriados: os que estiverem **ativos** em `fin_holidays` (ou no objeto
 *    `BusinessCalendar` passado aqui). Nada é presumido além do que está listado.
 *
 * O que `nationalHolidays` considera (feriados nacionais **por lei**):
 *   1º jan (Confraternização Universal), Sexta-feira Santa, 21 abr (Tiradentes),
 *   1º mai (Trabalho), 7 set (Independência), 12 out (N. Sra. Aparecida),
 *   2 nov (Finados), 15 nov (Proclamação da República), 20 nov (Consciência
 *   Negra — nacional desde 2024, Lei 14.759/2023) e 25 dez (Natal).
 *
 * `optionalBankHolidays` (Carnaval segunda/terça e Corpus Christi) são pontos
 * facultativos que bancos costumam seguir: vêm **desligados** e só valem se o
 * admin os ativar. Feriados estaduais/municipais (ex.: Ceará, Sobral) nunca
 * são presumidos: o admin os cadastra.
 *
 * Espelho em SQL: `public.fin_easter`, `public.fin_seed_national_holidays` e
 * `public.fin_due_date` (comparados em `__tests__/finance/sql`).
 */
import { addDays, addMonths, daysInMonth, firstOfMonth, isIsoDate, weekday, type IsoDate } from './dates';

export type HolidayScope = 'national' | 'state' | 'municipal' | 'club';
export type HolidayKind = 'holiday' | 'optional';

export interface Holiday {
  date: IsoDate;
  name: string;
  scope: HolidayScope;
  kind: HolidayKind;
  active: boolean;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const nat = (date: IsoDate, name: string): Holiday => ({ date, name, scope: 'national', kind: 'holiday', active: true });

/** Feriados nacionais por lei, para o ano. */
export function nationalHolidays(year: number): Holiday[] {
  const y = String(year).padStart(4, '0');
  const list: Holiday[] = [
    nat(`${y}-01-01`, 'Confraternização Universal'),
    nat(addDays(easterSunday(year), -2), 'Sexta-feira Santa'),
    nat(`${y}-04-21`, 'Tiradentes'),
    nat(`${y}-05-01`, 'Dia do Trabalho'),
    nat(`${y}-09-07`, 'Independência do Brasil'),
    nat(`${y}-10-12`, 'Nossa Senhora Aparecida'),
    nat(`${y}-11-02`, 'Finados'),
    nat(`${y}-11-15`, 'Proclamação da República'),
  ];
  if (year >= 2024) list.push(nat(`${y}-11-20`, 'Dia da Consciência Negra'));
  list.push(nat(`${y}-12-25`, 'Natal'));
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Pontos facultativos que os bancos costumam seguir. Nascem **inativos**. */
export function optionalBankHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const opt = (date: IsoDate, name: string): Holiday => ({ date, name, scope: 'national', kind: 'optional', active: false });
  return [
    opt(addDays(easter, -48), 'Carnaval (segunda-feira)'),
    opt(addDays(easter, -47), 'Carnaval (terça-feira)'),
    opt(addDays(easter, 60), 'Corpus Christi'),
  ];
}

export interface BusinessCalendar {
  /** Datas que não são úteis além do fim de semana (feriados ativos). */
  holidays: ReadonlySet<IsoDate>;
  /** Padrão `false`: sábado não é dia útil. */
  saturdayIsBusiness?: boolean;
}

/** Monta o calendário a partir das linhas de `fin_holidays` (só as ativas contam). */
export function buildCalendar(holidays: Array<Pick<Holiday, 'date' | 'active'>>, saturdayIsBusiness = false): BusinessCalendar {
  return {
    holidays: new Set(holidays.filter((h) => h.active).map((h) => h.date)),
    saturdayIsBusiness,
  };
}

export function isBusinessDay(date: IsoDate, calendar: BusinessCalendar): boolean {
  const wd = weekday(date);
  if (wd === 0) return false;
  if (wd === 6 && !calendar.saturdayIsBusiness) return false;
  return !calendar.holidays.has(date);
}

export type NonBusinessRule = 'next_business_day' | 'previous_business_day' | 'keep';

/** Aplica a regra de dia não útil a uma data. */
export function adjustToBusinessDay(date: IsoDate, calendar: BusinessCalendar, rule: NonBusinessRule = 'next_business_day'): IsoDate {
  if (rule === 'keep' || isBusinessDay(date, calendar)) return date;
  const step = rule === 'next_business_day' ? 1 : -1;
  let cursor = date;
  // Teto de segurança: um calendário que declare todos os dias como feriado não trava.
  for (let i = 0; i < 366; i++) {
    cursor = addDays(cursor, step);
    if (isBusinessDay(cursor, calendar)) return cursor;
  }
  throw new Error('Calendário sem nenhum dia útil em 366 dias');
}

export interface DueRule {
  /** Dia do mês do vencimento (1–31; em mês curto vale o último dia). */
  dueDay: number;
  /** 0 = mês do fim do período; 1 = mês seguinte (regra inicial do clube). */
  monthOffset: number;
  nonBusinessRule: NonBusinessRule;
}

/** Regra inicial informada pelo clube: dia 5 do mês seguinte, próximo dia útil. */
export const CLUB_DEFAULT_DUE_RULE: DueRule = { dueDay: 5, monthOffset: 1, nonBusinessRule: 'next_business_day' };

export interface DueDateResult {
  /** Data "de calendário" antes de ajustar (ex.: dia 5). */
  nominal: IsoDate;
  /** Data efetiva de vencimento. */
  due: IsoDate;
  adjusted: boolean;
}

/**
 * Vencimento de uma cobrança. O período cobrado começa em `competenceMonth`
 * (dia 1) e dura `periodMonths`; o vencimento é `dueDay` do mês
 * (`fim do período + monthOffset`), ajustado ao dia útil.
 *
 * Mensal, competência julho, regra inicial → 5 de agosto.
 */
export function computeDueDate(
  competenceMonth: IsoDate,
  periodMonths: number,
  rule: DueRule,
  calendar: BusinessCalendar,
): DueDateResult {
  if (!isIsoDate(competenceMonth)) throw new Error(`Competência inválida: ${competenceMonth}`);
  const start = firstOfMonth(competenceMonth);
  const target = addMonths(start, periodMonths - 1 + rule.monthOffset);
  const y = Number(target.slice(0, 4));
  const m = Number(target.slice(5, 7));
  const day = Math.min(Math.max(rule.dueDay, 1), daysInMonth(y, m));
  const nominal = `${target.slice(0, 8)}${String(day).padStart(2, '0')}`;
  const due = adjustToBusinessDay(nominal, calendar, rule.nonBusinessRule);
  return { nominal, due, adjusted: due !== nominal };
}
