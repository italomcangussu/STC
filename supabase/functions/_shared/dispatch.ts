// Varredura periódica: automações vencidas, retornos agendados e sessões de IA expiradas.
//
// Portado de `_shared/automations.ts` e `_shared/chatFollowups.ts` do North Jato. As mensagens saem pela
// MESMA fila e pela MESMA conversa das respostas da equipe e da IA (`conv_messages`); a chave de
// idempotência é o id do destinatário/retorno — repetir a varredura, cair no meio ou reenviar nunca manda
// duas vezes. O banco escolhe e REVALIDA (`conv_svc_automation_claim`: janela, teto por contato, opt-out,
// estado atual da fonte); aqui só se envia e se informa o resultado ao banco. O texto vem pronto do banco
// (variáveis só de fonte confirmada): não há texto gerado por IA em automação.

import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from './uazChat.ts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

const first = <T,>(r: RpcResult): T | null => (Array.isArray(r.data) ? (r.data[0] as T) ?? null : null);

export type DispatchSummary = { claimed: number; sent: number; failed: number };

/** `{nome}` vira o primeiro nome do contato, como nas respostas rápidas. */
export function fillTemplate(body: string, fullName: string): string {
  const nome = fullName.trim().split(/\s+/)[0] ?? '';
  const valido = nome && !/^\+?\d/.test(nome) ? nome : '';
  return body.replace(/\{nome\}/gi, valido).replace(/ ,/g, ',').replace(/[ \t]{2,}/g, ' ').trim();
}

export async function dispatchAutomations(db: Db, uaz: UazCaller | null, limit = 20): Promise<DispatchSummary> {
  const resumo: DispatchSummary = { claimed: 0, sent: 0, failed: 0 };
  const r = await db('conv_svc_automation_claim', { p_limit: limit });
  if (r.error || !Array.isArray(r.data)) return resumo;
  for (const c of r.data as { recipient_id: string; conversation_id: string; body: string }[]) {
    resumo.claimed += 1;
    const fim = (message: string | null, ok: boolean, error: string | null) =>
      db('conv_svc_automation_finish', { p_recipient: c.recipient_id, p_message: message, p_ok: ok, p_error: error });
    // Sem provedor, nada é enviado nem marcado como enviado: volta para a fila (tentativas finitas).
    if (!uaz) { await fim(null, false, 'WHATSAPP_NOT_CONFIGURED'); resumo.failed += 1; continue; }
    const q = await db('conv_svc_automation_queue', { p_recipient: c.recipient_id, p_conversation: c.conversation_id, p_body: c.body });
    const row = first<{ message_id: string; destination: string; already_sent: boolean }>(q);
    if (!row) { await fim(null, false, q.error?.message?.slice(0, 120) ?? 'QUEUE_FAILED'); resumo.failed += 1; continue; }
    let erro: string | null = null;
    if (!row.already_sent) {
      const pedido = buildChatRequest({ action: 'send', number: row.destination, kind: 'text', text: c.body });
      const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
      await db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
        p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
      erro = uazError(res);
    }
    await fim(row.message_id, erro === null, erro);
    if (erro) resumo.failed += 1; else resumo.sent += 1;
  }
  return resumo;
}

type DueFollowup = { followup_id: string; conversation_id: string; send_body: string | null;
  media_path?: string | null; media_mime?: string | null; media_name?: string | null; media_kind?: string | null };
type Sent = { messageId: string | null; error: string | null };
type FollowupDeps = { db: Db; uaz: UazCaller; signedUrl?: (path: string) => Promise<string | null> };

/** Chave de idempotência do arquivo, derivada do id do retorno: repetir a varredura nunca manda o arquivo duas vezes. */
async function derivedKey(id: string, suffix: string): Promise<string> {
  const h = [...await sha256(`${id}:${suffix}`)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Enfileira na conversa e envia pela UazAPI; o banco registra o resultado. */
type Outgoing = { p: Record<string, unknown>; key: string; request: (destination: string) => Promise<ReturnType<typeof buildChatRequest>> };

async function queueAndSend(d: FollowupDeps, f: DueFollowup, { p, key, request }: Outgoing): Promise<Sent> {
  const q = await d.db('conv_svc_queue_message', { p_conversation: f.conversation_id, p, p_author: null, p_key: key, p_origin: 'system' });
  const row = first<{ message_id: string; destination: string; already_sent: boolean }>(q);
  if (!row) return { messageId: null, error: q.error?.message?.slice(0, 120) ?? 'QUEUE_FAILED' };
  if (row.already_sent) return { messageId: row.message_id, error: null };
  const pedido = await request(row.destination);
  const res = pedido ? await d.uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
  await d.db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
    p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
  return { messageId: row.message_id, error: uazError(res) };
}

async function sendText(d: FollowupDeps, f: DueFollowup): Promise<Sent> {
  const c = first<{ name: string | null }>(await d.db('conv_svc_conversation_contact', { p_conversation: f.conversation_id }));
  const corpo = fillTemplate(f.send_body ?? '', c?.name ?? '');
  return queueAndSend(d, f, { p: { kind: 'text', body: corpo }, key: f.followup_id,
    request: async (number) => buildChatRequest({ action: 'send', number, kind: 'text', text: corpo }) });
}

/** O arquivo do retorno (já no bucket conv-media) sai depois do texto, como imagem, documento, áudio ou vídeo. */
async function sendMedia(d: FollowupDeps, f: DueFollowup): Promise<Sent> {
  const kind = (f.media_kind ?? 'document') as 'image' | 'document' | 'audio' | 'video';
  const key = f.send_body ? await derivedKey(f.followup_id, 'media') : f.followup_id;
  return queueAndSend(d, f, { p: { kind, body: '', media_path: f.media_path, mime: f.media_mime, file_name: f.media_name }, key, request: async (number) => {
    const url = d.signedUrl && f.media_path ? await d.signedUrl(f.media_path) : null;
    return url ? buildChatRequest({ action: 'send', number, kind, fileUrl: url, mime: f.media_mime ?? undefined, fileName: f.media_name ?? undefined }) : null;
  } });
}

/** Um retorno: o texto (se houver) e depois o arquivo (se houver). O retorno guarda a última mensagem enviada. */
async function sendFollowup(d: FollowupDeps, f: DueFollowup): Promise<Sent> {
  let sent: Sent = { messageId: null, error: null };
  if (f.send_body) sent = await sendText(d, f);
  if (!sent.error && f.media_path) sent = await sendMedia(d, f);
  return sent;
}

/** Retornos agendados na caixa que carregam uma mensagem (texto e/ou arquivo): quando vencem, saem sozinhos. */
export async function dispatchFollowups(db: Db, uaz: UazCaller | null, opts: { limit?: number; signedUrl?: (path: string) => Promise<string | null> } = {}): Promise<DispatchSummary> {
  const resumo: DispatchSummary = { claimed: 0, sent: 0, failed: 0 };
  if (!uaz) return resumo;
  const r = await db('conv_svc_claim_due_followups', { p_limit: opts.limit ?? 20 });
  if (r.error || !Array.isArray(r.data)) return resumo;
  for (const f of r.data as DueFollowup[]) {
    resumo.claimed += 1;
    const { messageId, error } = await sendFollowup({ db, uaz, signedUrl: opts.signedUrl }, f);
    await db('conv_svc_finish_followup', { p_followup: f.followup_id, p_message: messageId, p_error: error });
    if (error) resumo.failed += 1; else resumo.sent += 1;
  }
  return resumo;
}

export type DispatchResult = { tick: unknown; expiredSessions: number; automations: DispatchSummary; followups: DispatchSummary };

/** Uma volta completa. Cada etapa é independente: falha em uma não impede as outras. */
export async function runDispatch(db: Db, uaz: UazCaller | null, signedUrl?: (path: string) => Promise<string | null>): Promise<DispatchResult> {
  const safe = async <T,>(fn: () => Promise<T>, vazio: T): Promise<T> => { try { return await fn(); } catch { return vazio; } };
  const tick = await safe(async () => (await db('conv_svc_automation_tick', {})).data, null);
  const expired = await safe(async () => Number((await db('conv_svc_ai_expire_sessions', {})).data ?? 0), 0);
  const automations = await safe(() => dispatchAutomations(db, uaz), { claimed: 0, sent: 0, failed: 0 });
  const followups = await safe(() => dispatchFollowups(db, uaz, { signedUrl }), { claimed: 0, sent: 0, failed: 0 });
  return { tick, expiredSessions: expired, automations, followups };
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/**
 * O agendador se identifica com o cabeçalho `x-dispatch-secret`. Sem segredo configurado (ou curto
 * demais), ninguém passa. Comparação por resumo SHA-256, em tempo constante. Compartilhada pelas
 * varreduras de Conversas e de Assinaturas: a checagem existe em um lugar só.
 */
export async function authorizedBySecret(request: Request, secret: string | undefined): Promise<boolean> {
  const given = request.headers.get('x-dispatch-secret') ?? '';
  if (!secret || secret.length < 24 || !given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type DispatchHttpDeps = { secret: string | undefined; run(): Promise<DispatchResult> };

/** Só o agendador, com o segredo, dispara a varredura. Sem segredo configurado, ninguém dispara. */
export async function handleDispatchRequest(request: Request, deps: DispatchHttpDeps): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!(await authorizedBySecret(request, deps.secret))) return json(401, { error: 'UNAUTHORIZED' });
  return json(200, await deps.run());
}
