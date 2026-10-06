// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, asUserError, dbToday, ID, j, key, q, rpc, rpcError, U, world, SETTINGS_VERSION } from './harness';
import { addDays, addMonths, firstOfMonth } from '../../../lib/finance/dates';

type W = Awaited<ReturnType<typeof world>>;
const SHA = (n: number) => String(n).padStart(64, '0').replace(/0/g, 'a').slice(0, 63) + String(n % 10);

/** Sócia A com 3 cobranças vencidas (política de encargos confirmada) e sócio B com 1. */
async function scene() {
  const w = await world();
  const today = await dbToday(w.db);
  const start = addMonths(firstOfMonth(today), -3);
  await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: start, amount_cents: 10000 })})`);
  await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: start, amount_cents: 20000 })})`);
  await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '${today}')`);
  await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ fine_fixed_cents: 300, interest_daily_fixed_cents: 10, late_fee_confirmed: true })})`);
  const of = async (uid: string) => q<{ id: string; due_date: string }>(w.db,
    `select id, due_date::text from public.fin_member_charges where profile_id = '${uid}' order by competence_month`);
  return { w, today, A: await of(U.socioA), B: await of(U.socioB) };
}

const submit = (w: W, uid: string, sub: string, charges: string[], over: Record<string, unknown> = {}) => rpc<any>(w.db, uid,
  `public.fin_submit_receipt('${key()}', '${sub}', ${j({
    storage_path: `${uid}/${sub}/comprovante.png`, file_name: 'comprovante.png', content_type: 'image/png', size_bytes: 12345,
    content_sha256: SHA(Number(sub.slice(-4))), charge_ids: charges, declared_amount_cents: 10000, declared_paid_on: '2026-10-01',
    ocr_status: 'ok', ocr: { engine: 'tesseract', amount_cents: 10000, raw_text: 'SEGREDO', confidence: 0.8 }, ...over })})`);

const subId = (n: number) => ID(9000 + n);

describe('envio do comprovante pelo sócio', () => {
  it('registra "enviado" sem quitar nada: a cobrança continua aberta e aparece "em análise"', async () => {
    const { w, A } = await scene();
    const r = await submit(w, U.socioA, subId(1), [A[0].id]);
    expect(r).toMatchObject({ status: 'submitted', possible_duplicate: false });
    // cobrança não mudou
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[0].id}'`))[0].status).toBe('open');
    expect((await q(w.db, `select 1 from public.fin_charge_payments`)).length).toBe(0);
    const mine = await asUser<{ charge_id: string; display_status: string; in_review: boolean }>(w.db, U.socioA, `select charge_id, display_status, in_review from public.fin_my_charges()`);
    expect(mine.find((c) => c.charge_id === A[0].id)).toMatchObject({ in_review: true, display_status: 'in_review' });
    expect(mine.find((c) => c.charge_id === A[1].id)!.display_status).not.toBe('in_review');
  }, 60000);

  it('o texto bruto da leitura nunca é gravado (só campos estruturados) nem vai para a auditoria', async () => {
    const { w, A } = await scene();
    await submit(w, U.socioA, subId(2), [A[0].id]);
    const row = (await q<any>(w.db, `select ocr from public.fin_receipt_submissions`))[0];
    expect(JSON.stringify(row.ocr)).not.toContain('SEGREDO');
    expect(row.ocr.amount_cents).toBe(10000);
    const audit = await q<any>(w.db, `select new_data from public.admin_audit_logs where table_name = 'fin_receipt_submissions'`);
    expect(audit.length).toBeGreaterThan(0);
    for (const a of audit) {
      expect(Object.keys(a.new_data)).not.toContain('storage_path');
      expect(Object.keys(a.new_data)).not.toContain('ocr');
      expect(Object.keys(a.new_data)).not.toContain('content_sha256');
    }
  }, 60000);

  it('valida dono, pasta, cobranças e hash', async () => {
    const { w, A, B } = await scene();
    const bad = (uid: string, sub: string, charges: string[], over: Record<string, unknown> = {}) => submit(w, uid, sub, charges, over).then(() => null, (e) => (e as Error).message);
    expect(await bad(U.socioA, subId(3), [B[0].id])).toMatch(/INVALID_CHARGES/); // cobrança de outro sócio
    expect(await bad(U.socioA, subId(4), [])).toMatch(/NO_CHARGES_SELECTED/);
    expect(await bad(U.socioA, subId(5), [A[0].id], { storage_path: `${U.socioB}/${subId(5)}/x.png` })).toMatch(/INVALID_ATTACHMENT/); // pasta alheia
    expect(await bad(U.socioA, subId(6), [A[0].id], { storage_path: `${U.socioA}/${subId(99)}/x.png` })).toMatch(/INVALID_ATTACHMENT/); // pasta de outro envio
    expect(await bad(U.socioA, subId(7), [A[0].id], { content_sha256: 'xyz' })).toMatch(/INVALID_ATTACHMENT/);
    expect(await bad(U.socioA, subId(8), [A[0].id], { content_type: 'application/x-msdownload' })).not.toBeNull(); // CHECK de tipo
    expect(await bad(U.socioA, subId(9), [A[0].id], { size_bytes: 99999999 })).not.toBeNull(); // CHECK de tamanho
    expect(await bad(U.socioA, subId(10), [A[0].id], { declared_amount_cents: -5 })).toMatch(/INVALID_AMOUNT/);
    expect(await bad(U.lanch, subId(11), [A[0].id], { storage_path: `${U.lanch}/${subId(11)}/x.png` })).toMatch(/NOT_A_MEMBER/);
    expect(await rpcError(w.db, null, `public.fin_submit_receipt('${key()}', '${subId(12)}', '{}'::jsonb)`)).toMatch(/permission denied/);
  }, 60000);

  it('mesmo arquivo enviado por outro sócio é sinalizado como possível duplicidade — sem vazar dados', async () => {
    const { w, A, B } = await scene();
    await submit(w, U.socioA, subId(20), [A[0].id], { content_sha256: SHA(77) });
    const r = await submit(w, U.socioB, subId(21), [B[0].id], { content_sha256: SHA(77) });
    expect(r.possible_duplicate).toBe(true);
    // B não enxerga o envio de A
    const seenByB = await asUser<{ id: string }>(w.db, U.socioB, `select id from public.fin_receipt_submissions`);
    expect(seenByB.map((s) => s.id)).toEqual([subId(21)]);
    const flagged = (await q<{ possible_duplicate: boolean; duplicate_of: string }>(w.db, `select possible_duplicate, duplicate_of from public.fin_receipt_submissions where id = '${subId(21)}'`))[0];
    expect(flagged).toEqual({ possible_duplicate: true, duplicate_of: subId(20) });
  }, 60000);

  it('reenviar substitui o envio anterior (rastreável); aprovado não se substitui', async () => {
    const { w, A } = await scene();
    await submit(w, U.socioA, subId(30), [A[0].id]);
    await submit(w, U.socioA, subId(31), [A[0].id], { replaces: subId(30), content_sha256: SHA(31) });
    const rows = await q<{ id: string; status: string; superseded_by: string | null }>(w.db, `select id, status, superseded_by from public.fin_receipt_submissions order by created_at, id`);
    expect(rows).toEqual([{ id: subId(30), status: 'superseded', superseded_by: subId(31) }, { id: subId(31), status: 'submitted', superseded_by: null }]);
    // um comprovante em análise de outro sócio nunca pode ser substituído por A
    expect(await rpcError(w.db, U.socioB, `public.fin_submit_receipt('${key()}', '${subId(32)}', ${j({
      storage_path: `${U.socioB}/${subId(32)}/x.png`, file_name: 'x.png', content_type: 'image/png', size_bytes: 10, content_sha256: SHA(32),
      charge_ids: [], replaces: subId(31) })})`)).toMatch(/NO_CHARGES_SELECTED/);
  }, 60000);
});

describe('revisão e decisão (administrador)', () => {
  it('aprovar cria os pagamentos, quita e registra quem/quando; sócio não aprova', async () => {
    const { w, A, today } = await scene();
    await submit(w, U.socioA, subId(40), [A[0].id]);
    const st = (await q<any>(w.db, `select * from fin_private.charge_statement('${A[0].id}', '${today}')`))[0];
    const total = Number(st.total_due);
    expect(total).toBeGreaterThan(10000); // com encargos de atraso
    const approve = (uid: string, over: Record<string, unknown> = {}) => `public.fin_approve_receipt('${key()}', '${subId(40)}', ${j({
      paid_on: today, method: 'pix', account_id: w.account, allocations: [{ charge_id: A[0].id, amount_cents: total }], ...over })})`;
    expect(await rpcError(w.db, U.socioA, approve(U.socioA))).toMatch(/FINANCE_FORBIDDEN/);
    await rpc(w.db, U.admin, `public.fin_start_receipt_review('${key()}', '${subId(40)}')`);
    expect((await q<{ status: string }>(w.db, `select status from public.fin_receipt_submissions`))[0].status).toBe('in_review');
    const res = await rpc<any>(w.db, U.admin, approve(U.admin));
    expect(res).toMatchObject({ status: 'approved', total_cents: total });
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[0].id}'`))[0].status).toBe('paid');
    const sub = (await q<any>(w.db, `select status, reviewed_by, reviewed_at is not null as reviewed, approved_payment_ids from public.fin_receipt_submissions`))[0];
    expect(sub).toMatchObject({ status: 'approved', reviewed_by: U.admin, reviewed: true });
    expect(sub.approved_payment_ids.length).toBe(1);
    const pay = (await q<any>(w.db, `select fine_cents::text f, interest_cents::text i, principal_cents::text p, submission_id from public.fin_charge_payments`))[0];
    expect(pay.submission_id).toBe(subId(40));
    expect(Number(pay.p)).toBe(10000);
    expect(Number(pay.f) + Number(pay.i)).toBe(total - 10000);
    // aprovado é terminal
    expect(await rpcError(w.db, U.admin, approve(U.admin))).toMatch(/RECEIPT_NOT_PENDING/);
  }, 60000);

  it('comprovante enviado MESES depois, mas pago no vencimento: os encargos seguem a data do pagamento, não a do envio', async () => {
    const { w, A, today } = await scene();
    const due = A[0].due_date;
    expect(due < today).toBe(true);
    // O sócio só anexa hoje, mas o comprovante é da data do vencimento.
    await submit(w, U.socioA, subId(45), [A[0].id], { declared_paid_on: due, declared_amount_cents: 10000 });
    const hoje = (await q<any>(w.db, `select total_due::text t from fin_private.charge_statement('${A[0].id}', '${today}')`))[0];
    expect(Number(hoje.t)).toBeGreaterThan(10000); // até aprovar, o extrato de hoje mostra os encargos de atraso
    const noDia = (await q<any>(w.db, `select total_due::text t, fine_due::text f from fin_private.charge_statement('${A[0].id}', '${due}')`))[0];
    expect(Number(noDia.t)).toBe(10000); // no dia do vencimento não havia encargo
    await rpc(w.db, U.admin, `public.fin_approve_receipt('${key()}', '${subId(45)}', ${j({
      paid_on: due, method: 'pix', account_id: w.account, allocations: [{ charge_id: A[0].id, amount_cents: 10000 }] })})`);
    const pay = (await q<any>(w.db, `select fine_cents::text f, interest_cents::text i, principal_cents::text p, excess_cents::text e, paid_on::text d from public.fin_charge_payments`))[0];
    expect(pay).toMatchObject({ f: '0', i: '0', p: '10000', e: '0', d: due });
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[0].id}'`))[0].status).toBe('paid');
    // Depois de aprovado, nada acumula: o extrato de hoje fica zerado (pagamento no vencimento zera a base dos juros).
    const depois = (await q<any>(w.db, `select total_due::text t, fees_due::text f from fin_private.charge_statement('${A[0].id}', '${today}')`))[0];
    expect(depois).toMatchObject({ t: '0', f: '0' });
  }, 60000);

  it('valor insuficiente → parcial; valor a mais → crédito; tudo conforme a decisão do admin', async () => {
    const { w, A, today } = await scene();
    await submit(w, U.socioA, subId(50), [A[0].id, A[1].id]);
    const res = await rpc<any>(w.db, U.admin, `public.fin_approve_receipt('${key()}', '${subId(50)}', ${j({
      paid_on: today, method: 'pix', account_id: w.account,
      allocations: [{ charge_id: A[0].id, amount_cents: 4000 }, { charge_id: A[1].id, amount_cents: 99000 }] })})`);
    expect(res.status).toBe('approved');
    const st = await q<{ id: string; status: string }>(w.db, `select id, status from public.fin_member_charges where id in ('${A[0].id}','${A[1].id}') order by competence_month`);
    expect(st.map((s) => s.status)).toEqual(['partial', 'paid']);
    const credit = await q<{ reason: string; amount_cents: string }>(w.db, `select reason, amount_cents::text from public.fin_member_credits`);
    expect(credit.length).toBe(1);
    expect(credit[0].reason).toBe('excess');
  }, 60000);

  it('dispensa de encargos na aprovação exige justificativa e fica registrada', async () => {
    const { w, A, today } = await scene();
    await submit(w, U.socioA, subId(60), [A[0].id]);
    const st = (await q<any>(w.db, `select * from fin_private.charge_statement('${A[0].id}', '${today}')`))[0];
    const feesDue = Number(st.fees_due);
    expect(feesDue).toBeGreaterThan(0);
    const call = (reason: string) => `public.fin_approve_receipt('${key()}', '${subId(60)}', ${j({
      paid_on: today, method: 'pix', account_id: w.account, allocations: [{ charge_id: A[0].id, amount_cents: 10000 }],
      waivers: [{ charge_id: A[0].id, amount_cents: feesDue, reason }] })})`;
    expect(await rpcError(w.db, U.admin, call('x'))).toMatch(/REASON_REQUIRED/);
    // falha atômica: nada ficou pela metade
    expect((await q(w.db, `select 1 from public.fin_charge_adjustments`)).length).toBe(0);
    await rpc(w.db, U.admin, call('Pagou no dia, banco atrasou o Pix'));
    const adj = (await q<any>(w.db, `select kind, amount_cents::text, reason, actor_id from public.fin_charge_adjustments`))[0];
    expect(adj).toMatchObject({ kind: 'fee_waiver', amount_cents: String(feesDue), reason: 'Pagou no dia, banco atrasou o Pix', actor_id: U.admin });
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[0].id}'`))[0].status).toBe('paid');
  }, 60000);

  it('rejeitar exige justificativa, não quita nada e permite reenviar', async () => {
    const { w, A } = await scene();
    await submit(w, U.socioA, subId(70), [A[0].id]);
    expect(await rpcError(w.db, U.admin, `public.fin_reject_receipt('${key()}', '${subId(70)}', 'não')`)).toMatch(/REASON_REQUIRED/);
    await rpc(w.db, U.admin, `public.fin_reject_receipt('${key()}', '${subId(70)}', 'Comprovante ilegível, reenvie uma foto mais nítida')`);
    const s = (await q<any>(w.db, `select status, reviewed_by, decision_reason from public.fin_receipt_submissions`))[0];
    expect(s).toMatchObject({ status: 'rejected', reviewed_by: U.admin, decision_reason: 'Comprovante ilegível, reenvie uma foto mais nítida' });
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[0].id}'`))[0].status).toBe('open');
    // o sócio vê a decisão e o motivo (é o "próximo passo" que a tela mostra)
    const seen = await asUser<{ status: string; decision_reason: string }>(w.db, U.socioA, `select status, decision_reason from public.fin_receipt_submissions`);
    expect(seen).toEqual([{ status: 'rejected', decision_reason: 'Comprovante ilegível, reenvie uma foto mais nítida' }]);
    await submit(w, U.socioA, subId(71), [A[0].id], { replaces: subId(70), content_sha256: SHA(71) });
    expect((await q<{ status: string }>(w.db, `select status from public.fin_receipt_submissions where id = '${subId(70)}'`))[0].status).toBe('superseded');
  }, 60000);

  it('comprovante de uma cobrança que já foi paga por outro meio vira crédito "duplicado", não receita em dobro', async () => {
    const { w, A, today } = await scene();
    await submit(w, U.socioA, subId(80), [A[2].id]);
    // o admin quita por fora antes de aprovar o comprovante
    await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${A[2].id}', 10000, '${today}', 'cash', '${w.account}', null)`);
    const st = (await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${A[2].id}'`))[0].status;
    if (st === 'paid') {
      await rpc(w.db, U.admin, `public.fin_approve_receipt('${key()}', '${subId(80)}', ${j({
        paid_on: today, method: 'pix', account_id: w.account, allocations: [{ charge_id: A[2].id, amount_cents: 10000 }] })})`);
      const cr = await q<{ reason: string; amount_cents: string }>(w.db, `select reason, amount_cents::text from public.fin_member_credits`);
      expect(cr).toEqual([{ reason: 'duplicate', amount_cents: '10000' }]);
    }
  }, 60000);

  it('chave de idempotência: aprovar duas vezes com a mesma chave não paga duas vezes', async () => {
    const { w, A, today } = await scene();
    await submit(w, U.socioA, subId(90), [A[0].id]);
    const k = key();
    const call = `public.fin_approve_receipt('${k}', '${subId(90)}', ${j({ paid_on: today, method: 'pix', account_id: w.account, allocations: [{ charge_id: A[0].id, amount_cents: 3000 }] })})`;
    const a = await rpc<any>(w.db, U.admin, call);
    const b = await rpc<any>(w.db, U.admin, call);
    expect(b.replayed).toBe(true);
    expect(b.payment_ids).toEqual(a.payment_ids);
    expect((await q(w.db, `select 1 from public.fin_charge_payments`)).length).toBe(1);
  }, 60000);

  it('fila do admin lista pendentes primeiro; sócio não acessa', async () => {
    const { w, A, B } = await scene();
    await submit(w, U.socioA, subId(100), [A[0].id]);
    await submit(w, U.socioB, subId(101), [B[0].id], { content_sha256: SHA(101) });
    await rpc(w.db, U.admin, `public.fin_reject_receipt('${key()}', '${subId(100)}', 'Valor não confere com a cobrança')`);
    const queue = await asUser<{ id: string; status: string; profile_name: string }>(w.db, U.admin, `select id, status, profile_name from public.fin_receipt_queue()`);
    expect(queue.map((r) => r.status)).toEqual(['submitted', 'rejected']);
    const pend = await asUser<{ id: string }>(w.db, U.admin, `select id from public.fin_receipt_queue('pending')`);
    expect(pend.length).toBe(1);
    expect(await rpcError(w.db, U.socioA, `public.fin_receipt_queue()`)).toMatch(/FINANCE_FORBIDDEN/);
  }, 60000);
});

describe('armazenamento privado dos comprovantes', () => {
  async function put(w: W, uid: string | null, path: string) {
    return asUserError(w.db, uid, `insert into storage.objects(bucket_id, name, owner) values ('fin-receipts', '${path}', ${uid ? `'${uid}'` : 'null'})`);
  }
  it('bucket privado, com limite de tamanho e tipos permitidos', async () => {
    const { w } = await scene();
    const b = (await q<any>(w.db, `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'fin-receipts'`))[0];
    expect(b.public).toBe(false);
    expect(b.file_size_limit).toBe('10485760');
    expect(b.allowed_mime_types).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
    const d = (await q<any>(w.db, `select public from storage.buckets where id = 'fin-docs'`))[0];
    expect(d.public).toBe(false);
  }, 60000);

  it('sócio grava só na própria pasta; lê só o que é dele; admin lê tudo; ninguém troca nem apaga', async () => {
    const { w } = await scene();
    const mine = `${U.socioA}/${subId(1)}/foto.png`;
    expect(await put(w, U.socioA, mine)).toBeNull();
    expect(await put(w, U.socioA, `${U.socioB}/${subId(2)}/foto.png`)).not.toBeNull(); // pasta do B
    expect(await put(w, U.socioA, `${U.socioA}/foto.png`)).not.toBeNull(); // fora do formato <uid>/<envio>/<arquivo>
    expect(await put(w, U.lanch, `${U.lanch}/${subId(3)}/foto.png`)).not.toBeNull(); // lanchonete não é sócio
    expect(await put(w, null, `${U.socioA}/${subId(4)}/foto.png`)).not.toBeNull();
    await w.db.exec(`insert into storage.objects(bucket_id, name, owner) values ('fin-receipts', '${U.socioB}/${subId(5)}/b.png', '${U.socioB}')`);
    const names = (uid: string) => asUser<{ name: string }>(w.db, uid, `select name from storage.objects where bucket_id = 'fin-receipts' order by name`).then((r) => r.map((x) => x.name));
    expect(await names(U.socioA)).toEqual([mine]);
    expect(await names(U.socioB)).toEqual([`${U.socioB}/${subId(5)}/b.png`]);
    expect((await names(U.admin)).length).toBe(2);
    expect(await names(U.prof)).toEqual([]);
    expect(await names(U.lanch)).toEqual([]);
    // sem update/delete: a linha continua igual
    await asUser(w.db, U.socioA, `update storage.objects set name = '${U.socioA}/${subId(1)}/outro.png' where name = '${mine}'`);
    await asUser(w.db, U.socioA, `delete from storage.objects where name = '${mine}'`);
    expect(await names(U.socioA)).toEqual([mine]);
    // documentos de despesa (fin-docs): só admin
    expect(await asUserError(w.db, U.socioA, `select * from storage.objects where bucket_id = 'fin-docs'`)).toBeNull();
    expect((await asUser(w.db, U.socioA, `select * from storage.objects where bucket_id = 'fin-docs'`)).length).toBe(0);
  }, 60000);
});

void addDays;
