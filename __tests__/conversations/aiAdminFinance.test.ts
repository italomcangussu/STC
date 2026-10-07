// @vitest-environment node
/**
 * Assessor administrativo do João, de ponta a ponta: `turn.ts` real + SQL real (PGlite). Só o modelo e o
 * WhatsApp são simulados. O modelo é roteirizado para pedir ações financeiras mesmo quando não deveria.
 */
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { adminProposalMessage, parseSlots, runTurn, toCents } from '../../supabase/functions/_shared/aiAgent/turn';
import { adminPendencyRefs, financialContextText, isAdminAssistant } from '../../supabase/functions/_shared/aiAgent/prompts';
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
const direct = async (w: W, body: string, phone = '5599900000001') => {
  await tick();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `D${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'X', kind: 'text', body })})`);
};
const turn = (w: W, messageId: string, chat: Chat, uaz: UazCaller) => runTurn(messageId, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });
const pendencies = (w: W) => q<any>(w.db, `select * from public.fin_member_charges where charge_type = 'member_pendency' order by created_at`);

describe('assessor administrativo do João (turno completo)', () => {
  it('admin no privado: pedido → resumo (nada gravado) → "sim" → pendência lançada; depois baixa pela referência p1', async () => {
    const w = await setup();
    const p = provider();
    const lancar = { fin_action: 'lancar', member_name: 'Beto', description: 'Day Card do convidado Carlos', amount: 50, pendency_kind: 'day_card', guest_name: 'Carlos' };

    const m1 = await direct(w, 'lança 50 de day card pro Beto, convidado Carlos');
    const s1 = script(answer({ ready: true, slots: lancar }));
    const r1 = await turn(w, m1.message_id, s1.chat, p.uaz);
    expect(r1.action).toBe('proposed_admin');
    expect(s1.calls[0].system).toContain('ASSESSOR ADMINISTRATIVO');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou lançar para Beto Sócio: Day Card do convidado Carlos \(convidado Carlos\), R\$ 50,00, vencimento .*Confirma\? Responda "sim"\.$/);
    expect(await pendencies(w)).toHaveLength(0);

    const m2 = await direct(w, 'sim');
    const r2 = await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: lancar })).chat, p.uaz);
    expect(r2.action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toBe('Pronto: pendência lançada para Beto Sócio, Day Card do convidado Carlos, R$ 50,00.');
    const [ch] = await pendencies(w);
    expect(ch).toMatchObject({ profile_id: U.socioB, original_amount_cents: 5000, created_by: U.admin, pendency_kind: 'day_card' });

    // O admin vê a pendência numerada e dá baixa por ela.
    const m3 = await direct(w, 'o Beto pagou 20 no pix');
    const s3 = script(answer({ ready: true, slots: { fin_action: 'baixa', pendency_ref: 'p1', amount: 20, method: 'pix' } }));
    await turn(w, m3.message_id, s3.chat, p.uaz);
    expect(s3.calls[0].user).toMatch(/- p1 \| Beto Sócio \| Day Card do convidado Carlos/);
    expect(p.sent.at(-1)!.text).toMatch(/^Vou dar baixa de R\$ 20,00 para Beto Sócio: .* via PIX, conta Banco do clube\. Confirma/);
    const m4 = await direct(w, 'pode');
    await turn(w, m4.message_id, script(answer({ customer_confirmed: true })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toBe('Pronto: baixa de R$ 20,00 registrada para Beto Sócio. Ficou parcial; o restante continua em aberto.');
    expect((await pendencies(w))[0].status).toBe('partial');
  }, 90000);

  it('sócio comum: mesmo com o modelo pedindo a ação, nada é proposto nem gravado; não vê pendência de outro', async () => {
    const w = await setup();
    await rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: 'Consumo do Beto', amount_cents: 1500, competence_month: '2026-10-01', due_date: '2026-10-07' })})`);
    const p = provider();
    const m = await direct(w, 'lança 50 pro Beto', '5599900000002');
    const s = script(answer({ ready: true, slots: { fin_action: 'lancar', member_name: 'Beto', description: 'Consumo', amount: 50 } }));
    const r = await turn(w, m.message_id, s.chat, p.uaz);
    expect(r.action).toBe('ask');
    expect(p.sent.at(-1)!.text).toMatch(/só com a diretoria/);
    expect(s.calls[0].system).not.toContain('ASSESSOR ADMINISTRATIVO');
    expect(s.calls[0].user).not.toContain('Consumo do Beto');
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
    expect(await pendencies(w)).toHaveLength(1);
  }, 60000);

  it('admin no grupo: não vira assessor (sem seção, sem ação)', async () => {
    const w = await setup({ group: true });
    const p = provider();
    const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}`, chat_kind: 'group', group_jid: GROUP, phone: '5599900000001', name: 'Admin', kind: 'text', body: '@5599900000099 lança 50 pro Beto', mentions: ['5599900000099'] })})`);
    const s = script(answer({ ready: true, slots: { fin_action: 'lancar', member_name: 'Beto', description: 'Consumo', amount: 50 } }));
    const r = await turn(w, m.message_id, s.chat, p.uaz);
    if (s.calls.length) expect(s.calls[0].system).not.toContain('ASSESSOR ADMINISTRATIVO');
    expect(r.action).not.toBe('proposed_admin');
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
  }, 60000);
});

describe('assessor: peças puras', () => {
  const admin = { is_group: false, requester: { profile: { id: 'A', name: 'Admin', is_admin: true } } };
  const pend = (id: string, member: string, status = 'open') => ({ id, member_id: member, member_name: member, description: `d${id}`, status, due_date: '2026-10-01', total_due_cents: 100 });

  it('só administrador em conversa direta é assessor', () => {
    expect(isAdminAssistant(admin)).toBe(true);
    expect(isAdminAssistant({ ...admin, is_group: true })).toBe(false);
    expect(isAdminAssistant({ is_group: false, requester: { profile: { is_admin: false } } })).toBe(false);
    expect(isAdminAssistant({ is_group: false, requester: {} })).toBe(false);
  });

  it('referências só para pendências em aberto, na ordem do banco', () => {
    const ctx = { ...admin, financial_context: { member_pendencies: [pend('1', 'X'), pend('2', 'Y', 'paid'), pend('3', 'Z', 'partial')] } };
    expect(adminPendencyRefs(ctx).map((r) => [r.ref, r.id])).toEqual([['p1', '1'], ['p2', '3']]);
  });

  it('sócio comum só vê as próprias pendências (pelo id, não pelo nome)', () => {
    const ctx = { is_group: false, requester: { profile: { id: 'X', name: 'Homônimo' } },
      financial_context: { member_pendencies: [pend('1', 'X'), { ...pend('2', 'Y'), member_name: 'Homônimo' }] } };
    const t = financialContextText(ctx);
    expect(t).toContain('d1');
    expect(t).not.toContain('d2');
  });

  it('valor em reais vira centavos; lixo vira nulo', () => {
    expect(toCents(37.5)).toBe(3750);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(0)).toBeNull();
    expect(toCents(-5)).toBeNull();
    expect(parseSlots({ amount: '1.234,50' }).amount).toBe(1234.5);
    expect(parseSlots({ amount: 'abc' }).amount).toBeNull();
    expect(parseSlots({ fin_action: 'apagar_tudo' }).fin_action).toBeNull();
    expect(parseSlots({ method: 'credit' }).method).toBeNull();
  });

  it('resumo da baixa avisa quando sobra crédito', () => {
    const t = adminProposalMessage('fin_payment', { member_name: 'Beto', description: 'Consumo', total_due_cents: 1000, amount_cents: 1500, paid_on: '2026-10-07', method: 'cash', account_name: 'Caixa', excess_cents: 500 });
    expect(t).toContain('via dinheiro');
    expect(t).toContain('R$ 5,00 viram crédito');
  });
});
