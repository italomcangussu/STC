// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dbToday } from '../../finance/sql/harness';
import { addDays, addMonths, firstOfMonth } from '../../../lib/finance/dates';
import { inbound, j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;
const SETTINGS_VERSION = '(select version from public.fin_settings)';

/** Sócia A com mensalidades de R$ 100 vencidas, conta padrão e nome do clube cadastrado. */
async function scene(payees: string[] = ['Sobral Tênis Clube'], opts: { plan?: boolean; generate?: boolean } = {}) {
  const w = await world();
  const today = await dbToday(w.db);
  await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
  await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ payee_names: payees })})`);
  if (opts.plan !== false) {
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: addMonths(firstOfMonth(today), -2), amount_cents: 10000 })})`);
    if (opts.generate !== false) await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '${today}')`);
  }
  const charges = await q<{ id: string; due_date: string }>(w.db,
    `select id, due_date::text from public.fin_member_charges where profile_id = '${U.socioA}' order by due_date`);
  return { w, today, charges };
}

/** Foto recebida no privado da sócia A, já com a mídia guardada. */
async function photo(w: W) {
  const m = await inbound(w.db, { phone: '99900000002', kind: 'image', body: '' });
  await w.db.exec(`update public.conv_messages set media_path = 'in/${m.message_id}.jpg', media_mime = 'image/jpeg' where id = '${m.message_id}'`);
  return m.message_id;
}

/** O que a edge function manda depois do OCR (declarado = lido). */
function receipt(w: W, message: string, ocr: { amount_cents: number; paid_on: string; payee?: string | null; identifier?: string }, ocrStatus = 'ok') {
  const sub = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
  const stored = {
    engine: 'tesseract-server', identifier: ocr.identifier ?? `E${n}`, payee: 'SOBRAL TENIS CLUBE LTDA', ...ocr,
    confidence: { amount: 'high', date: 'high', identifier: 'high', payee: 'high' },
  };
  // Como a edge function: chamada com a chave de serviço.
  return svc<any>(w.db, `(select r from (select set_config('request.jwt.claim.role', 'service_role', true)) _,
    lateral (select public.fin_submit_whatsapp_pendency_receipt('${message}', '${sub}', ${j({
    storage_path: `${U.socioA}/${sub}/comprovante.jpg`, file_name: 'comprovante.jpg', content_type: 'image/jpeg', size_bytes: 1234,
    content_sha256: String(n).padStart(64, 'b'), declared_amount_cents: stored.amount_cents, declared_paid_on: stored.paid_on,
    declared_reference: stored.identifier, ocr_status: ocrStatus, ocr: ocrStatus === 'ok' ? stored : null })}) r) x)`);
}

const status = async (w: W, id: string) =>
  (await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${id}'`))[0].status;
const notices = (w: W, kind: 'paid' | 'receipt_review') =>
  q<any>(w.db, `select subject from public.conv_automation_recipients where dedupe_key like 'fin:member_pendency:${kind}:%'`);

describe('baixa automática do comprovante de mensalidade', () => {
  it('pelo WhatsApp, só com mensalidade em aberto: baixa a mais antiga e avisa o sócio', async () => {
    const { w, today, charges } = await scene();
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: true, status: 'approved' });
    expect(r.charge_ids).toHaveLength(charges.length);
    expect(await status(w, charges[0].id)).toBe('paid');
    expect(await status(w, charges[1].id)).toBe('open');
    const [notice] = await notices(w, 'paid');
    expect(notice.subject).toMatchObject({ paid_cents: 10000 });
    expect(Number(notice.subject.balance_cents)).toBeGreaterThan(0);
    expect(await notices(w, 'receipt_review')).toHaveLength(0);
  }, 60000);

  it('valor de duas mensalidades e meia: quita duas e deixa a terceira parcial', async () => {
    const { w, today, charges } = await scene();
    expect(charges.length).toBeGreaterThanOrEqual(3);
    const r = await receipt(w, await photo(w), { amount_cents: 25000, paid_on: today });
    expect(r.auto_approved).toBe(true);
    expect([await status(w, charges[0].id), await status(w, charges[1].id), await status(w, charges[2].id)]).toEqual(['paid', 'paid', 'partial']);
  }, 60000);

  it('favorecido só "Clube" não confere: fica em análise, nada é baixado, sócio é avisado', async () => {
    const { w, today, charges } = await scene();
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today, payee: 'Clube' });
    expect(r).toMatchObject({ auto_approved: false, auto_reason: 'PAYEE_MISMATCH', status: 'submitted' });
    expect(await status(w, charges[0].id)).toBe('open');
    expect(await q(w.db, `select 1 from public.fin_charge_payments`)).toHaveLength(0);
    expect(await notices(w, 'receipt_review')).toHaveLength(1);
  }, 60000);

  it('sem nome do clube cadastrado, não há baixa automática', async () => {
    const { w, today } = await scene([]);
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: false, auto_reason: 'PAYEE_NOT_CONFIGURED' });
  }, 60000);

  it('motor financeiro recusa (data anterior ao último pagamento): nada gravado, comprovante fica em análise', async () => {
    const { w, today, charges } = await scene();
    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${charges[0].id}', 1000, '${today}', 'pix', '${acc}', null)`);
    const r = await receipt(w, await photo(w), { amount_cents: 9000, paid_on: addDays(today, -1) });
    expect(r).toMatchObject({ auto_approved: false, auto_reason: 'PAYMENT_REJECTED', status: 'submitted' });
    expect(await q(w.db, `select 1 from public.fin_charge_payments`)).toHaveLength(1);
  }, 60000);

  it('sócio em dia com a mensalidade do mês ainda não gerada: gera na hora e baixa', async () => {
    const { w, today } = await scene(undefined, { generate: false });
    expect(await q(w.db, `select 1 from public.fin_member_charges`)).toHaveLength(0);
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: true, status: 'approved' });
    expect(r.generated_charges).toBeGreaterThan(0);
    expect(await notices(w, 'paid')).toHaveLength(1);
  }, 60000);

  it('sócio que já pagou tudo e manda o próximo mês adiantado: gera a próxima mensalidade e baixa', async () => {
    const { w, today, charges } = await scene();
    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    for (const c of charges) await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${c.id}', 10000, '${addDays(today, -3)}', 'pix', '${acc}', null)`);
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: true, generated_charges: 1 });
    const all = await q<{ status: string }>(w.db, `select status from public.fin_member_charges order by competence_month`);
    expect(all).toHaveLength(charges.length + 1);
    expect(all.every((c) => c.status === 'paid')).toBe(true);
  }, 60000);

  it('mesmo valor e data já baixados à mão pelo administrador: não baixa de novo', async () => {
    const { w, today, charges } = await scene();
    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${charges[0].id}', 10000, '${today}', 'pix', '${acc}', null)`);
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: false, auto_reason: 'DUPLICATE_PAYMENT' });
    expect(await notices(w, 'receipt_review')).toHaveLength(1);
  }, 60000);

  it('sócio sem plano e sem pendência: comprovante legível vai para análise e ele recebe resposta', async () => {
    const { w, today } = await scene(undefined, { plan: false });
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today });
    expect(r).toMatchObject({ auto_approved: false, auto_reason: 'NO_CHARGES_SELECTED', status: 'submitted' });
    expect(await notices(w, 'receipt_review')).toHaveLength(1);
  }, 60000);

  it('sem nada em aberto e arquivo ilegível (foto qualquer): ignorado, sem gerar mensalidade', async () => {
    const { w, today, charges } = await scene();
    const acc = (await q<{ id: string }>(w.db, `select id from public.fin_accounts where is_default_receipts`))[0].id;
    for (const c of charges) await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${c.id}', 10000, '${addDays(today, -3)}', 'pix', '${acc}', null)`);
    const r = await receipt(w, await photo(w), { amount_cents: 10000, paid_on: today }, 'unreadable');
    expect(r).toMatchObject({ skipped: true, reason: 'NO_OPEN_CHARGES' });
    expect(await q(w.db, `select 1 from public.fin_member_charges`)).toHaveLength(charges.length);
  }, 60000);

  it('pelo app, comprovante da mensalidade escolhida também é baixado automaticamente', async () => {
    const { w, today, charges } = await scene();
    const sub = '00000000-0000-4000-9100-000000000001';
    const r = await rpc<any>(w.db, U.socioA, `public.fin_submit_receipt('${key()}', '${sub}', ${j({
      storage_path: `${U.socioA}/${sub}/comprovante.png`, file_name: 'comprovante.png', content_type: 'image/png', size_bytes: 12345,
      content_sha256: 'c'.repeat(64), charge_ids: [charges[1].id], declared_amount_cents: 10000, declared_paid_on: today,
      ocr_status: 'ok', ocr: { engine: 'tesseract', amount_cents: 10000, paid_on: today, payee: 'Sobral Tênis Clube', identifier: 'APP1',
        confidence: { amount: 'high', date: 'high', identifier: 'high', payee: 'high' } } })})`);
    expect(r).toMatchObject({ auto_approved: true, status: 'approved' });
    expect([await status(w, charges[0].id), await status(w, charges[1].id)]).toEqual(['open', 'paid']);
  }, 60000);

  it('conferência do favorecido é por palavras inteiras do nome cadastrado', async () => {
    const w = await world();
    const m = async (read: string) =>
      (await q<{ ok: boolean }>(w.db, `select fin_private.payee_matches('${read}', array['Sobral Tênis Clube']) ok`))[0].ok;
    expect(await m('SOBRAL TENIS CLUBE LTDA')).toBe(true);
    expect(await m('Sobral Tênis Clube')).toBe(true);
    expect(await m('Clube')).toBe(false);
    expect(await m('Tênis Clube')).toBe(false);
    expect(await m('SOBRAL TENIS CLUBES')).toBe(false);
  }, 60000);
});
