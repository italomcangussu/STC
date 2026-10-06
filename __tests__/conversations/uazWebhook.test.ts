// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseUazWebhook } from '../../supabase/functions/_shared/uazWebhook';
import { classifyMention, extractMentions, mentionId, payloadShape, MAX_DELIBERATE_MENTIONS } from '../../supabase/functions/_shared/groupMention';

const BOT = { phone: '5585988880099', lids: ['262096671481918@lid'] };
const GRUPO = '120363025246125486@g.us';
const bruto = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  EventType: 'messages', message: { chatid: '5585999990001@s.whatsapp.net', messageid: 'wa-1', messageTimestamp: 1790000000, ...message }, ...extra });
const grupo = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  bruto({ chatid: GRUPO, isGroup: true, sender_pn: '5585988880002@s.whatsapp.net', sender: '999111@lid', senderName: 'Ana', ...message }, extra);

describe('webhook da UazAPI → Conversas (conversa direta, herdado do North Jato)', () => {
  it('texto do contato', () => {
    const e = parseUazWebhook(bruto({ sender_pn: '5585999990001@s.whatsapp.net', senderName: 'Maria', text: 'Oi, tem quadra?' }));
    expect(e).toMatchObject({ kind: 'message', message: { providerId: 'wa-1', phone: '5585999990001', name: 'Maria', body: 'Oi, tem quadra?', fromMe: false, kind: 'text',
      chat: { kind: 'direct' }, mentions: null, shape: null } });
  });

  it('remetente em formato LID usa o telefone do sender_pn; sem telefone, fica só o identificador opaco', () => {
    const a = parseUazWebhook(bruto({ chatid: '123@lid', sender: '123@lid', sender_pn: '5585999990001@s.whatsapp.net', text: 'Oi' }));
    expect(a.kind === 'message' && a.message.phone).toBe('5585999990001');
    const b = parseUazWebhook(bruto({ chatid: '123456789@lid', sender: '123456789@lid', text: 'Oi' }));
    expect(b).toMatchObject({ kind: 'message', message: { phone: '', lid: '123456789' } });
  });

  it('enviada pelo celular do clube: o contato é o chat; enviada pela API é ignorada (já foi gravada ao enfileirar)', () => {
    expect(parseUazWebhook(bruto({ fromMe: true, text: 'Temos sim' }))).toMatchObject({ kind: 'message', message: { phone: '5585999990001', fromMe: true, name: '' } });
    expect(parseUazWebhook(bruto({ fromMe: true, wasSentByApi: true, text: 'Olá' }))).toEqual({ kind: 'ignored', reason: 'enviada_pela_api' });
  });

  it('mídia, resposta citada, reação, edição, apagar e status', () => {
    expect(parseUazWebhook(bruto({ sender_pn: '5585999990001@s.whatsapp.net', mediaType: 'image', text: '', content: { URL: 'u', mediaKey: 'k', mimetype: 'image/jpeg' } })))
      .toMatchObject({ kind: 'message', message: { kind: 'image', hasMedia: true, mime: 'image/jpeg' } });
    const r = parseUazWebhook(bruto({ sender_pn: '5585999990001@s.whatsapp.net', text: 'esse', quoted: 'wa-0' }));
    expect(r.kind === 'message' && r.message.replyTo).toBe('wa-0');
    expect(parseUazWebhook(bruto({ type: 'reaction', reaction: 'wa-0', text: '👍' }))).toEqual({ kind: 'reaction', targetId: 'wa-0', emoji: '👍', fromMe: false });
    expect(parseUazWebhook(bruto({ edited: 'wa-0', text: 'novo' }))).toEqual({ kind: 'edit', targetId: 'wa-0', body: 'novo' });
    expect(parseUazWebhook(bruto({ content: { protocolMessage: { type: 'REVOKE', key: { id: 'wa-0' } } } }))).toEqual({ kind: 'delete', targetId: 'wa-0' });
    expect(parseUazWebhook({ EventType: 'messages_update', event: { Type: 'Read' }, data: { messageid: 'wa-9' } }))
      .toEqual({ kind: 'status', updates: [{ providerId: 'wa-9', status: 'read' }] });
  });

  it('evento desconhecido, sem mensagem ou incompleto é ignorado (nunca vira envio)', () => {
    expect(parseUazWebhook({ EventType: 'connection' })).toEqual({ kind: 'ignored', reason: 'evento_connection' });
    expect(parseUazWebhook({ EventType: 'messages' })).toEqual({ kind: 'ignored', reason: 'sem_mensagem' });
    expect(parseUazWebhook(bruto({ sender_pn: '5585999990001@s.whatsapp.net', text: '' }))).toEqual({ kind: 'ignored', reason: 'incompleta' });
    expect(parseUazWebhook({} as any)).toEqual({ kind: 'ignored', reason: 'evento_desconhecido' });
  });
});

describe('grupos: o NJ descartava; o STC identifica grupo, remetente e menções', () => {
  it('mensagem de grupo traz o JID do grupo, o remetente individual e o formato do payload (sem valores)', () => {
    const e = parseUazWebhook(grupo({ text: 'quem joga hoje?' }, { chat: { name: 'Sócios STC' } }));
    expect(e).toMatchObject({ kind: 'message', message: {
      chat: { kind: 'group', jid: GRUPO, name: 'Sócios STC' }, phone: '5585988880002', lid: '999111', name: 'Ana', body: 'quem joga hoje?' } });
    const shape = JSON.stringify((e as any).message.shape);
    expect(shape).toContain('chatid');
    expect(shape).not.toContain('quem joga hoje');   // só nomes e tipos, nunca valores
    expect(shape).not.toContain('5585988880002');
  });

  it('presença em grupo e grupo sem JID válido não viram sinal', () => {
    expect(parseUazWebhook({ EventType: 'presence', event: { Chat: GRUPO, State: 'composing' } })).toEqual({ kind: 'ignored', reason: 'presenca_invalida' });
    expect(parseUazWebhook(grupo({ chatid: 'abc', isGroup: true, text: 'oi' }))).toEqual({ kind: 'ignored', reason: 'grupo_sem_jid' });
  });

  it('lista de menções é lida nos lugares conhecidos; sem lista = sem metadado', () => {
    const e = parseUazWebhook(grupo({ text: '@5585988880099 quero uma quadra', content: { contextInfo: { mentionedJid: ['5585988880099@s.whatsapp.net'] } } }));
    expect((e as any).message.mentions).toMatchObject({ hasMetadata: true, ids: ['5585988880099'], allMarker: false, sources: ['content.contextInfo.mentionedJid'] });
    const sem = parseUazWebhook(grupo({ text: '@STC Institucional quero uma quadra' }));
    expect((sem as any).message.mentions).toMatchObject({ hasMetadata: false, ids: [] });
  });
});

describe('menção direta à conta institucional (fail-closed)', () => {
  const info = (message: Record<string, unknown>, text = 'quero uma quadra') => extractMentions(message, text);

  it('menção ao telefone da conta, pelo seletor do WhatsApp: direta', () => {
    const v = classifyMention(info({ mentions: ['5585988880099@s.whatsapp.net'] }), BOT);
    expect(v).toEqual({ direct: true, evidence: 'mentioned_bot_phone' });
  });

  it('menção pelo LID da conta, e telefone sem o nono dígito: direta', () => {
    expect(classifyMention(info({ content: { contextInfo: { mentionedJid: ['262096671481918@lid'] } } }), BOT)).toEqual({ direct: true, evidence: 'mentioned_bot_lid' });
    expect(classifyMention(info({ mentions: ['558588880099@s.whatsapp.net'] }), BOT).direct).toBe(true);
  });

  // Payload real da UazAPI em produção: a lista vem em `content.contextInfo.mentionedJID` (JID em maiúsculas), por LID.
  it('payload real do provedor (mentionedJID em maiúsculas, LID): menção ao LID da conta é direta', () => {
    const real = { messageType: 'ExtendedTextMessage', isGroup: true, content: { text: '@STC quero uma quadra', contextInfo: { mentionedJID: ['262096671481918@lid'] } } };
    const i = info(real);
    expect(i).toMatchObject({ hasMetadata: true, ids: ['262096671481918'], sources: ['content.contextInfo.mentionedJid'] });
    expect(classifyMention(i, BOT)).toEqual({ direct: true, evidence: 'mentioned_bot_lid' });
  });

  it('payload real: marcar outra pessoa por LID não aciona; texto puro (Conversation) não tem metadado', () => {
    const outra = { messageType: 'ExtendedTextMessage', content: { text: '@Ana oi', contextInfo: { mentionedJID: ['999000111222333@lid'] } } };
    expect(classifyMention(info(outra), BOT)).toEqual({ direct: false, evidence: 'mentions_other' });
    const puro = { messageType: 'Conversation', content: { text: 'STC Institucional quero uma quadra' } };
    expect(classifyMention(info(puro, 'STC Institucional quero uma quadra'), BOT)).toEqual({ direct: false, evidence: 'no_mention_metadata' });
  });

  it('as demais chaves de menção também aceitam qualquer caixa (mentions, groupMentions, nonJidMentions)', () => {
    expect(info({ MentionedJID: ['262096671481918@lid'] }).ids).toEqual(['262096671481918']);
    expect(info({ content: { contextInfo: { GroupMentions: [{ groupJid: 'x' }] } } }).allMarker).toBe(true);
    expect(info({ content: { contextInfo: { NonJidMentions: 2 } } }).allMarker).toBe(true);
  });

  it.each([
    ['@all no texto', { mentions: ['5585988880099@s.whatsapp.net'] }, '@all reunião às 20h', 'all_mention'],
    ['@todos no texto', { mentions: ['5585988880099@s.whatsapp.net'] }, 'Atenção @todos: jogo cancelado', 'all_mention'],
    ['@everyone', { mentions: ['5585988880099@s.whatsapp.net'] }, '@everyone olá', 'all_mention'],
    ['menção coletiva (nonJidMentions)', { content: { contextInfo: { mentionedJid: ['5585988880099@s.whatsapp.net'], nonJidMentions: 1 } } }, 'olá a todos', 'all_mention'],
    ['menção a outra pessoa', { mentions: ['5585988880002@s.whatsapp.net'] }, '@Ana vamos jogar?', 'mentions_other'],
    ['texto digitado "STC Institucional" sem metadado', {}, '@STC Institucional quero uma quadra', 'no_mention_metadata'],
    ['lista vazia', { mentions: [] }, 'oi', 'empty_mention_list'],
    ['lista grande (indistinguível de @all expandido)', { mentions: ['5585988880099', '1', '2', '3', '4'].map((x) => `${x}@s.whatsapp.net`) }, 'olá', 'too_many_mentions'],
  ])('não aciona: %s', (_nome, message, text, evidence) => {
    expect(classifyMention(info(message, text), BOT)).toEqual({ direct: false, evidence });
  });

  it('sem a identidade da conta configurada, nenhuma menção é reconhecida', () => {
    const i = info({ mentions: ['5585988880099@s.whatsapp.net'] });
    expect(classifyMention(i, { phone: null, lids: [] })).toEqual({ direct: false, evidence: 'no_bot_identity' });
  });

  it('o limite de menções deliberadas é pequeno e documentado', () => {
    expect(MAX_DELIBERATE_MENTIONS).toBe(3);
    const trio = info({ mentions: ['5585988880099@s.whatsapp.net', '5585988880002@s.whatsapp.net', '5585988880003@s.whatsapp.net'] });
    expect(classifyMention(trio, BOT).direct).toBe(true);
  });

  it('mentionId normaliza JID, dispositivo e LID', () => {
    expect(mentionId('5585988880099:12@s.whatsapp.net')).toBe('5585988880099');
    expect(mentionId('262096671481918@lid')).toBe('262096671481918');
    expect(mentionId(undefined)).toBe('');
  });

  it('payloadShape guarda só chaves e tipos, com limite', () => {
    const s = payloadShape({ a: 'segredo', b: { c: 1, d: [{ e: true }] }, f: null }) as any;
    expect(s).toEqual({ a: 'string', b: { c: 'number', d: [{ e: 'boolean' }] }, f: 'null' });
    const big = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'x']));
    expect(Object.keys(payloadShape(big) as object).length).toBeLessThanOrEqual(161);
  });
});
