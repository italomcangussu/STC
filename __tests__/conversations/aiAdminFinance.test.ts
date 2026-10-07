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

  it('R$ 400 ou mais: o "sim" não basta; só grava depois de repetir o valor (regra no banco)', async () => {
    const w = await setup();
    const p = provider();
    const lancar = { fin_action: 'lancar', member_name: 'Beto', description: 'Evento fechado', amount: 450 };
    const m1 = await direct(w, 'lança 450 de evento pro Beto');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: lancar })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('R$ 450,00');

    const confirmar = async (texto: string) => {
      const m = await direct(w, texto);
      return turn(w, m.message_id, script(answer({ customer_confirmed: true, slots: lancar })).chat, p.uaz);
    };
    expect((await confirmar('sim')).action).toBe('failed:CONFIRM_AMOUNT');
    expect(p.sent.at(-1)!.text).toContain('confirmo R$ 450,00');
    expect(await pendencies(w)).toHaveLength(0);

    expect((await confirmar('sim')).action).toBe('failed:CONFIRM_AMOUNT');          // outro "sim" não vale
    expect((await confirmar('confirmo 45')).action).toBe('failed:CONFIRM_AMOUNT');   // valor errado não vale
    expect(await pendencies(w)).toHaveLength(0);

    expect((await confirmar('confirmo R$ 450,00')).action).toBe('admin_confirmed');
    const [ch] = await pendencies(w);
    expect(ch).toMatchObject({ profile_id: U.socioB, original_amount_cents: 45000 });
  }, 90000);

  it('abaixo de R$ 400 segue com um "sim" só', async () => {
    const w = await setup();
    const p = provider();
    const lancar = { fin_action: 'lancar', member_name: 'Beto', description: 'Consumo', amount: 399.99 };
    const m1 = await direct(w, 'lança 399,99 pro Beto');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: lancar })).chat, p.uaz);
    const m2 = await direct(w, 'sim');
    expect((await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: lancar })).chat, p.uaz)).action).toBe('admin_confirmed');
  }, 90000);

  it('N3 (apagar, zerar ranking…): o servidor recusa e indica o painel, sem chamar o modelo', async () => {
    const w = await setup();
    const p = provider();
    const s = script();
    const m = await direct(w, 'apaga a pendência do Beto');
    const r = await turn(w, m.message_id, s.chat, p.uaz);
    expect(r.action).toBe('admin_n3_refused');
    expect(s.calls).toHaveLength(0);
    expect(p.sent.at(-1)!.text).toMatch(/painel administrativo/);
  }, 90000);

  it('consulta: caixa, a receber/pagar e reservas do dia saem do banco, escritas pelo servidor (modelo não escreve números)', async () => {
    const w = await setup();
    await rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: 'Consumo do Beto', amount_cents: 15000, competence_month: '2026-10-01', due_date: '2026-10-01' })})`);
    const p = provider();
    for (const [domain, esperado] of [['receber_pagar', /^A receber: R\$ 1\d\d,\d\d em aberto[\s\S]*\nA pagar: /], ['caixa', /Caixa de \d\d\/\d\d\/\d{4} a \d\d\/\d\d\/\d{4}:/], ['ocupacao', /^(Reservas de|Sem reservas em) \d\d\/\d\d\/\d{4}/]] as const) {
      const m = await direct(w, `me mostra ${domain}`);
      const r = await turn(w, m.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: domain } })).chat, p.uaz);
      expect(r.action, domain).toBe(`admin_read:${domain}`);
      expect(p.sent.at(-1)!.text, domain).toMatch(esperado);
    }
  }, 90000);

  it('consulta sem domínio pergunta o que ver; período inválido é recusado pelo banco', async () => {
    const w = await setup();
    const p = provider();
    const m1 = await direct(w, 'quero ver uns números');
    const r1 = await turn(w, m1.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: {} })).chat, p.uaz);
    expect(r1.action).toBe('ask');
    expect(p.sent.at(-1)!.text).toMatch(/O que você quer ver/);
    const m2 = await direct(w, 'caixa de 2020 a 2026');
    await turn(w, m2.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: 'caixa', read_from: '2020-01-01', read_to: '2026-10-07' } })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toMatch(/período não vale/);
  }, 90000);

  it('saldo do clube entra no prompt do administrador (e só dele)', async () => {
    const w = await setup();
    const p = provider();
    const s = script(answer({ intent: 'consultar', messages: ['O saldo é R$ 0,00.'] }));
    const m = await direct(w, 'qual o saldo do clube?');
    await turn(w, m.message_id, s.chat, p.uaz);
    expect(s.calls[0].user).toContain('SALDO DAS CONTAS DO CLUBE');
    expect(s.calls[0].user).toContain('Banco do clube');
  }, 90000);

  describe('onda 2: financeiro completo', () => {
    const pend = (w: W, cents = 15000, desc = 'Consumo do Beto') => rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: desc, amount_cents: cents, competence_month: '2026-10-01', due_date: '2026-10-07' })})`);
    const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
      const m = await direct(w, texto);
      return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
    };
    const confirmar = (w: W, p: ReturnType<typeof provider>, texto = 'sim') => dizer(w, p, texto, { customer_confirmed: true });
    const charge = async (w: W) => (await pendencies(w))[0];

    it('cancelar pendência: exige motivo, resume, e só cancela depois do "sim"', async () => {
      const w = await setup(); const p = provider(); await pend(w);
      const r0 = await dizer(w, p, 'cancela a pendência p1', { ready: true, slots: { fin_action: 'cancelar_pendencia', pendency_ref: 'p1' } });
      expect(r0.action).toBe('ask'); expect(p.sent.at(-1)!.text).toMatch(/motivo/i);
      const r1 = await dizer(w, p, 'foi lançada errada', { ready: true, slots: { fin_action: 'cancelar_pendencia', pendency_ref: 'p1', reason: 'lançada errada' } });
      expect(r1.action).toBe('proposed_admin');
      expect(p.sent.at(-1)!.text).toMatch(/^Vou cancelar a pendência de Beto Sócio: Consumo do Beto \(saldo R\$ 150,00\)\. Motivo: lançada errada\. Confirma/);
      expect((await charge(w)).status).toBe('open');
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      expect(await charge(w)).toMatchObject({ status: 'canceled', cancel_reason: 'lançada errada' });
    }, 90000);

    it('ajustar: desconto reduz o saldo; desconto maior que o saldo é recusado no banco', async () => {
      const w = await setup(); const p = provider(); await pend(w);
      const ajuste = (amount: number) => ({ ready: true, slots: { fin_action: 'ajustar', pendency_ref: 'p1', adjust_kind: 'discount', amount, reason: 'combinado com a diretoria' } });
      await dizer(w, p, 'dá 200 de desconto', ajuste(200));
      expect(p.sent.at(-1)!.text).toMatch(/passa do valor em aberto/);
      await dizer(w, p, 'dá 50 de desconto', ajuste(50));
      expect(p.sent.at(-1)!.text).toMatch(/^Vou aplicar desconto de R\$ 50,00 na pendência de Beto Sócio/);
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      const [adj] = await q<any>(w.db, `select kind, amount_cents, reason, actor_id from public.fin_charge_adjustments`);
      expect(adj).toMatchObject({ kind: 'discount', amount_cents: 5000, actor_id: U.admin });
      expect((await charge(w)).status).toBe('open');
    }, 90000);

    it('estornar o último pagamento do sócio: pendência volta a ficar em aberto', async () => {
      const w = await setup(); const p = provider(); await pend(w);
      const [acc] = await q<{ id: string }>(w.db, `select id from public.fin_accounts limit 1`);
      await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${(await charge(w)).id}', 15000, '2026-10-06', 'pix', '${acc.id}', 'teste')`);
      expect((await charge(w)).status).toBe('paid');
      const r = await dizer(w, p, 'estorna o pagamento do Beto', { ready: true, slots: { fin_action: 'estornar', member_name: 'Beto', reason: 'pix voltou' } });
      expect(r.action).toBe('proposed_admin');
      expect(p.sent.at(-1)!.text).toMatch(/^Vou estornar o pagamento de R\$ 150,00 de Beto Sócio \(Consumo do Beto\), feito em 06\/10\/2026/);
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      expect((await charge(w)).status).toBe('open');
    }, 90000);

    it('rejeitar comprovante: pelo sócio, com motivo; ambíguo pede o dia', async () => {
      const w = await setup(); const p = provider();
      const sub = (n: number) => q(w.db, `insert into public.fin_receipt_submissions(profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256, declared_amount_cents, ocr_status, request_id)
        values ('${U.socioB}', 'submitted', 'x/${n}/c.jpg', 'c.jpg', 'image/jpeg', 100, '${'b'.repeat(63)}${n}', 8000, 'not_run', gen_random_uuid())`);
      await sub(1);
      const r = await dizer(w, p, 'recusa o comprovante do Beto, ilegível', { ready: true, slots: { fin_action: 'rejeitar_comprovante', member_name: 'Beto', reason: 'imagem ilegível' } });
      expect(r.action).toBe('proposed_admin');
      expect(p.sent.at(-1)!.text).toMatch(/^Vou recusar o comprovante de Beto Sócio, enviado em \d\d\/\d\d\/\d{4} \(R\$ 80,00\)\. Motivo: imagem ilegível/);
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      expect((await q<any>(w.db, `select status, decision_reason from public.fin_receipt_submissions`))[0]).toMatchObject({ status: 'rejected', decision_reason: 'imagem ilegível' });
      await sub(2); await sub(3);
      await dizer(w, p, 'recusa o do Beto', { ready: true, slots: { fin_action: 'rejeitar_comprovante', member_name: 'Beto', reason: 'sem valor visível' } });
      expect(p.sent.at(-1)!.text).toMatch(/2 comprovantes pendentes/);
    }, 90000);

    it('despesa e receita: categoria e conta pelo nome; sem categoria o banco lista as opções', async () => {
      const w = await setup(); const p = provider();
      const d = (o: Record<string, unknown> = {}) => ({ ready: true, slots: { fin_action: 'despesa', description: 'Conta de luz', amount: 300, ...o } });
      await dizer(w, p, 'lança conta de luz de 300', d());
      expect(p.sent.at(-1)!.text).toMatch(/Em qual categoria\?.*Energia/);
      const r = await dizer(w, p, 'categoria energia', d({ category_name: 'energia' }));
      expect(r.action).toBe('proposed_admin');
      expect(p.sent.at(-1)!.text).toMatch(/^Vou lançar a despesa: Conta de luz, R\$ 300,00, categoria Energia, conta Banco do clube, paga em \d\d\/\d\d\/\d{4}\. Confirma/);
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      expect((await q<any>(w.db, `select kind, status, amount_cents from public.fin_entries`))[0]).toMatchObject({ kind: 'expense', amount_cents: 30000 });
      await dizer(w, p, 'lança receita de 80 de aluguel de quadra', { ready: true, slots: { fin_action: 'receita', description: 'Aluguel de quadra', amount: 80, category_name: 'zzzz inexistente' } });
      expect(p.sent.at(-1)!.text).toMatch(/Em qual categoria\?/);
    }, 90000);

    it('valor alto continua exigindo o segundo passo também nas ações novas (despesa de R$ 500)', async () => {
      const w = await setup(); const p = provider();
      await dizer(w, p, 'lança despesa de 500', { ready: true, slots: { fin_action: 'despesa', description: 'Manutenção da quadra', amount: 500, category_name: 'energia' } });
      expect((await confirmar(w, p)).action).toBe('failed:CONFIRM_AMOUNT');
      expect(await q(w.db, `select 1 from public.fin_entries`)).toHaveLength(0);
      expect((await confirmar(w, p, 'confirmo R$ 500,00')).action).toBe('admin_confirmed');
      expect(await q(w.db, `select 1 from public.fin_entries`)).toHaveLength(1);
    }, 90000);
  });

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

  it('saldo das contas do clube só aparece para o administrador no privado', () => {
    const club_balances = { total_cents: 123450, accounts: [{ name: 'Banco do clube', kind: 'bank', balance_cents: 123450 }] };
    const ver = financialContextText({ ...admin, club_balances, financial_context: {} });
    expect(ver).toContain('Banco do clube (bank): R$ 1234,50');
    expect(ver).toContain('TOTAL: R$ 1234,50');
    const socio = financialContextText({ is_group: false, requester: { profile: { id: 'X', is_admin: false } }, club_balances, financial_context: {} });
    expect(socio).not.toContain('SALDO DAS CONTAS');
    const grupo = financialContextText({ ...admin, is_group: true, club_balances, financial_context: {} });
    expect(grupo).not.toContain('SALDO DAS CONTAS');
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
