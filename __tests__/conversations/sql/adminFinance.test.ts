// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

async function enable(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
  await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
}

/** Conversa direta com a sessão da IA aberta. */
async function session(w: W, phone: string) {
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `F${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Pessoa', kind: 'text', body: 'oi joão' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { session: t.session_id as string, phone };
}
const pause = () => new Promise((r) => setTimeout(r, 15));
const say = async (w: W, phone: string, body: string) => {
  await pause();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}${Math.random()}`, chat_kind: 'direct', phone, kind: 'text', body })})`);
};
const propose = (w: W, s: { session: string }, p: Record<string, unknown>) =>
  svc<any>(w.db, `public.conv_svc_ai_admin_finance_propose('${s.session}', ${j(p)})`);
const confirm = (w: W, proposal: string, message: string) => svc<any>(w.db, `public.conv_svc_ai_confirm('${proposal}', '${message}')`);
const pendencies = (w: W) => q<any>(w.db, `select * from public.fin_member_charges where charge_type = 'member_pendency' order by created_at`);

async function admin(w: W) {
  await enable(w);
  return session(w, '99900000001');
}

/** Proposta + "sim" do administrador. */
async function proposeAndConfirm(w: W, s: { session: string; phone: string }, p: Record<string, unknown>) {
  const prop = await propose(w, s, p);
  expect(prop.ok).toBe(true);
  const yes = await say(w, s.phone, 'sim');
  return { prop, res: await confirm(w, prop.proposal_id, yes.message_id) };
}

describe('assessor administrativo do João (financeiro no privado)', () => {
  it('administrador lança pendência: proposta não grava; o "sim" grava pela função do app, com o admin como autor', async () => {
    const w = await world();
    const s = await admin(w);
    const prop = await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Day Card do convidado Carlos', amount_cents: 5000, pendency_kind: 'day_card', guest_name: 'Carlos' });
    expect(prop).toMatchObject({ ok: true, action: 'fin_pendency_create' });
    expect(prop.summary).toMatchObject({ member_name: expect.any(String), amount_cents: 5000, pendency_kind: 'day_card' });
    expect(await pendencies(w)).toHaveLength(0);

    const yes = await say(w, s.phone, 'sim');
    const res = await confirm(w, prop.proposal_id, yes.message_id);
    expect(res).toMatchObject({ ok: true, action: 'fin_pendency_create' });
    const rows = await pendencies(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_id: U.socioA, original_amount_cents: 5000, created_by: U.admin, guest_name: 'Carlos', status: 'open' });

    // Repetir a confirmação não cria outra pendência.
    expect((await confirm(w, prop.proposal_id, yes.message_id)).replayed).toBe(true);
    expect(await pendencies(w)).toHaveLength(1);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.ai_admin_finance'`)).length).toBe(1);
    // A identidade do admin não vaza para fora da confirmação.
    expect((await q<any>(w.db, `select nullif(current_setting('request.jwt.claim.sub', true), '') s`))[0].s).toBeNull();
  }, 60000);

  it('sócio comum não usa o assessor (recusado no banco, nada gravado)', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '99900000002');
    const r = await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioB, description: 'Consumo', amount_cents: 1000 });
    expect([r.ok, r.code]).toEqual([false, 'ADMIN_ONLY_PRIVATE']);
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
  }, 60000);

  it('confirmação vaga não grava; dado inválido vira pergunta', async () => {
    const w = await world();
    const s = await admin(w);
    expect((await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo', amount_cents: 0 })).code).toBe('INVALID_AMOUNT');
    expect((await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo', amount_cents: 100, due_date: '2026-02-30' })).code).toBe('INVALID_DATA');
    expect((await propose(w, s, { action: 'fin_pendency_create', profile_id: U.lanch, description: 'Consumo', amount_cents: 100 })).code).toBe('MEMBER_NOT_ACTIVE');
    const prop = await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 1000 });
    const talvez = await say(w, s.phone, 'talvez depois');
    expect((await confirm(w, prop.proposal_id, talvez.message_id)).code).toBe('NOT_EXPLICIT');
    expect(await pendencies(w)).toHaveLength(0);
  }, 60000);

  it('recusa do financeiro na hora do "sim" marca a proposta como falha e não grava nada', async () => {
    const w = await world();
    const s = await admin(w);
    const prop = await propose(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 1000 });
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    const yes = await say(w, s.phone, 'sim');
    const res = await confirm(w, prop.proposal_id, yes.message_id);
    expect([res.ok, res.code]).toEqual([false, 'MEMBER_NOT_ACTIVE']);
    expect(await pendencies(w)).toHaveLength(0);
    expect((await q<any>(w.db, `select status from public.conv_booking_proposals where id = '${prop.proposal_id}'`))[0].status).toBe('failed');
  }, 60000);

  it('pausar e retomar a régua; cobrar agora enfileira a mensagem consolidada', async () => {
    const w = await world();
    const s = await admin(w);
    await proposeAndConfirm(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 2500 });
    const [ch] = await pendencies(w);

    const send = await proposeAndConfirm(w, s, { action: 'fin_pendency_send', profile_id: U.socioA });
    expect(send.prop.summary).toMatchObject({ charge_id: ch.id, open_count: 1, member_total_due_cents: 2500 });
    expect(send.res.ok).toBe(true);
    expect(await q(w.db, `select 1 from public.conv_automation_recipients where profile_id = '${U.socioA}' and status = 'pending'`)).toHaveLength(1);

    const off = await proposeAndConfirm(w, s, { action: 'fin_pendency_collection', charge_id: ch.id, enabled: false });
    expect(off.res.ok).toBe(true);
    expect((await pendencies(w))[0].collection_enabled).toBe(false);
    // Pausar cancela o aviso que ainda não saiu.
    expect(await q(w.db, `select 1 from public.conv_automation_recipients where profile_id = '${U.socioA}' and status = 'pending'`)).toHaveLength(0);
    expect((await propose(w, s, { action: 'fin_pendency_collection', charge_id: ch.id, enabled: false })).code).toBe('ALREADY_SET');
    expect((await propose(w, s, { action: 'fin_pendency_send', charge_id: ch.id })).code).toBe('COLLECTION_PAUSED');
  }, 90000);

  it('baixa manual: parcial na conta padrão; data futura é recusada; quitada sai de "em aberto"', async () => {
    const w = await world();
    const s = await admin(w);
    await proposeAndConfirm(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 3000 });
    const [ch] = await pendencies(w);

    expect((await propose(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 1000, paid_on: '2999-01-01' })).code).toBe('INVALID_DATE');
    const part = await proposeAndConfirm(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 1000, method: 'pix' });
    expect(part.prop.summary).toMatchObject({ account_name: 'Banco do clube', amount_cents: 1000, excess_cents: 0 });
    expect(part.res.ok).toBe(true);
    expect((await pendencies(w))[0].status).toBe('partial');

    await proposeAndConfirm(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 2000 });
    expect((await pendencies(w))[0].status).toBe('paid');
    expect((await propose(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 10 })).code).toBe('PENDENCY_NOT_OPEN');
  }, 90000);

  it('com várias contas e nenhuma padrão, pergunta a conta; pelo nome, acha', async () => {
    const w = await world();
    const s = await admin(w);
    await w.db.exec(`update public.fin_accounts set is_default_receipts = false`);
    await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Caixa da secretaria', kind: 'cash', opening_balance_cents: 0, opening_date: '2020-01-01' })})`);
    await proposeAndConfirm(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 3000 });
    const [ch] = await pendencies(w);
    const sem = await propose(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 3000 });
    expect(sem.code).toBe('ACCOUNT_REQUIRED');
    expect(sem.message).toContain('Caixa da secretaria');
    const com = await propose(w, s, { action: 'fin_payment', charge_id: ch.id, amount_cents: 3000, account_name: 'secretaria' });
    expect(com.summary.account_name).toBe('Caixa da secretaria');
  }, 60000);
});
