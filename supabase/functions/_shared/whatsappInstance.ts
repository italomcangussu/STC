// A instância de WhatsApp do clube, vista pelo painel de Conversas.
//
// Portado de `_shared/whatsappInstance.ts` do North Jato. O token da instância só existe no
// servidor (STC_UAZAPI_INSTANCE_TOKEN): o navegador pede "status", "conectar" ou "desconectar"
// e recebe o estado já traduzido — nunca o token, nunca a resposta crua da UazAPI.

export type WhatsappState = 'connected' | 'connecting' | 'disconnected';

export type WhatsappConnection = {
  state: WhatsappState;
  /** `data:image/png;base64,…` enquanto espera a leitura; `null` no resto. */
  qrcode: string | null;
  profileName: string | null;
  /** Número conectado, só dígitos. */
  phone: string | null;
};

type Instance = { status?: unknown; qrcode?: unknown; profileName?: unknown; owner?: unknown };
type StatusBody = { instance?: Instance; status?: { connected?: unknown } };

export function toConnection(body: StatusBody): WhatsappConnection {
  const instance = body.instance ?? {};
  const connected = body.status?.connected === true || instance.status === 'connected';
  const state: WhatsappState = connected ? 'connected' : instance.status === 'connecting' ? 'connecting' : 'disconnected';
  const qr = typeof instance.qrcode === 'string' && instance.qrcode.length > 0 ? instance.qrcode : null;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    state,
    qrcode: state === 'connecting' && qr ? (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`) : null,
    profileName: state === 'connected' ? texto(instance.profileName) : null,
    phone: state === 'connected' ? texto(instance.owner)?.replace(/\D/g, '') || null : null,
  };
}

export type WhatsappInstanceApi = {
  status(): Promise<WhatsappConnection>;
  connect(): Promise<WhatsappConnection>;
  disconnect(): Promise<WhatsappConnection>;
  /**
   * Aponta o webhook da instância para o clube (mensagens, estados, presença e conexão).
   * NÃO filtra grupos (`isGroupYes`): a decisão de gravar um grupo é do administrador, no banco.
   */
  registerWebhook(url: string): Promise<void>;
};

export class WhatsappError extends Error {}

/** Cliente da instância própria do clube. `null` sem configuração. */
export function whatsappInstance(
  config: { serverUrl: string; instanceToken: string } | null,
  fetcher: typeof fetch = fetch,
): WhatsappInstanceApi | null {
  if (!config) return null;
  const base = config.serverUrl.replace(/\/+$/, '');
  const headers = { token: config.instanceToken, 'content-type': 'application/json' };

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let r: Response;
    try {
      r = await fetcher(`${base}${path}`, {
        method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new WhatsappError('WHATSAPP_PROVIDER_UNREACHABLE');
    }
    if (!r.ok) throw new WhatsappError(r.status === 401 ? 'WHATSAPP_TOKEN_INVALID' : 'WHATSAPP_PROVIDER_ERROR');
    return r.json().catch(() => ({}));
  }

  // Conectar e desconectar respondem com formatos próprios; o estado mostrado vem sempre do status, lido logo depois.
  const status = async () => toConnection(await call('GET', '/instance/status') as StatusBody);
  return {
    status,
    connect: async () => { await call('POST', '/instance/connect'); return status(); },
    disconnect: async () => { await call('POST', '/instance/disconnect'); return status(); },
    registerWebhook: async (url) => {
      await call('POST', '/webhook', {
        enabled: true, url, events: ['messages', 'messages_update', 'presence', 'connection'],
        // O que o próprio clube enviou pela API (confirmações, IA, automações) não volta como entrada.
        excludeMessages: ['wasSentByApi'],
      });
    },
  };
}
