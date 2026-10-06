// Ações da caixa de Conversas que falam com o provedor de WhatsApp.
//
// Portado de `conversation-operations/handler.ts` do North Jato. O que é só banco (assumir a conversa,
// tags, responsável, notas, retornos, automações, canal) o navegador chama direto como RPC de administrador;
// aqui ficam as ações que precisam do provedor: enviar, reagir, editar, apagar para todos, marcar lida (tique
// azul), presença, avatar, sincronizar mensagem não decifrada, estado da instância e registro do webhook.
//
// Cada ação vira um nome `conv.*` que o roteador executa com o banco (chave de serviço) e a UazAPI. O token da
// instância nunca sai daqui; o navegador só recebe o estado já traduzido.

import {
  handleAdminRequest, isPlainObject, text, UUID,
  type AdminDeps, type AdminEnvironment, type AdminRoute, type CallContext, type RpcResult,
} from '../_shared/adminRequest.ts';
import { avatarFrom, buildChatRequest, providerIdFrom, uazError, type OutboundKind, type UazCaller } from '../_shared/uazChat.ts';
import type { WhatsappInstanceApi } from '../_shared/whatsappInstance.ts';

const ACTIONS = ['send', 'react', 'edit', 'delete', 'mark-read', 'mark-unread', 'presence', 'refresh-avatar', 'sync-message',
  'instance-status', 'instance-connect', 'instance-disconnect', 'register-webhook', 'test-automation', 'ai-health'];

const KINDS: OutboundKind[] = ['text', 'image', 'video', 'audio', 'ptt', 'document'];
const MEDIA_PATH = /^(in|out)\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;
const MAX_BODY_CHARS = 4096;

const plan = (rpc: string, args: Record<string, unknown>, key = 'ok', status = 200) => ({ rpc: `conv.${rpc}`, args, key, status });

const ROUTE: AdminRoute = {
  actions: ACTIONS,
  plan(action, body, actor) {
    const conversation = text(body.conversationId);
    const message = text(body.messageId);
    switch (action) {
      case 'send': {
        const key = text(body.idempotencyKey);
        const kind = (text(body.kind) || 'text') as OutboundKind;
        const corpo = typeof body.body === 'string' ? body.body.replace(/\s+$/, '') : '';
        const mediaPath = text(body.mediaPath);
        const reply = text(body.replyToMessageId);
        if (!UUID.test(conversation) || !UUID.test(key) || !KINDS.includes(kind)) return null;
        if (corpo.length > MAX_BODY_CHARS || (kind === 'text' && !corpo.trim())) return null;
        if (kind !== 'text' && !MEDIA_PATH.test(mediaPath)) return null;
        if (reply && !UUID.test(reply)) return null;
        return plan('send', { p_conversation: conversation, p_key: key, p_author: actor.id, p_origin: 'staff', p: {
          kind, body: corpo || null, media_path: kind === 'text' ? null : mediaPath,
          mime: text(body.mime).slice(0, 100) || null, file_name: text(body.fileName).slice(0, 120) || null,
          reply_to_message_id: reply || null,
        } }, 'message', 201);
      }
      case 'react':
        if (!UUID.test(message) || typeof body.emoji !== 'string' || body.emoji.length > 16) return null;
        return plan('react', { p_message: message, p_emoji: body.emoji });
      case 'edit': {
        const corpo = typeof body.body === 'string' ? body.body.replace(/\s+$/, '') : '';
        if (!UUID.test(message) || !corpo.trim() || corpo.length > MAX_BODY_CHARS) return null;
        return plan('edit', { p_message: message, p_body: corpo });
      }
      case 'delete':
        return UUID.test(message) ? plan('delete', { p_message: message }) : null;
      case 'mark-read':
        return UUID.test(conversation) ? plan('mark-read', { p_conversation: conversation }) : null;
      case 'mark-unread':
        return UUID.test(conversation) ? plan('mark-unread', { p_conversation: conversation }) : null;
      case 'presence': {
        const state = text(body.state);
        if (!UUID.test(conversation) || !['composing', 'recording', 'paused'].includes(state)) return null;
        return plan('presence', { p_conversation: conversation, state });
      }
      case 'refresh-avatar':
        return UUID.test(conversation) ? plan('refresh-avatar', { p_conversation: conversation }, 'avatarUrl') : null;
      case 'sync-message':
        return UUID.test(message) ? plan('sync-message', { p_message: message }, 'ok') : null;
      case 'instance-status': return plan('instance-status', {}, 'connection');
      case 'instance-connect': return plan('instance-connect', {}, 'connection');
      case 'instance-disconnect': return plan('instance-disconnect', {}, 'connection');
      case 'register-webhook': return plan('register-webhook', { p_request: crypto.randomUUID() }, 'registered');
      case 'test-automation': {
        const id = text(body.automationId);
        return UUID.test(id) ? plan('test-automation', { p_actor: actor.id, p_id: id }, 'sent') : null;
      }
      case 'ai-health': return plan('ai-health', {}, 'health');
      default: return null;
    }
  },
  dbErrors: {
    CONVERSATION_NOT_FOUND: 404, CONTACT_WITHOUT_PHONE: 409, CONVERSATION_SUPERSEDED: 409, IDEMPOTENCY_KEY_REUSED: 409,
    MESSAGE_NOT_EDITABLE: 409, MESSAGE_NOT_DELETABLE: 409, MESSAGE_NOT_SENT: 409, NOTHING_TO_UNREAD: 409,
    BODY_REQUIRED: 400, BODY_TOO_LONG: 400, MEDIA_REQUIRED: 400, INVALID_MEDIA_PATH: 400,
    MESSAGE_STILL_UNDECRYPTABLE: 422, WHATSAPP_NOT_CONFIGURED: 503, WHATSAPP_SEND_FAILED: 502, WHATSAPP_ACTION_FAILED: 502,
    WHATSAPP_PROVIDER_UNREACHABLE: 502, WHATSAPP_TOKEN_INVALID: 502, WHATSAPP_PROVIDER_ERROR: 502,
    ADMIN_WITHOUT_PHONE: 409, NO_SAMPLE_RECIPIENT: 409, VARIABLE_UNAVAILABLE: 409, AUTOMATION_NOT_FOUND: 404,
  },
  rejection: 'CONVERSATION_OPERATION_REJECTED',
};

type Db = AdminDeps['rpc'];
const fail = (message: string): RpcResult => ({ data: null, error: { message } });
const first = <T,>(r: RpcResult): T | null => (Array.isArray(r.data) ? (r.data[0] as T) ?? null : null);

export type ConversationEnv = {
  uaz: UazCaller | null;
  instance: WhatsappInstanceApi | null;
  /** O agente de IA tem provedor configurado (STC_AI_API_KEY)? */
  aiConfigured?: boolean;
  /** URL assinada, curta, para a UazAPI buscar o arquivo que vai no envio. */
  signedMediaUrl(path: string): Promise<string | null>;
  /** URL pública da função de webhook, com o token (nunca devolvida ao navegador). */
  webhookUrl(token: string): string;
  /** Token novo e imprevisível para a URL do webhook. */
  newToken(): string;
};

type Target = { provider_message_id: string | null; destination: string; direction: string; created_at: string; is_group: boolean };

/** Troca o `rpc` do banco pelo roteador das ações `conv.*`. */
export function conversationRpc(db: Db, env: ConversationEnv): Db {
  async function target(message: string): Promise<Target | RpcResult> {
    const r = await db('conv_svc_message_target', { p_message: message });
    if (r.error) return r;
    const t = first<Target>(r);
    if (!t || !t.provider_message_id) return fail('MESSAGE_NOT_SENT');
    return t;
  }
  const isErr = (v: unknown): v is RpcResult => typeof v === 'object' && v !== null && 'error' in v && 'data' in v;

  return async (name, args, ctx?: CallContext): Promise<RpcResult> => {
    if (!name.startsWith('conv.')) return db(name, args, ctx);
    const acao = name.slice(5);
    const uaz = env.uaz;

    if (acao === 'send') {
      if (!uaz) return fail('WHATSAPP_NOT_CONFIGURED');
      const q = await db('conv_svc_queue_message', args);
      if (q.error) return q;
      const row = first<{ message_id: string; destination: string; already_sent: boolean; reply_provider_id: string | null }>(q);
      if (!row) return fail('CONVERSATION_NOT_FOUND');
      if (row.already_sent) return { data: { id: row.message_id, status: 'sent' }, error: null };
      const p = args.p as Record<string, unknown>;
      const kind = p.kind as OutboundKind;
      const fileUrl = kind === 'text' ? null : await env.signedMediaUrl(String(p.media_path));
      const pedido = buildChatRequest({
        action: 'send', number: row.destination, kind, text: (p.body as string) ?? null, fileUrl,
        mime: (p.mime as string) ?? null, fileName: (p.file_name as string) ?? null, replyId: row.reply_provider_id,
      });
      const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'MEDIA_URL_UNAVAILABLE' };
      // Só o provedor diz se foi enviada: sem resposta ok, a mensagem fica "falhou" com o código do erro.
      await db('conv_svc_finish_message', {
        p_message: row.message_id, p_sent: res.ok,
        p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res),
      });
      return res.ok ? { data: { id: row.message_id, status: 'sent' }, error: null } : fail('WHATSAPP_SEND_FAILED');
    }

    if (acao === 'react' || acao === 'edit' || acao === 'delete') {
      if (!uaz) return fail('WHATSAPP_NOT_CONFIGURED');
      const t = await target(String(args.p_message));
      if (isErr(t)) return t;
      if (acao !== 'react' && t.direction !== 'outbound') return fail(acao === 'edit' ? 'MESSAGE_NOT_EDITABLE' : 'MESSAGE_NOT_DELETABLE');
      if (acao === 'edit' && Date.now() - new Date(t.created_at).getTime() > 15 * 60 * 1000) return fail('MESSAGE_NOT_EDITABLE');
      const pedido = acao === 'react'
        ? buildChatRequest({ action: 'react', number: t.destination, messageId: t.provider_message_id!, emoji: String(args.p_emoji) })
        : acao === 'edit'
          ? buildChatRequest({ action: 'edit', messageId: t.provider_message_id!, text: String(args.p_body) })
          : buildChatRequest({ action: 'delete', messageId: t.provider_message_id! });
      const res = pedido ? await uaz(pedido) : null;
      // O WhatsApp é a fonte da verdade aqui: se ele recusou, nada muda no banco.
      if (!res?.ok) return fail('WHATSAPP_ACTION_FAILED');
      const r = await db(acao === 'react' ? 'conv_svc_staff_react' : acao === 'edit' ? 'conv_svc_staff_edit_message' : 'conv_svc_staff_delete_message', args);
      return r.error ? r : { data: true, error: null };
    }

    if (acao === 'mark-read') {
      const r = await db('conv_svc_mark_read_collect', args);
      if (r.error) return r;
      const row = first<{ destination: string; provider_ids: string[]; is_group: boolean }>(r);
      // Tiques azuis do lado do contato (só conversa direta): melhor esforço, nunca desfaz a leitura local.
      if (uaz && row && !row.is_group && row.provider_ids?.length) {
        const pedido = buildChatRequest({ action: 'markread', number: row.destination, messageIds: row.provider_ids });
        if (pedido) await uaz(pedido).catch(() => undefined);
      }
      return { data: true, error: null };
    }

    if (acao === 'mark-unread') {
      const r = await db('conv_svc_mark_unread', args);
      return r.error ? r : { data: true, error: null };
    }

    if (acao === 'presence' || acao === 'refresh-avatar') {
      const c = await db('conv_svc_conversation_contact', { p_conversation: args.p_conversation });
      if (c.error) return c;
      const contato = first<{ contact_id: string | null; destination: string; avatar_url: string | null; avatar_checked_at: string | null; is_group: boolean }>(c);
      if (!contato) return fail('CONVERSATION_NOT_FOUND');
      if (contato.is_group) return { data: acao === 'presence' ? true : null, error: null };
      if (acao === 'presence') {
        if (uaz) {
          const pedido = buildChatRequest({ action: 'presence', number: contato.destination, state: args.state as 'composing' });
          if (pedido) await uaz(pedido).catch(() => undefined);
        }
        return { data: true, error: null };
      }
      // Avatar expira no WhatsApp: busca de novo no máximo uma vez por dia.
      const recente = contato.avatar_checked_at && Date.now() - new Date(contato.avatar_checked_at).getTime() < 24 * 3600 * 1000;
      if (recente || !uaz || !contato.contact_id) return { data: contato.avatar_url, error: null };
      const pedido = buildChatRequest({ action: 'details', number: contato.destination });
      const res = pedido ? await uaz(pedido) : null;
      const url = res?.ok ? avatarFrom(res.body) : null;
      await db('conv_svc_set_avatar', { p_contact: contato.contact_id, p_url: url ?? '' });
      return { data: url, error: null };
    }

    if (acao === 'sync-message') {
      if (!uaz) return fail('WHATSAPP_NOT_CONFIGURED');
      const t = await target(String(args.p_message));
      if (isErr(t)) return t;
      const pedido = buildChatRequest({ action: 'find', messageId: t.provider_message_id! });
      if (!pedido) return fail('WHATSAPP_ACTION_FAILED');
      const res = await uaz(pedido);
      if (!res.ok) return fail('WHATSAPP_ACTION_FAILED');
      const b = res.body as Record<string, unknown> | null;
      const msgs = Array.isArray(b?.messages) ? b!.messages : (Array.isArray(b) ? b : [b]);
      const achada = msgs[0] as Record<string, unknown> | undefined;
      const content = achada && typeof achada.content === 'object' && achada.content ? achada.content as Record<string, unknown> : null;
      const texto = typeof achada?.text === 'string' ? achada.text : (typeof content?.text === 'string' ? content.text : null);
      if (!texto || texto.includes('[Undecryptable]')) {
        const syncPedido = buildChatRequest({ action: 'historySync', number: t.destination, messageId: t.provider_message_id! });
        if (syncPedido) await uaz(syncPedido).catch(() => undefined);
        return fail('MESSAGE_STILL_UNDECRYPTABLE');
      }
      const r = await db('conv_svc_resolve_undecryptable', { p_provider_id: t.provider_message_id!, p_body: texto, p_kind: 'text' });
      return r.error ? r : { data: true, error: null };
    }

    if (acao === 'instance-status' || acao === 'instance-connect' || acao === 'instance-disconnect') {
      if (!env.instance) return fail('WHATSAPP_NOT_CONFIGURED');
      try {
        const connection = acao === 'instance-status' ? await env.instance.status()
          : acao === 'instance-connect' ? await env.instance.connect() : await env.instance.disconnect();
        return { data: connection, error: null };
      } catch (e) {
        return fail(e instanceof Error && /^WHATSAPP_/.test(e.message) ? e.message : 'WHATSAPP_PROVIDER_ERROR');
      }
    }

    if (acao === 'register-webhook') {
      if (!env.instance) return fail('WHATSAPP_NOT_CONFIGURED');
      if (!ctx) return fail('CONV_FORBIDDEN');
      // Token novo: o hash vai ao banco COMO O PRÓPRIO ADMINISTRADOR (auditado); o token em claro só existe aqui e na URL do provedor.
      const token = env.newToken();
      const rot = await db('as_user:conv_rotate_inbound_token', { p_request: args.p_request, p_token: token }, ctx);
      if (rot.error) return rot;
      try {
        await env.instance.registerWebhook(env.webhookUrl(token));
      } catch (e) {
        return fail(e instanceof Error && /^WHATSAPP_/.test(e.message) ? e.message : 'WHATSAPP_PROVIDER_ERROR');
      }
      return { data: true, error: null };
    }

    if (acao === 'test-automation') {
      if (!uaz) return fail('WHATSAPP_NOT_CONFIGURED');
      const p = await db('conv_svc_automation_test_payload', args);
      if (p.error) return p;
      const payload = p.data as { phone: string; body: string };
      const pedido = buildChatRequest({ action: 'send', number: payload.phone, kind: 'text', text: payload.body });
      const res = pedido ? await uaz(pedido) : null;
      return res?.ok ? { data: true, error: null } : fail('WHATSAPP_SEND_FAILED');
    }

    if (acao === 'ai-health') {
      return { data: { aiConfigured: Boolean(env.aiConfigured), whatsappConfigured: Boolean(env.uaz) }, error: null };
    }

    return fail('CONVERSATION_OPERATION_REJECTED');
  };
}

export function handleConversationRequest(request: Request, deps: AdminDeps, env: AdminEnvironment): Promise<Response> {
  return handleAdminRequest(request, deps, env, ROUTE);
}

export { isPlainObject };
