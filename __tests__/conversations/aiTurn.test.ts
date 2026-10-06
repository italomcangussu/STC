// @vitest-environment node
/**
 * Turno da IA de ponta a ponta: o código REAL das edge functions (`turn.ts`) falando com o SQL REAL das
 * migrations (PGlite). Só o modelo de linguagem e o provedor de WhatsApp são simulados — e o que eles
 * respondem é roteirizado de propósito para tentar enganar o sistema.
 */
import { describe, expect, it } from 'vitest';
import { ID, U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { runTurn, type TurnResult } from '../../supabase/functions/_shared/aiAgent/turn';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type W = Awaited<ReturnType<typeof world>>;
const GROUP = '120363025246125486@g.us';
let n = 0;

const answer = (o: Record<string, unknown> = {}) => JSON.stringify({
  messages: [], intent: 'reservar', ready: false, customer_confirmed: false, declined: false, awaiting: false,
  transfer: false, handoff_kind: null, handoff_note: null, close: false, ...o,
  slots: { type: 'Play', date: null, start: null, duration: null, court_label: null, participant_names: [], participants_known: false,
    guest_name: null, professor_name: null, student_names: [], reservation_ref: null, ...((o.slots as object) ?? {}) },
});

/** Modelo roteirizado: devolve, em ordem, as respostas combinadas. Falta resposta ⇒ o teste quebra. */
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

/** Provedor de WhatsApp simulado: guarda o que foi enviado e devolve um id. */
const provider = (fail = false) => {
  const sent: { number: string; text: string; replyid?: string }[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') {
      if (fail) return { ok: false, error: 'HTTP_503' };
      sent.push({ number: String(body.number), text: String(body.text), replyid: body.replyid as string | undefined });
      return { ok: true, body: { messageid: `OUT${++n}` } };
    }
    return { ok: true, body: {} };
  };
  return { uaz, sent };
};

async function setup(opts: { group?: boolean } = {}) {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5585988880099', ai_direct_enabled: true })})`);
  if (opts.group) {
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `SEED${++n}`, chat_kind: 'group', group_jid: GROUP, group_name: 'Sócios', phone: '5585988880002', name: 'Ana', body: 'oi' })})`);
    const [g] = await q<{ id: string }>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(true)`);
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(true, true)`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', true)`);
  }
  const date = (await q<{ d: string }>(w.db, `select (conv_private.today() + 1)::text d`))[0].d;
  return { w, date };
}

const direct = (w: W, body: string, phone = '5585988880002', extra: Record<string, unknown> = {}) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `D${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Ana', kind: 'text', body, ...extra })})`);
const grp = (w: W, body: string, over: Record<string, unknown> = {}) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}${Math.random()}`, chat_kind: 'group', group_jid: GROUP, phone: '5585988880002', name: 'Ana', kind: 'text', body, ...over })})`);
const reservations = (w: W) => q<any>(w.db, `select * from public.reservations order by created_at`);
const turn = (w: W, messageId: string, chat: Chat | null, uaz: UazCaller | null): Promise<TurnResult> =>
  runTurn(messageId, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('conversa de reserva (individual)', () => {
  it('pedido incompleto → pergunta; dados completos → resumo com disponibilidade; "sim" → só então cria e avisa', async () => {
    const { w, date } = await setup();
    const p = provider();
    // 1) "hoje às 16h no saibro" — falta quem joga
    const m1 = await direct(w, 'Quero marcar amanhã às 16h no saibro');
    const s1 = script(answer({ messages: ['Claro! Quem vai jogar com você?'], awaiting: true, slots: { date, start: '16:00', court_label: 'saibro' } }));
    const r1 = await turn(w, m1.message_id, s1.chat, p.uaz);
    expect([r1.status, r1.bubbles]).toEqual(['replied', 1]);
    expect(p.sent.map((x) => x.text)).toEqual(['Claro! Quem vai jogar com você?']);
    expect(p.sent[0].number).toBe('5585988880002');
    expect((await reservations(w)).length).toBe(0);
    // 2) "com o Beto" → o servidor resolve no cadastro, consulta a quadra e monta a PROPOSTA
    await tick();
    const m2 = await direct(w, 'Com o Beto');
    const s2 = script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participant_names: ['Beto'] }, messages: ['Reservado! Pode ir jogar.'] }));
    const r2 = await turn(w, m2.message_id, s2.chat, p.uaz);
    expect(r2.action).toBe('proposed');
    expect(p.sent[1].text).toMatch(/^Verifiquei agora: o horário está livre\. Seria reserva amanhã, 16:00–17:00 na Quadra 1 para Ana Sócia e Beto Sócio\. Posso confirmar essa reserva\?$/);
    expect(p.sent.some((x) => /Reservado/.test(x.text))).toBe(false);   // o texto do modelo NÃO sai
    expect((await reservations(w)).length).toBe(0);                       // proposta ≠ reserva
    expect(s2.calls[0].user).toContain('# PROPOSTA ABERTA\nnenhuma');
    // 3) "sim" → o servidor confirma e escreve o aviso
    await tick();
    const m3 = await direct(w, 'sim, pode confirmar');
    const s3 = script(answer({ customer_confirmed: true, slots: { date, start: '16:00', court_label: 'saibro', participant_names: ['Beto'] } }));
    const r3 = await turn(w, m3.message_id, s3.chat, p.uaz);
    expect(r3.action).toBe('confirmed');
    expect(s3.calls[0].user).toContain('# PROPOSTA ABERTA\nreservar: Play');
    const [res] = await reservations(w);
    expect(res).toMatchObject({ type: 'Play', status: 'active', creator_id: U.socioA, court_id: w.court1, observation: 'Reserva via WhatsApp (IA)' });
    expect(p.sent[2].text).toBe('Reserva confirmada: reserva amanhã, 16:00–17:00 na Quadra 1 para Ana Sócia e Beto Sócio.');
    // as mensagens da IA entram no MESMO histórico da conversa, marcadas como IA
    const history = await q<any>(w.db, `select direction, origin, status, ai_session_id is not null as in_session from public.conv_messages order by created_at`);
    expect(history.filter((h) => h.origin === 'ai').length).toBe(3);
    expect(history.every((h) => h.origin === 'customer' || h.status === 'sent')).toBe(true);
    expect((await q<any>(w.db, `select status from public.conv_ai_sessions`))[0].status).toBe('done');
    expect((await q(w.db, `select 1 from public.conv_ai_decisions`)).length).toBe(3);
  }, 120000);

  it('o modelo diz que "reservou" sem confirmação: a frase não sai e nada é criado', async () => {
    const { w } = await setup();
    const p = provider();
    const m = await direct(w, 'Quero uma quadra');
    const s = script(answer({ messages: ['Pronto, reservei a Quadra 1 para você! Reserva confirmada.'] }));
    await turn(w, m.message_id, s.chat, p.uaz);
    expect(p.sent.length).toBe(1);
    expect(p.sent[0].text).not.toMatch(/reservei|confirmada/i);
    expect((await reservations(w)).length).toBe(0);
  }, 90000);

  it('o modelo marca "confirmado" mas a pessoa disse "talvez": o servidor recusa e pergunta de novo', async () => {
    const { w, date } = await setup();
    const p = provider();
    const m1 = await direct(w, 'Quero amanhã 16h no saibro, só eu');
    await turn(w, m1.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    await tick();
    const m2 = await direct(w, 'talvez');
    const r = await turn(w, m2.message_id, script(answer({ customer_confirmed: true, slots: { date, start: '16:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect(r.action).toBe('failed:NOT_EXPLICIT');
    expect(p.sent[p.sent.length - 1].text).toMatch(/responda "sim"/);
    expect((await reservations(w)).length).toBe(0);
  }, 90000);

  it('nome ambíguo ou inexistente vira pergunta; nada é escolhido por aproximação', async () => {
    const { w, date } = await setup();
    await w.db.exec(`insert into auth.users(id) values ('${ID(60)}'), ('${ID(61)}');
      insert into public.profiles(id, name, role, is_active) values ('${ID(60)}', 'João Silva', 'socio', true), ('${ID(61)}', 'João Pereira', 'socio', true)`);
    const p = provider();
    const m1 = await direct(w, 'amanhã 16h no saibro com o João');
    const r1 = await turn(w, m1.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participant_names: ['João'] } })).chat, p.uaz);
    expect(r1.action).toBe('ask');
    expect(p.sent[0].text).toBe('Tenho mais de um "João": João Pereira e João Silva. Qual deles?');
    await tick();
    const m2 = await direct(w, 'com o Zé Ninguém');
    await turn(w, m2.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participant_names: ['Zé Ninguém'] } })).chat, p.uaz);
    expect(p.sent[1].text).toMatch(/Não encontrei "Zé Ninguém" entre os sócios\. Essa pessoa é convidada sua\?/);
    expect((await q(w.db, `select 1 from public.conv_booking_proposals`)).length).toBe(0);
    // convidado dito pela própria pessoa vira reserva com convidado
    await tick();
    const m3 = await direct(w, 'sim, é convidado, Zé Ninguém');
    const r3 = await turn(w, m3.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participant_names: [], guest_name: 'Zé Ninguém', participants_known: true } })).chat, p.uaz);
    expect(r3.action).toBe('proposed');
    expect(p.sent[2].text).toContain('Zé Ninguém (convidado)');
  }, 120000);

  it('horário ocupado: oferece só os horários que o motor de reservas diz que estão livres', async () => {
    const { w, date } = await setup();
    await w.db.exec(`insert into public.reservations(court_id, creator_id, date, start_time, end_time, type, participant_ids) values
      ('${w.court1}', '${U.socioB}', '${date}', '16:00', '17:00', 'Play', '{}'), ('${w.court2}', '${U.socioB}', '${date}', '16:00', '19:00', 'Play', '{}')`);
    const p = provider();
    const m = await direct(w, 'amanhã 16h no saibro, só eu');
    await turn(w, m.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    const text = p.sent[0].text;
    expect(text).toMatch(/^Esse horário não está livre\. Livres amanhã: /);
    expect(text).toContain('Quadra 1: 14:30, 15:00, 17:00, 17:30');   // os 4 mais próximos de 16:00 que cabem 60 min
    expect(text).toContain('Quadra 2: 13:30, 14:00, 14:30, 15:00');
    expect(text).not.toContain('16:00');
    expect((await q(w.db, `select 1 from public.conv_booking_proposals where status = 'open'`)).length).toBe(0);
  }, 90000);

  it('data/horário passados, fora da grade ou depois do fechamento: o sistema explica; a IA não inventa', async () => {
    const { w, date } = await setup();
    const p = provider();
    const m = await direct(w, 'amanhã às 22:30 por 60 min');
    await turn(w, m.message_id, script(answer({ ready: true, slots: { date, start: '22:30', duration: 60, court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect(p.sent[0].text).toMatch(/passaria das 23:00/);
    await tick();
    const m2 = await direct(w, 'ontem');
    await turn(w, m2.message_id, script(answer({ ready: true, slots: { date: '2020-01-01', start: '10:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect(p.sent[1].text).toMatch(/já passou/);
    expect((await reservations(w)).length).toBe(0);
  }, 90000);

  it('telefone sem cadastro de sócio não reserva: a IA avisa e passa para a equipe', async () => {
    const { w, date } = await setup();
    const p = provider();
    const m = await direct(w, 'quero reservar amanhã às 16h', '5511912345678');
    const r = await turn(w, m.message_id, script(answer({ ready: true, slots: { date, start: '16:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect(r.status).toBe('handoff');
    expect(p.sent[0].text).toMatch(/Não consegui identificar o seu cadastro/);
    expect((await q<any>(w.db, `select ai_status, handoff_kind from public.conv_conversations`))[0]).toEqual({ ai_status: 'ai', handoff_kind: 'soft' });   // "soft": segue atendendo e avisa a equipe
    expect((await reservations(w)).length).toBe(0);
  }, 90000);

  it('cancelar e remarcar usam proposta + confirmação, e só as reservas da própria pessoa', async () => {
    const { w, date } = await setup();
    await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${ID(980)}', '${w.court1}', '${U.socioA}', '${date}', '10:00', '11:00', 'Play', array['${U.socioA}']::uuid[])`);
    const p = provider();
    const m1 = await direct(w, 'cancela minha reserva de amanhã às 10h');
    const r1 = await turn(w, m1.message_id, script(answer({ intent: 'cancelar', ready: true, slots: { reservation_ref: ID(980) } })).chat, p.uaz);
    expect(r1.action).toBe('proposed');
    expect(p.sent[0].text).toMatch(/^Vou cancelar a reserva amanhã, 10:00–11:00 na Quadra 1\. Posso cancelar\?/);
    expect((await reservations(w))[0].status).toBe('active');
    await tick();
    const m2 = await direct(w, 'sim');
    await turn(w, m2.message_id, script(answer({ intent: 'cancelar', customer_confirmed: true, slots: { reservation_ref: ID(980) } })).chat, p.uaz);
    expect((await reservations(w))[0].status).toBe('cancelled');
    expect(p.sent[1].text).toMatch(/foi cancelada\.$/);
    // reserva de outra pessoa não está na lista da IA: pedir por id inventado não cancela nada
    await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${ID(981)}', '${w.court2}', '${U.socioB}', '${date}', '12:00', '13:00', 'Play', '{}')`);
    await tick();
    const m3 = await direct(w, 'cancela a do Beto');
    await turn(w, m3.message_id, script(answer({ intent: 'cancelar', ready: true, slots: { reservation_ref: ID(981) } })).chat, p.uaz);
    expect(p.sent[2].text).toMatch(/Qual reserva\?/);
    expect((await q<any>(w.db, `select status from public.reservations where id = '${ID(981)}'`))[0].status).toBe('active');
  }, 120000);
});

describe('regras do turno que não dependem do modelo', () => {
  it('JSON inválido do modelo vira transferência (nunca silêncio nem invenção)', async () => {
    const { w } = await setup();
    const p = provider();
    const m = await direct(w, 'oi');
    const r = await turn(w, m.message_id, script('isto não é json').chat, p.uaz);
    expect(r.status).toBe('handoff');
    expect(p.sent[0].text).toMatch(/passar a sua conversa para alguém da equipe/);
    expect((await q<any>(w.db, `select ai_status from public.conv_conversations`))[0].ai_status).toBe('human');
  }, 90000);

  it('modelo indisponível ou sem chave: transfere sem chamar ninguém', async () => {
    const { w } = await setup();
    const p = provider();
    const m = await direct(w, 'oi');
    const r = await turn(w, m.message_id, null, p.uaz);
    expect(r.status).toBe('handoff');
    expect(p.sent.length).toBe(0);
    expect((await q<any>(w.db, `select handoff_note from public.conv_conversations`))[0].handoff_note).toMatch(/sem provedor/);
    const m2 = await direct(w, 'oi de novo');   // equipe assumiu: a IA cala
    expect((await turn(w, m2.message_id, script(answer()).chat, p.uaz)).status).toBe('skip');
  }, 90000);

  it('palavra de transferência e mídia sem texto vão para a equipe sem gastar o modelo', async () => {
    const { w } = await setup();
    const p = provider();
    const calls = script();
    const m = await direct(w, 'quero falar com um atendente');
    expect((await turn(w, m.message_id, calls.chat, p.uaz)).status).toBe('handoff');
    expect(calls.calls.length).toBe(0);
    const w2 = (await setup()).w;
    const m2 = await direct(w2, '', '5585988880002', { kind: 'image', body: null });
    expect((await turn(w2, m2.message_id, calls.chat, p.uaz)).status).toBe('handoff');
    expect(calls.calls.length).toBe(0);
  }, 120000);

  it('chegou mensagem nova durante o buffer: só a última responde', async () => {
    const { w } = await setup();
    const p = provider();
    const a = await direct(w, 'oi');
    const b = await direct(w, 'quero marcar uma quadra');
    const calls = script(answer({ messages: ['Posso ajudar! Qual dia?'], awaiting: true }));
    expect((await turn(w, a.message_id, calls.chat, p.uaz)).status).toBe('superseded');
    expect((await turn(w, b.message_id, calls.chat, p.uaz)).status).toBe('replied');
    expect(p.sent.length).toBe(1);
  }, 90000);

  it('falha do provedor ao enviar: a bolha fica "falhou", não "enviada", e o erro não vaza credencial', async () => {
    const { w } = await setup();
    const p = provider(true);
    const m = await direct(w, 'oi');
    await turn(w, m.message_id, script(answer({ messages: ['Olá! Como posso ajudar?'], intent: 'outro' })).chat, p.uaz);
    const [out] = await q<any>(w.db, `select status, last_error from public.conv_messages where origin = 'ai'`);
    expect([out.status, out.last_error]).toEqual(['failed', 'HTTP_503']);
  }, 90000);

  it('IA desligada ou fora do canal: o turno nem chama o modelo', async () => {
    const { w } = await setup();
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(false, false)`);
    const calls = script();
    const m = await direct(w, 'oi');
    expect(await turn(w, m.message_id, calls.chat, provider().uaz)).toMatchObject({ status: 'skip', reason: 'direct_ai_off' });
    expect(calls.calls.length).toBe(0);
  }, 90000);
});

describe('grupo: só quem chamou, só o seu contexto', () => {
  const mention = { mention: { direct: true, evidence: 'mentioned_bot_phone' } };

  it('menção direta abre o atendimento; a resposta cita a mensagem de quem pediu; o contexto não traz os outros', async () => {
    const { w, date } = await setup({ group: true });
    const p = provider();
    await grp(w, 'segredo do Beto: meu CPF é 123.456.789-00', { phone: '5585988880003', name: 'Beto' });
    const m = await grp(w, 'quero amanhã às 16h no saibro', mention);
    const s = script(answer({ messages: ['Claro! Quem vai jogar com você?'], awaiting: true, slots: { date, start: '16:00', court_label: 'saibro' } }));
    const r = await turn(w, m.message_id, s.chat, p.uaz);
    expect(r.status).toBe('replied');
    expect(p.sent[0].number).toBe(GROUP);
    const [mine] = await q<any>(w.db, `select provider_message_id from public.conv_messages where id = '${m.message_id}'`);
    expect(p.sent[0].replyid).toBe(mine.provider_message_id);   // responde ao solicitante
    expect(s.calls[0].user).not.toContain('CPF');
    expect(s.calls[0].user).not.toContain('Beto');
    expect(s.calls[0].system).toContain('ESTA CONVERSA É UM GRUPO');
  }, 120000);

  it('sem menção direta o modelo nem é chamado (@all, outra pessoa, texto digitado)', async () => {
    const { w } = await setup({ group: true });
    const calls = script();
    for (const body of ['@all reunião hoje', 'STC Institucional, quero uma quadra', 'bom dia, pessoal']) {
      const m = await grp(w, body, { mention: { direct: false, evidence: 'all_mention' } });
      expect((await turn(w, m.message_id, calls.chat, provider().uaz)).status).toBe('skip');
    }
    expect(calls.calls.length).toBe(0);
  }, 90000);

  it('"sim" de outro participante não confirma; o solicitante confirma depois e a reserva sai no nome dele', async () => {
    const { w, date } = await setup({ group: true });
    const p = provider();
    const m1 = await grp(w, 'quero amanhã às 17h no saibro, só eu', mention);
    await turn(w, m1.message_id, script(answer({ ready: true, slots: { date, start: '17:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect((await q(w.db, `select 1 from public.conv_booking_proposals where status = 'open'`)).length).toBe(1);
    await tick();
    // outro participante responde "sim": não aciona (não é o solicitante e não citou a IA)
    const intruder = await grp(w, 'sim', { phone: '5585988880003', name: 'Beto' });
    const calls = script();
    expect((await turn(w, intruder.message_id, calls.chat, p.uaz)).status).toBe('skip');
    expect(calls.calls.length).toBe(0);
    expect((await reservations(w)).length).toBe(0);
    // o solicitante confirma (sem nova menção: continuação)
    await tick();
    const yes = await grp(w, 'sim');
    const r = await turn(w, yes.message_id, script(answer({ customer_confirmed: true, slots: { date, start: '17:00', court_label: 'saibro', participants_known: true } })).chat, p.uaz);
    expect(r.action).toBe('confirmed');
    const [res] = await reservations(w);
    expect(res.creator_id).toBe(U.socioA);
    expect(p.sent[p.sent.length - 1].number).toBe(GROUP);
    expect(p.sent[p.sent.length - 1].text).toMatch(/^Reserva confirmada: reserva amanhã, 17:00–18:00 na Quadra 1 para Ana Sócia\.$/);
    const [a] = await q<any>(w.db, `select metadata from public.admin_audit_logs where action = 'conv.ai_reservation_created'`);
    expect(a.metadata).toMatchObject({ source: 'whatsapp', requester_profile_id: U.socioA });
    expect(a.metadata.group_id).toBeTruthy();
  }, 150000);

  it('rajada: pedido em duas mensagens seguidas responde uma vez só, lendo as duas', async () => {
    const { w, date } = await setup({ group: true });
    const p = provider();
    const a = await grp(w, 'quero uma quadra', mention);
    const b = await grp(w, 'amanhã às 16h');
    const s = script(answer({ messages: ['Entendi! Quem vai jogar com você?'], awaiting: true, slots: { date, start: '16:00' } }));
    expect((await turn(w, a.message_id, s.chat, p.uaz)).status).toBe('superseded');
    expect((await turn(w, b.message_id, s.chat, p.uaz)).status).toBe('replied');
    expect(s.calls[0].user).toContain('quero uma quadra\namanhã às 16h');
    expect(p.sent.length).toBe(1);
  }, 120000);
});
