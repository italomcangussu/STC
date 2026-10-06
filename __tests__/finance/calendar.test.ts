import { describe, expect, it } from 'vitest';
import {
  adjustToBusinessDay, buildCalendar, CLUB_DEFAULT_DUE_RULE, computeDueDate, easterSunday, isBusinessDay, nationalHolidays,
  optionalBankHolidays, type BusinessCalendar, type DueRule,
} from '../../lib/finance/calendar';

const nationalCalendar = (...years: number[]): BusinessCalendar =>
  buildCalendar(years.flatMap((y) => nationalHolidays(y)));

describe('calendário — feriados nacionais por lei', () => {
  it('calcula a Páscoa (conferido com datas conhecidas)', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
  });

  it('lista os feriados nacionais de 2026', () => {
    const dates = nationalHolidays(2026).map((h) => h.date);
    expect(dates).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07',
      '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    ]);
  });

  it('Consciência Negra só é nacional a partir de 2024', () => {
    expect(nationalHolidays(2023).some((h) => h.date === '2023-11-20')).toBe(false);
    expect(nationalHolidays(2024).some((h) => h.date === '2024-11-20')).toBe(true);
  });

  it('não presume feriado estadual nem municipal', () => {
    const names = nationalHolidays(2026).map((h) => h.scope);
    expect(new Set(names)).toEqual(new Set(['national']));
    expect(nationalHolidays(2026).some((h) => h.date === '2026-03-25')).toBe(false); // Data Magna do Ceará: só se o admin cadastrar
  });

  it('pontos facultativos de banco nascem inativos', () => {
    const opt = optionalBankHolidays(2026);
    expect(opt.map((h) => h.date)).toEqual(['2026-02-16', '2026-02-17', '2026-06-04']);
    expect(opt.every((h) => !h.active && h.kind === 'optional')).toBe(true);
    // inativos não contam como feriado
    const cal = buildCalendar(opt);
    expect(isBusinessDay('2026-02-16', cal)).toBe(true);
  });
});

describe('dia útil', () => {
  const cal = nationalCalendar(2026);

  it('fim de semana e feriado não são úteis', () => {
    expect(isBusinessDay('2026-09-04', cal)).toBe(true); // sexta
    expect(isBusinessDay('2026-09-05', cal)).toBe(false); // sábado
    expect(isBusinessDay('2026-09-06', cal)).toBe(false); // domingo
    expect(isBusinessDay('2026-09-07', cal)).toBe(false); // feriado
    expect(isBusinessDay('2026-09-08', cal)).toBe(true);
  });

  it('sábado pode ser ligado como útil', () => {
    expect(isBusinessDay('2026-09-05', { ...cal, saturdayIsBusiness: true })).toBe(true);
    expect(isBusinessDay('2026-09-06', { ...cal, saturdayIsBusiness: true })).toBe(false);
  });

  it('feriado local só vale se o admin o ativar', () => {
    const active = buildCalendar([{ date: '2026-03-25', active: true }]);
    const inactive = buildCalendar([{ date: '2026-03-25', active: false }]);
    expect(isBusinessDay('2026-03-25', active)).toBe(false);
    expect(isBusinessDay('2026-03-25', inactive)).toBe(true);
  });

  it('ajusta para o próximo / anterior / mantém', () => {
    expect(adjustToBusinessDay('2026-09-05', cal, 'next_business_day')).toBe('2026-09-08'); // sáb + domingo + feriado
    expect(adjustToBusinessDay('2026-09-05', cal, 'previous_business_day')).toBe('2026-09-04');
    expect(adjustToBusinessDay('2026-09-05', cal, 'keep')).toBe('2026-09-05');
    expect(adjustToBusinessDay('2026-09-08', cal)).toBe('2026-09-08');
  });

  it('calendário sem nenhum dia útil não trava', () => {
    const silly: BusinessCalendar = { holidays: new Set(Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
      return d.toISOString().slice(0, 10);
    })) };
    expect(() => adjustToBusinessDay('2026-01-03', silly)).toThrow(/dia útil/);
  });
});

/** Opção `monthOffset: 1`: dia 5 do mês seguinte (a regra inicial do clube, antes de 2026-10-06). */
const MES_SEGUINTE: DueRule = { ...CLUB_DEFAULT_DUE_RULE, monthOffset: 1 };

describe('vencimento — opção "mês seguinte" (dia 5 do mês seguinte, próximo dia útil)', () => {
  const cal = nationalCalendar(2026, 2027);
  const due = (competence: string, months = 1, rule: DueRule = MES_SEGUINTE, c = cal) =>
    computeDueDate(competence, months, rule, c);

  it('competência de julho vence 5 de agosto (quarta)', () => {
    expect(due('2026-07-01')).toEqual({ nominal: '2026-08-05', due: '2026-08-05', adjusted: false });
  });

  it('dia 5 em sábado, domingo seguinte e segunda feriado → terça', () => {
    expect(due('2026-08-01')).toEqual({ nominal: '2026-09-05', due: '2026-09-08', adjusted: true });
  });

  it('dia 5 em domingo → segunda', () => {
    expect(due('2026-03-01')).toEqual({ nominal: '2026-04-05', due: '2026-04-06', adjusted: true });
  });

  it('dezembro vence em janeiro do ano seguinte', () => {
    expect(due('2026-12-01').due).toBe('2027-01-05');
  });

  it('dia no feriado de Sexta-feira Santa passa para a segunda', () => {
    const rule: DueRule = { dueDay: 3, monthOffset: 1, nonBusinessRule: 'next_business_day' };
    expect(due('2026-03-01', 1, rule).due).toBe('2026-04-06');
  });

  it('mês curto: dia 31 vale o último dia do mês', () => {
    const rule: DueRule = { dueDay: 31, monthOffset: 1, nonBusinessRule: 'keep' };
    expect(due('2026-01-01', 1, rule).due).toBe('2026-02-28');
    expect(due('2026-01-01', 1, { ...rule, nonBusinessRule: 'next_business_day' }).due).toBe('2026-03-02');
  });

  it('período trimestral conta do fim do período', () => {
    expect(due('2026-01-01', 3).nominal).toBe('2026-04-05');
    expect(due('2026-01-01', 3).due).toBe('2026-04-06');
  });

  it('offset 0 vence no próprio mês do fim do período', () => {
    const rule: DueRule = { dueDay: 10, monthOffset: 0, nonBusinessRule: 'next_business_day' };
    expect(due('2026-07-01', 1, rule).due).toBe('2026-07-10');
  });

  it('regra "dia útil anterior" e "manter"', () => {
    expect(due('2026-08-01', 1, { ...MES_SEGUINTE, nonBusinessRule: 'previous_business_day' }).due).toBe('2026-09-04');
    expect(due('2026-08-01', 1, { ...MES_SEGUINTE, nonBusinessRule: 'keep' }).due).toBe('2026-09-05');
  });

  it('feriado municipal cadastrado muda o vencimento; desativado, não', () => {
    const withLocal = buildCalendar([...nationalHolidays(2026), { date: '2026-08-05', active: true }]);
    expect(due('2026-07-01', 1, MES_SEGUINTE, withLocal).due).toBe('2026-08-06');
    const off = buildCalendar([...nationalHolidays(2026), { date: '2026-08-05', active: false }]);
    expect(due('2026-07-01', 1, MES_SEGUINTE, off).due).toBe('2026-08-05');
  });

  it('sábado útil mantém o dia 5 de setembro de 2026', () => {
    expect(due('2026-08-01', 1, MES_SEGUINTE, { ...cal, saturdayIsBusiness: true }).due).toBe('2026-09-05');
  });

  it('recusa competência inválida', () => {
    expect(() => due('2026-13-01')).toThrow();
  });
});
describe('vencimento — padrão do clube (no mês cobrado, dia 5, só fins de semana)', () => {
  const cal = buildCalendar([]); // feriado não conta: só sábado e domingo
  const due = (competence: string, months = 1) => computeDueDate(competence, months, CLUB_DEFAULT_DUE_RULE, cal);

  it('o padrão é vencer no mês cobrado', () => {
    expect(CLUB_DEFAULT_DUE_RULE).toEqual({ dueDay: 5, monthOffset: 0, nonBusinessRule: 'next_business_day' });
  });

  it('vínculo em 01/09/2026: a 1ª cobrança (competência setembro) vence em setembro, não em outubro', () => {
    // dia 5 é sábado → segunda 7/9; o feriado da Independência não conta
    expect(due('2026-09-01')).toEqual({ nominal: '2026-09-05', due: '2026-09-07', adjusted: true });
  });

  it('cada mês vence nele mesmo (dia 5; sábado e domingo vão para a segunda)', () => {
    expect(due('2026-07-01')).toEqual({ nominal: '2026-07-05', due: '2026-07-06', adjusted: true }); // domingo → segunda
    expect(due('2026-08-01').due).toBe('2026-08-05'); // quarta
    expect(due('2026-12-01').due).toBe('2026-12-07'); // sábado → segunda; não vira janeiro
  });

  it('feriado em dia de semana NÃO empurra o vencimento (1º de maio, Natal)', () => {
    expect(computeDueDate('2026-05-01', 1, { ...CLUB_DEFAULT_DUE_RULE, dueDay: 1 }, cal).due).toBe('2026-05-01'); // sexta, Dia do Trabalho
    expect(computeDueDate('2026-12-01', 1, { ...CLUB_DEFAULT_DUE_RULE, dueDay: 25 }, cal).due).toBe('2026-12-25'); // sexta, Natal
  });

  it('trimestral: vence no último mês do período (offset 0 não antecipa para o 1º mês)', () => {
    expect(due('2026-01-01', 3).nominal).toBe('2026-03-05');
  });
});

