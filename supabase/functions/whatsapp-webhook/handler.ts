// Entrada de eventos da UazAPI (mensagens recebidas, estados, presença, conexão do número).
//
// Autorização: o token secreto na URL, gerado pelo painel (`conv_rotate_inbound_token`) e guardado
// no banco só como HASH SHA-256. Sem o token certo, qualquer um injetaria mensagens falsas na caixa
// de conversas e na IA. O provedor recebe 200 logo: demora ou erro nosso não pode fazê-lo reenviar em
// rajada — o processamento acontece em segundo plano e é idempotente pelo id da mensagem.
//
// Padrão do `whatsapp-webhook` do North Jato, sem o repasse ao n8n (o STC não tem esse fluxo).

export type ChannelDelivery = {
  inbound_token_hash: string | null;
  bot_phone: string | null;
  bot_lids: string[];
  ai_direct_enabled: boolean;
  ai_group_enabled: boolean;
  mention_verified_at: string | null;
  group_session_minutes: number;
  institutional_name: string;
};

export type WebhookDeps = {
  loadChannel(): Promise<ChannelDelivery | null>;
  /** Mantém a função viva até o processamento terminar, sem segurar a resposta. */
  background(task: Promise<unknown>): void;
  record(payload: Record<string, unknown>, channel: ChannelDelivery): Promise<unknown>;
};

const MAX_BODY = 256 * 1024;

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante de dois hex do mesmo tamanho. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function handleWhatsappWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const channel = await deps.loadChannel();
  if (!channel?.inbound_token_hash || !token || !sameHex(await sha256Hex(token), channel.inbound_token_hash)) {
    return json(401, { error: 'UNAUTHORIZED' });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return json(400, { error: 'INVALID_JSON' }); }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return json(400, { error: 'INVALID_JSON' });

  // Falha ao gravar NUNCA vira envio: o `record` só grava; qualquer erro é engolido aqui (e registrado lá).
  deps.background(deps.record(payload, channel).catch(() => undefined));
  return json(200, { received: true });
}
