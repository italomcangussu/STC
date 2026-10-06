import { describe, expect, it } from 'vitest';
import { analyzeFromStatements, batchReadiness, duplicateCandidates, mapLimit, runSequential, type QueuedReceiptDetail } from '../../lib/finance/batch';
import type { ChargeStatementRow, ReceiptQueueRow } from '../../lib/finance/types';

const stm = (over: Partial<ChargeStatementRow> = {}): ChargeStatementRow => ({
  charge_id: 'c1', plan_id: 'p1', profile_id: 'u1', profile_name: 'Ana', competence_month: '2026-08-01', period_months: 1, due_date: '2026-09-07', original_amount_cents: 15000,
  stored_status: 'open', display_status: 'open', in_review: true, principal_base_cents: 15000, principal_paid_cents: 0, principal_remaining_cents: 15000, days_late: 0,
  fine_due_cents: 0, interest_due_cents: 0, fees_due_cents: 0, fees_paid_cents: 0, fees_waived_cents: 0, total_due_cents: 15000, fees_configured: false, overdue: false,
  last_payment_on: null, cancel_reason: null, total_count: 1, ...over,
});
const detail = (over: Partial<QueuedReceiptDetail> = {}): QueuedReceiptDetail => ({
  declared_amount_cents: 15000, declared_paid_on: '2026-09-05', ocr_status: 'ok', ocr: { amount_cents: 15000, paid_on: '2026-09-05', identifier: 'E1' }, possible_duplicate: false, ...over,
});
const analyze = (d: QueuedReceiptDetail, rows = [stm()], others: Parameters<typeof analyzeFromStatements>[0]['others'] = [], payeeNames: string[] = []) =>
  analyzeFromStatements({ detail: d, atPaid: rows, now: rows, others, payeeNames, today: '2026-09-20' });

describe('aprovação em lote — quem pode entrar', () => {
  it('valor igual ao devido, sem alertas de risco: pronto', () => {
    const r = batchReadiness(analyze(detail()));
    expect(r).toEqual({ status: 'ready', reason: null });
  });

  it('pagou depois do vencimento com os encargos já somados continua pronto (valor confere)', () => {
    const late = stm({ days_late: 3, fine_due_cents: 300, interest_due_cents: 30, fees_due_cents: 330, total_due_cents: 15330, fees_configured: true });
    const r = batchReadiness(analyze(detail({ declared_amount_cents: 15330, declared_paid_on: '2026-09-10', ocr: null, ocr_status: 'not_run' }), [late]));
    expect(r.status).toBe('ready');
  });

  it('só o valor original com atraso, valor a menos ou a mais: conferir individualmente', () => {
    const late = stm({ days_late: 3, fine_due_cents: 300, interest_due_cents: 30, fees_due_cents: 330, total_due_cents: 15330, fees_configured: true });
    expect(batchReadiness(analyze(detail({ declared_amount_cents: 15000, declared_paid_on: '2026-09-10' }), [late])).status).toBe('attention');
    expect(batchReadiness(analyze(detail({ declared_amount_cents: 9000 }))).status).toBe('attention');
    const above = batchReadiness(analyze(detail({ declared_amount_cents: 17000 })));
    expect(above.status).toBe('attention');
    expect(above.reason).toMatch(/crédito/i);
  });

  it('sem valor ou sem data (leitura falhou): conferir individualmente', () => {
    expect(batchReadiness(analyze(detail({ declared_amount_cents: null, declared_paid_on: null, ocr: null, ocr_status: 'unreadable' }))).status).toBe('attention');
  });

  it('data no futuro e cobrança já quitada bloqueiam', () => {
    expect(batchReadiness(analyze(detail({ declared_paid_on: '2026-09-25' }))).status).toBe('blocked');
    const settled = batchReadiness(analyze(detail(), [stm({ total_due_cents: 0, principal_remaining_cents: 0 })]));
    expect(settled.status).toBe('blocked');
    expect(settled.reason).toMatch(/quitada/i);
  });

  it('arquivo repetido e favorecido diferente exigem olhar o arquivo', () => {
    expect(batchReadiness(analyze(detail({ possible_duplicate: true }))).status).toBe('attention');
    const payee = analyze(detail({ ocr: { amount_cents: 15000, paid_on: '2026-09-05', payee: 'Loja do Zé' } }), [stm()], [], ['Clube de Tênis']);
    expect(batchReadiness(payee).status).toBe('attention');
  });

  it('sem cobrança vinculada não entra', () => {
    expect(batchReadiness(analyze(detail(), [])).status).toBe('blocked');
  });
});

describe('duplicidade no lote', () => {
  const q = (id: string, profile: string, over: Partial<ReceiptQueueRow> = {}): ReceiptQueueRow => ({
    id, profile_id: profile, profile_name: profile, status: 'submitted', file_name: 'x.png', content_type: 'image/png', size_bytes: 1, declared_amount_cents: 15000,
    declared_paid_on: '2026-09-05', ocr_status: 'ok', ocr: { identifier: id }, possible_duplicate: false, decision_reason: null, reviewed_at: null,
    created_at: '2026-09-05T10:00:00Z', charge_count: 1, total_count: 3, ...over,
  });

  it('sócios diferentes com mesmo valor e data NÃO se acusam; o identificador do Pix, sim', () => {
    const queue = [q('a', 'u1'), q('b', 'u2'), q('c', 'u3', { ocr: { identifier: 'a' } })];
    const forA = duplicateCandidates(queue, queue[0]);
    expect(forA).toHaveLength(2);
    const readyA = batchReadiness(analyze(detail({ ocr: { amount_cents: 15000, paid_on: '2026-09-05', identifier: 'a' } }), [stm()], forA));
    // c repete o identificador "a" → duplicado
    expect(readyA.status).toBe('attention');
    const forB = duplicateCandidates(queue, queue[1]);
    expect(batchReadiness(analyze(detail({ ocr: { amount_cents: 15000, paid_on: '2026-09-05', identifier: 'b' } }), [stm()], forB)).status).toBe('ready');
  });

  it('o mesmo sócio com valor e data iguais é suspeito', () => {
    const queue = [q('a', 'u1', { ocr: null }), q('b', 'u1', { ocr: null })];
    const r = batchReadiness(analyze(detail({ ocr: null, ocr_status: 'not_run' }), [stm()], duplicateCandidates(queue, queue[0])));
    expect(r.status).toBe('attention');
  });
});

describe('execução em lote', () => {
  it('runSequential segue depois de uma falha e informa cada resultado, na ordem', async () => {
    const seen: string[] = []; const progress: number[] = [];
    const res = await runSequential(['a', 'b', 'c'], async (x) => { seen.push(x); if (x === 'b') throw new Error('falhou'); }, (d) => progress.push(d));
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(res.map((r) => [r.item, r.ok])).toEqual([['a', true], ['b', false], ['c', true]]);
    expect((res[1].error as Error).message).toBe('falhou');
    expect(progress).toEqual([1, 2, 3]);
  });

  it('mapLimit respeita o limite de simultâneos e preserva a ordem', async () => {
    let active = 0; let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return n * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimit([], 3, async (n: number) => n)).toEqual([]);
  });
});
