import { describe, expect, it } from 'vitest';
import type { ChargePaymentRow, ChargeStatementRow, MemberCreditRow, MemberPendencyMeta, PublicSettings } from '../../lib/finance/types';
import {
  canSendReceipt, chargeSubtitle, chargeTitle, describeRules, fieldsFromOcr, groupCharges, guestLine, headerSentence, openCreditCents, openPendencyCharges, payableCharges,
  paymentBreakdown, receiptHints, receiptSentNotice, receiptSummaryLine, submittedOcrStatus, sumDue, toggleId,
} from '../../lib/finance/memberStatement';

const settings = (over: Partial<PublicSettings> = {}): PublicSettings => ({
  due_day: 5, due_month_offset: 1, non_business_rule: 'next_business_day', saturday_is_business: false, late_fee_confirmed: true, grace_days: 0,
  fine_fixed_cents: null, fine_percent_bps: 200, interest_daily_fixed_cents: null, interest_daily_percent_bps: 3, ...over,
});

const charge = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'overdue', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 10, fine_due_cents: 300, interest_due_cents: 150, fees_due_cents: 450, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15450, fees_configured: true, overdue: true, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});
const meta = (over: Partial<MemberPendencyMeta> = {}): MemberPendencyMeta => ({
  id: 'c1', profile_id: 'u1', charge_type: 'member_pendency', description: 'Day Card do convidado Carlos', pendency_kind: 'day_card', category_id: 'cat',
  guest_name: 'Carlos', guest_date: '2026-10-05', collection_enabled: true, competence_month: '2026-10-01', due_date: '2026-10-07', original_amount_cents: 5000, status: 'open', version: 1, ...over,
});

describe('regras do clube em português', () => {
  it('vencimento: mês seguinte ou do período, e o que fazer em dia não útil', () => {
    expect(describeRules(settings()).due).toBe('Vence no dia 5 do mês seguinte ao período cobrado; se cair em dia não útil, passa para o próximo dia útil.');
    expect(describeRules(settings({ due_month_offset: 0, non_business_rule: 'keep', due_day: 10 })).due).toBe('Vence no dia 10 do mês do período cobrado; se cair em dia não útil, é mantido.');
    expect(describeRules(settings({ non_business_rule: 'previous_business_day' })).due).toMatch(/passa para o dia útil anterior\.$/);
  });

  it('encargos ainda não definidos: nenhum é cobrado', () => {
    expect(describeRules(settings({ late_fee_confirmed: false })).fees).toBe('Os encargos de atraso ainda não foram definidos pelo clube: por enquanto nenhum encargo é cobrado.');
  });

  it('confirmado sem multa nem juros: o clube não cobra', () => {
    expect(describeRules(settings({ fine_percent_bps: null, interest_daily_percent_bps: null })).fees).toBe('O clube não cobra encargos de atraso.');
  });

  it('multa e juros em percentual', () => {
    expect(describeRules(settings()).fees).toBe('Em caso de atraso: multa única de 2% no 1º dia de atraso e juros de 0,03% ao dia sobre o valor em aberto. Juros simples — encargos não geram novos juros.');
  });

  it('multa fixa + percentual, juros fixos e carência', () => {
    const fees = describeRules(settings({ fine_fixed_cents: 500, interest_daily_fixed_cents: 100, interest_daily_percent_bps: null, grace_days: 3 })).fees;
    expect(fees).toBe('Em caso de atraso: multa única de R$ 5,00 + 2% no 1º dia de atraso e juros de R$ 1,00 por dia, após 3 dia(s) de carência. Juros simples — encargos não geram novos juros.');
  });

  it('só juros (sem multa) também é descrito', () => {
    expect(describeRules(settings({ fine_percent_bps: null })).fees).toMatch(/^Em caso de atraso: juros de 0,03% ao dia/);
  });
});

describe('grupos de cobrança', () => {
  const list = [
    charge({ charge_id: 'a', display_status: 'overdue' }), charge({ charge_id: 'b', display_status: 'open' }), charge({ charge_id: 'c', display_status: 'partial' }),
    charge({ charge_id: 'd', display_status: 'in_review' }), charge({ charge_id: 'e', display_status: 'forecast' }), charge({ charge_id: 'f', display_status: 'paid', total_due_cents: 0 }),
    charge({ charge_id: 'g', display_status: 'canceled', total_due_cents: 0 }),
  ];

  it('separa a pagar, previstas, pagas e canceladas', () => {
    const g = groupCharges(list);
    expect(g.pay.map((c) => c.charge_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(g.forecast.map((c) => c.charge_id)).toEqual(['e']);
    expect(g.paid.map((c) => c.charge_id)).toEqual(['f']);
    expect(g.canceled.map((c) => c.charge_id)).toEqual(['g']);
  });

  it('pode incluir no comprovante o que está a pagar ou previsto e tem saldo', () => {
    const g = groupCharges([...list, charge({ charge_id: 'zero', display_status: 'open', total_due_cents: 0 })]);
    expect(payableCharges(g).map((c) => c.charge_id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('soma o devido', () => {
    expect(sumDue(groupCharges(list).pay)).toBe(15450 * 4);
    expect(sumDue([])).toBe(0);
  });

  it.each([
    [1, 0, 'Você tem 1 cobrança vencida'],
    [3, 100, 'Você tem 3 cobranças vencidas'],
    [0, 100, 'Valor em aberto hoje'],
    [0, 0, 'Tudo em dia'],
  ])('%i vencidas e %i centavos em aberto → "%s"', (vencidas, aberto, frase) => {
    expect(headerSentence(vencidas, aberto)).toBe(frase);
  });

  it('pendências em aberto: só as lançadas pelo clube e não encerradas', () => {
    const ids = new Set(['a', 'b', 'c']);
    const rows = [charge({ charge_id: 'a', display_status: 'open' }), charge({ charge_id: 'b', display_status: 'paid' }), charge({ charge_id: 'c', display_status: 'canceled' }), charge({ charge_id: 'd', display_status: 'open' })];
    expect(openPendencyCharges(rows, ids).map((c) => c.charge_id)).toEqual(['a']);
  });

  it('crédito em aberto soma só os abertos', () => {
    const credit = (status: MemberCreditRow['status'], remaining: number) => ({ id: status, profile_id: 'u1', reason: 'excess', amount_cents: remaining, remaining_cents: remaining, status, resolution_note: null, created_at: '' }) as MemberCreditRow;
    expect(openCreditCents([credit('open', 1000), credit('open', 500), credit('applied', 9999)])).toBe(1500);
  });

  it('marcar e desmarcar um id', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('textos do cartão', () => {
  it('mensalidade: título pelo mês e vencimento', () => {
    expect(chargeTitle(charge(), undefined)).toBe('Mensalidade de agosto de 2026');
    expect(chargeSubtitle(charge(), undefined)).toBe('Vencimento em 07/09/2026');
  });

  it('pendência: descrição e competência; um plano com ficha de pendência continua sendo mensalidade', () => {
    const pendency = charge({ plan_id: null, competence_month: '2026-10-01' });
    expect(chargeTitle(pendency, meta())).toBe('Day Card do convidado Carlos');
    expect(chargeSubtitle(pendency, meta())).toBe('Pendência · competência outubro de 2026 · Vencimento em 07/09/2026');
    expect(chargeTitle(charge(), meta())).toBe('Mensalidade de agosto de 2026');
    expect(chargeTitle(pendency, null)).toBe('Mensalidade de outubro de 2026');
  });

  it('convidado e visita', () => {
    expect(guestLine(meta())).toBe('Convidado: Carlos · Visita: 05/10/2026');
    expect(guestLine(meta({ guest_name: null }))).toBe('Visita: 05/10/2026');
    expect(guestLine(meta({ guest_date: null }))).toBe('Convidado: Carlos');
    expect(guestLine(meta({ guest_name: null, guest_date: null }))).toBe('');
  });

  it('divisão do pagamento: encargos e crédito só quando existem; estorno sem divisão', () => {
    const payment = (over: Partial<ChargePaymentRow> = {}): ChargePaymentRow => ({
      id: 'p', charge_id: 'c1', kind: 'payment', amount_cents: 15000, paid_on: '2026-09-08', fine_cents: 0, interest_cents: 0, principal_cents: 15000, excess_cents: 0, method: 'pix', note: null, created_at: '', ...over,
    });
    expect(paymentBreakdown(payment())).toBe(' (principal R$ 150,00)');
    expect(paymentBreakdown(payment({ principal_cents: 14000, fine_cents: 300, interest_cents: 200, excess_cents: 500 }))).toBe(' (principal R$ 140,00, encargos R$ 5,00, crédito R$ 5,00)');
    expect(paymentBreakdown(payment({ kind: 'reversal' }))).toBe('');
  });
});

describe('envio do comprovante', () => {
  const extracted = (over: Record<string, unknown> = {}) => ({ amountCents: 15450, paidOn: '2026-09-17', identifier: 'E1', ...over }) as never;

  it('a leitura preenche valor, data passada e identificador', () => {
    expect(fieldsFromOcr(extracted(), '2026-10-06')).toEqual({ amount: 15450, paidOn: '2026-09-17', reference: 'E1' });
  });

  it('data de hoje vale; futura e campos vazios não preenchem', () => {
    expect(fieldsFromOcr(extracted({ paidOn: '2026-10-06' }), '2026-10-06').paidOn).toBe('2026-10-06');
    expect(fieldsFromOcr(extracted({ paidOn: '2026-10-07', amountCents: null, identifier: null }), '2026-10-06')).toEqual({});
  });

  it('"lendo" e "parado" contam como leitura que não rodou', () => {
    expect(['idle', 'reading', 'ok', 'unreadable', 'failed'].map((s) => submittedOcrStatus(s as never))).toEqual(['not_run', 'not_run', 'ok', 'unreadable', 'failed']);
  });

  it('o envio só habilita com arquivo, cobrança, valor positivo e data', () => {
    const ok = { file: {}, chosen: ['c1'], amount: 100, paidOn: '2026-09-17' };
    expect(canSendReceipt(ok)).toBe(true);
    expect(canSendReceipt({ ...ok, file: null })).toBe(false);
    expect(canSendReceipt({ ...ok, chosen: [] })).toBe(false);
    expect(canSendReceipt({ ...ok, amount: null })).toBe(false);
    expect(canSendReceipt({ ...ok, amount: 0 })).toBe(false);
    expect(canSendReceipt({ ...ok, paidOn: '' })).toBe(false);
  });

  it('resumo do comprovante enviado', () => {
    expect(receiptSummaryLine({ declared_amount_cents: 15450, declared_paid_on: '2026-09-17' })).toBe('R$ 154,50 · 17/09/2026');
    expect(receiptSummaryLine({ declared_amount_cents: 15450, declared_paid_on: null })).toBe('R$ 154,50');
    expect(receiptSummaryLine({ declared_amount_cents: null, declared_paid_on: '2026-09-17' })).toBe('Valor não informado · 17/09/2026');
    expect(receiptSummaryLine({ declared_amount_cents: null, declared_paid_on: null })).toBe('Valor não informado');
  });

  it('o aviso depois de enviar', () => {
    expect(receiptSentNotice({ auto_approved: true }).title).toBe('Pagamento identificado e baixado!');
    expect(receiptSentNotice({ possible_duplicate: true })).toEqual({ title: 'Comprovante enviado!', description: 'Este arquivo já tinha sido enviado antes; o clube vai conferir.' });
    expect(receiptSentNotice({})).toEqual({ title: 'Comprovante enviado!', description: 'O clube vai conferir o pagamento e você será avisado.' });
  });

  it('orienta sobre o valor digitado na data do pagamento', () => {
    const base = { atPaid: [charge()], selected: [charge()], paidOn: '2026-09-17', ocrStatus: 'idle' as const, today: '2026-10-06' };
    expect(receiptHints({ ...base, amountCents: 10000 }).map((f) => f.code)).toContain('amount_below_total');
    const exact = receiptHints({ ...base, amountCents: 15450 }).map((f) => f.code);
    expect(exact).toContain('amount_matches_total');
    expect(exact).not.toContain('amount_below_total');
  });
});
