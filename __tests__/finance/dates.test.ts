import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, brDate, daysInMonth, diffDays, firstOfMonth, isIsoDate, lastOfMonth, monthLabel, monthsBetween,
  todayInFortaleza, weekday,
} from '../../lib/finance/dates';

describe('dates — calendário sem fuso', () => {
  it('valida datas de calendário', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
  });

  it('soma dias atravessando mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('diferença em dias é assinada', () => {
    expect(diffDays('2026-09-05', '2026-09-08')).toBe(3);
    expect(diffDays('2026-09-08', '2026-09-05')).toBe(-3);
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('soma meses preservando o fim de mês curto', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonths('2026-03-01', -3)).toBe('2025-12-01');
  });

  it('dia da semana (0 = domingo)', () => {
    expect(weekday('2026-10-06')).toBe(2); // terça-feira
    expect(weekday('2026-09-05')).toBe(6); // sábado
    expect(weekday('2026-09-06')).toBe(0); // domingo
  });

  it('limites de mês', () => {
    expect(firstOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(lastOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(lastOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('lista meses de um intervalo', () => {
    expect(monthsBetween('2026-11-15', '2027-01-03')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('"hoje" é o de Fortaleza, não o UTC', () => {
    expect(todayInFortaleza(new Date('2026-10-06T02:00:00Z'))).toBe('2026-10-05');
    expect(todayInFortaleza(new Date('2026-10-06T03:00:00Z'))).toBe('2026-10-06');
  });

  it('rótulos em português', () => {
    expect(brDate('2026-09-05')).toBe('05/09/2026');
    expect(brDate(null)).toBe('—');
    expect(monthLabel('2026-09-01')).toBe('setembro de 2026');
  });
});
