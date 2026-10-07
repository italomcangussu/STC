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


const recipients = (w: W) => q<any>(w.db, `select id, status from public.conv_automation_recipients where profile_id = '${U.socioA}' order by created_at`);

describe('cobrança de pendência: nunca em duplicidade', () => {
  it('pedir "cobrar agora" de novo não cria outra execução: devolve a que já existe', async () => {
    const w = await world();
    const s = await admin(w);
    await proposeAndConfirm(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Day Card do convidado', amount_cents: 5000 });
    const [ch] = await pendencies(w);

    const first = await proposeAndConfirm(w, s, { action: 'fin_pendency_send', charge_id: ch.id });
    expect(first.res.ok).toBe(true);
    expect(first.res.summary.result.already).toBeUndefined();
    expect(await recipients(w)).toHaveLength(1);

    const again = await proposeAndConfirm(w, s, { action: 'fin_pendency_send', charge_id: ch.id });
    expect(again.res.ok).toBe(true);
    expect(again.res.summary.result).toMatchObject({ already: 'pending', automation_recipient_id: (await recipients(w))[0].id });
    expect(await recipients(w)).toHaveLength(1);
    expect((await q<any>(w.db, `select count(*)::int n from public.conv_automation_runs where kind = 'manual'`))[0].n).toBe(1);
  }, 90000);

  it('depois de enviada, segura por 30 minutos e libera de novo depois disso', async () => {
    const w = await world();
    const s = await admin(w);
    await proposeAndConfirm(w, s, { action: 'fin_pendency_create', profile_id: U.socioA, description: 'Consumo do bar', amount_cents: 2500, send_now: true });
    const [ch] = await pendencies(w);
    expect(await recipients(w)).toHaveLength(1);                       // "lançar e cobrar já" também conta

    await w.db.exec(`update public.conv_automation_recipients set status = 'sent', sent_at = now() where profile_id = '${U.socioA}'`);
    const blocked = await proposeAndConfirm(w, s, { action: 'fin_pendency_send', charge_id: ch.id });
    expect(blocked.res.summary.result.already).toBe('sent');
    expect(blocked.res.summary.result.already_hhmm).toMatch(/^\d{2}:\d{2}$/);
    expect(await recipients(w)).toHaveLength(1);

    await w.db.exec(`update public.conv_automation_recipients set sent_at = now() - interval '2 hours' where profile_id = '${U.socioA}'`);
    const allowed = await proposeAndConfirm(w, s, { action: 'fin_pendency_send', charge_id: ch.id });
    expect(allowed.res.summary.result.already).toBeUndefined();
    expect(await recipients(w)).toHaveLength(2);
  }, 90000);
});
