// Despacho dos avisos de WhatsApp de Documentos e Assinaturas (publicação, sócio novo, lembretes).
//
// A fila é `sig_notifications`. O banco decide o que sai: `sig_svc_claim_notifications` entrega UM aviso
// por vez (já revalidado: documento ainda publicado, sócio ainda sem assinar, telefone existente) e
// `sig_svc_finish_notification` registra o resultado (3 tentativas com espera de 5 e 10 min; depois `failed`,
// e o admin usa "Reenviar falhas"). Aqui só se monta o texto, se envia e se informa o resultado.
//
// Um aviso por vez e intervalo aleatório entre eles: 26 mensagens iguais em rajada é o jeito de a
// instância do WhatsApp ser limitada. Sem provedor configurado nada é pego da fila (não gasta tentativa).

import { authorizedBySecret, type Db } from './dispatch.ts';
import { composeNotification, toWhatsappNumber } from './signatureMessages.ts';
import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from './uazChat.ts';

type Claimed = {
  id: string; document_id: string; profile_id: string; kind: string; slot: string;
  phone: string; name: string | null; title: string; due_at: string | null; attempts: number;
};

export type SignatureDispatchSummary = {
  /** O WhatsApp está configurado? Se não, nada foi pego da fila. */
  configured: boolean;
  claimed: number; sent: number; failed: number;
  /** Lembretes novos colocados na fila nesta volta. */
  reminders: number;
  /** `true` quando a fila esvaziou; `false` se parou por limite ou tempo (chame de novo). */
  done: boolean;
};

export type SignatureDispatchOptions = {
  appUrl: string;
  /** Máximo de avisos por volta. */
  limit?: number;
  /** Tempo máximo da volta (a função de borda tem prazo). */
  maxMs?: number;
  /** Intervalo entre mensagens: sorteado entre `[mín, máx]` ms. */
  jitterMs?: [number, number];
  /** Lembretes novos entram na fila antes de despachar (só o agendador faz isso). */
  reminders?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function dispatchSignatureNotifications(db: Db, uaz: UazCaller | null, opts: SignatureDispatchOptions): Promise<SignatureDispatchSummary> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const maxMs = opts.maxMs ?? 100_000;
  const [jMin, jMax] = opts.jitterMs ?? [1500, 3500];
  const sleep = opts.sleep ?? wait;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const started = now();
  const out: SignatureDispatchSummary = { configured: Boolean(uaz), claimed: 0, sent: 0, failed: 0, reminders: 0, done: false };

  if (opts.reminders) {
    try {
      const r = await db('sig_svc_enqueue_reminders', {});
      out.reminders = r.error ? 0 : Number(r.data ?? 0) || 0;
    } catch { /* lembrete é melhor esforço: não impede o despacho do que já está na fila */ }
  }
  if (!uaz) { out.done = true; return out; }

  while (out.claimed < limit) {
    if (out.claimed > 0 && now() - started >= maxMs) return out;
    const r = await db('sig_svc_claim_notifications', { p_limit: 1 });
    if (r.error || !Array.isArray(r.data)) return out;
    if (r.data.length === 0) { out.done = true; return out; }
    const n = r.data[0] as Claimed;
    out.claimed += 1;
    // Espera só se há mensagem para enviar (não gasta tempo depois da última). O aviso já está marcado
    // como "enviando"; ele só volta à fila depois de 10 min.
    if (out.claimed > 1) await sleep(Math.round(jMin + random() * Math.max(jMax - jMin, 0)));

    const number = toWhatsappNumber(n.phone);
    const text = composeNotification({
      kind: n.kind, slot: n.slot ?? '', name: n.name ?? '', title: n.title, dueAt: n.due_at, documentId: n.document_id, appUrl: opts.appUrl,
    });
    const pedido = number && text ? buildChatRequest({ action: 'send', number, kind: 'text', text }) : null;
    const res = pedido ? await uaz(pedido) : { ok: false as const, error: number ? 'UNKNOWN_KIND' : 'INVALID_PHONE' };
    await db('sig_svc_finish_notification', {
      p_id: n.id, p_sent: res.ok,
      p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null,
      p_error: uazError(res),
    });
    if (res.ok) out.sent += 1; else out.failed += 1;
  }
  return out;
}

export type SignatureCronDeps = { secret: string | undefined; run(): Promise<SignatureDispatchSummary> };

/** Só o agendador, com o segredo, dispara. A resposta traz contagens, nenhum dado de sócio. */
export async function handleSignatureCron(request: Request, deps: SignatureCronDeps): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!(await authorizedBySecret(request, deps.secret))) return json(401, { error: 'UNAUTHORIZED' });
  return json(200, await deps.run());
}
