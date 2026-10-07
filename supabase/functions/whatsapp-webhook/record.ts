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
import type { Transcription } from '../_shared/audioTranscription.ts';
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
  onMediaReady?(messageId: string, aiPending?: boolean): void;
  /** Tarefas assíncronas em segundo plano (retry de decifração, etc). */
  background?(task: Promise<unknown>): void;
  /** Áudio de entrada já guardado em `path` → texto (Whisper). Sem isto, o áudio segue como hoje. */
  transcribe?(input: { messageId: string; conversationId: string | null; path: string; mime: string; contactName: string; institutionalName: string }): Promise<Transcription>;
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
      // Áudio para o João: a IA só é acionada depois da transcrição (ou da tentativa), para ler o que foi dito.
      // No grupo, só o áudio que pode ser com ele (menção ou resposta): o resto do papo não sai do clube.
      const listen = !m.fromMe && (m.kind === 'audio' || m.kind === 'ptt') && m.hasMedia && Boolean(deps.uaz && deps.transcribe)
        && (m.chat.kind !== 'group' || verdict.direct || Boolean(m.replyTo));
      if (!m.fromMe && out.message_id && !specializedMedia && !listen) deps.onInbound?.(out.message_id);
      if (listen && out.message_id) {
        const messageId = out.message_id;
        try {
          return await storeMedia(m, messageId, deps, (path, mime) => transcribeAndSave(messageId, out.conversation_id ?? null, path, mime, m.name, channel, deps));
        } finally {
          deps.onInbound?.(messageId);
        }
      }
      if (m.hasMedia && deps.uaz && out.message_id) {
        // Imagem/documento tratado como comprovante não aciona o João na entrada: ele responde depois da leitura (onMediaReady).
        return storeMedia(m, out.message_id, deps, undefined, specializedMedia && !m.fromMe && m.chat.kind !== 'group');
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

type Incoming = { providerId: string; mime: string | null };

/** Pede o arquivo já decifrado, guarda no bucket e liga à mensagem. `ready` roda com a mídia no lugar. */
async function storeMedia(m: Incoming, messageId: string, deps: RecordDeps, ready?: (path: string, mime: string) => Promise<void>, aiPending = false): Promise<string> {
  const pedido = deps.uaz ? buildChatRequest({ action: 'download', messageId: m.providerId }) : null;
  const baixado = pedido && deps.uaz ? await deps.uaz(pedido) : null;
  const url = baixado?.ok ? String(baixado.body.fileURL ?? baixado.body.fileUrl ?? '') : '';
  if (url) {
    const mime = String(baixado?.ok ? baixado.body.mimetype ?? m.mime : m.mime) || 'application/octet-stream';
    const path = inboundMediaPath(messageId, m.providerId, mime);
    if (await deps.store(path, url, mime)) {
      await deps.rpc('conv_svc_set_message_media', { p_provider_id: m.providerId, p_path: path, p_mime: mime });
      deps.onMediaReady?.(messageId, aiPending);
      if (ready) await ready(path, mime);
      return 'mensagem_com_midia';
    }
  }
  if (ready) await saveTranscription(messageId, { status: 'failed', reason: 'midia_indisponivel' }, deps);
  return 'mensagem_midia_pendente';
}

async function transcribeAndSave(messageId: string, conversationId: string | null, path: string, mime: string, contactName: string,
  channel: ChannelDelivery, deps: RecordDeps): Promise<void> {
  let result: Transcription;
  try {
    result = await deps.transcribe!({ messageId, conversationId, path, mime, contactName, institutionalName: channel.institutional_name });
  } catch {
    result = { status: 'failed', reason: 'erro_transcricao' };
  }
  await saveTranscription(messageId, result, deps);
}

async function saveTranscription(messageId: string, t: Transcription, deps: RecordDeps): Promise<void> {
  const r = await Promise.resolve(deps.rpc('conv_svc_set_message_transcription', { p_message: messageId, p: t })).catch(() => null);
  // Só o desfecho vai para o registro do webhook, nunca o que foi dito.
  if (t.status !== 'ok' || !r || r.error) {
    await Promise.resolve(deps.rpc('conv_svc_log_webhook', { p_event: 'message', p_outcome: `audio_${t.status}`, p_detail: r?.error ? 'erro_ao_gravar' : t.reason ?? null }))
      .catch(() => undefined);
  }
}
