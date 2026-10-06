// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { handleWhatsappWebhook, sha256Hex, sameHex, type ChannelDelivery } from '../../supabase/functions/whatsapp-webhook/handler';
import { recordInbound, type RecordDeps } from '../../supabase/functions/whatsapp-webhook/record';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

const TOKEN = 'T'.repeat(48);
const GROUP = '120363025246125486@g.us';
const channel = async (over: Partial<ChannelDelivery> = {}): Promise<ChannelDelivery> => ({
  inbound_token_hash: await sha256Hex(TOKEN), bot_phone: '5585988880099', bot_lids: [], ai_direct_enabled: true, ai_group_enabled: true,
  mention_verified_at: '2026-10-06T10:00:00Z', group_session_minutes: 15, institutional_name: 'STC Institucional', ...over });

const post = (body: unknown, token = TOKEN, method = 'POST') =>
  new Request(`https://x.example/functions/v1/whatsapp-webhook?token=${token}`, { method, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });

function harness(over: Partial<ChannelDelivery> = {}) {
  const recorded: Record<string, unknown>[] = [];
  const tasks: Promise<unknown>[] = [];
  const deps = {
    loadChannel: async () => channel(over).then((c) => (over.inbound_token_hash === null ? { ...c, inbound_token_hash: null } : c)),
    background: (t: Promise<unknown>) => { tasks.push(t); },
    record: async (payload: Record<string, unknown>) => { recorded.push(payload); },
  };
  return { deps, recorded, flush: () => Promise.all(tasks) };
}

describe('webhook: autorização e transporte', () => {
  it('token certo: 200 e processa em segundo plano; token errado, ausente ou canal sem token: 401 e nada é processado', async () => {
    const h = harness();
    const ok = await handleWhatsappWebhook(post({ EventType: 'messages' }), h.deps);
    expect(ok.status).toBe(200);
    await h.flush();
    expect(h.recorded.length).toBe(1);
    for (const token of ['errado', '', 'T'.repeat(47)]) {
      expect((await handleWhatsappWebhook(post({ EventType: 'messages' }, token), h.deps)).status).toBe(401);
    }
    const semToken = harness({ inbound_token_hash: null });
    expect((await handleWhatsappWebhook(post({ EventType: 'messages' }), semToken.deps)).status).toBe(401);
    await Promise.all([h.flush(), semToken.flush()]);
    expect(h.recorded.length).toBe(1);
    expect(semToken.recorded.length).toBe(0);
  });

  it('só POST; JSON inválido ou fora do tamanho não chega ao processamento', async () => {
    const h = harness();
    expect((await handleWhatsappWebhook(post(null, TOKEN, 'GET'), h.deps)).status).toBe(405);
    expect((await handleWhatsappWebhook(post('{{{'), h.deps)).status).toBe(400);
    expect((await handleWhatsappWebhook(post('[1,2]'), h.deps)).status).toBe(400);
    expect((await handleWhatsappWebhook(post('x'.repeat(256 * 1024 + 1)), h.deps)).status).toBe(413);
    expect(h.recorded.length).toBe(0);
  });

  it('falha ao gravar não derruba a resposta (o provedor não reenvia em rajada)', async () => {
    const h = harness();
    h.deps.record = async () => { throw new Error('banco fora do ar'); };
    const r = await handleWhatsappWebhook(post({ EventType: 'messages' }), h.deps);
    expect(r.status).toBe(200);
    await expect(h.flush()).resolves.toBeDefined();
  });

  it('comparação do hash em tempo constante', () => {
    expect(sameHex('ab', 'ab')).toBe(true);
    expect(sameHex('ab', 'ac')).toBe(false);
    expect(sameHex('ab', 'abc')).toBe(false);
  });
});

describe('webhook: o que é gravado e quem aciona a IA', () => {
  const evento = (message: Record<string, unknown>) => ({ EventType: 'messages', message: { chatid: '5585999990001@s.whatsapp.net', messageid: `wa-${Math.random()}`,
    messageTimestamp: 1790000000, sender_pn: '5585999990001@s.whatsapp.net', senderName: 'Maria', text: 'Oi', ...message } });
  const fake = (result: unknown = { message_id: 'M1', conversation_id: 'C1', duplicate: false }) => {
    const calls: { name: string; args: any }[] = [];
    const inbound: string[] = [];
    const deps: RecordDeps = {
      rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'conv_svc_ingest_message' ? result : null, error: null }; },
      uaz: (async () => ({ ok: true, body: {} })) as UazCaller, store: async () => true, broadcast: async () => undefined,
      onInbound: (id) => inbound.push(id), background: () => undefined };
    return { deps, calls, inbound };
  };

  it('mensagem do contato é gravada e aciona o gatilho da IA UMA vez; webhook repetido não aciona de novo', async () => {
    const f = fake();
    expect(await recordInbound(evento({}), await channel(), f.deps)).toBe('mensagem');
    expect(f.inbound).toEqual(['M1']);
    const dup = fake({ message_id: 'M1', conversation_id: 'C1', duplicate: true });
    expect(await recordInbound(evento({}), await channel(), dup.deps)).toBe('duplicada');
    expect(dup.inbound).toEqual([]);
  });

  it('o que o clube enviou do celular (fromMe) é gravado como equipe e NÃO aciona a IA', async () => {
    const f = fake();
    await recordInbound(evento({ fromMe: true }), await channel(), f.deps);
    expect(f.inbound).toEqual([]);
    expect(f.calls[0].args.p.from_me).toBe(true);
  });

  it('grupo: leva o JID, o remetente e a classificação da menção; grupo não permitido não grava nem aciona', async () => {
    const f = fake();
    const ev = evento({ chatid: GROUP, isGroup: true, sender_pn: '5585988880002@s.whatsapp.net', text: 'quero quadra',
      content: { contextInfo: { mentionedJid: ['5585988880099@s.whatsapp.net'] } } });
    await recordInbound(ev, await channel(), f.deps);
    const p = f.calls[0].args.p;
    expect(p).toMatchObject({ chat_kind: 'group', group_jid: GROUP, phone: '5585988880002', mention: { direct: true, evidence: 'mentioned_bot_phone' } });
    expect(f.inbound).toEqual(['M1']);   // quem decide se responde é o banco (conv_svc_ai_trigger)
    const blocked = fake({ ignored: 'group_not_allowed', group_status: 'detected' });
    expect(await recordInbound(ev, await channel(), blocked.deps)).toBe('grupo_nao_permitido');
    expect(blocked.inbound).toEqual([]);
  });

  it('sem identidade configurada ou sem metadado de menção, o webhook NÃO finge que sabe: direct=false e a evidência diz por quê', async () => {
    const f = fake();
    await recordInbound(evento({ chatid: GROUP, isGroup: true, text: '@STC Institucional oi' }), await channel(), f.deps);
    expect(f.calls[0].args.p.mention).toEqual({ direct: false, evidence: 'no_mention_metadata' });
    const g = fake();
    await recordInbound(evento({ chatid: GROUP, isGroup: true, text: 'oi', mentions: ['5585988880099'] }), await channel({ bot_phone: null }), g.deps);
    expect(g.calls[0].args.p.mention).toEqual({ direct: false, evidence: 'no_bot_identity' });
  });

  it('erro do banco, payload inválido e evento desconhecido não aciona IA nem envia nada', async () => {
    const quebrado: RecordDeps = { ...fake().deps, rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    expect(await recordInbound(evento({}), await channel(), quebrado)).toBe('erro_ao_gravar');
    const f = fake();
    expect(await recordInbound({ EventType: 'algo_novo' }, await channel(), f.deps)).toBe('evento_algo_novo');
    expect(await recordInbound({} as any, await channel(), f.deps)).toBe('evento_desconhecido');
    expect(f.inbound).toEqual([]);
    expect(f.calls.every((c) => c.name === 'conv_svc_log_webhook')).toBe(true);   // só o registro curto, sem conteúdo
    expect(JSON.stringify(f.calls)).not.toContain('Oi');
  });

  it('status, reação, edição e exclusão atualizam por id do provedor', async () => {
    const f = fake();
    await recordInbound({ EventType: 'messages_update', event: { Type: 'Delivered' }, data: { messageid: 'wa-9' } }, await channel(), f.deps);
    expect(f.calls[0]).toEqual({ name: 'conv_svc_update_message_status', args: { p_provider_id: 'wa-9', p_status: 'delivered' } });
    await recordInbound(evento({ type: 'reaction', reaction: 'wa-1', text: '👍' }), await channel(), f.deps);
    expect(f.calls[1].name).toBe('conv_svc_apply_reaction');
  });

  it('mídia: baixa pelo provedor, guarda no bucket e liga à mensagem; sem arquivo a mensagem fica sem mídia (não inventa)', async () => {
    const f = fake();
    f.deps.uaz = (async () => ({ ok: true, body: { fileURL: 'https://cdn/x', mimetype: 'image/jpeg' } })) as UazCaller;
    const stored: string[] = [];
    f.deps.store = async (path) => { stored.push(path); return true; };
    const r = await recordInbound(evento({ mediaType: 'image', text: '', content: { URL: 'u', mediaKey: 'k', mimetype: 'image/jpeg' } }), await channel(), f.deps);
    expect(r).toBe('mensagem_com_midia');
    expect(stored[0]).toMatch(/^in\/M1\/wa-.*\.jpg$/);
    expect(f.calls.some((c) => c.name === 'conv_svc_set_message_media')).toBe(true);
    const g = fake();
    g.deps.store = async () => false;
    expect(await recordInbound(evento({ mediaType: 'image', text: '', content: { URL: 'u', mediaKey: 'k' } }), await channel(), g.deps)).toBe('mensagem_midia_pendente');
    expect(g.calls.some((c) => c.name === 'conv_svc_set_message_media')).toBe(false);
  });
});
