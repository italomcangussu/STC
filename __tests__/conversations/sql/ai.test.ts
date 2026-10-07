// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
const GROUP = '120363025246125486@g.us';
let n = 0;

/** Liga o canal de IA: configuração ativa, direto ligado, grupo permitido com menção verificada. */
async function enable(w: W, opts: { group?: boolean } = {}) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', daily_turn_budget: 50 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5585988880099', ai_direct_enabled: true, group_session_minutes: 10 })})`);
  if (opts.group) {
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `SEED${++n}`, chat_kind: 'group', group_jid: GROUP, group_name: 'Sócios', phone: '5599900000002', name: 'Ana', body: 'oi' })})`);
    const [g] = await q<{ id: string }>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(true)`);
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(true, true)`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', true)`);
  }
}

const direct = (w: W, body: string, phone = '5599900000002') =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `D${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Ana', kind: 'text', body })})`);
const group = (w: W, over: Record<string, unknown> = {}) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}${Math.random()}`, chat_kind: 'group', group_jid: GROUP, phone: '5599900000002', name: 'Ana', kind: 'text', body: 'oi', ...over })})`);
const trigger = (w: W, id: string) => svc<any>(w.db, `public.conv_svc_ai_trigger('${id}')`);
/** A IA fala na sessão: grava a mensagem de saída ligada à sessão e finaliza o envio. */
async function aiSays(w: W, conversation: string, session: string, body: string, providerId: string) {
  const r = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${conversation}', ${j({ kind: 'text', body })}, null, '${key()}', 'ai', '${session}') x)`);
  await svc(w.db, `public.conv_svc_finish_message('${r.message_id}', true, '${providerId}', null)`);
  return r.message_id as string;
}

describe('gatilho da IA: só o que merece o modelo chega ao modelo', () => {
  it('IA desativada, sem modelo ou fora do canal: ninguém responde', async () => {
    const w = await world();
    const m = await direct(w, 'Oi');
    expect((await trigger(w, m.message_id)).reason).toBe('ai_inactive');
    expect(await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true })})`).catch((e) => String(e.message))).toMatch(/AI_MODEL_REQUIRED/);
    await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'm' })})`);
    expect((await trigger(w, m.message_id)).reason).toBe('direct_ai_off');   // canal direto desligado por padrão
  }, 60000);

  it('conversa direta: abre sessão, reaproveita enquanto vale, e para quando a equipe assume', async () => {
    const w = await world();
    await enable(w);
    const m1 = await direct(w, 'Quero marcar uma quadra');
    const t1 = await trigger(w, m1.message_id);
    expect([t1.run, t1.reason, t1.is_group]).toEqual([true, 'direct_message', false]);
    const m2 = await direct(w, 'Para amanhã');
    const t2 = await trigger(w, m2.message_id);
    expect(t2.session_id).toBe(t1.session_id);
    expect((await q(w.db, `select 1 from public.conv_ai_sessions`)).length).toBe(1);
    // a equipe assume ⇒ a IA cala
    await rpc(w.db, U.admin, `public.conv_set_ai_status('${m1.conversation_id}', 'human')`);
    const m3 = await direct(w, 'Alguém aí?');
    expect((await trigger(w, m3.message_id)).reason).toBe('not_ai_conversation');
    expect((await q<any>(w.db, `select status from public.conv_ai_sessions`))[0].status).toBe('handoff');
  }, 60000);

  it('só a última mensagem do solicitante responde (as anteriores são lidas juntas)', async () => {
    const w = await world();
    await enable(w);
    const a = await direct(w, 'Oi');
    const b = await direct(w, 'quero marcar');
    expect(await svc<boolean>(w.db, `public.conv_svc_ai_is_latest('${a.message_id}')`)).toBe(false);
    expect(await svc<boolean>(w.db, `public.conv_svc_ai_is_latest('${b.message_id}')`)).toBe(true);
  }, 60000);

  it('pedido de descadastro não aciona a IA', async () => {
    const w = await world();
    await enable(w);
    const m = await direct(w, 'parar');
    expect((await trigger(w, m.message_id)).reason).toBe('opt_out');
  }, 60000);

  it('teto de custo por dia: estourou, não chama o modelo', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'm', daily_turn_budget: 1 })})`);
    await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
    const m = await direct(w, 'Oi');
    const t = await trigger(w, m.message_id);
    await svc(w.db, `public.conv_svc_ai_save_turn('${t.session_id}', '{}'::jsonb, 'reply', '{}'::jsonb, false, false)`);
    const m2 = await direct(w, 'De novo');
    expect((await trigger(w, m2.message_id)).reason).toBe('budget_exhausted');
  }, 60000);
});

describe('grupo: menção direta, continuação e isolamento de contexto', () => {
  it('sem menção direta a IA não é acionada; com menção verificada, abre sessão só do solicitante', async () => {
    const w = await world();
    await enable(w, { group: true });
    const plain = await group(w, { body: 'bom dia pessoal' });
    expect((await trigger(w, plain.message_id)).reason).toBe('no_trigger');
    // texto digitado "STC Institucional" sem o metadado de menção: não aciona
    const typed = await group(w, { body: '@STC Institucional quero uma quadra' });
    expect((await trigger(w, typed.message_id)).reason).toBe('no_trigger');
    const m = await group(w, { body: 'quero marcar às 16h', mention: { direct: true, evidence: 'mentioned_bot_phone' } });
    const t = await trigger(w, m.message_id);
    expect([t.run, t.reason, t.is_group]).toEqual([true, 'direct_mention', true]);
    expect((await q<any>(w.db, `select requester_contact_id, status from public.conv_ai_sessions`))[0].requester_contact_id).toBe(m.contact_id);
  }, 60000);

  it('com a IA de grupo desligada ou a menção não verificada, nem a menção direta aciona', async () => {
    const w = await world();
    await enable(w);   // sem grupo
    await group(w);
    const [g] = await q<any>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    const m = await group(w, { body: 'quero marcar', mention: { direct: true, evidence: 'mentioned_bot_phone' } });
    expect((await trigger(w, m.message_id)).reason).toBe('group_ai_off');
  }, 60000);

  it('continuação: só o MESMO solicitante, enquanto a IA espera resposta e a sessão vale; outro participante é ignorado', async () => {
    const w = await world();
    await enable(w, { group: true });
    const m1 = await group(w, { body: 'quero marcar às 16h', mention: { direct: true, evidence: 'x' } });
    const t1 = await trigger(w, m1.message_id);
    // rajada: a 2ª mensagem do pedido (sem menção) chega antes de a IA falar e entra na MESMA sessão
    const early = await group(w, { body: 'amanhã' });
    const te = await trigger(w, early.message_id);
    expect([te.run, te.reason, te.session_id]).toEqual([true, 'burst', t1.session_id]);
    // só a última da rajada responde
    expect(await svc<boolean>(w.db, `public.conv_svc_ai_is_latest('${m1.message_id}')`)).toBe(false);
    // a IA respondeu SEM esperar nada (awaiting = false): mensagem solta depois disso não continua
    await svc(w.db, `public.conv_svc_ai_save_turn('${t1.session_id}', '{}'::jsonb, 'reply', '{}'::jsonb, false, false)`);
    const loose = await group(w, { body: 'valeu' });
    expect((await trigger(w, loose.message_id)).reason).toBe('no_trigger');
    await svc(w.db, `public.conv_svc_ai_save_turn('${t1.session_id}', '{}'::jsonb, 'reply', '{}'::jsonb, true, false)`);
    // outro participante responde: ignorado
    const other = await group(w, { phone: '5599900000003', name: 'Beto', body: 'eu também' });
    expect((await trigger(w, other.message_id)).reason).toBe('no_trigger');
    // o solicitante responde: continua, na MESMA sessão
    const mine = await group(w, { body: 'amanhã mesmo' });
    const t2 = await trigger(w, mine.message_id);
    expect([t2.run, t2.reason, t2.session_id]).toEqual([true, 'session_followup', t1.session_id]);
    // sessão expira: não continua
    await w.db.exec(`update public.conv_ai_sessions set expires_at = now() - interval '1 minute'`);
    const late = await group(w, { body: 'e então?' });
    expect((await trigger(w, late.message_id)).reason).toBe('no_trigger');
    expect(await svc<number>(w.db, `public.conv_svc_ai_expire_sessions()`)).toBe(1);
  }, 60000);

  it('resposta citando a fala da IA: do solicitante ou de administrador continua; de terceiro não', async () => {
    const w = await world();
    await enable(w, { group: true });
    const m1 = await group(w, { body: 'quero marcar', mention: { direct: true, evidence: 'x' } });
    const t1 = await trigger(w, m1.message_id);
    await aiSays(w, m1.conversation_id, t1.session_id, 'Para quando?', 'AI-PROV-1');
    await svc(w.db, `public.conv_svc_ai_save_turn('${t1.session_id}', '{}'::jsonb, 'reply', '{}'::jsonb, false, false)`);   // não espera mais
    const third = await group(w, { phone: '5599900000003', name: 'Beto', body: 'sábado', reply_to: 'AI-PROV-1' });
    expect((await trigger(w, third.message_id)).reason).toBe('other_sender');
    const admin = await group(w, { phone: '5599900000001', name: 'Admin', body: 'sábado', reply_to: 'AI-PROV-1' });
    const ta = await trigger(w, admin.message_id);
    expect([ta.run, ta.reason, ta.acting_admin]).toEqual([true, 'reply_to_ai', true]);
    const mine = await group(w, { body: 'sábado', reply_to: 'AI-PROV-1' });
    expect((await trigger(w, mine.message_id)).reason).toBe('reply_to_ai');
  }, 60000);

  it('o contexto do modelo em grupo só tem o solicitante e a IA: nada das conversas dos outros', async () => {
    const w = await world();
    await enable(w, { group: true });
    await group(w, { phone: '5599900000003', name: 'Beto', body: 'segredo do Beto: meu CPF é 123' });
    const m1 = await group(w, { body: 'quero marcar às 16h', mention: { direct: true, evidence: 'x' } });
    const t1 = await trigger(w, m1.message_id);
    await aiSays(w, m1.conversation_id, t1.session_id, 'Quem vai participar?', 'AI-2');
    const ctx = await svc<any>(w.db, `public.conv_svc_ai_context('${t1.session_id}')`);
    const bodies = ctx.transcript.map((t: any) => t.body);
    expect(bodies).toEqual(['quero marcar às 16h', 'Quem vai participar?']);
    expect(JSON.stringify(ctx)).not.toContain('CPF');
    expect(JSON.stringify(ctx)).not.toContain('5585');       // sem telefones
    expect(ctx.requester.profile.name).toBe('Ana Sócia');    // identificada pelo cadastro
    expect(ctx.requester.profile.is_admin).toBe(false);
    expect(ctx.is_group).toBe(true);
  }, 60000);

  it('transferência em grupo fecha a sessão e marca a conversa, sem desligar a IA do grupo inteiro', async () => {
    const w = await world();
    await enable(w, { group: true });
    const m1 = await group(w, { body: 'quero reclamar', mention: { direct: true, evidence: 'x' } });
    const t1 = await trigger(w, m1.message_id);
    await svc(w.db, `public.conv_svc_ai_handoff('${t1.session_id}', 'hard', 'Reclamação do sócio')`);
    const [c] = await q<any>(w.db, `select ai_status, handoff_kind, handoff_note from public.conv_conversations`);
    expect([c.ai_status, c.handoff_kind]).toEqual(['ai', 'hard']);
    expect((await q<any>(w.db, `select status from public.conv_ai_sessions`))[0].status).toBe('handoff');
    const inbox = await rpc<any[]>(w.db, U.admin, `(select jsonb_agg(to_jsonb(x)) from public.conv_inbox('handoff', null, 10) x)`);
    expect(inbox.length).toBe(1);
    // nova menção abre uma nova sessão
    const m2 = await group(w, { body: 'outra coisa', mention: { direct: true, evidence: 'x' } });
    expect((await trigger(w, m2.message_id)).run).toBe(true);
  }, 60000);
});
