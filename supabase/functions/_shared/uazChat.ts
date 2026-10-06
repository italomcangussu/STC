// Ações de chat na UazAPI (instância do clube).
//
// Construtor de requisições portado de `supabase/functions/_shared/uazChat.ts` do
// North Jato, que por sua vez veio do CRM Ibiapaba (`crm-uaz-chat-actions`). Contratos:
// /send/text e /send/media (com `replyid`), /message/react, /message/edit,
// /message/delete, /message/markread, /message/presence, /message/download,
// /message/find e /chat/details. O namespace de ações é /message/* — /chat/markread
// responde 405.
//
// Diferença para o North Jato: aqui o destino pode ser um GRUPO. O `number` de um
// grupo é o `chatid` do webhook (`…@g.us`) e NÃO pode ser reduzido a dígitos.
//
// Puro: sem I/O além do `fetch` injetado em `uazCaller`. O token da instância só
// existe no servidor.

export type OutboundKind = 'text' | 'image' | 'video' | 'audio' | 'ptt' | 'document';
export type PresenceState = 'composing' | 'recording' | 'paused' | 'available';

export type UazRequest = { path: string; body: Record<string, unknown> };

export type ChatRequest =
  | { action: 'send'; number: string; kind: OutboundKind; text?: string | null; fileUrl?: string | null;
      mime?: string | null; fileName?: string | null; replyId?: string | null }
  | { action: 'react'; number: string; messageId: string; emoji: string }
  | { action: 'edit'; messageId: string; text: string }
  | { action: 'delete'; messageId: string }
  | { action: 'markread'; number: string; messageIds: string[] }
  | { action: 'presence'; number: string; state: PresenceState }
  | { action: 'download'; messageId: string }
  | { action: 'find'; messageId: string }
  | { action: 'historySync'; number: string; messageId: string }
  | { action: 'details'; number: string };

const GROUP_JID = /^[0-9A-Za-z._-]{5,64}@g\.us$/;

/** Telefone → só dígitos. Grupo (`…@g.us`) → o próprio JID. Qualquer outra coisa com `@` é recusada. */
export function destination(value: string): string | null {
  const v = (value ?? '').trim();
  if (v.includes('@')) return GROUP_JID.test(v) ? v : null;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

export function buildChatRequest(input: ChatRequest): UazRequest | null {
  switch (input.action) {
    case 'send': {
      const number = destination(input.number);
      if (!number) return null;
      if (input.kind === 'text') {
        const text = (input.text ?? '').trim() ? input.text! : '';
        if (!text) return null;
        return { path: '/send/text', body: { number, text, ...(input.replyId ? { replyid: input.replyId } : {}) } };
      }
      if (!input.fileUrl) return null;
      const body: Record<string, unknown> = { number, type: input.kind, file: input.fileUrl };
      if (input.text?.trim()) body.text = input.text;
      if (input.mime) body.mimetype = input.mime;
      if (input.kind === 'document' && input.fileName) body.docName = input.fileName;
      if (input.replyId) body.replyid = input.replyId;
      return { path: '/send/media', body };
    }
    case 'react': {
      const number = destination(input.number);
      if (!input.messageId || !number) return null;
      // Emoji vazio remove a reação.
      return { path: '/message/react', body: { number, id: input.messageId, text: input.emoji ?? '' } };
    }
    case 'edit':
      if (!input.messageId || !input.text.trim()) return null;
      return { path: '/message/edit', body: { id: input.messageId, text: input.text } };
    case 'delete':
      return input.messageId ? { path: '/message/delete', body: { id: input.messageId } } : null;
    case 'markread': {
      const ids = input.messageIds.map((s) => s.trim()).filter(Boolean);
      const number = destination(input.number);
      return ids.length && number ? { path: '/message/markread', body: { number, id: ids } } : null;
    }
    case 'presence': {
      const number = destination(input.number);
      if (!number || !['composing', 'recording', 'paused', 'available'].includes(input.state)) return null;
      return { path: '/message/presence', body: { number, presence: input.state } };
    }
    case 'download':
      return input.messageId ? { path: '/message/download', body: { id: input.messageId } } : null;
    case 'find':
      return input.messageId ? { path: '/message/find', body: { id: input.messageId } } : null;
    case 'historySync': {
      const number = destination(input.number);
      return number && input.messageId ? { path: '/message/history-sync', body: { number, mode: 'exact', messageid: input.messageId } } : null;
    }
    case 'details': {
      const number = destination(input.number);
      return number ? { path: '/chat/details', body: { number, preview: true } } : null;
    }
  }
}

export type UazResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };
export type UazCaller = (request: UazRequest) => Promise<UazResult>;

/** Código do erro de um envio (o projeto não usa `strict`, então o TypeScript não estreita a união sozinho). */
export const uazError = (r: UazResult): string | null => (r.ok ? null : (r as { ok: false; error: string }).error);

/**
 * O erro devolvido é só um código (`HTTP_<status>`, `TIMEOUT`, `NETWORK_ERROR`): nunca a
 * resposta crua do provedor, que pode ecoar token ou payload.
 */
export function uazCaller(config: { serverUrl: string; instanceToken: string }, fetcher: typeof fetch = fetch): UazCaller {
  const base = config.serverUrl.replace(/\/+$/, '');
  return async ({ path, body }) => {
    try {
      const r = await fetcher(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', token: config.instanceToken },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const json = await r.json().catch(() => ({})) as Record<string, unknown>;
      return r.ok ? { ok: true, body: json } : { ok: false, error: `HTTP_${r.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
    }
  };
}

/** Id da mensagem na resposta do envio (a UazAPI varia o nome do campo). */
export function providerIdFrom(body: Record<string, unknown>): string | null {
  const key = body.key as Record<string, unknown> | undefined;
  const id = body.messageid ?? body.messageId ?? body.id ?? key?.id;
  return typeof id === 'string' && id ? id : null;
}

/** URL do avatar em `/chat/details`. */
export function avatarFrom(body: Record<string, unknown>): string | null {
  for (const k of ['imagePreview', 'image', 'profilePicUrl', 'profilePictureUrl']) {
    const v = body[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

// --- Mídia recebida ---

const MIME_EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/wav': 'wav',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'application/pdf': 'pdf',
};

export function extensionForMimetype(mimetype: string): string {
  const base = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base];
  const sub = base.includes('/') ? base.slice(base.indexOf('/') + 1) : '';
  return sub.replace(/[^a-z0-9]/g, '') || 'bin';
}

/** `in/<id da mensagem>/<id do provedor>.<ext>` — o id do provedor pode ter caracteres estranhos. */
export function inboundMediaPath(messageId: string, providerId: string, mimetype: string): string {
  const safe = providerId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100) || 'arquivo';
  return `in/${messageId}/${safe}.${extensionForMimetype(mimetype)}`;
}
