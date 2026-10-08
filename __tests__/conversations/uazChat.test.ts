// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildChatRequest, destination, providerIdFrom, uazCaller, uazError, inboundMediaPath, extensionForMimetype } from '../../supabase/functions/_shared/uazChat';
import { toConnection, whatsappInstance } from '../../supabase/functions/_shared/whatsappInstance';

describe('envio pela UazAPI', () => {
  it('telefone vira dígitos; grupo mantém o JID; destino inválido é recusado', () => {
    expect(destination('+55 (85) 98888-0002')).toBe('5585988880002');
    expect(destination('120363025246125486@g.us')).toBe('120363025246125486@g.us');
    expect(destination('abc@evil.com')).toBeNull();
    expect(destination('123')).toBeNull();
    expect(buildChatRequest({ action: 'send', number: 'x@g.us', kind: 'text', text: 'oi' })).toBeNull();
  });

  it('texto, resposta citada, mídia e ações no contrato do provedor', () => {
    expect(buildChatRequest({ action: 'send', number: '120363025246125486@g.us', kind: 'text', text: 'Olá', replyId: 'wa-1' }))
      .toEqual({ path: '/send/text', body: { number: '120363025246125486@g.us', text: 'Olá', replyid: 'wa-1' } });
    expect(buildChatRequest({ action: 'send', number: '5585988880002', kind: 'text', text: '   ' })).toBeNull();
    expect(buildChatRequest({ action: 'send', number: '5585988880002', kind: 'document', fileUrl: 'https://x/f.pdf', fileName: 'f.pdf', mime: 'application/pdf' }))
      .toEqual({ path: '/send/media', body: { number: '5585988880002', type: 'document', file: 'https://x/f.pdf', mimetype: 'application/pdf', docName: 'f.pdf' } });
    expect(buildChatRequest({ action: 'markread', number: '5585988880002', messageIds: ['a', ' '] })).toEqual({ path: '/message/markread', body: { number: '5585988880002', id: ['a'] } });
    expect(buildChatRequest({ action: 'presence', number: '5585988880002', state: 'composing' })?.path).toBe('/message/presence');
    expect(buildChatRequest({ action: 'delete', messageId: '' })).toBeNull();
  });

  it('o erro devolvido é só um código: nunca o corpo do provedor nem o token', async () => {
    const token = 'segredo-da-instancia';
    const respostas: [() => Promise<Response>, string][] = [
      [async () => new Response(JSON.stringify({ error: `token ${token} inválido` }), { status: 401 }), 'HTTP_401'],
      [async () => { throw new Error(`falha de rede com ${token}`); }, 'NETWORK_ERROR'],
      [async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, 'TIMEOUT'],
    ];
    for (const [fn, code] of respostas) {
      const r = await uazCaller({ serverUrl: 'https://uaz.example', instanceToken: token }, fn as any)({ path: '/send/text', body: { number: '5585988880002', text: 'x' } });
      expect(r).toEqual({ ok: false, error: code });
      expect(JSON.stringify(r)).not.toContain(token);
      expect(uazError(r)).toBe(code);
    }
    let headers: Record<string, string> = {};
    const ok = await uazCaller({ serverUrl: 'https://uaz.example/', instanceToken: token }, (async (_u: string, init: any) => { headers = init.headers; return new Response('{"messageid":"M1"}'); }) as any)({ path: '/x', body: {} });
    expect(headers.token).toBe(token);   // o token viaja só no cabeçalho para o provedor
    expect(ok.ok && providerIdFrom(ok.body)).toBe('M1');
    expect(uazError(ok)).toBeNull();
  });

  it('caminho de mídia recebida e extensões', () => {
    // barras são removidas: o id do provedor nunca sai da pasta da mensagem
    expect(inboundMediaPath('abc', 'WA/../x', 'audio/ogg; codecs=opus')).toBe('in/abc/WA..x.ogg');
    expect(extensionForMimetype('application/vnd.x')).toBe('vndx');
  });
});

describe('instância do clube', () => {
  it('estado traduzido; QR só enquanto conecta; nunca o token', () => {
    expect(toConnection({ instance: { status: 'connected', profileName: 'STC Institucional', owner: '5585988880099' }, status: { connected: true } }))
      .toEqual({ state: 'connected', qrcode: null, profileName: 'STC Institucional', phone: '5585988880099' });
    expect(toConnection({ instance: { status: 'connecting', qrcode: 'AAA' } })).toMatchObject({ state: 'connecting', qrcode: 'data:image/png;base64,AAA' });
    expect(toConnection({})).toEqual({ state: 'disconnected', qrcode: null, profileName: null, phone: null });
    expect(whatsappInstance(null)).toBeNull();
  });

  it('o webhook é registrado sem filtrar grupos (a decisão é do administrador) e sem reentrada do que o clube enviou', async () => {
    let body: any;
    const api = whatsappInstance({ serverUrl: 'https://uaz.example', instanceToken: 't' }, (async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response('{}'); }) as any)!;
    await api.registerWebhook('https://x/functions/v1/whatsapp-webhook?token=abc');
    expect(body.excludeMessages).toEqual(['wasSentByApi']);
    expect(JSON.stringify(body)).not.toContain('isGroup');
    expect(body.events).toEqual(expect.arrayContaining(['messages', 'messages_update']));
  });
});

describe('menção no grupo', () => {
  it('número com @ no texto do grupo vira mentions; no privado não', () => {
    expect(buildChatRequest({ action: 'send', number: '120363046963315575@g.us', kind: 'text', text: '@5588999990000 cadê você? e o @5588988887777 também' })?.body)
      .toMatchObject({ mentions: '5588999990000,5588988887777' });
    expect(buildChatRequest({ action: 'send', number: '5588999990000', kind: 'text', text: '@5588999990000 oi' })?.body).not.toHaveProperty('mentions');
    expect(buildChatRequest({ action: 'send', number: '120363046963315575@g.us', kind: 'text', text: 'email a@b.com, nada de menção' })?.body).not.toHaveProperty('mentions');
  });
});
