/**
 * Aviso push aos administradores quando chega mensagem direta no WhatsApp do clube.
 * Puro e testável: a função de borda só injeta o acesso ao banco e o disparo do `send-push`.
 */

export type PushMessageRow = {
  id: string;
  body: string | null;
  kind: string | null;
  direction?: string | null;
  conversation_id: string;
  conv_conversations?: { kind?: string | null; conv_contacts?: { name?: string | null; phone?: string | null } | null } | null;
};

export type AdminPush = {
  admin_broadcast: true;
  title: string;
  body: string;
  url: string;
  tag: string;
  data: { conversationId: string; messageId: string };
};

const MEDIA_TEXT: Record<string, string> = {
  image: '📷 Foto recebida',
  video: '🎬 Vídeo recebido',
  audio: '🎤 Mensagem de áudio',
  ptt: '🎤 Mensagem de áudio',
  sticker: '🏷️ Figurinha recebida',
};

/** Texto da notificação; nulo quando não é para avisar (grupo, mensagem do clube). */
export function buildAdminPush(msg: PushMessageRow | null): AdminPush | null {
  if (!msg || msg.direction === 'outbound') return null;
  const conv = msg.conv_conversations;
  if (conv?.kind !== 'direct') return null;

  const contact = conv.conv_contacts;
  const phone = contact?.phone ? `+${String(contact.phone).replace(/^\+/, '')}` : '';
  const title = contact?.name?.trim() || phone || 'Nova mensagem no WhatsApp';
  const text = msg.body?.trim()
    ? (msg.body.length > 90 ? `${msg.body.slice(0, 87)}...` : msg.body)
    : (MEDIA_TEXT[msg.kind ?? ''] ?? '📎 Arquivo recebido');

  return {
    admin_broadcast: true,
    title,
    body: text,
    url: '/conversas',
    tag: `conv-${msg.conversation_id}`,
    data: { conversationId: msg.conversation_id, messageId: msg.id },
  };
}
