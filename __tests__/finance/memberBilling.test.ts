import { describe, expect, it } from 'vitest';
import {
  chargeDisplayStatus, chargesToCancelOnEnd, chargesToReprice, generationHorizon, periodStarts, planCharges, priceFor,
  type ChargeRef, type MemberPlan, type PlanPrice,
} from '../../lib/finance/memberBilling';
import { buildCalendar, CLUB_DEFAULT_DUE_RULE, nationalHolidays } from '../../lib/finance/calendar';

const cal = buildCalendar([...nationalHolidays(2026), ...nationalHolidays(2027)]);
const plan = (over: Partial<MemberPlan> = {}): MemberPlan => ({
  id: 'p1', profileId: 'u1', startOn: '2026-01-10', endedOn: null, status: 'active', periodMonths: 1, ...over,
});
const prices: PlanPrice[] = [
  { effectiveFrom: '2026-01-01', amountCents: 10000 },
  { effectiveFrom: '2026-04-01', amountCents: 12000 },
];

describe('preço por competência (histórico de reajuste)', () => {
  it('usa o preço vigente na competência', () => {
    expect(priceFor(prices, '2026-01-01')).toBe(10000);
    expect(priceFor(prices, '2026-03-01')).toBe(10000);
    expect(priceFor(prices, '2026-04-01')).toBe(12000);
    expect(priceFor(prices, '2027-01-01')).toBe(12000);
  });
  it('antes do primeiro preço não há valor — nada é inventado', () => {
    expect(priceFor(prices, '2025-12-01')).toBeNull();
    expect(priceFor([], '2026-01-01')).toBeNull();
  });
});

describe('períodos do plano', () => {
  it('mensal: do mês do início até o horizonte', () => {
    expect(periodStarts(plan(), '2026-03-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });
  it('trimestral avança de 3 em 3 meses a partir do início', () => {
    expect(periodStarts(plan({ periodMonths: 3 }), '2026-12-01')).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
  });
  it('fim do vínculo no meio do mês ainda deve esse mês, não o seguinte', () => {
    expect(periodStarts(plan({ endedOn: '2026-03-20' }), '2026-12-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });
  it('horizonte = mês atual + meses à frente', () => {
    expect(generationHorizon('2026-10-17', 0)).toBe('2026-10-01');
    expect(generationHorizon('2026-10-17', 2)).toBe('2026-12-01');
  });
});

describe('geração de cobranças — idempotente e sem reescrever o passado', () => {
  it('gera as competências que faltam com vencimento dia 5 do mês cobrado (dia útil)', () => {
    const r = planCharges(plan(), prices, [], '2026-03-01', CLUB_DEFAULT_DUE_RULE, cal);
    expect(r.create.map((c) => [c.competenceMonth, c.dueDate, c.originalAmountCents])).toEqual([
      ['2026-01-01', '2026-01-05', 10000],
      ['2026-02-01', '2026-02-05', 10000],
      ['2026-03-01', '2026-03-05', 10000],
    ]);
  });

  it('com a opção "mês seguinte", o vencimento cai no dia 5 do mês seguinte', () => {
    const r = planCharges(plan(), prices, [], '2026-03-01', { ...CLUB_DEFAULT_DUE_RULE, monthOffset: 1 }, cal);
    expect(r.create.map((c) => [c.competenceMonth, c.dueDate])).toEqual([
      ['2026-01-01', '2026-02-05'], ['2026-02-01', '2026-03-05'], ['2026-03-01', '2026-04-06'], // 5/4 é domingo
    ]);
  });

  it('rodar duas vezes não cria duplicata', () => {
    const first = planCharges(plan(), prices, [], '2026-06-01', CLUB_DEFAULT_DUE_RULE, cal);
    const months = first.create.map((c) => c.competenceMonth);
    const second = planCharges(plan(), prices, months, '2026-06-01', CLUB_DEFAULT_DUE_RULE, cal);
    expect(second.create).toEqual([]);
    expect(second.existing).toEqual(months);
  });

  it('reajuste vale só daqui para a frente; meses já gerados não são regravados', () => {
    const jan = planCharges(plan(), [prices[0]], [], '2026-03-01', CLUB_DEFAULT_DUE_RULE, cal).create;
    expect(jan.every((c) => c.originalAmountCents === 10000)).toBe(true);
    // preço novo em abril; as 3 primeiras já existem
    const next = planCharges(plan(), prices, jan.map((c) => c.competenceMonth), '2026-06-01', CLUB_DEFAULT_DUE_RULE, cal);
    expect(next.create.map((c) => [c.competenceMonth, c.originalAmountCents])).toEqual([
      ['2026-04-01', 12000], ['2026-05-01', 12000], ['2026-06-01', 12000],
    ]);
  });

  it('plano pausado não gera nada novo', () => {
    expect(planCharges(plan({ status: 'paused' }), prices, [], '2026-06-01', CLUB_DEFAULT_DUE_RULE, cal).create).toEqual([]);
  });

  it('sem preço para a competência: não gera e sinaliza', () => {
    const r = planCharges(plan({ startOn: '2025-11-01' }), prices, [], '2026-01-01', CLUB_DEFAULT_DUE_RULE, cal);
    expect(r.missingPrice).toEqual(['2025-11-01', '2025-12-01']);
    expect(r.create.map((c) => c.competenceMonth)).toEqual(['2026-01-01']);
  });

  it('vencimento próprio do sócio substitui o global (dia e mês)', () => {
    const global = { ...CLUB_DEFAULT_DUE_RULE, monthOffset: 1 }; // global: mês seguinte; o sócio escolheu o mês cobrado
    const r = planCharges(plan({ dueDay: 10, dueMonthOffset: 0 }), prices, [], '2026-01-01', global, cal);
    expect(r.create[0].dueDate).toBe('2026-01-12'); // dia 10 é sábado → segunda 12
  });

  it('valor global fixo não existe: cada plano tem o seu', () => {
    const a = planCharges(plan({ id: 'a' }), [{ effectiveFrom: '2026-01-01', amountCents: 9000 }], [], '2026-01-01', CLUB_DEFAULT_DUE_RULE, cal);
    const b = planCharges(plan({ id: 'b' }), [{ effectiveFrom: '2026-01-01', amountCents: 15000 }], [], '2026-01-01', CLUB_DEFAULT_DUE_RULE, cal);
    expect([a.create[0].originalAmountCents, b.create[0].originalAmountCents]).toEqual([9000, 15000]);
  });
});

describe('fim do vínculo e reajuste sobre cobranças existentes', () => {
  const ref = (id: string, month: string, status: ChargeRef['status'], pay = false, adj = false): ChargeRef =>
    ({ id, competenceMonth: month, status, hasEffectivePayments: pay, hasAdjustments: adj });
  const charges = [
    ref('mar', '2026-03-01', 'open'),
    ref('mar-paid', '2026-03-01', 'paid', true),
    ref('apr-open', '2026-04-01', 'open'),
    ref('apr-part', '2026-04-01', 'partial', true),
    ref('may-open', '2026-05-01', 'open'),
    ref('jun-cancel', '2026-06-01', 'canceled'),
  ];

  it('cancela só o futuro sem pagamento; passado, pagas e parciais ficam', () => {
    expect(chargesToCancelOnEnd('2026-03-20', charges)).toEqual(['apr-open', 'may-open']);
  });

  it('reajuste atinge só cobranças intocadas a partir da vigência', () => {
    const list = [...charges, ref('jul-adj', '2026-07-01', 'open', false, true), ref('jul', '2026-07-01', 'open')];
    expect(chargesToReprice('2026-04-01', list)).toEqual(['apr-open', 'may-open', 'jul']);
  });
});

describe('situação exibida', () => {
  const base = { competenceMonth: '2026-07-01', periodMonths: 1, dueDate: '2026-08-05' };
  const s = (stored: 'open' | 'partial' | 'paid' | 'canceled', today: string, inReview = false) =>
    chargeDisplayStatus({ ...base, stored, today, inReview });

  it('prevista enquanto o período não terminou', () => {
    expect(s('open', '2026-07-15')).toBe('forecast');
    expect(s('open', '2026-07-31')).toBe('forecast');
  });
  it('aberta depois do período e até o vencimento', () => {
    expect(s('open', '2026-08-01')).toBe('open');
    expect(s('open', '2026-08-05')).toBe('open');
  });
  it('vencida depois do vencimento', () => {
    expect(s('open', '2026-08-06')).toBe('overdue');
  });
  it('parcial, paga e cancelada têm prioridade sobre vencida', () => {
    expect(s('partial', '2026-09-01')).toBe('partial');
    expect(s('paid', '2026-09-01')).toBe('paid');
    expect(s('canceled', '2026-09-01')).toBe('canceled');
  });
  it('em análise vale enquanto há comprovante pendente, mas não sobre paga/cancelada', () => {
    expect(s('open', '2026-09-01', true)).toBe('in_review');
    expect(s('partial', '2026-09-01', true)).toBe('in_review');
    expect(s('paid', '2026-09-01', true)).toBe('paid');
  });
  it('período trimestral só deixa de ser "prevista" ao fim do trimestre', () => {
    const q = { competenceMonth: '2026-01-01', periodMonths: 3, dueDate: '2026-04-06', stored: 'open' as const };
    expect(chargeDisplayStatus({ ...q, today: '2026-03-31' })).toBe('forecast');
    expect(chargeDisplayStatus({ ...q, today: '2026-04-01' })).toBe('open');
  });
});
