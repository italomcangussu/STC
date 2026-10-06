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
  return body.replace(/\{nome\}/gi, valido).replace(/ ,/g, ',').replace(/\s{2,}/g, ' ').trim();
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

/** Retornos agendados na caixa que carregam uma mensagem: quando vencem, a mensagem sai sozinha. */
export async function dispatchFollowups(db: Db, uaz: UazCaller | null, limit = 20): Promise<DispatchSummary> {
  const resumo: DispatchSummary = { claimed: 0, sent: 0, failed: 0 };
  if (!uaz) return resumo;
  const r = await db('conv_svc_claim_due_followups', { p_limit: limit });
  if (r.error || !Array.isArray(r.data)) return resumo;
  for (const f of r.data as { followup_id: string; conversation_id: string; send_body: string }[]) {
    resumo.claimed += 1;
    const c = first<{ name: string | null }>(await db('conv_svc_conversation_contact', { p_conversation: f.conversation_id }));
    const corpo = fillTemplate(f.send_body, c?.name ?? '');
    const q = await db('conv_svc_queue_message', { p_conversation: f.conversation_id, p: { kind: 'text', body: corpo },
      p_author: null, p_key: f.followup_id, p_origin: 'system' });
    const row = first<{ message_id: string; destination: string; already_sent: boolean }>(q);
    if (!row) {
      await db('conv_svc_finish_followup', { p_followup: f.followup_id, p_message: null, p_error: q.error?.message?.slice(0, 120) ?? 'QUEUE_FAILED' });
      resumo.failed += 1;
      continue;
    }
    let erro: string | null = null;
    if (!row.already_sent) {
      const pedido = buildChatRequest({ action: 'send', number: row.destination, kind: 'text', text: corpo });
      const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
      await db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
        p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
      erro = uazError(res);
    }
    await db('conv_svc_finish_followup', { p_followup: f.followup_id, p_message: row.message_id, p_error: erro });
    if (erro) resumo.failed += 1; else resumo.sent += 1;
  }
  return resumo;
}

export type DispatchResult = { tick: unknown; expiredSessions: number; automations: DispatchSummary; followups: DispatchSummary };

/** Uma volta completa. Cada etapa é independente: falha em uma não impede as outras. */
export async function runDispatch(db: Db, uaz: UazCaller | null): Promise<DispatchResult> {
  const safe = async <T,>(fn: () => Promise<T>, vazio: T): Promise<T> => { try { return await fn(); } catch { return vazio; } };
  const tick = await safe(async () => (await db('conv_svc_automation_tick', {})).data, null);
  const expired = await safe(async () => Number((await db('conv_svc_ai_expire_sessions', {})).data ?? 0), 0);
  const automations = await safe(() => dispatchAutomations(db, uaz), { claimed: 0, sent: 0, failed: 0 });
  const followups = await safe(() => dispatchFollowups(db, uaz), { claimed: 0, sent: 0, failed: 0 });
  return { tick, expiredSessions: expired, automations, followups };
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export type DispatchHttpDeps = { secret: string | undefined; run(): Promise<DispatchResult> };

/** Só o agendador, com o segredo, dispara a varredura. Sem segredo configurado, ninguém dispara. */
export async function handleDispatchRequest(request: Request, deps: DispatchHttpDeps): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const given = request.headers.get('x-dispatch-secret') ?? '';
  if (!deps.secret || deps.secret.length < 24 || !given) return json(401, { error: 'UNAUTHORIZED' });
  const [a, b] = await Promise.all([sha256(given), sha256(deps.secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  if (diff !== 0) return json(401, { error: 'UNAUTHORIZED' });
  return json(200, await deps.run());
}
