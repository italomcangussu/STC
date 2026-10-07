import { describe, expect, it } from 'vitest';
import { buildAdminPush, type PushMessageRow } from '../../supabase/functions/whatsapp-webhook/pushNotify';

const row = (over: Partial<PushMessageRow> = {}, conv: Partial<NonNullable<PushMessageRow['conv_conversations']>> = {}): PushMessageRow => ({
  id: 'm1', body: 'Oi, bom dia', kind: 'text', direction: 'inbound', conversation_id: 'c1',
  conv_conversations: { kind: 'direct', conv_contacts: { name: 'Hermeson', phone: '5588997500863' }, ...conv },
  ...over,
});

describe('aviso push aos administradores', () => {
  it('mensagem direta de entrada vira notificação com o nome, o texto e o link da conversa', () => {
    expect(buildAdminPush(row())).toEqual({
      admin_broadcast: true, title: 'Hermeson', body: 'Oi, bom dia', url: '/conversas', tag: 'conv-c1',
      data: { conversationId: 'c1', messageId: 'm1' },
    });
  });

  it('sem nome no cadastro, o título é o telefone', () => {
    expect(buildAdminPush(row({}, { conv_contacts: { name: null, phone: '5588997500863' } }))?.title).toBe('+5588997500863');
  });

  it('mídia sem texto ganha frase própria (áudio de voz é "ptt")', () => {
    expect(buildAdminPush(row({ body: null, kind: 'ptt' }))?.body).toBe('🎤 Mensagem de áudio');
    expect(buildAdminPush(row({ body: null, kind: 'image' }))?.body).toBe('📷 Foto recebida');
    expect(buildAdminPush(row({ body: null, kind: 'document' }))?.body).toBe('📎 Arquivo recebido');
  });

  it('texto longo é cortado em 90 caracteres', () => {
    const t = buildAdminPush(row({ body: 'a'.repeat(200) }))!.body;
    expect(t).toHaveLength(90);
    expect(t.endsWith('...')).toBe(true);
  });

  it('grupo, mensagem do clube e linha ausente não notificam', () => {
    expect(buildAdminPush(row({}, { kind: 'group' }))).toBeNull();
    expect(buildAdminPush(row({ direction: 'outbound' }))).toBeNull();
    expect(buildAdminPush(null)).toBeNull();
  });
});
