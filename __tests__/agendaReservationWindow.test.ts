import { describe, expect, it } from 'vitest';
import {
  HISTORY_DAYS,
  defaultHistoryStart,
  extendedHistoryStart,
  firstDayShown,
} from '../lib/agenda/reservationWindow';

const date = (iso: string) => new Date(`${iso}T12:00:00`);

describe('defaultHistoryStart', () => {
  it('recua HISTORY_DAYS dias a partir de hoje', () => {
    expect(HISTORY_DAYS).toBe(60);
    expect(defaultHistoryStart(date('2026-10-08'))).toBe('2026-08-09');
  });

  it('atravessa a virada de ano', () => {
    expect(defaultHistoryStart(date('2026-01-10'))).toBe('2025-11-11');
  });
});

describe('firstDayShown', () => {
  it('no dia, é o próprio dia', () => {
    expect(firstDayShown(date('2026-10-08'), 'day')).toBe('2026-10-08');
  });

  it('na semana, é o domingo da semana', () => {
    expect(firstDayShown(date('2026-10-08'), 'week')).toBe('2026-10-04');
  });

  it('na semana que começa no mês anterior, vale o domingo', () => {
    expect(firstDayShown(date('2026-10-01'), 'week')).toBe('2026-09-27');
  });

  it('no mês, é o dia 1', () => {
    expect(firstDayShown(date('2026-10-08'), 'month')).toBe('2026-10-01');
  });
});

describe('extendedHistoryStart', () => {
  it('não pede nada enquanto o que aparece já foi carregado', () => {
    expect(extendedHistoryStart('2026-08-09', '2026-08-09')).toBeNull();
    expect(extendedHistoryStart('2026-08-09', '2026-10-01')).toBeNull();
  });

  it('quando a tela vai para antes do carregado, recua até o dia 1 do mês dela', () => {
    expect(extendedHistoryStart('2026-08-09', '2026-08-02')).toBe('2026-08-01');
    expect(extendedHistoryStart('2026-08-09', '2026-03-17')).toBe('2026-03-01');
  });
});
