// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, dbToday, ID, j, key, q, rpc, rpcError, U, world } from './harness';
import { addMonths, firstOfMonth } from '../../../lib/finance/dates';

type W = Awaited<ReturnType<typeof world>>;

/** Sócia A e sócio B com mensalidades; A enviou um comprovante ligado só à primeira. */
async function scene() {
  const w = await world();
  const today = await dbToday(w.db);
  const start = addMonths(firstOfMonth(today), -2);
  await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: start, amount_cents: 10000 })})`);
  await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: start, amount_cents: 20000 })})`);
  await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '${today}')`);
  const of = async (uid: string) => q<{ id: string }>(w.db, `select id from public.fin_member_charges where profile_id = '${uid}' order by competence_month`);
  const A = await of(U.socioA);
  const sub = ID(9500);
  await rpc(w.db, U.socioA, `public.fin_submit_receipt('${key()}', '${sub}', ${j({
    storage_path: `${U.socioA}/${sub}/comprovante.png`, file_name: 'comprovante.png', content_type: 'image/png', size_bytes: 12345,
    content_sha256: 'd'.repeat(64), charge_ids: [A[0].id], declared_amount_cents: 20000, declared_paid_on: today, ocr_status: 'not_run' })})`);
  return { w, today, sub, A, B: await of(U.socioB) };
}

const link = (w: W, uid: string, sub: string, ids: string[]) =>
  rpc<any>(w.db, uid, `public.fin_link_receipt_charges('${key()}', '${sub}', array[${ids.map((x) => `'${x}'`).join(',')}]::uuid[])`);
const links = async (w: W, sub: string) =>
  (await q<{ charge_id: string }>(w.db, `select charge_id from public.fin_receipt_charges where submission_id = '${sub}'`)).map((r) => r.charge_id).sort();

describe('administrador liga cobranças ao comprovante', () => {
  it('liga outra cobrança do mesmo sócio sem pagar nada; depois a aprovação usa a cobrança ligada', async () => {
    const { w, today, sub, A } = await scene();
    const r = await link(w, U.admin, sub, [A[1].id, A[0].id]);
    expect(r.linked).toBe(1);
    expect(await links(w, sub)).toEqual([A[0].id, A[1].id].sort());
    expect(await q(w.db, `select 1 from public.fin_charge_payments`)).toHaveLength(0);
    const mine = await asUser<{ charge_id: string; in_review: boolean }>(w.db, U.socioA, `select charge_id, in_review from public.fin_my_charges()`);
    expect(mine.find((c) => c.charge_id === A[1].id)!.in_review).toBe(true);
    const audit = await q(w.db, `select 1 from public.admin_audit_logs where table_name = 'fin_receipt_submissions' and action like '%receipt_link_charges%'`);
    expect(audit.length).toBeGreaterThan(0);

    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    await rpc(w.db, U.admin, `public.fin_approve_receipt('${key()}', '${sub}', ${j({ paid_on: today, method: 'pix', account_id: acc,
      allocations: [{ charge_id: A[0].id, amount_cents: 10000 }, { charge_id: A[1].id, amount_cents: 10000 }] })})`);
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[1].id}'`))[0].status).toBe('paid');
  }, 60000);

  it('recusa cobrança de outro sócio, cobrança quitada, comprovante já decidido e quem não é administrador', async () => {
    const { w, today, sub, A, B } = await scene();
    expect(await rpcError(w.db, U.admin, `public.fin_link_receipt_charges('${key()}', '${sub}', array['${B[0].id}']::uuid[])`)).toMatch(/INVALID_CHARGES/);
    expect(await rpcError(w.db, U.admin, `public.fin_link_receipt_charges('${key()}', '${sub}', array[]::uuid[])`)).toMatch(/NO_CHARGES_SELECTED/);
    expect(await rpcError(w.db, U.socioA, `public.fin_link_receipt_charges('${key()}', '${sub}', array['${A[1].id}']::uuid[])`)).toMatch(/FORBIDDEN|permission/i);

    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${A[2].id}', 10000, '${today}', 'pix', '${acc}', null)`);
    expect(await rpcError(w.db, U.admin, `public.fin_link_receipt_charges('${key()}', '${sub}', array['${A[2].id}']::uuid[])`)).toMatch(/INVALID_CHARGES/);

    await rpc(w.db, U.admin, `public.fin_reject_receipt('${key()}', '${sub}', 'Comprovante ilegível')`);
    expect(await rpcError(w.db, U.admin, `public.fin_link_receipt_charges('${key()}', '${sub}', array['${A[1].id}']::uuid[])`)).toMatch(/RECEIPT_NOT_PENDING/);
    expect(await links(w, sub)).toEqual([A[0].id]);
  }, 60000);
});
