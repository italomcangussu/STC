// @vitest-environment node
/**
 * Assessor administrativo do João, de ponta a ponta: `turn.ts` real + SQL real (PGlite). Só o modelo e o
 * WhatsApp são simulados. O modelo é roteirizado para pedir ações financeiras mesmo quando não deveria.
 */
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { adminProposalMessage, parseSlots, runTurn, toCents } from '../../supabase/functions/_shared/aiAgent/turn';
import { adminPendencyRefs, financialContextText, isAdminAssistant } from '../../supabase/functions/_shared/aiAgent/prompts';
import { dispatchFollowups } from '../../supabase/functions/_shared/dispatch';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';
import { composeWelcome } from '../../supabase/functions/_shared/aiAgent/welcome';
import type { Provision } from '../../supabase/functions/_shared/athleteProvision';

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

  it('valor alto (R$ 450) também grava com um "sim" só, sem segundo passo', async () => {
    const w = await setup();
    const p = provider();
    const lancar = { fin_action: 'lancar', member_name: 'Beto', description: 'Evento fechado', amount: 450 };
    const m1 = await direct(w, 'lança 450 de evento pro Beto');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: lancar })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toContain('R$ 450,00');
    const m2 = await direct(w, 'sim');
    expect((await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: lancar })).chat, p.uaz)).action).toBe('admin_confirmed');
    const [ch] = await pendencies(w);
    expect(ch).toMatchObject({ profile_id: U.socioB, original_amount_cents: 45000 });
  }, 90000);

  it('abaixo de R$ 400 também segue com um "sim" só', async () => {
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

    it('valor alto não pede segundo passo nas ações novas (despesa de R$ 500)', async () => {
      const w = await setup(); const p = provider();
      await dizer(w, p, 'lança despesa de 500', { ready: true, slots: { fin_action: 'despesa', description: 'Manutenção da quadra', amount: 500, category_name: 'energia' } });
      expect((await confirmar(w, p)).action).toBe('admin_confirmed');
      expect(await q(w.db, `select 1 from public.fin_entries`)).toHaveLength(1);
    }, 90000);
  });

  describe('onda 3: ações administrativas (N1)', () => {
    const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
      const m = await direct(w, texto);
      return turn(w, m.message_id, script(answer({ intent: 'admin_acao', ...o })).chat, p.uaz);
    };
    const sim = async (w: W, p: ReturnType<typeof provider>) => {
      const m = await direct(w, 'sim');
      return turn(w, m.message_id, script(answer({ intent: 'admin_acao', customer_confirmed: true })).chat, p.uaz);
    };
    const acao = (adm_action: string, extra: Record<string, unknown> = {}) => ({ ready: true, slots: { adm_action, ...extra } });

    it('aviso: pede o que falta, mostra o texto inteiro e só publica depois do "sim"; depois tira do ar', async () => {
      const w = await setup(); const p = provider();
      await w.db.exec(`create table if not exists public.announcements(id uuid primary key default gen_random_uuid(), title text not null, message text not null, image_url text,
        is_active boolean default true, show_once boolean default false, created_at timestamptz default now(), expires_at timestamptz, updated_at timestamptz default now())`);
      expect((await dizer(w, p, 'publica um aviso', acao('aviso'))).action).toBe('ask');
      await dizer(w, p, 'aviso: quadra fechada sábado', acao('aviso', { ann_title: 'Quadra fechada', ann_message: 'A quadra rápida fica fechada sábado para manutenção.' }));
      expect(p.sent.at(-1)!.text).toMatch(/«Quadra fechada»\nA quadra rápida fica fechada sábado para manutenção\.\nSem data para sair\. Confirma/);
      expect(await q(w.db, `select 1 from public.announcements`)).toHaveLength(0);
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect((await q<any>(w.db, `select title, is_active from public.announcements`))[0]).toEqual({ title: 'Quadra fechada', is_active: true });
      await dizer(w, p, 'tira o aviso da quadra do ar', acao('aviso_desativar', { ann_title: 'quadra fechada' }));
      expect(p.sent.at(-1)!.text).toMatch(/Vou tirar do ar o aviso «Quadra fechada»/);
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect((await q<any>(w.db, `select is_active from public.announcements`))[0].is_active).toBe(false);
    }, 90000);

    it('sócio: inativa e reativa (acha inativo pelo nome); administrador é protegido; já no estado pedido é recusado', async () => {
      const w = await setup(); const p = provider();
      const ativo = async () => (await q<any>(w.db, `select is_active from public.profiles where id = '${U.socioB}'`))[0].is_active;
      expect(await ativo()).toBe(true);
      await dizer(w, p, 'inativa o Beto', acao('socio_status', { member_name: 'Beto', active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/^Vou inativar o sócio Beto Sócio\./);
      expect(await ativo()).toBe(true);
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect(await ativo()).toBe(false);
      await dizer(w, p, 'inativa o Beto de novo', acao('socio_status', { member_name: 'Beto', active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/já está inativo/);
      await dizer(w, p, 'reativa o Beto', acao('socio_status', { member_name: 'Beto', active: true }));
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect(await ativo()).toBe(true);
      await dizer(w, p, 'inativa o administrador', acao('socio_status', { member_name: 'Admin Clube', active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/Administrador não é alterado por aqui/);
      expect((await q<any>(w.db, `select is_active from public.profiles where id = '${U.admin}'`))[0].is_active).toBe(true);
    }, 90000);

    it('aluno: pausa e reativa pelo nome', async () => {
      const w = await setup(); const p = provider();
      const [ns] = await q<{ id: string }>(w.db, `insert into public.non_socio_students(name, plan_type, plan_status) values ('Diana Lima', 'Day Card', 'active') returning id`);
      if (!(await q(w.db, `select 1 from public.student_profiles where non_socio_student_id = '${ns.id}'`)).length)
        await q(w.db, `insert into public.student_profiles(non_socio_student_id, student_status) values ('${ns.id}', 'active')`);
      const st = async () => (await q<any>(w.db, `select student_status from public.student_profiles`))[0].student_status;
      await dizer(w, p, 'pausa a Diana', acao('aluno_status', { student_names: ['Diana'], active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/^Vou pausar o aluno Diana Lima\./);
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect(await st()).toBe('paused');
      await dizer(w, p, 'pausa a Diana', acao('aluno_status', { student_names: ['Diana'], active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/já está pausado/);
      await dizer(w, p, 'pausa a Zuleide', acao('aluno_status', { student_names: ['Zuleide'], active: false }));
      expect(p.sent.at(-1)!.text).toMatch(/Não achei esse aluno/);
    }, 90000);

    it('reserva: cancela pelo dia e horário; ambígua pede a quadra; inexistente é recusada', async () => {
      const w = await setup(); const p = provider();
      const date = '2026-10-20';
      await w.db.exec(`insert into public.reservations(court_id, creator_id, date, start_time, end_time, type, participant_ids) values
        ('${w.court1}', '${U.socioB}', '${date}', '19:00', '20:00', 'Play', '{}'), ('${w.court2}', '${U.socioB}', '${date}', '19:00', '20:00', 'Play', '{}')`);
      await dizer(w, p, 'cancela a das 19h', acao('reserva_cancelar', { date, start: '19:00' }));
      expect(p.sent.at(-1)!.text).toMatch(/Há 2 reservas nesse horário/);
      await dizer(w, p, 'cancela a das 19h do saibro', acao('reserva_cancelar', { date, start: '19:00', court_label: 'quadra 1', reason: 'chuva' }));
      expect(p.sent.at(-1)!.text).toMatch(/^Vou cancelar a reserva .*20\/10\/2026 19:00-20:00 \(Play, de Beto Sócio\)\. Motivo: chuva\. Confirma/);
      expect((await sim(w, p)).action).toBe('admin_confirmed');
      expect((await q<any>(w.db, `select count(*)::int c from public.reservations where status = 'cancelled'`))[0].c).toBe(1);
      expect((await q<any>(w.db, `select count(*)::int c from public.reservations where status = 'active'`))[0].c).toBe(1);
      await dizer(w, p, 'cancela a das 7h', acao('reserva_cancelar', { date, start: '07:00' }));
      expect(p.sent.at(-1)!.text).toMatch(/Não achei reserva ativa/);
    }, 90000);

    it('sócio comum e grupo: a ação administrativa nem é proposta', async () => {
      const w = await setup(); const p = provider();
      const m = await direct(w, 'inativa o Beto', '5599900000002');
      const r = await turn(w, m.message_id, script(answer({ intent: 'admin_acao', ...acao('socio_status', { member_name: 'Beto', active: false }) })).chat, p.uaz);
      expect(r.action).not.toBe('proposed_admin');
      expect(await q(w.db, `select 1 from public.conv_booking_proposals where action like 'adm\\_%'`)).toHaveLength(0);
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

describe('onda 6: aprovar comprovante e gerar cobranças (N2)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };
  const confirmar = (w: W, p: ReturnType<typeof provider>, texto = 'sim') => dizer(w, p, texto, { customer_confirmed: true });
  const pend = (w: W, cents: number, desc: string, due: string) => rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: desc, amount_cents: cents, competence_month: '2026-10-01', due_date: due })})`);
  const comprovante = (w: W, cents: number | null, n = 1) => q(w.db, `insert into public.fin_receipt_submissions(profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256, declared_amount_cents, ocr_status, request_id)
    values ('${U.socioB}', 'submitted', 'x/${n}/c.jpg', 'c.jpg', 'image/jpeg', 100, '${'c'.repeat(63)}${n}', ${cents ?? 'null'}, 'not_run', gen_random_uuid())`);
  const aprovar = { ready: true, slots: { fin_action: 'aprovar_comprovante', member_name: 'Beto' } };

  it('aprova o comprovante distribuindo pela cobrança mais antiga primeiro; a mais nova fica parcial', async () => {
    const w = await setup(); const p = provider();
    await pend(w, 10000, 'Consumo antigo', '2026-09-10'); await pend(w, 10000, 'Consumo novo', '2026-10-05');
    await comprovante(w, 15000);
    const r = await dizer(w, p, 'aprova o comprovante do Beto', aprovar);
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou aprovar o comprovante de Beto Sócio, enviado em \d\d\/\d\d\/\d{4}: R\$ 150,00,[\s\S]*Consumo antigo \(venc\. 10\/09\/2026\): R\$ 100,00\n- Consumo novo \(venc\. 05\/10\/2026\): R\$ 50,00\nConfirma/);
    expect((await q<any>(w.db, `select status from public.fin_receipt_submissions`))[0].status).toBe('submitted');
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status from public.fin_receipt_submissions`))[0].status).toBe('approved');
    const st = await q<any>(w.db, `select description, status from public.fin_member_charges where charge_type = 'member_pendency' order by due_date`);
    expect(st.map((x: any) => x.status)).toEqual(['paid', 'partial']);
    expect(p.sent.at(-1)!.text).toMatch(/Pronto: comprovante de Beto Sócio aprovado, R\$ 150,00 baixados/);
  }, 90000);

  it('valor ilegível, maior que o em aberto ou sem cobrança: não propõe e manda para o painel', async () => {
    const w = await setup(); const p = provider();
    await comprovante(w, null);
    await dizer(w, p, 'aprova o do Beto', aprovar);
    expect(p.sent.at(-1)!.text).toMatch(/Não consegui ler o valor/);
    await q(w.db, `update public.fin_receipt_submissions set status = 'superseded'`);
    await comprovante(w, 5000, 2);
    await dizer(w, p, 'aprova o do Beto', aprovar);
    expect(p.sent.at(-1)!.text).toMatch(/não tem cobrança em aberto/);
    await pend(w, 3000, 'Consumo', '2026-10-05');
    await dizer(w, p, 'aprova o do Beto', aprovar);
    expect(p.sent.at(-1)!.text).toMatch(/passa do que esse sócio tem em aberto \(R\$ 30,00\)/);
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
  }, 90000);

  it('R$ 400 ou mais baixa com um "sim" só', async () => {
    const w = await setup(); const p = provider();
    await pend(w, 50000, 'Mensalidade atrasada', '2026-09-10'); await comprovante(w, 50000);
    await dizer(w, p, 'aprova o do Beto', aprovar);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status from public.fin_receipt_submissions`))[0].status).toBe('approved');
  }, 90000);

  it('gerar cobranças: resume, só roda depois do "sim" e não duplica ao repetir', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'gera as cobranças do mês', { ready: true, slots: { fin_action: 'gerar_cobrancas' } });
    expect(p.sent.at(-1)!.text).toMatch(/Não há plano de sócio ativo/);
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: '2026-10-01', amount_cents: 20000 })})`);
    await dizer(w, p, 'gera as cobranças do mês', { ready: true, slots: { fin_action: 'gerar_cobrancas' } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou gerar as cobranças que faltam dos 1 planos de sócios ativos/);
    expect(await q(w.db, `select 1 from public.fin_member_charges where plan_id is not null`)).toHaveLength(0);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q(w.db, `select 1 from public.fin_member_charges where plan_id is not null`)).length).toBeGreaterThan(0);
    expect(p.sent.at(-1)!.text).toMatch(/Pronto: \d+ cobrança\(s\) nova\(s\) gerada\(s\)/);
  }, 90000);
});

describe('onda 7: pedidos de acesso e sócio novo com mensalidade paga', () => {
  let calls: string[] = [];
  const fakeProvision = (w: W): Provision => async ({ name, phone }) => {
    calls.push(name);
    const id = crypto.randomUUID(); const local = phone.replace(/\D/g, '');
    await w.db.exec(`insert into auth.users(id) values ('${id}'); insert into public.profiles(id, name, phone, role, is_active) values ('${id}', '${name}', '${local}', 'socio', true)`);
    return { ok: true, profileId: id, alreadyProvisioned: false };
  };
  const turnP = (w: W, messageId: string, chat: Chat, uaz: UazCaller) => runTurn(messageId, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined, provision: fakeProvision(w) });
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turnP(w, m.message_id, script(answer({ intent: 'admin_acao', ...o })).chat, p.uaz);
  };
  const confirmar = (w: W, p: ReturnType<typeof provider>, texto = 'sim') => dizer(w, p, texto, { customer_confirmed: true });
  const pedidos = (w: W) => q(w.db, `create table if not exists public.access_requests(id uuid primary key default gen_random_uuid(), phone text not null unique, status text not null default 'pending',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), name text not null, phone_normalized text not null, email text, rejection_reason text,
    decided_by uuid references public.profiles(id), decided_at timestamptz)`);
  /** O administrador manda a imagem do comprovante: o servidor guarda o envio ligado à mensagem. */
  const comprovante = async (w: W, cents: number | null) => {
    await pedidos(w);
    const m = await direct(w, 'comprovante');
    await q(w.db, `insert into public.fin_receipt_submissions(profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256, declared_amount_cents, ocr_status, request_id, source, source_message_id)
      values ('${U.admin}', 'submitted', 'x/1/c.jpg', 'c.jpg', 'image/jpeg', 100, '${'d'.repeat(64)}', ${cents ?? 'null'}, 'ok', gen_random_uuid(), 'whatsapp', '${m.message_id}')`);
  };
  const criar = (o: Record<string, unknown> = {}) => ({ ready: true, slots: { adm_action: 'socio_criar', member_name: 'Carla Souza', phone: '88 99999-1234', amount: 150, ...o } });

  it('sem comprovante não propõe: pede a imagem; pergunta o que falta (telefone, valor)', async () => {
    calls = []; const w = await setup(); const p = provider();
    await dizer(w, p, 'cadastra a Carla', criar({ phone: null, amount: null }));
    expect(p.sent.at(-1)!.text).toMatch(/telefone/i);
    await dizer(w, p, 'telefone 88 99999-1234', criar({ amount: null }));
    expect(p.sent.at(-1)!.text).toMatch(/valor da mensalidade/i);
    await dizer(w, p, 'mensalidade 150', criar());
    expect(p.sent.at(-1)!.text).toMatch(/preciso do comprovante de pagamento da mensalidade/);
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  }, 90000);

  it('cadastra o sócio com a mensalidade do mês paga pelo comprovante, sem pendência, e dá boas-vindas no grupo', async () => {
    calls = []; const w = await setup({ group: true }); const p = provider();
    await comprovante(w, 15000);
    const r = await dizer(w, p, 'cadastra a Carla', criar());
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou cadastrar o sócio Carla Souza \(telefone \(88\) 99999-1234, e-mail gerado pelo sistema\), com mensalidade de R\$ 150,00\. A mensalidade de \d\d\/\d{4} fica paga com o comprovante/);
    expect(calls).toHaveLength(0);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect(calls).toEqual(['Carla Souza']);
    const [novo] = await q<any>(w.db, `select id from public.profiles where phone = '88999991234'`);
    const cobr = await q<any>(w.db, `select status, competence_month::text m from public.fin_member_charges where profile_id = '${novo.id}' order by competence_month`);
    expect(cobr[0].status).toBe('paid');
    expect(cobr.slice(1).every((c: any) => c.status === 'open')).toBe(true);
    const [sub] = await q<any>(w.db, `select status, profile_id from public.fin_receipt_submissions`);
    expect(sub).toMatchObject({ status: 'approved', profile_id: novo.id });
    expect(await q(w.db, `select 1 from public.fin_member_charges where profile_id = '${novo.id}' and status in ('open','partial') and due_date < current_date`)).toHaveLength(0);
    expect(p.sent.at(-1)!.text).toMatch(/Pronto: Carla Souza agora é sócio e a mensalidade de \d\d\/\d{4} ficou paga \(R\$ 150,00\), sem pendência/);
    const grupo = p.sent.filter((x) => x.number.endsWith('@g.us'));
    expect(grupo).toHaveLength(1);
    expect(grupo[0].text).toMatch(/Carla/); expect(grupo[0].text).toMatch(/João/);
  }, 90000);

  it('valor do comprovante diferente da mensalidade informada: não propõe', async () => {
    calls = []; const w = await setup(); const p = provider();
    await comprovante(w, 8000);
    await dizer(w, p, 'cadastra a Carla', criar());
    expect(p.sent.at(-1)!.text).toMatch(/O comprovante mostra R\$ 80,00, mas a mensalidade informada é R\$ 150,00/);
    expect(await q(w.db, `select 1 from public.conv_booking_proposals`)).toHaveLength(0);
  }, 90000);

  it('mensalidade de R$ 500 cria o acesso com um "sim" só', async () => {
    calls = []; const w = await setup(); const p = provider();
    await comprovante(w, 50000);
    await dizer(w, p, 'cadastra a Carla', criar({ amount: 500 }));
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect(calls).toHaveLength(1);
  }, 90000);

  it('telefone de professor, ou de sócio ativo, é recusado no banco', async () => {
    calls = []; const w = await setup(); const p = provider();
    await comprovante(w, 15000);
    await dizer(w, p, 'cadastra', criar({ phone: '99900000001' }));
    expect(p.sent.at(-1)!.text).toMatch(/já é de .* \(admin\)/i);
    await dizer(w, p, 'cadastra', criar({ phone: '99900000003' }));
    expect(p.sent.at(-1)!.text).toMatch(/já é sócio ativo/);
    expect(calls).toHaveLength(0);
  }, 90000);

  it('recusar pedido de acesso: por nome, com motivo, depois do "sim"', async () => {
    const w = await setup(); const p = provider(); await pedidos(w);
    await q(w.db, `insert into public.access_requests(name, phone, phone_normalized, status) values ('Zeca Pereira', '88988887777', '88988887777', 'pending')`);
    const r = await dizer(w, p, 'recusa o acesso do Zeca', { ready: true, slots: { adm_action: 'acesso_recusar', member_name: 'Zeca', reason: 'não é do clube' } });
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou recusar o pedido de acesso de Zeca Pereira\. Motivo: não é do clube\. Confirma/);
    expect((await q<any>(w.db, `select status from public.access_requests`))[0].status).toBe('pending');
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status, rejection_reason, decided_by from public.access_requests`))[0]).toMatchObject({ status: 'rejected', rejection_reason: 'não é do clube', decided_by: U.admin });
  }, 90000);

  it('aprovar pedido de acesso: cria o sócio com a mensalidade paga e fecha o pedido', async () => {
    calls = []; const w = await setup(); const p = provider(); await pedidos(w);
    await q(w.db, `insert into public.access_requests(name, phone, phone_normalized, status) values ('Zeca Pereira', '88988887777', '88988887777', 'pending')`);
    await comprovante(w, 15000);
    await dizer(w, p, 'aprova o Zeca', { ready: true, slots: { adm_action: 'acesso_aprovar', member_name: 'Zeca', amount: 150 } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou aprovar o pedido de acesso de Zeca Pereira \(telefone \(88\) 98888-7777/);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status, decided_by from public.access_requests`))[0]).toMatchObject({ status: 'approved', decided_by: U.admin });
    expect(calls).toEqual(['Zeca Pereira']);
  }, 90000);
});

describe('onda 8: retornos, bloqueio de quadra e preferências', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer({ intent: 'admin_acao', ...o })).chat, p.uaz);
  };
  const confirmar = (w: W, p: ReturnType<typeof provider>, texto = 'sim') => dizer(w, p, texto, { customer_confirmed: true });
  const amanha = () => new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);

  it('lembrete para si: sem nome vale a própria conversa e o texto vira a mensagem do horário', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'me lembra amanhã', { ready: true, slots: { adm_action: 'followup_criar', date: amanha() } });
    expect(p.sent.at(-1)!.text).toMatch(/O que é para lembrar/);
    const r = await dizer(w, p, 'de cobrar o Beto', { ready: true, slots: { adm_action: 'followup_criar', date: amanha(), start: '09:00', note: 'cobrar o Beto' } });
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou te lembrar em \d\d\/\d\d,? \d\d:\d\d: «cobrar o Beto»\. Confirma/);
    expect(await q(w.db, `select 1 from public.conv_followups`)).toHaveLength(0);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status, note, send_body, created_by from public.conv_followups`))[0]).toMatchObject({ status: 'pending', note: 'cobrar o Beto', send_body: 'Lembrete: cobrar o Beto', created_by: U.admin });
  }, 90000);

  it('retorno com sócio que tem conversa; data no passado é recusada; concluir acha o retorno', async () => {
    const w = await setup(); const p = provider();
    await direct(w, 'oi', '5599900000003');
    await dizer(w, p, 'retorno com o Beto', { ready: true, slots: { adm_action: 'followup_criar', member_name: 'Beto', date: '2020-01-01', note: 'x' } });
    expect(p.sent.at(-1)!.text).toMatch(/já passou/);
    await dizer(w, p, 'retorno com o Beto', { ready: true, slots: { adm_action: 'followup_criar', member_name: 'Beto', date: amanha(), note: 'confirmar mensalidade' } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou criar um retorno com Beto Sócio para .*: confirmar mensalidade\. Confirma/);
    await confirmar(w, p);
    expect(await q(w.db, `select 1 from public.conv_followups where status = 'pending'`)).toHaveLength(1);
    await dizer(w, p, 'conclui o retorno do Beto', { ready: true, slots: { adm_action: 'followup_concluir', member_name: 'Beto' } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou dar por concluído o retorno com Beto Sócio/);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    expect((await q<any>(w.db, `select status from public.conv_followups`))[0].status).toBe('done');
  }, 90000);

  it('bloquear quadra: cria a reserva de bloqueio; horário ocupado é recusado com quem ocupa', async () => {
    const w = await setup(); const p = provider();
    const bloqueio = (o: Record<string, unknown> = {}) => ({ ready: true, slots: { adm_action: 'quadra_bloquear', court_label: 'Quadra 1', date: amanha(), start: '08:00', duration: 120, reason: 'manutenção do saibro', ...o } });
    const r = await dizer(w, p, 'bloqueia a quadra 1', bloqueio());
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou bloquear a Quadra 1 em \d\d\/\d\d\/\d{4}, das 08:00 às 10:00 \(manutenção do saibro\)/);
    expect((await confirmar(w, p)).action).toBe('admin_confirmed');
    const [res] = await q<any>(w.db, `select start_time::text s, end_time::text e, observation, creator_id, status::text st from public.reservations`);
    expect(res).toMatchObject({ s: '08:00:00', e: '10:00:00', observation: 'Bloqueio: manutenção do saibro', creator_id: U.admin, st: 'active' });
    await dizer(w, p, 'bloqueia de novo', bloqueio({ start: '09:00', duration: 60 }));
    expect(p.sent.at(-1)!.text).toMatch(/Já há reserva nesse horário: 08:00-10:00 Play \(Admin/i);
    await dizer(w, p, 'bloqueia a quadra x', bloqueio({ court_label: 'Quadra X' }));
    expect(p.sent.at(-1)!.text).toMatch(/Não achei a quadra/);
  }, 90000);

  it('preferências: valida, grava depois do "sim" e a leitura mostra o que ficou', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'muda', { ready: true, slots: { adm_action: 'preferencia' } });
    expect(p.sent.at(-1)!.text).toMatch(/O que você quer ajustar/);
    await dizer(w, p, 'resumo curto', { ready: true, slots: { adm_action: 'preferencia', pref: 'estilo', pref_value: 'enorme' } });
    expect(p.sent.at(-1)!.text).toMatch(/curto" ou "completo/);
    await dizer(w, p, 'resumo curto', { ready: true, slots: { adm_action: 'preferencia', pref: 'estilo', pref_value: 'curto' } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou deixar o seu resumo da manhã curto\. Confirma/);
    await confirmar(w, p);
    await dizer(w, p, 'avisa se o caixa passar de baixo de 3 mil', { ready: true, slots: { adm_action: 'preferencia', pref: 'saldo_minimo', amount: 3000 } });
    await confirmar(w, p);
    await dizer(w, p, 'não quero o resumo', { ready: true, slots: { adm_action: 'preferencia', pref: 'resumo', active: false } });
    await confirmar(w, p);
    expect((await q<any>(w.db, `select briefing_style, min_balance_cents, briefing_enabled from public.conv_admin_prefs`))[0]).toMatchObject({ briefing_style: 'curto', min_balance_cents: 300000, briefing_enabled: false });
    const [sess] = await q<{ id: string }>(w.db, `select id from public.conv_ai_sessions limit 1`);
    const lido = await svc<any>(w.db, `public.conv_svc_ai_admin_prefs('${sess.id}')`);
    expect(lido.prefs).toMatchObject({ briefing_enabled: false, briefing_style: 'curto', min_balance_cents: 300000, overdue_days: 7 });
  }, 90000);

  it('conta padrão: usada na despesa quando o administrador não diz a conta', async () => {
    const w = await setup(); const p = provider();
    await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Caixa pequeno', kind: 'cash', opening_balance_cents: 0, opening_date: '2020-01-01' })})`);
    await dizer(w, p, 'conta padrão caixa pequeno', { ready: true, slots: { adm_action: 'preferencia', pref: 'conta_padrao', account_name: 'Caixa pequeno' } });
    expect(p.sent.at(-1)!.text).toMatch(/^Vou usar Caixa pequeno como a sua conta padrão/);
    await confirmar(w, p);
    await dizer(w, p, 'lança despesa', { intent: 'admin_financeiro', ready: true, slots: { fin_action: 'despesa', description: 'Gelo', amount: 40, category_name: 'energia' } });
    expect(p.sent.at(-1)!.text).toMatch(/conta Caixa pequeno/);
  }, 90000);

  it('alertas com o banco real: cobrança vencida há mais de N dias aparece e respeita as preferências', async () => {
    const w = await setup();
    await q(w.db, `create table if not exists public.access_requests(id uuid primary key default gen_random_uuid(), status text)`);
    await direct(w, 'oi');
    await q(w.db, `insert into public.conv_admin_briefing_recipients(profile_id) values ('${U.admin}') on conflict do nothing`);
    await rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: 'Consumo antigo', amount_cents: 20000, competence_month: '2026-08-01', due_date: '2026-08-10' })})`);
    const dados = (await svc<any>(w.db, `public.conv_svc_admin_alert_data('${U.admin}')`)).data;
    expect(dados.overdue.count).toBe(1);
    expect(Number(dados.overdue.cents)).toBeGreaterThanOrEqual(20000);
    expect(dados.receipts_waiting.count).toBe(0);
    await q(w.db, `insert into public.conv_admin_prefs(profile_id, alerts_enabled) values ('${U.admin}', false)`);
    expect(await q(w.db, `select 1 from public.conv_svc_admin_alert_targets()`)).toHaveLength(0);
  }, 90000);
});

describe('dependente de sócio pelo WhatsApp (N1)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };
  const dep = (slots: Record<string, unknown> = {}) => ({ ready: true, intent: 'admin_acao', slots: { adm_action: 'dependente_criar', member_name: 'Beto', ...slots } });

  it('sem os dados, o João diz que pode cadastrar e pede nome e parentesco (sem pedir CPF)', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'cadastra a esposa do Beto como dependente', dep());
    expect(p.sent.at(-1)!.text).toMatch(/Posso cadastrar sim\. Me passa o nome completo do dependente.*CPF não é necessário/);
    await dizer(w, p, 'Jessica Lorraine Gomes', dep({ dependent_name: 'Jessica Lorraine Gomes de Morais' }));
    expect(p.sent.at(-1)!.text).toMatch(/Qual o parentesco de Jessica Lorraine Gomes de Morais com Beto: esposa/);
    expect(await q(w.db, `select 1 from public.non_socio_students where student_type = 'dependent'`)).toHaveLength(0);
  }, 90000);

  it('com tudo: resume, só grava depois do "sim", cria o dependente sem cobrança e não duplica', async () => {
    const w = await setup(); const p = provider();
    const r = await dizer(w, p, 'a esposa dele é Jessica', dep({ dependent_name: 'Jessica Lorraine Gomes de Morais', relationship: 'esposa', phone: '(88) 99999-1234' }));
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/^Vou cadastrar Jessica Lorraine Gomes de Morais como esposa de Beto Sócio \(dependente, sem cobrança, telefone 88999991234\)\. Confirma/);
    expect(await q(w.db, `select 1 from public.non_socio_students where student_type = 'dependent'`)).toHaveLength(0);
    const c = await dizer(w, p, 'sim', { customer_confirmed: true });
    expect(c.action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toBe('Pronto: Jessica Lorraine Gomes de Morais cadastrado(a) como esposa de Beto Sócio.');
    const [d] = await q<any>(w.db, `select name, student_type, relationship_type, plan_type, plan_status, responsible_socio_id from public.non_socio_students where student_type = 'dependent'`);
    expect(d).toMatchObject({ name: 'Jessica Lorraine Gomes de Morais', relationship_type: 'esposa', plan_type: 'Dependente', plan_status: 'active', responsible_socio_id: U.socioB });
    expect(await q(w.db, `select 1 from public.student_profiles sp join public.non_socio_students n on n.id = sp.non_socio_student_id where n.student_type = 'dependent'`)).toHaveLength(1);
    await dizer(w, p, 'cadastra de novo', dep({ dependent_name: 'jéssica lorraine gomes de morais', relationship: 'esposa' }));
    expect(p.sent.at(-1)!.text).toMatch(/já está cadastrado\(a\) como dependente de Beto Sócio/);
  }, 90000);
});

describe('chamar sócio no privado e mandar mensagem (N1)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };
  const msg = (slots: Record<string, unknown> = {}) => ({ ready: true, intent: 'admin_acao', slots: { adm_action: 'mensagem_enviar', member_name: 'Beto', ...slots } });

  it('pede o recado, mostra o texto exato, só enfileira depois do "sim" e abre a conversa do sócio', async () => {
    const w = await setup(); const p = provider();
    await q(w.db, `update public.profiles set phone = '88993412944' where id = '${U.socioB}'`);
    await dizer(w, p, 'chama o Beto no privado', msg());
    expect(p.sent.at(-1)!.text).toMatch(/O que eu digo para Beto\?/);
    const texto = 'Beto, boas-vindas ao STC! Acesse o app por https://stcplay.com.br. Seu celular é iOS ou Android?';
    const r = await dizer(w, p, 'manda o link e pergunta se é ios ou android', msg({ send_body: texto }));
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toBe(`Vou chamar Beto Sócio no WhatsApp (5588993412944) e mandar esta mensagem:\n«${texto}»\nConfirma? Responda "sim".`);
    expect(await q(w.db, `select 1 from public.conv_followups where send_body is not null`)).toHaveLength(0);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/Pronto: a mensagem para Beto Sócio está na fila/);
    const [f] = await q<any>(w.db, `select f.send_body, f.status, c.kind, ct.phone from public.conv_followups f join public.conv_conversations c on c.id = f.conversation_id join public.conv_contacts ct on ct.id = c.contact_id where f.send_body is not null`);
    expect(f).toMatchObject({ send_body: texto, status: 'pending', kind: 'direct', phone: '5588993412944' });
    // o despacho dos retornos entrega a mensagem
    const enviados: string[] = [];
    const uaz: UazCaller = async ({ path, body }) => { if (path === '/send/text') enviados.push(`${body.number}|${body.text}`); return { ok: true, body: { messageid: `X${++n}` } }; };
    await dispatchFollowups(pgDb(w.db), uaz);
    expect(enviados).toEqual([`5588993412944|${texto}`]);
  }, 120000);

  it('sócio sem telefone válido: não propõe', async () => {
    const w = await setup(); const p = provider();
    await q(w.db, `update public.profiles set phone = null where id = '${U.socioB}'`);
    await dizer(w, p, 'chama o Beto', msg({ send_body: 'Oi Beto, tudo bem?' }));
    expect(p.sent.at(-1)!.text).toMatch(/não tem telefone válido/);
  }, 90000);
});

describe('comunicado no WhatsApp de todos os sócios (N1)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };
  const com = (slots: Record<string, unknown> = {}) => ({ ready: true, intent: 'admin_acao', slots: { adm_action: 'comunicado_enviar', ...slots } });
  const texto = 'COMUNICADO – STC\n\nConcluímos a transição entre as diretorias. Iniciaremos o Plano de Revitalização do STC.';

  it('sem texto: explica que consegue e pede texto e horário; com texto: mostra e só enfileira (uma vez por sócio) depois do "sim"', async () => {
    const w = await setup(); const p = provider();
    await q(w.db, `update public.profiles set phone = '88993412944' where id = '${U.socioB}'`);
    await dizer(w, p, 'preciso disparar um comunicado para os sócios', com());
    expect(p.sent.at(-1)!.text).toMatch(/Consigo sim.*texto exato e o horário/);
    const r = await dizer(w, p, 'texto acima, às 8h', com({ send_body: texto, start: '23:30' }));
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/Vou mandar este comunicado no WhatsApp pessoal de \d+ sócios, em .* às 23:30/);
    expect(await q(w.db, `select 1 from public.conv_followups where send_body is not null`)).toHaveLength(0);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/comunicado está agendado para \d+ sócios/);
    const f = await q<any>(w.db, `select f.send_body, f.due_at, ct.phone from public.conv_followups f join public.conv_conversations c on c.id = f.conversation_id join public.conv_contacts ct on ct.id = c.contact_id where f.send_body is not null`);
    expect(f.length).toBeGreaterThan(0);
    expect(new Set(f.map((x: any) => x.phone)).size).toBe(f.length);
    expect(f.every((x: any) => x.send_body === texto)).toBe(true);
    expect(f.some((x: any) => x.phone === '5588993412944')).toBe(true);
    // repetir o "sim" não duplica
    await dizer(w, p, 'sim', { customer_confirmed: true });
    expect(await q(w.db, `select 1 from public.conv_followups where send_body is not null`)).toHaveLength(f.length);
  }, 120000);
});

describe('consultas nominais do assessor (inadimplentes, pagamentos, ficha, vencimentos, alunos, movimentos)', () => {
  it('cada domínio responde com dados do banco, escrito pelo servidor, sem cair em fallback', async () => {
    const w = await setup(); const p = provider();
    await rpc(w.db, U.admin, `public.fin_create_member_pendency('${key()}', ${j({ profile_id: U.socioB, description: 'Consumo do Beto', amount_cents: 15000, competence_month: '2026-10-01', due_date: '2026-10-01' })})`);
    const ask = async (domain: string, slots: Record<string, unknown> = {}) => {
      const m = await direct(w, `me mostra ${domain}`);
      const r = await turn(w, m.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: domain, ...slots } })).chat, p.uaz);
      expect(r.action, domain).toBe(`admin_read:${domain}`);
      return p.sent.at(-1)!.text;
    };
    expect(await ask('inadimplentes')).toMatch(/^1 sócio com cobrança vencida, R\$ 1\d\d,\d\d no total[\s\S]*- Beto Sócio: R\$ 1\d\d,\d\d \(1 cobrança, \d+ dias? de atraso\)/);
    expect(await ask('pagamentos')).toMatch(/Nenhum pagamento de mensalidade entre/);
    expect(await ask('socio_ficha', { member_name: 'Beto' })).toMatch(/^Beto Sócio \(sócio\), com R\$ 1\d\d,\d\d vencido\.[\s\S]*- Dependentes: nenhum/);
    expect(await ask('vencimentos')).toMatch(/^(Nada a vencer até|Até )/);
    expect(await ask('alunos')).toMatch(/^Alunos ativos: \d+ avulsos\/regulares e \d+ dependentes/);
    expect(await ask('movimentos')).toMatch(/^(Ainda não há lançamentos pagos|Últimos lançamentos pagos:)/);
  }, 120000);

  it('ficha sem sócio informado pergunta de quem; sem administrador não consulta', async () => {
    const w = await setup(); const p = provider();
    const m = await direct(w, 'me dá a ficha');
    await turn(w, m.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: 'socio_ficha' } })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).toMatch(/De qual sócio você quer a ficha\?/);
    const m2 = await direct(w, 'quem está devendo?', '5599977770000');
    await turn(w, m2.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: 'inadimplentes' } })).chat, p.uaz);
    expect(p.sent.at(-1)!.text).not.toMatch(/cobrança vencida/);
  }, 90000);
});

describe('limite assumido e novidades (administrador)', () => {
  it('"o que você faz?": o servidor lista as novidades e o que sabe, sem chamar fallback', async () => {
    const w = await setup(); const p = provider();
    const m = await direct(w, 'o que você consegue fazer de novo?');
    const r = await turn(w, m.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: 'capacidades' } })).chat, p.uaz);
    expect(r.action).toBe('admin_read:capacidades');
    const t = p.sent.at(-1)!.text;
    expect(t).toMatch(/^Novidades de \d\d\/\d\d:/);
    expect(t).toMatch(/comunicado no WhatsApp pessoal de todos os sócios/);
    expect(t).toMatch(/PDF/);
    expect(t).toMatch(/o Ítalo ensina rápido/);
  }, 90000);

  it('pedido sem capacidade: o João assume o limite com a frase combinada, manda informar o Ítalo e registra a limitação', async () => {
    const w = await setup(); const p = provider();
    const frase = 'Ainda não consigo realizar esse pedido, mas consigo aprender a fazer. Informe ao Ítalo essa minha limitação que ele corrige rapidamente.';
    const s = script(answer({ transfer: true, handoff_kind: 'hard', handoff_note: 'sem capacidade', messages: ['Vou passar para a equipe.'] }), answer({ messages: [frase] }));
    const m = await direct(w, 'troca a logo do site pra mim');
    await turn(w, m.message_id, s.chat, p.uaz);
    expect(s.calls[1].system).toContain(frase);
    expect(p.sent.at(-1)!.text).toBe(frase);
    const [dec] = await q<any>(w.db, `select tool_result as payload from public.conv_ai_decisions order by created_at desc limit 1`);
    expect(dec.payload).toMatchObject({ limitation: true, asked: 'troca a logo do site pra mim' });
  }, 90000);
});

describe('memória de cargos (role_title)', () => {
  it('administrador informa o cargo: entra aprovado, o servidor confirma ("Anotei") e o João passa a tratar a pessoa pelo cargo', async () => {
    const w = await setup(); const p = provider();
    const m = await direct(w, 'o Beto é o vice-presidente do clube');
    const s1 = script(answer({ messages: ['Beleza, anotado.'], memory_candidates: [{ subject_name: 'Beto Sócio', kind: 'role_title', content: 'Vice-presidente do clube', confidence: 1 }] }));
    await turn(w, m.message_id, s1.chat, p.uaz);
    const [c] = await q<any>(w.db, `select status, kind, content from public.conv_ai_memory_candidates where kind = 'role_title' and subject_name = 'Beto Sócio'`);
    expect(c).toMatchObject({ status: 'approved', content: 'Vice-presidente do clube' });
    expect(p.sent.map((x) => x.text).join('\n')).toMatch(/📝 Anotei: Beto Sócio é Vice-presidente do clube\./);
    // o cargo chega ao prompt de quando o Beto falar
    const m2 = await direct(w, 'bom dia', '5599900000003');
    const s2 = script(answer({ messages: ['Bom dia, Vice!'] }));
    await q(w.db, `update public.profiles set phone = '5599900000003' where id = '${U.socioB}'`);
    await turn(w, m2.message_id, s2.chat, p.uaz);
    expect(s2.calls.at(-1)!.user + s2.calls.at(-1)!.system).toContain('Cargo no clube: Vice-presidente do clube');
  }, 120000);

  it('cargo novo substitui o anterior da mesma pessoa; sócio comum só sugere (fica pendente)', async () => {
    const w = await setup();
    await svc(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Beto Sócio', kind: 'role_title', content: 'Tesoureiro', approve: true })})`);
    await svc(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Beto Sócio', kind: 'role_title', content: 'Vice-presidente', approve: true })})`);
    expect(await q<any>(w.db, `select content, status from public.conv_ai_memory_candidates where kind = 'role_title' and subject_name = 'Beto Sócio' order by created_at`)).toEqual([
      { content: 'Tesoureiro', status: 'superseded' }, { content: 'Vice-presidente', status: 'approved' }]);
    await svc(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Fulano', kind: 'role_title', content: 'Presidente' })})`);
    expect((await q<any>(w.db, `select status from public.conv_ai_memory_candidates where subject_name = 'Fulano'`))[0].status).toBe('pending');
  }, 90000);
});

describe('memória ampliada pelo administrador (fatos, consulta e esquecer)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };

  it('fato contado pelo administrador entra aprovado e o servidor confirma; brincadeira interna continua pendente', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'o Beto prefere jogar cedo, lembra disso', { messages: ['Fechou.'], memory_candidates: [
      { subject_name: 'Beto Sócio', kind: 'recurring_preference', content: 'Prefere jogar cedo, por volta das 6h.', confidence: 1 },
      { subject_name: 'Beto Sócio', kind: 'inside_joke', content: 'Brincadeira de que sempre atrasa.', confidence: 0.7 }] });
    const rows = await q<any>(w.db, `select kind, status from public.conv_ai_memory_candidates where subject_name = 'Beto Sócio' order by kind`);
    expect(rows).toEqual([{ kind: 'inside_joke', status: 'pending' }, { kind: 'recurring_preference', status: 'approved' }]);
    expect(p.sent.map((x) => x.text).join('\n')).toMatch(/📝 Anotei: Beto Sócio: Prefere jogar cedo, por volta das 6h\./);
  }, 90000);

  it('"o que você sabe do Beto?" lista as memórias aprovadas; esquecer mostra o que sai, só aplica no "sim" e tira do prompt', async () => {
    const w = await setup(); const p = provider();
    await svc(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Beto Sócio', kind: 'confirmed_fact', content: 'Joga de canhoto.', approve: true })})`);
    await svc(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Beto Sócio', kind: 'recurring_preference', content: 'Prefere jogar cedo.', approve: true })})`);
    const r = await dizer(w, p, 'o que você sabe do Beto?', { intent: 'admin_consulta', ready: true, slots: { read_domain: 'memoria', member_name: 'Beto' } });
    expect(r.action).toBe('admin_read:memoria');
    expect(p.sent.at(-1)!.text).toMatch(/O que eu sei sobre Beto:\n- Beto Sócio \(fato\): Joga de canhoto\.\n- Beto Sócio \(preferência\): Prefere jogar cedo\./);
    const f = await dizer(w, p, 'esquece que ele joga de canhoto', { intent: 'admin_acao', ready: true, slots: { adm_action: 'memoria_esquecer', member_name: 'Beto', note: 'canhoto' } });
    expect(f.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/Vou esquecer esta memória[\s\S]*- Beto Sócio: Joga de canhoto\.\nConfirma\?/);
    expect((await q<any>(w.db, `select count(*)::int n from public.conv_ai_memory_candidates where status = 'approved' and subject_name = 'Beto Sócio'`))[0].n).toBe(2);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/Pronto: esqueci 1 memória sobre Beto/);
    expect(await q<any>(w.db, `select content, status from public.conv_ai_memory_candidates where subject_name = 'Beto Sócio' order by content`)).toEqual([
      { content: 'Joga de canhoto.', status: 'superseded' }, { content: 'Prefere jogar cedo.', status: 'approved' }]);
  }, 120000);

  it('nada para esquecer: avisa com franqueza, sem propor', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'esquece o que sabe do Zé', { intent: 'admin_acao', ready: true, slots: { adm_action: 'memoria_esquecer', member_name: 'Zé' } });
    expect(p.sent.at(-1)!.text).toMatch(/Não tenho nenhuma memória guardada sobre Zé/);
  }, 90000);
});

describe('relação nominal dos sócios', () => {
  it('"liste os sócios": o servidor escreve a relação (diretoria e sócios), sem chamar fallback', async () => {
    const w = await setup(); const p = provider();
    const m = await direct(w, 'liste os sócios atuais do clube');
    const r = await turn(w, m.message_id, script(answer({ intent: 'admin_consulta', ready: true, slots: { read_domain: 'socios' } })).chat, p.uaz);
    expect(r.action).toBe('admin_read:socios');
    expect(p.sent.at(-1)!.text).toMatch(/^O STC tem \d+ sócios ativos no cadastro \(\d+ da diretoria e \d+ sócios\)\.\n\nDiretoria:\n1\. /);
    expect(p.sent.at(-1)!.text).toMatch(/\n\nSócios:\n1\. /);
  }, 90000);
});

describe('lista do resumo das 8h pelo chat (N1)', () => {
  const dizer = async (w: W, p: ReturnType<typeof provider>, texto: string, o: Record<string, unknown>) => {
    const m = await direct(w, texto);
    return turn(w, m.message_id, script(answer(o)).chat, p.uaz);
  };
  const lista = (slots: Record<string, unknown>) => ({ ready: true, intent: 'admin_acao', slots: { adm_action: 'resumo_destinatario', ...slots } });

  it('tira e volta um administrador da lista: resumo mostra como a lista fica e só aplica depois do "sim"', async () => {
    const w = await setup(); const p = provider();
    await q(w.db, `insert into public.conv_admin_briefing_recipients(profile_id, enabled) values ('${U.admin}', true) on conflict (profile_id) do update set enabled = true`);
    const [adm] = await q<any>(w.db, `select name from public.profiles where id = '${U.admin}'`);
    const r = await dizer(w, p, 'tira o admin do resumo', lista({ member_name: adm.name, active: false }));
    expect(r.action).toBe('proposed_admin');
    expect(p.sent.at(-1)!.text).toMatch(/Vou tirar .* do resumo diário das 8h\. A lista fica: ninguém\. Confirma\?/);
    expect((await q<any>(w.db, `select enabled from public.conv_admin_briefing_recipients where profile_id = '${U.admin}'`))[0].enabled).toBe(true);
    expect((await dizer(w, p, 'sim', { customer_confirmed: true })).action).toBe('admin_confirmed');
    expect(p.sent.at(-1)!.text).toMatch(/não recebe mais o resumo das 8h/);
    expect((await q<any>(w.db, `select enabled from public.conv_admin_briefing_recipients where profile_id = '${U.admin}'`))[0].enabled).toBe(false);
    await dizer(w, p, 'inclui de volta', lista({ member_name: adm.name, active: true }));
    expect(p.sent.at(-1)!.text).toMatch(/Vou incluir .* no resumo diário das 8h\. A lista fica: /);
    await dizer(w, p, 'sim', { customer_confirmed: true });
    expect((await q<any>(w.db, `select enabled from public.conv_admin_briefing_recipients where profile_id = '${U.admin}'`))[0].enabled).toBe(true);
  }, 120000);

  it('quem não é administrador não entra na lista (o resumo traz dado financeiro)', async () => {
    const w = await setup(); const p = provider();
    await dizer(w, p, 'inclui o Beto no resumo', lista({ member_name: 'Beto', active: true }));
    expect(p.sent.at(-1)!.text).toMatch(/não é da diretoria no sistema/);
  }, 90000);
});

describe('arquivos para o administrador (PDF e documentos)', () => {
  const arq = (slots: Record<string, unknown>) => ({ intent: 'admin_consulta', ready: true, slots });
  const kitDe = (guardados: { source: unknown; name: string }[]) => ({
    pdf: async () => new TextEncoder().encode('%PDF-teste'),
    stage: async (source: unknown, name: string) => { guardados.push({ source, name }); return `out/00000000-0000-4000-8000-00000000000${guardados.length}/${name}`; },
    signedUrl: async (path: string) => `https://storage.teste/${path}?token=x`,
  });
  const comKit = (w: W, id: string, chat: Chat, uaz: UazCaller, files: ReturnType<typeof kitDe> | undefined) =>
    runTurn(id, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined, files });

  it('"me manda o DRE em PDF": gera pelos dados da consulta, guarda e envia como documento ao próprio administrador', async () => {
    const w = await setup(); const guardados: { source: unknown; name: string }[] = [];
    const media: Record<string, unknown>[] = [];
    const uaz: UazCaller = async ({ path, body }) => { if (path === '/send/media') media.push(body); return { ok: true, body: { messageid: `M${++n}` } }; };
    const m = await direct(w, 'me manda o DRE do mês em pdf');
    const r = await comKit(w, m.message_id, script(answer(arq({ file_kind: 'relatorio_pdf', read_domain: 'dre' }))).chat, uaz, kitDe(guardados));
    expect(r.action).toBe('admin_file:dre');
    expect(guardados).toHaveLength(1);
    expect(guardados[0].name).toMatch(/^DRE-Demonstracao-do-Resultado-\d{4}-\d\d-\d\d\.pdf$/);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ type: 'document', mimetype: 'application/pdf', docName: guardados[0].name });
    expect(String(media[0].file)).toMatch(/^https:\/\/storage\.teste\/out\//);
    const [d] = await q<any>(w.db, `select kind, status, media_name from public.conv_messages where kind = 'document'`);
    expect(d).toMatchObject({ kind: 'document', status: 'sent', media_name: guardados[0].name });
  }, 90000);

  it('sem relatório informado: pergunta qual; sem o kit de arquivos: avisa e não finge', async () => {
    const w = await setup(); const p = provider();
    const m1 = await direct(w, 'quero um pdf');
    await comKit(w, m1.message_id, script(answer(arq({ file_kind: 'relatorio_pdf' }))).chat, p.uaz, kitDe([]));
    expect(p.sent.at(-1)!.text).toMatch(/De qual relatório você quer o PDF/);
    const m2 = await direct(w, 'o DRE em pdf');
    await comKit(w, m2.message_id, script(answer(arq({ file_kind: 'relatorio_pdf', read_domain: 'dre' }))).chat, p.uaz, undefined);
    expect(p.sent.at(-1)!.text).toMatch(/Não consegui gerar ou anexar arquivo agora/);
    expect(await q(w.db, `select 1 from public.conv_messages where kind = 'document'`)).toHaveLength(0);
  }, 90000);

  it('não administrador não recebe arquivo: o pedido nem chega à consulta', async () => {
    const w = await setup(); const p = provider(); const guardados: { source: unknown; name: string }[] = [];
    const m = await direct(w, 'manda o DRE em pdf', '5599977770000');
    await comKit(w, m.message_id, script(answer(arq({ file_kind: 'relatorio_pdf', read_domain: 'dre' }))).chat, p.uaz, kitDe(guardados));
    expect(guardados).toHaveLength(0);
    expect(await q(w.db, `select 1 from public.conv_messages where kind = 'document'`)).toHaveLength(0);
  }, 90000);
});

describe('comprovante enviado logo depois do texto: o João não fica mudo', () => {
  const imagem = (w: W, phone: string) => svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `I${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'X', kind: 'image', body: '📷 Foto' })})`);
  const turnoMidia = (w: W, id: string, chat: Chat, uaz: UazCaller) => runTurn(id, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined, mediaOnly: true });

  it('administrador: texto e foto seguidos; o turno da foto (já lida) responde lendo os dois', async () => {
    const w = await setup(); const p = provider();
    const t = await direct(w, 'o valor é 400,00');
    const m = await imagem(w, '5599900000001');
    const s = script(answer({ intent: 'outro', messages: ['Recebi o comprovante e o valor.'], awaiting: true }));
    expect((await turn(w, t.message_id, s.chat, p.uaz)).status).toBe('superseded');   // o turno do texto cede à foto
    expect(p.sent).toHaveLength(0);
    const r = await turnoMidia(w, m.message_id, s.chat, p.uaz);
    expect(r.status).toBe('replied');
    expect(p.sent.at(-1)!.text).toMatch(/Recebi o comprovante/);
    expect(s.calls[0].user).toContain('400,00');
  }, 90000);

  it('quem não é administrador: a foto de comprovante segue só pelo financeiro, o João não responde', async () => {
    const w = await setup(); const p = provider();
    const m = await imagem(w, '5599900000002');
    const s = script();
    expect(await turnoMidia(w, m.message_id, s.chat, p.uaz)).toMatchObject({ status: 'skip', reason: 'media_only' });
    expect(p.sent).toHaveLength(0); expect(s.calls).toHaveLength(0);
  }, 90000);
});

describe('assessor: peças puras', () => {
  it('boas-vindas: usa o primeiro nome, o João se apresenta, e a mesma proposta sempre dá a mesma mensagem', () => {
    const a = composeWelcome('Carla Souza', 'proposta-1');
    expect(a).toMatch(/Carla/); expect(a).not.toMatch(/Souza/); expect(a).toMatch(/Eu sou o João|eu sou o João/i);
    expect(composeWelcome('Carla Souza', 'proposta-1')).toBe(a);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => composeWelcome('Carla', x))).size).toBeGreaterThan(1);
    expect(composeWelcome('5588999991234', 'x')).toMatch(/nosso novo sócio/);
  });

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
