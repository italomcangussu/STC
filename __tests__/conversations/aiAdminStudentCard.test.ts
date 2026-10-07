// @vitest-environment node
/**
 * Assessor administrativo do João, de ponta a ponta: `turn.ts` real + SQL real (PGlite). Só o modelo e o
 * WhatsApp são simulados. O modelo é roteirizado para pedir ações financeiras mesmo quando não deveria.
 */
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { runTurn } from '../../supabase/functions/_shared/aiAgent/turn';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type W = Awaited<ReturnType<typeof world>>;
const GROUP = 'adm-group@g.us';
let n = 0;

const answer = (o: Record<string, unknown> = {}) => JSON.stringify({
  messages: [], intent: 'admin_financeiro', ready: false, customer_confirmed: false, declined: false, awaiting: false,
  transfer: false, handoff_kind: null, handoff_note: null, close: false, ...o, slots: { ...((o.slots as object) ?? {}) },
});
const script = (...outs: string[]) => {
  const calls: { system: string; user: string }[] = [];
  const chat: Chat = async (messages) => {
    calls.push({ system: messages[0].content, user: messages[1].content });
    const out = outs.shift();
    if (out === undefined) throw new Error('modelo chamado além do roteiro');
    return { output: out, model: 'teste', usage: null };
  };
  return { chat, calls };
};
const provider = () => {
  const sent: { number: string; text: string }[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') { sent.push({ number: String(body.number), text: String(body.text) }); return { ok: true, body: { messageid: `OUT${++n}` } }; }
    return { ok: true, body: {} };
  };
  return { uaz, sent };
};

async function setup(opts: { group?: boolean } = {}) {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5599900000099', ai_direct_enabled: true })})`);
  await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
  if (opts.group) {
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `SEED${++n}`, chat_kind: 'group', group_jid: GROUP, group_name: 'Sócios', phone: '5599900000002', name: 'Ana', body: 'oi' })})`);
    const [g] = await q<{ id: string }>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(true)`);
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(true, true)`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', true)`);
  }
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 15));
const direct = async (w: W, body: string | null, phone = '5599900000001', kind = 'text') => {
  await tick();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `D${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'X', kind, body })})`);
};
const turn = (w: W, messageId: string, chat: Chat, uaz: UazCaller) => runTurn(messageId, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });
const payments = (w: W) => q<any>(w.db, `select * from public.student_payments order by created_at`);
const erick = async (w: W, extra = '') => {
  const [r] = await q<{ id: string }>(w.db, `insert into public.non_socio_students(name, plan_type, plan_status, master_expiration_date) values ('Erick Souza', 'Card Mensal', 'active', '2026-09-20') returning id`);
  void extra;
  return r.id;
};
const receipt = async (w: W, messageId: string, o: { amount?: number; paid_on?: string; payee?: string | null; ident?: string; ocr_status?: string } = {}) => {
  await q(w.db, `update public.fin_settings set payee_names = array['Sobral Tenis Clube'] where id`);
  const ocr = { engine: 'tesseract-server', amount_cents: o.amount ?? 20000, paid_on: o.paid_on ?? '2026-10-07', identifier: o.ident ?? 'E18236120202610071911s058335b68b', payee: o.payee === undefined ? 'Sobral Tenis Clube' : o.payee };
  const [r] = await q<{ id: string }>(w.db, `insert into public.fin_receipt_submissions(profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256, declared_amount_cents, declared_paid_on, ocr_status, ocr, request_id, source, source_message_id)
    values ('${U.admin}', 'in_review', 'x/${++n}/c.jpg', 'c.jpg', 'image/jpeg', 100, '${'a'.repeat(63)}${n % 10}', ${ocr.amount_cents}, '${ocr.paid_on}', '${o.ocr_status ?? 'ok'}', '${JSON.stringify(ocr)}'::jsonb, gen_random_uuid(), 'whatsapp', '${messageId}') returning id`);
  return r.id;
};
const renovar = { fin_action: 'renovar_card', student_names: ['Erick'] };

describe('renovar o Card Mensal de aluno pelo João (turno completo)', () => {
  it('lê o comprovante, propõe com o resumo e só grava no "sim"; o comprovante fecha', async () => {
    const w = await setup();
    const p = provider();
    const id = await erick(w);
    const mImg = await direct(w, null, '5599900000001', 'image');
    const sub = await receipt(w, mImg.message_id);
    const m1 = await direct(w, 'o nome dele é Erick, paga 200 pra quadra rápida');
    const r1 = await turn(w, m1.message_id, script(answer({ ready: true, slots: renovar })).chat, p.uaz);
    expect(r1.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou renovar o Card Mensal de Erick Souza \(hoje vale até 20\/09\/2026\): R\$ 200,00 pagos em 07\/10\/2026 via PIX, nova validade 07\/11\/2026\. Comprovante lido: R\$ 200,00 em 07\/10\/2026, para Sobral Tenis Clube\. Confirma\? Responda "sim"\.$/);
    expect(await payments(w)).toHaveLength(0);

    const m2 = await direct(w, 'sim');
    const r2 = await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: renovar })).chat, p.uaz);
    expect(r2.action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toBe('Pronto: Card Mensal de Erick Souza renovado até 07/11/2026 (R$ 200,00). Comprovante arquivado.');
    const [pay] = await payments(w);
    expect(pay).toMatchObject({ student_id: id, status: 'active', approved_by: U.admin });
    expect(Number(pay.amount)).toBe(200);
    const [st] = await q<any>(w.db, `select plan_status, master_expiration_date::text d from public.non_socio_students where id = '${id}'`);
    expect(st).toMatchObject({ plan_status: 'active', d: '2026-11-07' });
    expect((await q<any>(w.db, `select status, reviewed_by from public.fin_receipt_submissions where id = '${sub}'`))[0]).toMatchObject({ status: 'approved', reviewed_by: U.admin });

    // Confirmar de novo não duplica.
    const m3 = await direct(w, 'sim');
    await turn(w, m3.message_id, script(answer({ customer_confirmed: true, slots: renovar })).chat, p.uaz);
    expect(await payments(w)).toHaveLength(1);
  }, 90000);

  it('sem comprovante: propõe o padrão de R$ 200 e avisa que não há comprovante; mesmo dia e valor não duplica', async () => {
    const w = await setup();
    const p = provider();
    await erick(w);
    const m1 = await direct(w, 'renova o card do Erick');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: renovar })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('R$ 200,00');
    expect(p.sent.at(-1)!.text).toContain('Sem comprovante nesta conversa.');
    const m2 = await direct(w, 'sim');
    await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: renovar })).chat, p.uaz);
    expect(await payments(w)).toHaveLength(1);

    const m3 = await direct(w, 'renova de novo o card do Erick');
    const r3 = await turn(w, m3.message_id, script(answer({ ready: true, slots: renovar })).chat, p.uaz);
    expect(r3.action).toBe('ask');
    expect(p.sent.at(-1)!.text).toMatch(/já tem um pagamento de R\$ 200,00/);
    expect(await payments(w)).toHaveLength(1);
  }, 90000);

  it('comprovante para outra pessoa, repetido ou de aluno que não é Card Mensal: recusa', async () => {
    const w = await setup();
    const p = provider();
    await erick(w);
    const mImg = await direct(w, null, '5599900000001', 'image');
    await receipt(w, mImg.message_id, { payee: 'Padaria Central' });
    const m1 = await direct(w, 'renova o Erick');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: renovar })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('não é o clube');
    expect(await payments(w)).toHaveLength(0);

    await q(w.db, `insert into public.non_socio_students(name, plan_type, plan_status) values ('Diana Lima', 'Day Card', 'active')`);
    const m2 = await direct(w, 'renova a Diana');
    await turn(w, m2.message_id, script(answer({ ready: true, slots: { fin_action: 'renovar_card', student_names: ['Diana'] } })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('não no Card Mensal');
  }, 90000);

  it('valor a partir de R$ 400 não é registrado por aqui', async () => {
    const w = await setup();
    const p = provider();
    await erick(w);
    const m1 = await direct(w, 'renova o Erick, 450');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: { ...renovar, amount: 450 } })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('pelo painel');
    expect(await payments(w)).toHaveLength(0);
  }, 90000);

  it('administrador manda só o comprovante: o João responde com o que leu, sem chamar o modelo nem a equipe', async () => {
    const w = await setup();
    const p = provider();
    const mImg = await direct(w, null, '5599900000001', 'image');
    await receipt(w, mImg.message_id);
    const calls = script();
    const r = await turn(w, mImg.message_id, calls.chat, p.uaz);
    expect([r.status, r.handoff, r.action]).toEqual(['replied', null, 'admin_receipt_received']);
    expect(calls.calls.length).toBe(0);
    expect(p.sent.at(-1)!.text).toBe('Recebi o comprovante (R$ 200,00, de 07/10/2026, para Sobral Tenis Clube). É para renovar o Card de qual aluno? Se for outra coisa, me diz o que é.');
    expect((await q<any>(w.db, `select handoff_kind from public.conv_conversations`))[0].handoff_kind).toBeNull();
  }, 90000);
});
