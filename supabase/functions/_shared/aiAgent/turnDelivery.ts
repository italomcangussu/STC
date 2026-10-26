// Entrega do turno: bolhas de texto (com "digitando" e guarda de takeover), arquivos como documento e reação com emoji.
// Toda saída passa pela fila da conversa (conv_svc_queue_message) antes de ir para a UazAPI.

import { type UazRequest, buildChatRequest, providerIdFrom, uazError } from '../uazChat.ts';
import { type OutFile, type TurnDeps, first } from './turnTypes.ts';

export type Bubble = { text: string; delayMs: number };

type DeliveryInput = {
  deps: TurnDeps; conversation: string; session: string; isGroup: boolean;
  /** Mensagem da pessoa que esta resposta cita (no grupo) e que recebe a reação. */
  replyTo: string | undefined;
  /** Esta ainda é a última mensagem do solicitante? Chegou outra ou a equipe assumiu → para de falar. */
  latest: () => Promise<boolean>;
};

type Queued = { message_id: string; destination: string; reply_provider_id?: string | null };
const NOT_CONFIGURED = { ok: false as const, error: 'WHATSAPP_NOT_CONFIGURED' };

export function turnDelivery({ deps, conversation, session, isGroup, replyTo, latest }: DeliveryInput) {
  const { db } = deps;

  /** "digitando..." enquanto espera a cadência da bolha. Melhor esforço. */
  const typing = async () => {
    if (!deps.uaz) return;
    const dest = first<{ destination: string }>(await db('conv_svc_conversation_contact', { p_conversation: conversation }));
    const p = dest ? buildChatRequest({ action: 'presence', number: dest.destination, state: 'composing' }) : null;
    if (p) await deps.uaz(p).catch(() => undefined);
  };

  /** Enfileira na conversa, manda pela UazAPI e registra o resultado. Devolve se saiu. */
  const send = async (p: Record<string, unknown>, request: (q: Queued) => Promise<UazRequest | null>): Promise<boolean> => {
    const q = first<Queued>(await db('conv_svc_queue_message', {
      p_conversation: conversation, p, p_author: null, p_key: crypto.randomUUID(), p_origin: 'ai', p_session: session,
    }));
    if (!q) return false;
    const pedido = await request(q);
    const res = deps.uaz && pedido ? await deps.uaz(pedido) : NOT_CONFIGURED;
    await db('conv_svc_finish_message', { p_message: q.message_id, p_sent: res.ok, p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
    return res.ok;
  };

  /** Bolhas de texto na cadência; no grupo, a primeira cita a mensagem da pessoa. Para na primeira falha ou takeover. */
  const entregar = async (bolhas: Bubble[]) => {
    let enviadas = 0;
    for (const [i, b] of bolhas.entries()) {
      if (b.delayMs) { await typing(); await deps.sleep(b.delayMs); }
      // Guarda de takeover: chegou mensagem nova do solicitante ou a equipe assumiu → para de falar.
      if (!(await latest())) break;
      const ok = await send({ kind: 'text', body: b.text, reply_to_message_id: isGroup && i === 0 && replyTo ? replyTo : null },
        async (q) => buildChatRequest({ action: 'send', number: q.destination, kind: 'text', text: b.text, replyId: q.reply_provider_id ?? null }));
      if (!ok) break;
      enviadas += 1;
    }
    return enviadas;
  };

  /** Arquivos como documento (comprovante, PDF): enfileira, assina o link da mídia e manda. */
  const entregarArquivos = async (arquivos: OutFile[]) => {
    let enviados = 0;
    for (const f of arquivos) {
      if (!(await latest())) break;
      const kind = f.kind ?? 'document';
      const ok = await send({ kind, body: f.caption, media_path: f.path, mime: f.mime, file_name: f.name }, async (q) => {
        const url = deps.files ? await deps.files.signedUrl(f.path) : null;
        return url ? buildChatRequest({ action: 'send', number: q.destination, kind, text: f.caption, fileUrl: url, mime: f.mime, fileName: f.name }) : null;
      });
      if (!ok) break;
      enviados += 1;
    }
    return enviados;
  };

  // Reação com emoji na mensagem da pessoa: o WhatsApp é a fonte da verdade (recusou → nada muda no banco).
  // Melhor esforço: falhar em reagir nunca derruba o turno.
  const reagir = async (emoji: string): Promise<boolean> => {
    if (!deps.uaz || !replyTo) return false;
    try {
      const alvo = first<{ provider_message_id: string | null; destination: string | null }>(await db('conv_svc_message_target', { p_message: replyTo }));
      if (!alvo?.provider_message_id || !alvo.destination) return false;
      if (!(await latest())) return false;
      const pedido = buildChatRequest({ action: 'react', number: alvo.destination, messageId: alvo.provider_message_id, emoji });
      const res = pedido ? await deps.uaz(pedido) : null;
      if (!res?.ok) return false;
      await db('conv_svc_staff_react', { p_message: replyTo, p_emoji: emoji });
      return true;
    } catch { return false; }
  };
  return { entregar, entregarArquivos, reagir };
}
