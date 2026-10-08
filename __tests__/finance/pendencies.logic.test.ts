import { describe, expect, it } from 'vitest';
import type { ChargeStatementRow, FinCategory, FinSettings, MemberPendencyMeta } from '../../lib/finance/types';
import {
  amountAfterKindChange, availablePendencyActions, emptyPendencyDraft, feeText, isPendencyReady, pendencyCategoryId, pendencyCreatedMessage,
  pendencyInput, pendencyKindLabel, pendencyRows, pendencyTotals, reminderDaysText, type PendencyDraft,
} from '../../lib/finance/pendencies';

const stmt = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: null, profile_id: 'u1', profile_name: 'Ana Sócia', competence_month: '2026-10-01', period_months: 1, due_date: '2026-10-07',
  original_amount_cents: 5000, stored_status: 'open', display_status: 'open', in_review: false, principal_base_cents: 5000, principal_paid_cents: 0,
  principal_remaining_cents: 5000, days_late: 0, fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0,
  total_due_cents: 5000, fees_configured: true, overdue: false, last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});
const meta = (over: Partial<MemberPendencyMeta> = {}): MemberPendencyMeta => ({
  id: 'c1', profile_id: 'u1', charge_type: 'member_pendency', description: 'Day Card do convidado Carlos', pendency_kind: 'day_card', category_id: 'cat-day',
  guest_name: 'Carlos', guest_date: '2026-10-05', collection_enabled: true, competence_month: '2026-10-01', due_date: '2026-10-07',
  original_amount_cents: 5000, status: 'open', version: 1, ...over,
});
const settings = { day_card_price_cents: 5000 } as FinSettings;
const TODAY = '2026-10-06';

describe('texto da régua', () => {
  it.each([
    [[0, 3, 7], 'No vencimento, +3 e +7 dias'],
    [[0], 'No vencimento'],
    [[0, 5], 'No vencimento e +5 dias'],
    [[3], '+3 dias'],
    [[3, 7], '+3 e +7 dias'],
    [[], 'Nenhum envio'],
  ])('%j → %s', (days, texto) => {
    expect(reminderDaysText(days)).toBe(texto);
  });

  it('multa e juros: fixo, percentual, os dois ou nenhum', () => {
    expect(feeText(500, 0)).toBe('R$ 5,00');
    expect(feeText(0, 200)).toBe('2%');
    expect(feeText(500, 250)).toBe('R$ 5,00 + 2,5%');
    expect(feeText(0, 3)).toBe('0,03%');
    expect(feeText(0, 0)).toBe('');
  });

  it('o tipo aparece por extenso', () => {
    expect(pendencyKindLabel('dano_reposicao')).toBe('Dano / reposição');
  });
});

describe('lista de pendências', () => {
  const statements = [stmt(), stmt({ charge_id: 'c2', profile_name: 'Beto Sócio' }), stmt({ charge_id: 'c3', profile_name: 'Sem Ficha' })];
  const metas = [meta(), meta({ id: 'c2', description: 'Consumo do bar', guest_name: null })];

  it('junta a ficha de cada cobrança e descarta a que não tem ficha', () => {
    expect(pendencyRows(statements, metas, '').map((r) => r.charge_id)).toEqual(['c1', 'c2']);
    expect(pendencyRows(statements, metas, '')[0].meta.description).toBe('Day Card do convidado Carlos');
  });

  it('busca por sócio, descrição ou convidado, sem acento e sem maiúsculas', () => {
    expect(pendencyRows(statements, metas, 'CARLOS').map((r) => r.charge_id)).toEqual(['c1']);
    expect(pendencyRows(statements, metas, 'beto socio').map((r) => r.charge_id)).toEqual(['c2']);
    expect(pendencyRows(statements, metas, 'bar').map((r) => r.charge_id)).toEqual(['c2']);
    expect(pendencyRows(statements, metas, '   ').map((r) => r.charge_id)).toEqual(['c1', 'c2']);
  });

  it('totais: saldo em aberto sem quitadas e canceladas; vencido pela situação exibida', () => {
    const rows = [
      stmt({ total_due_cents: 5000 }),
      stmt({ total_due_cents: 1200, display_status: 'overdue' }),
      stmt({ total_due_cents: 800, stored_status: 'paid', display_status: 'paid' }),
      stmt({ total_due_cents: 700, stored_status: 'canceled', display_status: 'canceled' }),
    ];
    expect(pendencyTotals(rows)).toEqual({ open: 6200, overdue: 1200 });
    expect(pendencyTotals([])).toEqual({ open: 0, overdue: 0 });
  });
});

describe('ações de uma pendência', () => {
  const row = (statement: Partial<ChargeStatementRow> = {}, m: Partial<MemberPendencyMeta> = {}) => ({ ...stmt(statement), meta: meta(m) });

  it('aberta e ativa: pagar, cobrar agora, pausar e cancelar', () => {
    expect(availablePendencyActions(row())).toEqual(['pay', 'send', 'toggle', 'cancel']);
  });

  it('cobrança pausada esconde "cobrar agora" mas mantém reativar', () => {
    expect(availablePendencyActions(row({}, { collection_enabled: false }))).toEqual(['pay', 'toggle', 'cancel']);
  });

  it('com pagamento parcial não cancela', () => {
    expect(availablePendencyActions(row({ principal_paid_cents: 1000, total_due_cents: 4000, stored_status: 'partial' }))).toEqual(['pay', 'send', 'toggle']);
  });

  it('quitada: nada a pagar nem cancelar', () => {
    expect(availablePendencyActions(row({ stored_status: 'paid', total_due_cents: 0, principal_paid_cents: 5000 }))).toEqual([]);
  });

  it('cancelada: nenhuma ação', () => {
    expect(availablePendencyActions(row({ stored_status: 'canceled' }))).toEqual([]);
  });
});

describe('pendência nova', () => {
  const categories = [{ id: 'cat-day', system_key: 'day_card' }, { id: 'cat-pend', system_key: 'member_pendency' }, { id: 'x', system_key: null }] as unknown as FinCategory[];
  const filled = (over: Partial<PendencyDraft> = {}): PendencyDraft => ({ ...emptyPendencyDraft(TODAY, settings, 'a1'), profile: 'u2', description: 'Consumo do bar', ...over });

  it('o formulário limpo começa no Day Card do clube, hoje e com cobrança automática ligada', () => {
    expect(emptyPendencyDraft(TODAY, settings, 'a1')).toEqual({
      profile: '', kind: 'day_card', description: '', amount: 5000, competence: '2026-10-01', due: TODAY, guestName: '', guestDate: '',
      sendNow: false, collection: true, alreadyPaid: false, paidOn: TODAY, method: 'pix', account: 'a1',
    });
    expect(emptyPendencyDraft(TODAY, null, '').amount).toBeNull();
  });

  it('trocar para Day Card traz o valor do clube só se a pessoa ainda não digitou outro', () => {
    expect(amountAfterKindChange('day_card', null, 5000)).toBe(5000);
    expect(amountAfterKindChange('day_card', 5000, 5000)).toBe(5000);
    expect(amountAfterKindChange('day_card', 1200, 5000)).toBe(1200);
    expect(amountAfterKindChange('consumo', null, 5000)).toBeNull();
    expect(amountAfterKindChange('consumo', 5000, 5000)).toBe(5000);
    expect(amountAfterKindChange('day_card', null, undefined)).toBeNull();
  });

  it('categoria: Day Card tem a sua; as outras usam a de pendência de sócio', () => {
    expect(pendencyCategoryId(categories, 'day_card')).toBe('cat-day');
    expect(pendencyCategoryId(categories, 'consumo')).toBe('cat-pend');
    expect(pendencyCategoryId([], 'consumo')).toBeNull();
  });

  it('só está pronta com sócio, descrição de 3+ letras, valor, datas e categoria', () => {
    expect(isPendencyReady(filled({ amount: 1000 }), 'cat-pend')).toBe(true);
    expect(isPendencyReady(filled({ amount: 1000, profile: '' }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: 1000, description: ' ab ' }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: 0 }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: null }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: 1000, due: '' }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: 1000 }), null)).toBe(false);
  });

  it('já foi pago exige a conta', () => {
    expect(isPendencyReady(filled({ amount: 1000, alreadyPaid: true, account: '' }), 'cat-pend')).toBe(false);
    expect(isPendencyReady(filled({ amount: 1000, alreadyPaid: true, account: 'a1' }), 'cat-pend')).toBe(true);
  });

  it('os dados enviados: texto aparado, competência no dia 1, convidado só no Day Card', () => {
    const input = pendencyInput(filled({ kind: 'day_card', amount: 5000, description: '  Day Card Pedro ', guestName: ' Pedro ', guestDate: '2026-10-05', competence: '2026-10-17' }), 'cat-day');
    expect(input).toEqual({
      profileId: 'u2', description: 'Day Card Pedro', amountCents: 5000, competenceMonth: '2026-10-01', dueDate: TODAY, pendencyKind: 'day_card', categoryId: 'cat-day',
      guestName: 'Pedro', guestDate: '2026-10-05', collectionEnabled: true, sendNow: false, alreadyPaid: false, paidOn: null, method: null, accountId: null,
    });
    expect(pendencyInput(filled({ kind: 'consumo', amount: 1000, guestName: 'Pedro', guestDate: '2026-10-05' }), 'cat-pend')).toMatchObject({ guestName: null, guestDate: null });
    expect(pendencyInput(filled({ kind: 'day_card', amount: 5000, guestName: '  ', guestDate: '' }), 'cat-day')).toMatchObject({ guestName: null, guestDate: null });
  });

  it('já foi pago leva data, forma e conta e nunca "cobrar agora"', () => {
    const input = pendencyInput(filled({ amount: 1000, alreadyPaid: true, sendNow: true, paidOn: '2026-10-04', method: 'cash', account: 'a9' }), 'cat-pend');
    expect(input).toMatchObject({ alreadyPaid: true, sendNow: false, paidOn: '2026-10-04', method: 'cash', accountId: 'a9' });
  });

  it('o aviso diz o que aconteceu', () => {
    expect(pendencyCreatedMessage({ alreadyPaid: true, sendNow: true })).toBe('Pendência lançada e pagamento registrado.');
    expect(pendencyCreatedMessage({ alreadyPaid: false, sendNow: true })).toBe('Pendência criada. A cobrança entrou na fila do WhatsApp.');
    expect(pendencyCreatedMessage({ alreadyPaid: false, sendNow: false })).toBe('Pendência criada.');
  });
});
