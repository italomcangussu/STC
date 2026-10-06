// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { handleConversationRequest, conversationRpc, type ConversationEnv } from '../../supabase/functions/conversation-operations/handler';
import type { AdminDeps } from '../../supabase/functions/_shared/adminRequest';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';
import { WhatsappError, type WhatsappInstanceApi } from '../../supabase/functions/_shared/whatsappInstance';

const ORIGIN = 'https://stc.example';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const CONV = '00000000-0000-4000-8000-0000000000c1';
const MSG = '00000000-0000-4000-8000-0000000000a1';
const KEY = '00000000-0000-4000-8000-0000000000b1';
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://x/functions/v1/conversation-operations', {
  method: 'POST', body: JSON.stringify(body), headers: { origin: ORIGIN, authorization: 'Bearer jwt-valido', ...headers } });

type Calls = { name: string; args: Record<string, unknown>; ctx?: unknown }[];

function build(opts: { role?: string; active?: boolean; uaz?: UazCaller | null; send?: boolean; instance?: WhatsappInstanceApi | null; dbError?: Record<string, string> } = {}) {
  const calls: Calls = [];
  const provider: { path: string; body: any }[] = [];
  const uaz: UazCaller | null = opts.uaz === undefined ? (async (req) => { provider.push(req); return opts.send === false ? { ok: false, error: 'HTTP_503' } : { ok: true, body: { messageid: 'PROV-1' } }; }) : opts.uaz;
  const env: ConversationEnv = { uaz, instance: opts.instance ?? null, aiConfigured: true, signedMediaUrl: async () => 'https://signed/x', webhookUrl: (t) => `https://x/wh?token=${t}`, newToken: () => 'TOKEN-NOVO-'.padEnd(48, 'x') };
  const db: AdminDeps['rpc'] = async (name, args, ctx) => {
    calls.push({ name, args, ctx });
    if (opts.dbError?.[name]) return { data: null, error: { message: opts.dbError[name] } };
    switch (name) {
      case 'conv_svc_queue_message': return { data: [{ message_id: 'MSG-1', destination: '5585988880002', already_sent: false, reply_provider_id: null }], error: null };
      case 'conv_svc_message_target': return { data: [{ provider_message_id: 'PROV-0', destination: '5585988880002', direction: 'outbound', created_at: new Date().toISOString(), is_group: false }], error: null };
      case 'conv_svc_mark_read_collect': return { data: [{ destination: '5585988880002', provider_ids: ['P1'], is_group: false }], error: null };
      case 'conv_svc_conversation_contact': return { data: [{ contact_id: 'CT', destination: '5585988880002', avatar_url: null, avatar_checked_at: null, is_group: false }], error: null };
      case 'conv_svc_automation_test_payload': return { data: { phone: '5585988880001', body: '[TESTE] oi' }, error: null };
      default: return { data: null, error: null };
    }
  };
  const deps: AdminDeps = {
    verifyToken: async (t) => (t === 'jwt-valido' ? { userId: ADMIN } : null),
    loadActor: async () => ({ id: ADMIN, role: opts.role ?? 'admin', active: opts.active ?? true }),
    rpc: conversationRpc(db, env),
  };
  return { deps, calls, provider, handle: (req: Request) => handleConversationRequest(req, deps, { origin: ORIGIN }) };
}
const send = (extra: Record<string, unknown> = {}) => ({ action: 'send', conversationId: CONV, idempotencyKey: KEY, body: 'Olá!', ...extra });

describe('autorização no servidor (não só no menu)', () => {
  it('sem token, token inválido, origem estranha: recusado antes de qualquer ação', async () => {
    const h = build();
    expect((await h.handle(post(send(), { authorization: '' }))).status).toBe(401);
    expect((await h.handle(post(send(), { authorization: 'Bearer outro' }))).status).toBe(401);
    expect((await h.handle(post(send(), { origin: 'https://evil.example' }))).status).toBe(403);
    expect(h.calls.length).toBe(0);
    expect(h.provider.length).toBe(0);
  });

  it.each(['socio', 'lanchonete', 'professor', ''])('papel "%s" não administra Conversas: 403 e nada é enviado', async (role) => {
    const h = build({ role });
    const r = await h.handle(post(send()));
    expect(r.status).toBe(403);
    expect(h.calls.length).toBe(0);
    expect(h.provider.length).toBe(0);
  });

  it('administrador inativo também é recusado; o papel nunca vem do corpo', async () => {
    const h = build({ active: false });
    expect((await h.handle(post(send({ role: 'admin' })))).status).toBe(403);
    const ok = build();
    expect((await ok.handle(post({ ...send(), role: 'socio', actor: 'x' }))).status).toBe(201);
    expect(ok.calls[0].args.p_author).toBe(ADMIN);   // o autor é o do token, não o do corpo
  });

  it('ação desconhecida, corpo inválido e UUID malformado: 400', async () => {
    const h = build();
    expect((await h.handle(post({ action: 'apagar-tudo' }))).status).toBe(400);
    expect((await h.handle(post(send({ conversationId: 'x' })))).status).toBe(400);
    expect((await h.handle(post(send({ body: '   ' })))).status).toBe(400);
    expect((await h.handle(post(send({ kind: 'image', mediaPath: '../x' })))).status).toBe(400);
    expect((await h.handle(new Request('https://x/', { method: 'POST', body: '{{', headers: { origin: ORIGIN, authorization: 'Bearer jwt-valido' } }))).status).toBe(400);
  });
});

describe('envio: só o provedor diz se foi enviada', () => {
  it('sucesso: grava como staff com o autor, envia ao provedor e fecha como enviada', async () => {
    const h = build();
    const r = await h.handle(post(send({ replyToMessageId: MSG })));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ message: { id: 'MSG-1', status: 'sent' } });
    expect(h.calls.map((c) => c.name)).toEqual(['conv_svc_queue_message', 'conv_svc_finish_message']);
    expect(h.calls[0].args).toMatchObject({ p_origin: 'staff', p_author: ADMIN, p_key: KEY });
    expect(h.provider[0]).toEqual({ path: '/send/text', body: { number: '5585988880002', text: 'Olá!' } });
    expect(h.calls[1].args).toMatchObject({ p_sent: true, p_provider_id: 'PROV-1', p_error: null });
  });

  it('falha do provedor: resposta 502 com o código e a mensagem fica "falhou" com o erro, nunca "enviada"', async () => {
    const h = build({ send: false });
    const r = await h.handle(post(send()));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'WHATSAPP_SEND_FAILED' });
    expect(h.calls[1].args).toMatchObject({ p_sent: false, p_error: 'HTTP_503' });
  });

  it('provedor não configurado: 503 sem gravar nada', async () => {
    const h = build({ uaz: null });
    expect((await h.handle(post(send()))).status).toBe(503);
    expect(h.calls.length).toBe(0);
  });

  it('erro do banco vira código conhecido (sem expor mensagem do Postgres)', async () => {
    const h = build({ dbError: { conv_svc_queue_message: 'IDEMPOTENCY_KEY_REUSED: detalhe interno' } });
    const r = await h.handle(post(send()));
    expect([r.status, await r.json()]).toEqual([409, { error: 'IDEMPOTENCY_KEY_REUSED' }]);
    const g = build({ dbError: { conv_svc_queue_message: 'relation "x" does not exist' } });
    const r2 = await g.handle(post(send()));
    expect([r2.status, await r2.json()]).toEqual([400, { error: 'CONVERSATION_OPERATION_REJECTED' }]);
  });
});

describe('editar, apagar, reagir, ler', () => {
  it('editar/apagar para todos só mudam o banco depois que o WhatsApp aceitou', async () => {
    const ok = build();
    expect((await ok.handle(post({ action: 'edit', messageId: MSG, body: 'corrigido' }))).status).toBe(200);
    expect(ok.provider[0].path).toBe('/message/edit');
    expect(ok.calls.some((c) => c.name === 'conv_svc_staff_edit_message')).toBe(true);
    const no = build({ send: false });
    expect((await no.handle(post({ action: 'delete', messageId: MSG }))).status).toBe(502);
    expect(no.calls.some((c) => c.name === 'conv_svc_staff_delete_message')).toBe(false);   // o WhatsApp recusou: nada muda
  });

  it('marcar como lida avisa o provedor em melhor esforço, e a conversa de grupo não manda recibo', async () => {
    const h = build();
    expect((await h.handle(post({ action: 'mark-read', conversationId: CONV }))).status).toBe(200);
    expect(h.provider[0]).toEqual({ path: '/message/markread', body: { number: '5585988880002', id: ['P1'] } });
    expect((await h.handle(post({ action: 'mark-unread', conversationId: CONV }))).status).toBe(200);
  });
});

describe('instância e webhook: o token nunca chega ao navegador', () => {
  const instance = (over: Partial<WhatsappInstanceApi> = {}): WhatsappInstanceApi => ({
    status: async () => ({ state: 'connected', qrcode: null, profileName: 'STC Institucional', phone: '5585988880099' }),
    connect: async () => ({ state: 'connecting', qrcode: 'data:image/png;base64,AA', profileName: null, phone: null }),
    disconnect: async () => ({ state: 'disconnected', qrcode: null, profileName: null, phone: null }),
    registerWebhook: async () => undefined, ...over });

  it('estado da conexão: só o estado traduzido', async () => {
    const h = build({ instance: instance() });
    const r = await h.handle(post({ action: 'instance-status' }));
    expect(await r.json()).toEqual({ connection: { state: 'connected', qrcode: null, profileName: 'STC Institucional', phone: '5585988880099' } });
    expect((await build({ instance: null }).handle(post({ action: 'instance-status' }))).status).toBe(503);
    const bad = build({ instance: instance({ status: async () => { throw new WhatsappError('WHATSAPP_TOKEN_INVALID'); } }) });
    expect((await bad.handle(post({ action: 'instance-status' }))).status).toBe(502);
  });

  it('registrar webhook: troca o token como o administrador, registra a URL no provedor e NÃO devolve o token', async () => {
    let registered = '';
    const h = build({ instance: instance({ registerWebhook: async (u) => { registered = u; } }) });
    const r = await h.handle(post({ action: 'register-webhook' }));
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(registered).toContain('?token=TOKEN-NOVO-');
    expect(text).not.toContain('TOKEN-NOVO');
    const rot = h.calls.find((c) => c.name === 'as_user:conv_rotate_inbound_token')!;
    expect(rot.args.p_token).toContain('TOKEN-NOVO');
    expect(rot.ctx).toMatchObject({ actorId: ADMIN });   // o banco confere como o administrador
  });

  it('se o provedor recusa o registro, a resposta é erro (e o token ainda não vaza)', async () => {
    const h = build({ instance: instance({ registerWebhook: async () => { throw new WhatsappError('WHATSAPP_PROVIDER_ERROR'); } }) });
    const r = await h.handle(post({ action: 'register-webhook' }));
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain('TOKEN-NOVO');
  });
});

describe('mensagem de teste de automação', () => {
  it('vai ao telefone do PRÓPRIO administrador que o banco devolveu, nunca a número vindo do corpo', async () => {
    const h = build();
    const r = await h.handle(post({ action: 'test-automation', automationId: MSG, phone: '5511999999999' }));
    expect(r.status).toBe(200);
    expect(h.calls[0]).toMatchObject({ name: 'conv_svc_automation_test_payload', args: { p_actor: ADMIN, p_id: MSG } });
    expect(h.provider[0].body.number).toBe('5585988880001');
    expect(JSON.stringify(h.provider)).not.toContain('5511999999999');
    const none = build({ dbError: { conv_svc_automation_test_payload: 'ADMIN_WITHOUT_PHONE' } });
    expect((await none.handle(post({ action: 'test-automation', automationId: MSG }))).status).toBe(409);
  });
});
