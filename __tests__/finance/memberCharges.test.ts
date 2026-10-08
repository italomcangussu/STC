import { describe, expect, it } from 'vitest';
import type { ChargePaymentRow, ChargeStatementRow, FinHoliday, FinSettings } from '../../lib/finance/types';
import {
  availableChargeActions, chargeApiFilters, chargeExportFilters, chargeTotals, creditResolution, creditTargets, effectivePayments, isSettled,
  lastEffectivePayment, lateSuffix, NO_CHARGE_FILTERS, overdueCount, overdueSentence, previewNeedsAttention, previewNewPlan, previewSentence, shownAmountCents,
} from '../../lib/finance/memberCharges';

const payment = (over: Partial<ChargePaymentRow> = {}): ChargePaymentRow => ({
  id: 'p1', charge_id: 'c1', kind: 'payment', amount_cents: 15000, paid_on: '2026-09-08', fine_cents: 0, interest_cents: 0, principal_cents: 15000,
  excess_cents: 0, method: 'pix', note: null, created_at: '2026-09-08T10:00:00Z', ...over,
});
const reversalOf = (p: ChargePaymentRow, over: Partial<ChargePaymentRow> = {}): ChargePaymentRow =>
  payment({ ...p, id: `r-${p.id}`, kind: 'reversal', paid_on: '2026-09-09', created_at: '2026-09-09T10:00:00Z', ...over });

const charge = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07',
  original_amount_cents: 15000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 15000, principal_paid_cents: 0,
  principal_remaining_cents: 15000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 15000, fees_configured: false, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});

describe('pagamentos efetivos', () => {
  it('sem estorno, todo pagamento vale', () => {
    const list = [payment({ id: 'a' }), payment({ id: 'b', paid_on: '2026-09-10' })];
    expect(effectivePayments(list).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('um estorno de mesma forma, valor e principal, depois do pagamento, o desfaz', () => {
    const p = payment();
    expect(effectivePayments([p, reversalOf(p)])).toEqual([]);
  });

  it.each([
    ['outra forma de pagamento', { method: 'cash' as const }],
    ['outro valor', { amount_cents: 1000 }],
    ['outro principal', { principal_cents: 1000 }],
    ['data anterior ao pagamento', { paid_on: '2026-09-01' }],
    ['lançado antes do pagamento', { created_at: '2026-09-08T09:00:00Z' }],
  ])('estorno com %s não desfaz o pagamento', (_motivo, over) => {
    const p = payment();
    expect(effectivePayments([p, reversalOf(p, over)])).toEqual([p]);
  });

  it('dois pagamentos idênticos: um estorno casa com os dois (regra herdada da tela)', () => {
    const a = payment({ id: 'a' });
    const b = payment({ id: 'b' });
    expect(effectivePayments([a, b, reversalOf(a)])).toEqual([]);
  });

  it('linha de estorno nunca é pagamento efetivo', () => {
    const p = payment();
    expect(effectivePayments([reversalOf(p)])).toEqual([]);
  });
});

describe('último pagamento efetivo', () => {
  it('sem pagamento, nada', () => {
    expect(lastEffectivePayment([])).toBeUndefined();
  });

  it('é o mais recente por data do dinheiro e depois por lançamento', () => {
    const antigo = payment({ id: 'antigo', paid_on: '2026-09-01' });
    const novo = payment({ id: 'novo', paid_on: '2026-09-20', amount_cents: 500, principal_cents: 500 });
    expect(lastEffectivePayment([novo, antigo])?.id).toBe('novo');
  });

  it('empate perfeito: vale o que aparece por último na lista', () => {
    const a = payment({ id: 'a' });
    const b = payment({ id: 'b' });
    expect(lastEffectivePayment([a, b])?.id).toBe('b');
  });

  it('ignora o pagamento que já foi estornado', () => {
    const velho = payment({ id: 'velho', paid_on: '2026-09-01', amount_cents: 700, principal_cents: 700, created_at: '2026-09-01T10:00:00Z' });
    const estornado = payment({ id: 'estornado', paid_on: '2026-09-08' });
    expect(lastEffectivePayment([velho, estornado, reversalOf(estornado)])?.id).toBe('velho');
  });
});

describe('totais e linhas da lista', () => {
  it('soma a receber sem as quitadas e canceladas, e o vencido à parte', () => {
    const rows = [
      charge({ total_due_cents: 100, display_status: 'open' }),
      charge({ total_due_cents: 200, display_status: 'overdue' }),
      charge({ total_due_cents: 300, display_status: 'partial' }),
      charge({ total_due_cents: 400, display_status: 'paid' }),
      charge({ total_due_cents: 500, display_status: 'canceled' }),
    ];
    expect(chargeTotals(rows)).toEqual({ due: 600, overdue: 200 });
  });

  it('lista vazia soma zero', () => {
    expect(chargeTotals([])).toEqual({ due: 0, overdue: 0 });
  });

  it('cobrança quitada ou cancelada mostra o valor original; a ativa, o total atualizado', () => {
    expect(shownAmountCents(charge({ display_status: 'paid', original_amount_cents: 15000, total_due_cents: 0 }))).toBe(15000);
    expect(shownAmountCents(charge({ display_status: 'canceled', original_amount_cents: 15000, total_due_cents: 0 }))).toBe(15000);
    expect(shownAmountCents(charge({ display_status: 'overdue', original_amount_cents: 15000, total_due_cents: 15800 }))).toBe(15800);
  });

  it('dias de atraso só aparecem enquanto a cobrança corre', () => {
    expect(lateSuffix(charge({ days_late: 3, display_status: 'overdue' }))).toBe(' · 3 dia(s) de atraso');
    expect(lateSuffix(charge({ days_late: 3, display_status: 'paid' }))).toBe('');
    expect(lateSuffix(charge({ days_late: 0 }))).toBe('');
  });

  it('isSettled reconhece quitada e cancelada', () => {
    expect(['paid', 'canceled'].map((s) => isSettled({ display_status: s as ChargeStatementRow['display_status'] }))).toEqual([true, true]);
    expect(isSettled({ display_status: 'partial' })).toBe(false);
  });
});

describe('cobranças que um crédito pode abater', () => {
  it('só do mesmo sócio, com saldo e não canceladas', () => {
    const charges = [
      charge({ charge_id: 'ok' }),
      charge({ charge_id: 'outro-socio', profile_id: 'u2' }),
      charge({ charge_id: 'quitada', total_due_cents: 0, display_status: 'paid' }),
      charge({ charge_id: 'cancelada', display_status: 'canceled' }),
      charge({ charge_id: 'parcial', display_status: 'partial', total_due_cents: 5000 }),
    ];
    expect(creditTargets(charges, { profile_id: 'u1' }).map((c) => c.charge_id)).toEqual(['ok', 'parcial']);
  });
});

describe('prévia de plano novo', () => {
  const settings = { id: true, due_day: 5, due_month_offset: 0, non_business_rule: 'next_business_day', saturday_is_business: false, horizon_months: 1 } as FinSettings;
  const holiday = (over: Partial<FinHoliday> = {}): FinHoliday => ({ id: 'h', holiday_date: '2026-09-07', name: 'Independência', scope: 'national', kind: 'holiday', active: true, ...over });
  const TODAY = '2026-10-06';
  const draft = { profile: '', start: '2026-09-01', period: 1 as const, amountCents: 15000 };

  it('gera do mês do início até o horizonte, com vencimento no mês cobrado', () => {
    const preview = previewNewPlan(draft, { today: TODAY, settings, holidays: [] });
    expect(preview.create.map((c) => [c.competenceMonth, c.dueDate])).toEqual([['2026-09-01', '2026-09-07'], ['2026-10-01', '2026-10-05'], ['2026-11-01', '2026-11-05']]);
  });

  it('feriado ativo adia o vencimento; desativado não conta', () => {
    const ativo = previewNewPlan(draft, { today: TODAY, settings, holidays: [holiday()] });
    const inativo = previewNewPlan(draft, { today: TODAY, settings, holidays: [holiday({ active: false })] });
    expect(ativo.create[0].dueDate).toBe('2026-09-08');
    expect(inativo.create[0].dueDate).toBe('2026-09-07');
  });

  it('sem configurações do clube usa a regra padrão', () => {
    const preview = previewNewPlan(draft, { today: TODAY, settings: null, holidays: [] });
    expect(preview.create.length).toBeGreaterThan(0);
  });

  it('conta as que já nascem vencidas e descreve a prévia', () => {
    const preview = previewNewPlan(draft, { today: TODAY, settings, holidays: [] });
    expect(overdueCount(preview, TODAY)).toBe(2);
    expect(previewSentence(preview, TODAY)).toBe('De setembro de 2026 a novembro de 2026; a primeira vence em 07/09/2026. 2 já estão vencidas hoje.');
    expect(previewNeedsAttention(preview, 2)).toBe(true);
  });

  it('início deste mês, no prazo: nenhuma vencida e nenhum aviso', () => {
    const preview = previewNewPlan({ ...draft, start: '2026-11-01' }, { today: TODAY, settings, holidays: [] });
    expect(overdueCount(preview, TODAY)).toBe(0);
    expect(previewSentence(preview, TODAY)).not.toMatch(/vencid/);
    expect(previewNeedsAttention(preview, 0)).toBe(false);
  });

  it('início muito antigo pede para conferir a data', () => {
    const preview = previewNewPlan({ ...draft, start: '2025-01-01' }, { today: TODAY, settings, holidays: [] });
    expect(preview.create.length).toBeGreaterThan(12);
    expect(previewSentence(preview, TODAY)).toMatch(/Muitas competências passadas: confira se a data de início está certa\.$/);
    expect(previewNeedsAttention(preview, 0)).toBe(true);
  });

  it('plano sem nenhuma cobrança no período', () => {
    expect(previewSentence({ create: [], existing: [], missingPrice: [] }, TODAY)).toBe('Nenhuma cobrança no período.');
  });
});

describe('frase de cobranças vencidas', () => {
  it.each([
    [0, 3, ''],
    [1, 1, ' Ela já está vencida hoje.'],
    [2, 2, ' Todas já estão vencidas hoje.'],
    [1, 3, ' 1 já está vencida hoje.'],
    [2, 3, ' 2 já estão vencidas hoje.'],
  ])('%i de %i vencidas', (overdue, total, texto) => {
    expect(overdueSentence(overdue, total)).toBe(texto);
  });
});

describe('ações disponíveis numa cobrança', () => {
  it('em aberto e sem pagamento: pagar, desconto, cancelar', () => {
    expect(availableChargeActions(charge(), undefined)).toEqual(['pay', 'discount', 'cancel']);
  });

  it('com encargos devidos oferece dispensar, entre desconto e o resto', () => {
    expect(availableChargeActions(charge({ fees_due_cents: 500 }), undefined)).toEqual(['pay', 'discount', 'waiver', 'cancel']);
  });

  it('com pagamento válido, a saída é estornar (não cancelar)', () => {
    const quitada = charge({ stored_status: 'paid', display_status: 'paid', total_due_cents: 0, principal_remaining_cents: 0 });
    expect(availableChargeActions(quitada, payment())).toEqual(['reverse']);
  });

  it('paga em aberto parcial: pode pagar o resto, ajustar e estornar', () => {
    const parcial = charge({ display_status: 'partial', stored_status: 'partial', total_due_cents: 5000, principal_remaining_cents: 5000 });
    expect(availableChargeActions(parcial, payment())).toEqual(['pay', 'discount', 'reverse']);
  });

  it('quitada sem pagamento válido (estornada) já não pode ser cancelada', () => {
    const quitada = charge({ stored_status: 'paid', display_status: 'paid', total_due_cents: 0, principal_remaining_cents: 0 });
    expect(availableChargeActions(quitada, undefined)).toEqual([]);
  });

  it('cobrança cancelada não tem ação nenhuma', () => {
    expect(availableChargeActions(charge({ display_status: 'canceled', stored_status: 'canceled' }), undefined)).toEqual([]);
  });
});

describe('o que o banco recebe ao resolver um crédito', () => {
  const draft = { chargeId: '', accountId: '', reason: '' };

  it('aplicar pede a cobrança', () => {
    expect(creditResolution('apply', draft)).toBeNull();
    expect(creditResolution('apply', { ...draft, chargeId: 'c1' })).toEqual({ charge_id: 'c1' });
  });

  it('devolver pede conta e observação de 3+ caracteres (o texto vai como foi digitado)', () => {
    expect(creditResolution('refund', { ...draft, reason: 'Pix de volta' })).toBeNull();
    expect(creditResolution('refund', { ...draft, accountId: 'a1', reason: 'ab ' })).toBeNull();
    expect(creditResolution('refund', { ...draft, accountId: 'a1', reason: ' Pix ' })).toEqual({ account_id: 'a1', reason: ' Pix ' });
  });

  it('baixar pede justificativa de 5+ caracteres', () => {
    expect(creditResolution('void', { ...draft, reason: 'erro' })).toBeNull();
    expect(creditResolution('void', { ...draft, reason: '  erro  ' })).toBeNull();
    expect(creditResolution('void', { ...draft, reason: 'Erro de lançamento' })).toEqual({ reason: 'Erro de lançamento' });
  });
});

describe('filtros da lista de cobranças', () => {
  it('sem nada digitado só pede mensalidades; o nome nunca vai ao banco', () => {
    expect(chargeApiFilters({ ...NO_CHARGE_FILTERS, search: 'joao' })).toEqual({
      status: '', competenceFrom: undefined, competenceTo: undefined, dueFrom: undefined, dueTo: undefined, chargeType: 'membership',
    });
  });

  it('competência vira o dia 1 do mês; vencimento segue como está', () => {
    const f = chargeApiFilters({ ...NO_CHARGE_FILTERS, status: 'overdue', compFrom: '2026-03', compTo: '2026-08', dueFrom: '2026-04-01', dueTo: '2026-09-30' });
    expect(f).toMatchObject({ status: 'overdue', competenceFrom: '2026-03-01', competenceTo: '2026-08-01', dueFrom: '2026-04-01', dueTo: '2026-09-30' });
  });

  it('as linhas do arquivo exportado dizem o que estava na tela', () => {
    expect(chargeExportFilters(NO_CHARGE_FILTERS, '2026-10-06')).toEqual([
      { label: 'Situação', value: 'Todas' }, { label: 'Busca', value: '—' }, { label: 'Competência', value: 'todas' },
      { label: 'Vencimento', value: 'todos' }, { label: 'Posição em', value: '06/10/2026' },
    ]);
    expect(chargeExportFilters({ ...NO_CHARGE_FILTERS, status: 'overdue', search: 'ana', compFrom: '2026-03', dueTo: '2026-09-30' }, '2026-10-06')).toEqual([
      { label: 'Situação', value: 'Vencidas' }, { label: 'Busca', value: 'ana' }, { label: 'Competência', value: '2026-03 a …' },
      { label: 'Vencimento', value: '… a 2026-09-30' }, { label: 'Posição em', value: '06/10/2026' },
    ]);
  });
});
