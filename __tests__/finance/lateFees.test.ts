import { describe, expect, it } from 'vitest';
import {
  allocateAcrossCharges, allocatePayment, computeStatement, storedStatusFor, UNCONFIGURED_POLICY, type ChargeLedger, type FeePolicy,
} from '../../lib/finance/lateFees';
import { addDays } from '../../lib/finance/dates';

// Valores de TESTE (o clube ainda não definiu política): servem só para exercitar a fórmula.
const policy = (over: Partial<FeePolicy> = {}): FeePolicy => ({
  confirmed: true, graceDays: 0, fineFixedCents: null, finePercentBps: null,
  interestDailyFixedCents: null, interestDailyPercentBps: null, ...over,
});

const DUE = '2026-08-05';
const charge = (over: Partial<ChargeLedger> = {}): ChargeLedger => ({ originalCents: 10000, dueDate: DUE, payments: [], ...over });
const day = (n: number) => addDays(DUE, n);

describe('encargos — sem política confirmada', () => {
  it('não calcula encargo algum e avisa que falta configurar', () => {
    const s = computeStatement(charge(), UNCONFIGURED_POLICY, day(30));
    expect(s.feesConfigured).toBe(false);
    expect(s.daysLate).toBe(30);
    expect(s.feesDueCents).toBe(0);
    expect(s.totalDueCents).toBe(10000);
    expect(s.overdue).toBe(true);
  });

  it('política confirmada com tudo nulo = decisão explícita de não cobrar encargo', () => {
    const s = computeStatement(charge(), policy(), day(30));
    expect(s.feesConfigured).toBe(true);
    expect(s.feesDueCents).toBe(0);
  });
});

describe('encargos — prazo, carência e atraso', () => {
  const p = policy({ fineFixedCents: 500, interestDailyFixedCents: 20 });

  it('pagar no vencimento ou antes: nenhum encargo', () => {
    expect(computeStatement(charge(), p, day(-3)).feesDueCents).toBe(0);
    const onDue = computeStatement(charge(), p, DUE);
    expect(onDue.daysLate).toBe(0);
    expect(onDue.feesDueCents).toBe(0);
    expect(onDue.overdue).toBe(false);
  });

  it('1º dia de atraso: multa + 1 dia de juros', () => {
    const s = computeStatement(charge(), p, day(1));
    expect(s.daysLate).toBe(1);
    expect(s.fineAccruedCents).toBe(500);
    expect(s.interestAccruedCents).toBe(20);
    expect(s.totalDueCents).toBe(10520);
  });

  it('carência: só há encargo depois do último dia de graça', () => {
    const g = policy({ ...p, graceDays: 3 });
    expect(computeStatement(charge(), g, day(3)).feesDueCents).toBe(0);
    expect(computeStatement(charge(), g, day(3)).overdue).toBe(true); // vencida, ainda sem encargo
    const s = computeStatement(charge(), g, day(4));
    expect(s.daysLate).toBe(1);
    expect(s.feesDueCents).toBe(520);
  });
});

describe('encargos — valor fixo, percentual e combinação', () => {
  it('só valor fixo', () => {
    const s = computeStatement(charge(), policy({ fineFixedCents: 300, interestDailyFixedCents: 10 }), day(10));
    expect(s.fineAccruedCents).toBe(300);
    expect(s.interestAccruedCents).toBe(100);
  });

  it('só percentual (multa 2% e juros 0,1% ao dia sobre o principal)', () => {
    const s = computeStatement(charge(), policy({ finePercentBps: 200, interestDailyPercentBps: 10 }), day(10));
    expect(s.fineAccruedCents).toBe(200);
    expect(s.interestAccruedCents).toBe(100); // 10000 × 0,1% × 10
  });

  it('combinação fixo + percentual', () => {
    const s = computeStatement(
      charge(),
      policy({ fineFixedCents: 100, finePercentBps: 200, interestDailyFixedCents: 5, interestDailyPercentBps: 10 }),
      day(10),
    );
    expect(s.fineAccruedCents).toBe(300);
    expect(s.interestAccruedCents).toBe(50 + 100);
    expect(s.totalDueCents).toBe(10000 + 300 + 150);
  });

  it('juros são simples: crescem em linha reta, sem juros sobre juros', () => {
    const p = policy({ finePercentBps: 200, interestDailyPercentBps: 10 });
    const at = (n: number) => computeStatement(charge(), p, day(n)).interestAccruedCents;
    expect(at(1)).toBe(10);
    expect(at(30)).toBe(300);
    expect(at(60)).toBe(600);
    // composto daria 10000 × ((1,001)^30 − 1) ≈ 304,4 → já não bateria com 300
    expect(at(30)).not.toBe(Math.round(10000 * (Math.pow(1.001, 30) - 1)));
  });

  it('a multa não entra na base dos juros', () => {
    const semMulta = computeStatement(charge(), policy({ interestDailyPercentBps: 10 }), day(30)).interestAccruedCents;
    const comMulta = computeStatement(charge(), policy({ finePercentBps: 1000, fineFixedCents: 5000, interestDailyPercentBps: 10 }), day(30)).interestAccruedCents;
    expect(comMulta).toBe(semMulta);
  });

  it('percentual arredonda metade para cima por trecho', () => {
    // 3333 × 0,15% × 1 dia = 4,9995 → 5
    const s = computeStatement(charge({ originalCents: 3333 }), policy({ interestDailyPercentBps: 15 }), day(1));
    expect(s.interestAccruedCents).toBe(5);
  });
});

describe('principal base: descontos e acréscimos', () => {
  it('desconto reduz a base dos encargos', () => {
    const s = computeStatement(charge({ discountCents: 2000 }), policy({ finePercentBps: 200, interestDailyPercentBps: 10 }), day(10));
    expect(s.principalBaseCents).toBe(8000);
    expect(s.fineAccruedCents).toBe(160);
    expect(s.interestAccruedCents).toBe(80);
  });

  it('acréscimo aumenta a base', () => {
    expect(computeStatement(charge({ increaseCents: 500 }), policy(), DUE).principalBaseCents).toBe(10500);
  });

  it('cobrança cancelada não deve nada', () => {
    const s = computeStatement(charge({ canceled: true }), policy({ fineFixedCents: 500 }), day(20));
    expect(s.totalDueCents).toBe(0);
    expect(s.settled).toBe(true);
    expect(s.overdue).toBe(false);
  });
});

describe('pagamento parcial, estorno e dispensa', () => {
  const p = policy({ finePercentBps: 200, interestDailyPercentBps: 10 });

  it('imputa multa → juros → principal e recalcula os juros sobre o saldo', () => {
    // 5 dias de atraso: multa 200 + juros 50 = 250; paga 3000 → 200 multa, 50 juros, 2750 principal
    const before = computeStatement(charge(), p, day(5));
    expect(before.fineDueCents).toBe(200);
    expect(before.interestDueCents).toBe(50);
    const split = allocatePayment(before, 3000);
    expect(split).toMatchObject({ fineCents: 200, interestCents: 50, principalCents: 2750, excessCents: 0, settles: false, duplicate: false });

    const ledger = charge({ payments: [{ paidOn: day(5), fineCents: 200, interestCents: 50, principalCents: 2750 }] });
    const mid = computeStatement(ledger, p, day(5));
    expect(mid.principalRemainingCents).toBe(7250);
    expect(mid.feesDueCents).toBe(0);

    // dias 6..10 sobre 7250: round(7250 × 10 × 5 / 10000) = round(36,25) = 36
    const later = computeStatement(ledger, p, day(10));
    expect(later.interestAccruedCents).toBe(50 + 36);
    expect(later.feesDueCents).toBe(36);
    expect(later.totalDueCents).toBe(7250 + 36);
  });

  it('o pagamento do dia só reduz a base do dia seguinte', () => {
    const ledger = charge({ payments: [{ paidOn: day(3), fineCents: 200, interestCents: 30, principalCents: 770 }] });
    const s = computeStatement(ledger, p, day(4));
    // dias 1–3 sobre 10000 (30) + dia 4 sobre 9230 (round(9,23) = 9)
    expect(s.interestAccruedCents).toBe(30 + 9);
  });

  it('pagamento posterior a "hoje" não conta (extrato em data anterior)', () => {
    const ledger = charge({ payments: [{ paidOn: day(10), fineCents: 0, interestCents: 0, principalCents: 10000 }] });
    expect(computeStatement(ledger, p, day(5)).principalRemainingCents).toBe(10000);
    expect(computeStatement(ledger, p, day(10)).principalRemainingCents).toBe(0);
  });

  it('dispensa de encargos abate multa primeiro e fica registrada no extrato', () => {
    const s = computeStatement(charge({ feeWaivedCents: 220 }), p, day(5));
    expect(s.feesWaivedCents).toBe(220);
    expect(s.fineDueCents).toBe(0);
    expect(s.interestDueCents).toBe(30);
    const all = computeStatement(charge({ feeWaivedCents: 250 }), p, day(5));
    expect(all.feesDueCents).toBe(0);
    expect(all.totalDueCents).toBe(10000);
  });

  it('pagamento total quita e marca como paga', () => {
    const s = computeStatement(charge(), p, day(5));
    const split = allocatePayment(s, s.totalDueCents);
    expect(split.settles).toBe(true);
    const after = computeStatement(
      charge({ payments: [{ paidOn: day(5), fineCents: split.fineCents, interestCents: split.interestCents, principalCents: split.principalCents }] }),
      p, day(5),
    );
    expect(after.settled).toBe(true);
    expect(storedStatusFor(after, true)).toBe('paid');
    // depois de quitado, o tempo não gera mais encargo
    expect(computeStatement(
      charge({ payments: [{ paidOn: day(5), fineCents: split.fineCents, interestCents: split.interestCents, principalCents: split.principalCents }] }),
      p, day(40),
    ).feesDueCents).toBe(0);
  });

  it('estorno: sem o pagamento na lista a cobrança volta ao que era', () => {
    const ledgerWith = charge({ payments: [{ paidOn: day(5), fineCents: 200, interestCents: 50, principalCents: 10000 }] });
    expect(computeStatement(ledgerWith, p, day(5)).settled).toBe(true);
    const reversed = computeStatement(charge(), p, day(5));
    expect(reversed.settled).toBe(false);
    expect(storedStatusFor(reversed, false)).toBe('open');
  });
});

describe('excedente e duplicado — nunca descartados', () => {
  it('pagamento maior que o devido vira excedente', () => {
    const s = computeStatement(charge(), policy(), DUE);
    const split = allocatePayment(s, 12000);
    expect(split).toMatchObject({ principalCents: 10000, excessCents: 2000, settles: true, duplicate: false });
  });

  it('pagamento sobre cobrança já quitada é excedente "duplicado"', () => {
    const paid = computeStatement(charge({ payments: [{ paidOn: DUE, fineCents: 0, interestCents: 0, principalCents: 10000 }] }), policy(), DUE);
    const split = allocatePayment(paid, 10000);
    expect(split).toMatchObject({ principalCents: 0, fineCents: 0, interestCents: 0, excessCents: 10000, duplicate: true });
  });

  it('valor inválido é recusado', () => {
    const s = computeStatement(charge(), policy(), DUE);
    expect(() => allocatePayment(s, 0)).toThrow();
    expect(() => allocatePayment(s, 10.5)).toThrow();
  });
});

describe('status gravado', () => {
  it('open → partial → paid', () => {
    const none = computeStatement(charge(), policy(), DUE);
    expect(storedStatusFor(none, false)).toBe('open');
    const some = computeStatement(charge({ payments: [{ paidOn: DUE, fineCents: 0, interestCents: 0, principalCents: 4000 }] }), policy(), DUE);
    expect(storedStatusFor(some, true)).toBe('partial');
    expect(storedStatusFor(none, false, true)).toBe('canceled');
  });
});

describe('várias cobranças num pagamento só', () => {
  it('distribui da mais antiga para a mais nova e devolve o excedente', () => {
    const mk = (id: string, due: string, orig: number) => ({ id, dueDate: due, statement: computeStatement({ originalCents: orig, dueDate: due, payments: [] }, policy(), '2026-09-01') });
    const r = allocateAcrossCharges([mk('b', '2026-08-05', 10000), mk('a', '2026-07-06', 10000), mk('c', '2026-09-08', 10000)], 25000);
    expect(r.allocations).toEqual([
      { id: 'a', amountCents: 10000 },
      { id: 'b', amountCents: 10000 },
      { id: 'c', amountCents: 5000 },
    ]);
    expect(r.excessCents).toBe(0);
    expect(allocateAcrossCharges([mk('a', '2026-07-06', 10000)], 12000).excessCents).toBe(2000);
  });
});
