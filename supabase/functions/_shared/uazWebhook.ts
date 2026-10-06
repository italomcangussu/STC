// Leitura dos webhooks da UazAPI (uazapiGO) para a caixa de Conversas.
//
// Portado de `supabase/functions/_shared/uazWebhook.ts` do North Jato (que veio do CRM
// Ibiapaba) e estendido para GRUPOS: o North Jato descarta grupos de propósito; aqui o grupo
// vira uma mensagem com `chat.kind = 'group'`, remetente individual e, quando o payload traz,
// a lista de menções (a classificação "menção direta à conta institucional" é feita depois,
// com a identidade da conta que só o banco conhece — ver `groupMention.ts`).
//
// Puro: sem I/O.

import { extractMentions, payloadShape, type MentionInfo } from './groupMention.ts';

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Rec;
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'ptt' | 'document' | 'sticker' | 'location' | 'contact' | 'other';

export type IncomingMessage = {
  providerId: string;
  /** Conversa direta (com um contato) ou de grupo. */
  chat: { kind: 'direct' | 'group'; /** `…@g.us` em grupo. */ jid: string; /** Nome do grupo, se o payload trouxer. */ name: string };
  /** Só dígitos, com DDI. Vazio quando o provedor só entrega o identificador opaco (LID). */
  phone: string;
  /** Identificador opaco do remetente (LID), sem domínio. */
  lid: string;
  name: string;
  /** Texto ou legenda. Vazio em mídia sem legenda. */
  body: string;
  fromMe: boolean;
  sentAt: string;
  kind: MessageKind;
  /** Tem arquivo para baixar em /message/download. */
  hasMedia: boolean;
  mime: string;
  fileName: string;
  /** Id do provedor da mensagem citada. */
  replyTo: string;
  meta: Record<string, unknown>;
  /** Menções encontradas no payload (só em grupo). */
  mentions: MentionInfo | null;
  /** Formato do payload — só nomes e tipos — para o administrador conferir o que o provedor entrega (só em grupo). */
  shape: unknown | null;
};

export type StatusUpdate = { providerId: string; status: 'delivered' | 'read' };
export type PresenceState = 'composing' | 'recording' | 'paused' | 'available';

export type UazEvent =
  | { kind: 'message'; message: IncomingMessage }
  | { kind: 'reaction'; targetId: string; emoji: string; fromMe: boolean }
  | { kind: 'edit'; targetId: string; body: string; mentions: MentionInfo | null }
  | { kind: 'delete'; targetId: string }
  | { kind: 'status'; updates: StatusUpdate[] }
  | { kind: 'presence'; phone: string; state: PresenceState }
  | { kind: 'ignored'; reason: string };

/** Rótulo para mídia sem texto: a caixa mostra o que chegou, mesmo sem abrir. */
const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Foto', imagemessage: '📷 Foto',
  video: '🎥 Vídeo', videomessage: '🎥 Vídeo',
  audio: '🎤 Áudio', ptt: '🎤 Áudio', audiomessage: '🎤 Áudio',
  document: '📄 Documento', documentmessage: '📄 Documento',
  sticker: '🌟 Figurinha', stickermessage: '🌟 Figurinha',
  location: '📍 Localização', locationmessage: '📍 Localização',
  contact: '👤 Contato', contactmessage: '👤 Contato', vcard: '👤 Contato',
};

function eventType(payload: Rec): string {
  const v = texto(payload.EventType ?? payload.eventType ?? payload.event ?? payload.type).toLowerCase();
  if (v === 'message.received' || v === 'message_upsert' || v === 'messages') return 'messages';
  if (v === 'message_update' || v === 'messages.update' || v === 'messages_update' || v === 'message.status') return 'messages_update';
  return v;
}

/** Escala do WhatsApp (ack numérico) ou texto. */
function mapStatus(value: unknown): StatusUpdate['status'] | null {
  if (typeof value === 'number') {
    if (value === 3 || value === 4) return 'read';
    if (value === 2) return 'delivered';
    return null;
  }
  const v = texto(value).toLowerCase();
  if (v.includes('read') || v.includes('played')) return 'read';
  if (v.includes('deliver')) return 'delivered';
  return null;
}

function collectIds(...sources: (Rec | null)[]): string[] {
  const ids: string[] = [];
  const add = (v: unknown) => { const s = texto(v); if (s && !ids.includes(s)) ids.push(s); };
  for (const src of sources) {
    if (!src) continue;
    for (const key of ['MessageIDs', 'messageIDs', 'messageIds', 'message_ids']) {
      const list = src[key];
      if (Array.isArray(list)) list.forEach(add);
    }
    for (const key of ['messageid', 'messageId', 'MessageID', 'MessageId', 'message_id']) add(src[key]);
  }
  return ids;
}

function messageText(message: Rec, content: Rec | null): string {
  const direto = [message.text, content?.text, content?.caption, message.caption, content?.conversation, message.body]
    .map(texto).find(Boolean);
  if (direto) return direto;
  const tipo = texto(message.mediaType ?? message.messageType ?? message.type).toLowerCase();
  return MEDIA_LABELS[tipo] ?? (tipo && tipo !== 'text' && tipo !== 'conversation' ? '📎 Anexo' : '');
}

/** Tipo da mensagem a partir do `mediaType`/`messageType` da UazAPI. */
function messageKind(message: Rec, content: Rec | null): MessageKind {
  const tipo = texto(message.mediaType ?? message.messageType ?? '').toLowerCase().replace(/message$/, '');
  if (tipo === 'ptt' || (tipo === 'audio' && content?.PTT === true)) return 'ptt';
  if (['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact'].includes(tipo)) return tipo as MessageKind;
  if (tipo === 'documentwithcaption') return 'document';
  if (tipo === 'livelocation') return 'location';
  if (tipo === 'contactsarray' || tipo === 'vcard') return 'contact';
  if (!tipo || ['conversation', 'extendedtext', 'text', 'chat'].includes(tipo)) return 'text';
  return 'other';
}

const MEDIA_KINDS: MessageKind[] = ['image', 'video', 'audio', 'ptt', 'document', 'sticker'];

function presenceState(raw: string): PresenceState | null {
  const v = raw.trim().toLowerCase();
  if (v.includes('compos') || v === 'typing') return 'composing';
  if (v.includes('record')) return 'recording';
  if (v.includes('paus')) return 'paused';
  if (v.includes('avail') || v === 'online') return 'available';
  return null;
}

const isGroupJid = (jid: string) => /@g\.us$/i.test(jid);
const digitsOf = (jid: string) => jid.split('@')[0].split(':')[0].replace(/\D/g, '');
/** `…@lid` → identificador opaco. Qualquer outra coisa → vazio. */
const lidOf = (jid: string) => (/@lid$/i.test(jid) ? jid.split('@')[0].split(':')[0].replace(/[^0-9A-Za-z._-]/g, '').toLowerCase() : '');

export function parseUazWebhook(payload: Rec, now: () => number = Date.now): UazEvent {
  const tipo = eventType(payload);

  if (tipo === 'messages_update') {
    const event = asRec(payload.event);
    const data = asRec(payload.data);
    const status = mapStatus(event?.Type ?? event?.type ?? payload.state ?? payload.status ?? data?.status ?? data?.state);
    if (!status) return { kind: 'ignored', reason: 'status_irrelevante' };
    const ids = collectIds(event, data, payload);
    return ids.length ? { kind: 'status', updates: ids.map((providerId) => ({ providerId, status })) } : { kind: 'ignored', reason: 'sem_id' };
  }

  if (tipo === 'presence' || tipo === 'chat_presence') {
    const src = asRec(payload.event) ?? asRec(payload.data) ?? payload;
    const chat = texto(src.Chat ?? src.chatid ?? src.chat ?? src.from ?? src.id);
    const state = presenceState(texto(src.State ?? src.state ?? src.Presence ?? src.presence ?? src.type));
    const phone = digitsOf(chat);
    // "Digitando" em grupo não vira sinal na tela: o grupo não tem um interlocutor só.
    if (!state || !phone || isGroupJid(chat)) return { kind: 'ignored', reason: 'presenca_invalida' };
    return { kind: 'presence', phone, state };
  }

  if (tipo !== 'messages') return { kind: 'ignored', reason: `evento_${tipo || 'desconhecido'}` };
  const message = asRec(payload.message);
  if (!message) return { kind: 'ignored', reason: 'sem_mensagem' };

  const chatid = texto(message.chatid);
  const group = isGroupJid(chatid) || message.isGroup === true;
  // Enviada pela própria API (confirmações, respostas desta tela, IA, automações) já está gravada.
  if (message.wasSentByApi === true) return { kind: 'ignored', reason: 'enviada_pela_api' };

  const fromMe = message.fromMe === true || texto(message.fromMe).toLowerCase() === 'true';
  const content = asRec(message.content);
  const providerId = texto(message.messageid) || texto(message.id);
  const tipoBruto = texto(message.type ?? message.messageType).toLowerCase();

  // Reação: vem como mensagem com o id da reagida em `reaction`.
  if (tipoBruto === 'reaction' || tipoBruto === 'reactionmessage') {
    const targetId = texto(message.reaction) || texto(asRec(content?.key)?.id);
    return targetId ? { kind: 'reaction', targetId, emoji: texto(message.text ?? content?.text), fromMe } : { kind: 'ignored', reason: 'reacao_sem_alvo' };
  }
  // Edição: `edited` aponta sempre para o id original.
  if (texto(message.edited)) {
    const body = texto(message.text ?? content?.text ?? content?.conversation);
    return body ? { kind: 'edit', targetId: texto(message.edited), body, mentions: group && !fromMe ? extractMentions(message, body) : null } : { kind: 'ignored', reason: 'edicao_vazia' };
  }
  // Apagar para todos: protocolMessage do tipo revoke.
  const protocolo = asRec(content?.protocolMessage) ?? (tipoBruto === 'protocolmessage' ? content : null);
  if (protocolo && /revoke|delete|^0$/i.test(texto(protocolo.type))) {
    const targetId = texto(asRec(protocolo.key)?.id) || texto(message.revoked);
    return targetId ? { kind: 'delete', targetId } : { kind: 'ignored', reason: 'exclusao_sem_alvo' };
  }

  // Quem é o interlocutor: em conversa direta, o destino (chat) numa mensagem nossa e o remetente na dele;
  // em grupo, o chat é o grupo e o remetente individual vem em `sender_pn`/`sender`.
  const senderPn = texto(message.sender_pn);
  const sender = texto(message.sender);
  const jid = group ? (senderPn || sender) : fromMe ? chatid : senderPn || sender || chatid;
  const phone = /@lid$/i.test(jid) ? '' : digitsOf(jid);
  const lid = group ? (lidOf(sender) || lidOf(jid)) : lidOf(jid);
  const kind = messageKind(message, content);
  const legenda = [message.text, content?.text, content?.caption, message.caption, content?.conversation, message.body]
    .map(texto).find(Boolean) ?? '';
  const hasMedia = MEDIA_KINDS.includes(kind) || Boolean(texto(content?.URL) && texto(content?.mediaKey));
  const body = legenda || (kind === 'other' || kind === 'contact' || kind === 'location' ? messageText(message, content) : '');
  const semInterlocutor = group ? false : !phone && !lid;
  if (!providerId || semInterlocutor || (!body && !hasMedia && kind === 'text')) return { kind: 'ignored', reason: 'incompleta' };
  if (group && !isGroupJid(chatid)) return { kind: 'ignored', reason: 'grupo_sem_jid' };

  const meta: Record<string, unknown> = {};
  if (kind === 'location') {
    const lat = Number(content?.degreesLatitude ?? content?.latitude);
    const lng = Number(content?.degreesLongitude ?? content?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(meta, { latitude: lat, longitude: lng, name: texto(content?.name), address: texto(content?.address) });
  }
  if (kind === 'contact') {
    Object.assign(meta, { displayName: texto(content?.displayName), vcard: texto(content?.vcard).slice(0, 2000) });
  }
  const seconds = Number(content?.seconds);
  if (Number.isFinite(seconds) && seconds > 0) meta.seconds = seconds;

  const ts = Number(message.messageTimestamp ?? payload.timestamp);
  // A UazAPI manda ora segundos, ora milissegundos.
  const millis = !Number.isFinite(ts) || ts <= 0 ? now() : ts < 1e12 ? ts * 1000 : ts;
  const chatInfo = asRec(payload.chat);
  return {
    kind: 'message',
    message: {
      providerId, phone, lid, body, fromMe, kind, hasMedia, meta,
      chat: group
        ? { kind: 'group', jid: chatid, name: texto(chatInfo?.name) || texto(message.groupName) || texto(chatInfo?.wa_name) }
        : { kind: 'direct', jid: chatid, name: '' },
      name: fromMe ? '' : texto(message.senderName) || (group ? '' : texto(chatInfo?.name)),
      sentAt: new Date(millis).toISOString(),
      mime: texto(content?.mimetype ?? content?.mimeType ?? message.mimetype),
      fileName: texto(content?.fileName ?? content?.title).slice(0, 120),
      replyTo: texto(message.quoted) || texto(asRec(content?.contextInfo)?.stanzaId),
      mentions: group && !fromMe ? extractMentions(message, body) : null,
      shape: group ? payloadShape({ ...payload, message }) : null,
    },
  };
}
