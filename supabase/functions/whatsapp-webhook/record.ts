// O que o webhook grava na caixa de Conversas, por tipo de evento.
//
// Separado do transporte para ser testado sem rede. A mídia segue o fluxo do North Jato/CRM
// Ibiapaba: a mensagem entra primeiro, e o arquivo — criptografado no CDN do WhatsApp — é pedido
// já decifrado em /message/download, guardado no bucket e só então ligado à mensagem. Nunca se
// guarda a URL do CDN.
//
// Grupos: o evento só é gravado se um administrador permitiu o grupo (o banco decide); a menção
// direta à conta institucional é classificada aqui com a identidade configurada no canal, e a IA só
// é acionada pelo banco (`conv_svc_ai_trigger`) quando todas as condições batem.

import { parseUazWebhook } from '../_shared/uazWebhook.ts';
import { buildChatRequest, inboundMediaPath, type UazCaller } from '../_shared/uazChat.ts';
import { classifyMention, mentionId } from '../_shared/groupMention.ts';
import type { ChannelDelivery } from './handler.ts';

type RpcResult = { data: unknown; error: { message: string } | null };

export type RecordDeps = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  uaz: UazCaller | null;
  /** Baixa `url` e guarda em `path` no bucket de mídia. */
  store(path: string, url: string, mime: string): Promise<boolean>;
  /** Avisa as telas abertas (digitando/gravando). */
  broadcast(event: string, payload: Record<string, unknown>): Promise<void>;
  /** Mensagem de entrada nova gravada: a IA decide (no banco) se responde. */
  onInbound?(messageId: string): void;
  /** Mídia de entrada já persistida: consumidores especializados podem processá-la. */
  onMediaReady?(messageId: string): void;
  /** Tarefas assíncronas em segundo plano (retry de decifração, etc). */
  background?(task: Promise<unknown>): void;
};

type Ingested = { message_id?: string; conversation_id?: string; duplicate?: boolean; ignored?: string; group_status?: string; from_me?: boolean };

export async function recordInbound(payload: Record<string, unknown>, channel: ChannelDelivery, deps: RecordDeps): Promise<string> {
  const evento = parseUazWebhook(payload);
  const log = (outcome: string, detail?: string) =>
    Promise.resolve(deps.rpc('conv_svc_log_webhook', { p_event: evento.kind, p_outcome: outcome, p_detail: detail ?? null })).catch(() => undefined);

  switch (evento.kind) {
    case 'message': {
      const m = evento.message;
      const verdict = m.mentions ? classifyMention(m.mentions, { phone: channel.bot_phone, lids: channel.bot_lids }) : { direct: false, evidence: '' };
      const r = await deps.rpc('conv_svc_ingest_message', { p: {
        provider_id: m.providerId, chat_kind: m.chat.kind, group_jid: m.chat.kind === 'group' ? m.chat.jid : null,
        group_name: m.chat.name || null, payload_shape: m.shape,
        phone: m.phone || null, lid: m.lid || null, name: m.name, body: m.body, from_me: m.fromMe,
        sent_at: m.sentAt, kind: m.kind, mime: m.mime, file_name: m.fileName, reply_to: m.replyTo, meta: m.meta,
        mention: m.chat.kind === 'group' ? { direct: verdict.direct, evidence: verdict.evidence } : null,
      } });
      const out = r.data as Ingested | null;
      if (r.error || !out) { await log('erro_ao_gravar', r.error?.message?.slice(0, 120)); return 'erro_ao_gravar'; }
      if (out.ignored) return 'grupo_nao_permitido';          // grupo detectado/bloqueado: nada foi gravado
      if (out.duplicate) return 'duplicada';                    // webhook repetido: nem mídia nem IA de novo
      const receiptCaption = /\b(comprovante|pagamento|paguei|pago|pix|transferencia|recibo)\b/i
        .test((m.body ?? '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
      const specializedMedia = m.hasMedia
        && (m.kind === 'image' || m.kind === 'document')
        && (!m.body || m.body === '📷 Foto' || m.body === '📄 Documento' || receiptCaption);
      if (!m.fromMe && out.message_id && !specializedMedia) deps.onInbound?.(out.message_id);
      if (m.hasMedia && deps.uaz && out.message_id) {
        const pedido = buildChatRequest({ action: 'download', messageId: m.providerId });
        const baixado = pedido ? await deps.uaz(pedido) : null;
        const url = baixado?.ok ? String(baixado.body.fileURL ?? baixado.body.fileUrl ?? '') : '';
        if (url) {
          const mime = String(baixado?.ok ? baixado.body.mimetype ?? m.mime : m.mime) || 'application/octet-stream';
          const path = inboundMediaPath(out.message_id, m.providerId, mime);
          if (await deps.store(path, url, mime)) {
            await deps.rpc('conv_svc_set_message_media', { p_provider_id: m.providerId, p_path: path, p_mime: mime });
            deps.onMediaReady?.(out.message_id);
            return 'mensagem_com_midia';
          }
        }
        return 'mensagem_midia_pendente';
      }
      if (m.body?.includes('[Undecryptable]') && deps.uaz && deps.background) {
        deps.background((async () => {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const pedido = buildChatRequest({ action: 'find', messageId: m.providerId });
          const res = pedido ? await deps.uaz!(pedido) : null;
          if (res?.ok && Array.isArray(res.body.messages) && res.body.messages[0]) {
            const achada = res.body.messages[0] as Record<string, unknown>;
            const texto = String(achada.text ?? (achada.content as Record<string, unknown>)?.text ?? '');
            if (texto && !texto.includes('[Undecryptable]')) {
              await deps.rpc('conv_svc_resolve_undecryptable', { p_provider_id: m.providerId, p_body: texto, p_kind: 'text' });
            }
          }
        })().catch(() => undefined));
      }
      return 'mensagem';
    }
    case 'reaction':
      await deps.rpc('conv_svc_apply_reaction', { p_target: evento.targetId, p_emoji: evento.emoji, p_from_me: evento.fromMe });
      return 'reacao';
    case 'edit': {
      const verdict = evento.mentions
        ? classifyMention(evento.mentions, { phone: channel.bot_phone, lids: channel.bot_lids })
        : { direct: false, evidence: 'no_mention_metadata' };
      const botIds = [
        mentionId(channel.bot_phone ?? ''),
        ...(channel.bot_lids ?? []).map((id) => mentionId(id)),
      ].filter(Boolean);
      const bodyHasExactBotId = botIds.some((id) => evento.body.includes('@' + id));
      const direct = verdict.direct || (!evento.mentions?.hasMetadata && bodyHasExactBotId);
      const evidence = verdict.direct
        ? verdict.evidence
        : direct ? 'edited_body_bot_id' : verdict.evidence;
      const r = await deps.rpc('conv_svc_apply_edit_with_mention', {
        p_provider_id: evento.targetId,
        p_body: evento.body,
        p_mention_direct: direct,
        p_mention_evidence: evidence,
      });
      const out = r.data as { found?: boolean; message_id?: string; became_direct_mention?: boolean } | null;
      if (out?.became_direct_mention && out.message_id) deps.onInbound?.(out.message_id);
      return 'edicao';
    }
    case 'delete':
      await deps.rpc('conv_svc_apply_delete', { p_provider_id: evento.targetId });
      return 'exclusao';
    case 'status':
      for (const u of evento.updates) {
        await deps.rpc('conv_svc_update_message_status', { p_provider_id: u.providerId, p_status: u.status });
      }
      return 'status';
    case 'presence':
      await deps.broadcast('presence', { phone: evento.phone, state: evento.state, at: Date.now() });
      return 'presenca';
    default:
      // Evento desconhecido/inválido: nada é enviado a ninguém; fica um registro curto (sem conteúdo).
      if (!['evento_connection', 'status_irrelevante', 'enviada_pela_api', 'presenca_invalida'].includes(evento.reason)) await log('ignorado', evento.reason);
      return evento.reason;
  }
}
