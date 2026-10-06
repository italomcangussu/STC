import { supabase } from '../supabase';
import { COMMON_MESSAGES, callEdgeOperation, messageFor, type OperationBody } from './edge';
import type { PresenceState } from './presenceSignalPolicy';

export { OperationError as ConversationOperationError } from './edge';

const FUNCTION = 'conversation-operations';
export const MEDIA_BUCKET = 'conv-media';

export type ConversationStatus = 'open' | 'closed';
export type ConversationKind = 'direct' | 'group';
export type InboxFilter = 'open' | 'unread' | 'waiting' | 'mine' | 'followup' | 'ai' | 'handoff' | 'groups' | 'closed';
export type AiStatus = 'ai' | 'human' | 'paused';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'ptt' | 'document' | 'sticker' | 'location' | 'contact' | 'other';
export type MessageOrigin = 'customer' | 'staff' | 'ai' | 'automation' | 'system';
export type OutboundKind = 'text' | 'image' | 'video' | 'audio' | 'ptt' | 'document';
export type LinkStatus = 'none' | 'linked' | 'ambiguous' | 'manual';

/** Uma linha da caixa, como `public.conv_inbox` devolve. */
export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  status: ConversationStatus;
  title: string;
  /** Telefone (só dígitos, com DDI) ou `…@g.us` no caso de grupo. */
  destination: string;
  contact_id: string | null;
  group_id: string | null;
  avatar_url: string | null;
  profile_id: string | null;
  profile_name: string | null;
  student_id: string | null;
  link_status: LinkStatus | null;
  opt_out: boolean;
  last_message_at: string;
  last_body: string | null;
  last_message_kind: MessageKind | null;
  last_direction: 'inbound' | 'outbound' | null;
  last_status: MessageStatus | null;
  last_origin: MessageOrigin | null;
  last_deleted: boolean;
  unread_count: number;
  tags: string[];
  assigned_to: string | null;
  assigned_name: string | null;
  next_followup_at: string | null;
  waiting_since: string | null;
  ai_status: AiStatus;
  handoff_kind: 'soft' | 'hard' | null;
  handoff_note: string | null;
  handoff_at: string | null;
  ai_session_open: boolean;
};

export type Reactions = { customer?: string; staff?: string };

export type ConversationMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  origin: MessageOrigin;
  kind: MessageKind;
  body: string | null;
  status: MessageStatus;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
  mediaPath: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  meta: Record<string, unknown>;
  replyPreview: string | null;
  reactions: Reactions;
  editedAt: string | null;
  deletedAt: string | null;
  providerId: string | null;
  /** Em grupo, quem falou. */
  senderName: string | null;
  /** O webhook classificou a mensagem como menção direta à conta institucional. */
  mentionDirect: boolean;
  mentionEvidence: string | null;
  /** Mensagem otimista ainda sem resposta do servidor. */
  pending?: boolean;
  /** Chave de idempotência: reenviar a mesma mensagem não duplica. */
  requestId?: string | null;
  /** Prévia local de mídia enviada agora (antes da URL assinada). */
  localUrl?: string;
};

const MESSAGES: Record<string, string> = {
  ...COMMON_MESSAGES,
  CONV_FORBIDDEN: COMMON_MESSAGES.FORBIDDEN,
  WHATSAPP_NOT_CONFIGURED: 'O WhatsApp do clube não está conectado. Conecte em Conversas → Canal e tente de novo.',
  WHATSAPP_SEND_FAILED: 'O WhatsApp não aceitou a mensagem agora. Ela ficou marcada com falha — toque nela para reenviar.',
  WHATSAPP_ACTION_FAILED: 'O WhatsApp recusou a ação agora. Tente de novo em instantes.',
  WHATSAPP_PROVIDER_UNREACHABLE: 'Não foi possível falar com o provedor de WhatsApp. Tente de novo em instantes.',
  WHATSAPP_TOKEN_INVALID: 'O provedor recusou as credenciais da instância. Confira a configuração do servidor.',
  WHATSAPP_PROVIDER_ERROR: 'O provedor de WhatsApp respondeu com erro. Tente de novo em instantes.',
  CONVERSATION_NOT_FOUND: 'Esta conversa não existe mais. Atualize a lista.',
  CONTACT_WITHOUT_PHONE: 'Este contato não tem telefone: só dá para responder pelo WhatsApp do celular.',
  CONVERSATION_SUPERSEDED: 'O contato já tem outra conversa aberta, mais recente. Continue por ela.',
  IDEMPOTENCY_KEY_REUSED: 'Este envio já foi feito com outro conteúdo. Digite a mensagem de novo.',
  MESSAGE_NOT_EDITABLE: 'Só dá para editar mensagem de texto sua, enviada há menos de 15 minutos.',
  MESSAGE_NOT_DELETABLE: 'Só dá para apagar para todos uma mensagem sua que já foi enviada.',
  MESSAGE_NOT_SENT: 'Esta mensagem ainda não foi entregue ao WhatsApp.',
  NOTHING_TO_UNREAD: 'Não há mensagem do contato para marcar como não lida.',
  INVALID_PHONE: 'Número inválido. Use DDD + número, como (88) 99999-0000.',
  TOO_MANY_TAGS: 'Use no máximo 12 etiquetas por conversa.',
  BODY_TOO_LONG: 'A mensagem passou de 4.096 caracteres. Divida em duas.',
  BODY_REQUIRED: 'Escreva a mensagem antes de enviar.',
  MESSAGE_STILL_UNDECRYPTABLE: 'A mensagem ainda aguarda as chaves do WhatsApp. Abra o aplicativo do WhatsApp no celular para acelerar a sincronização.',
  ASSIGNEE_NOT_ADMIN: 'Só um administrador pode ser o responsável por uma conversa.',
  ADMIN_WITHOUT_PHONE: 'Seu perfil não tem telefone cadastrado, então não há para onde mandar o teste.',
  NO_SAMPLE_RECIPIENT: 'Não há nenhum destinatário real hoje para montar o exemplo de teste.',
  VARIABLE_UNAVAILABLE: 'Alguma variável da mensagem não tem valor para o exemplo, então o teste não foi enviado.',
  AUTOMATION_NOT_FOUND: 'Esta automação não existe mais. Atualize a lista.',
  AUTOMATION_ENDED: 'Esta automação foi encerrada e não pode mais ser alterada.',
  AUTOMATION_PAUSED: 'Esta automação está pausada. Reative antes de enviar.',
  AUTOMATION_NOT_MANUAL: 'Só automações de disparo manual podem ser enviadas por aqui.',
  AUTOMATION_KIND_FIXED: 'A origem e o tipo de uma automação não mudam depois de criada. Crie outra.',
  AUTOMATION_INCOMPLETE: 'A automação tem pendências. Resolva os itens marcados e tente de novo.',
  RUN_NOT_FOUND: 'Esta execução não existe mais. Atualize a lista.',
  RUN_NOT_IN_REVIEW: 'Esta execução já foi decidida (aprovada ou cancelada).',
  AI_MODEL_REQUIRED: 'Escolha o modelo de IA antes de ligar o agente.',
  BOT_IDENTITY_REQUIRED: 'Informe o telefone (ou LID) da conta institucional antes de marcar a menção como verificada.',
  MENTION_NOT_VERIFIED: 'A IA em grupos só liga depois de a menção direta ser verificada com uma mensagem real.',
  GROUP_AI_NOT_ALLOWED: 'Para a IA atender este grupo, ele precisa estar permitido e a IA em grupos precisa estar ligada.',
  GROUP_NOT_FOUND: 'Este grupo não existe mais. Atualize a lista.',
  CONVERSATION_OPERATION_REJECTED: 'O servidor não aceitou a operação. Atualize a tela e tente de novo.',
};

export const describeConversationError = messageFor(MESSAGES);

const call = <T,>(body: OperationBody, key: keyof T & string) => callEdgeOperation<T>(FUNCTION, body, key);

/** Chama uma RPC `public.conv_*` (administrador) e devolve o dado ou lança o erro do banco. */
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

const newRequest = () => crypto.randomUUID();

/* ------------------------------ Leitura ------------------------------ */

export async function listInbox(filter: InboxFilter, search: string): Promise<ConversationSummary[]> {
  const data = await rpc<ConversationSummary[] | null>('conv_inbox', { p_filter: filter, p_search: search.trim() || null, p_limit: 150 });
  return data ?? [];
}

type MessageRow = {
  id: string; direction: 'inbound' | 'outbound'; origin: MessageOrigin; kind: MessageKind; body: string | null; status: MessageStatus;
  created_at: string; sent_at: string | null; last_error: string | null; request_id: string | null;
  media_path: string | null; media_mime: string | null; media_name: string | null; meta: Record<string, unknown> | null;
  reply_preview: string | null; reactions: Reactions | null; edited_at: string | null; deleted_at: string | null;
  provider_message_id: string | null; mention_direct: boolean | null; mention_evidence: string | null;
  sender: { name: string | null; phone: string | null } | null;
};

const COLS = 'id,direction,origin,kind,body,status,created_at,sent_at,last_error,request_id,media_path,media_mime,media_name,meta,reply_preview,reactions,edited_at,deleted_at,provider_message_id,mention_direct,mention_evidence,sender:conv_contacts!sender_contact_id(name,phone)';

export function toMessage(r: MessageRow): ConversationMessage {
  return {
    id: r.id, direction: r.direction, origin: r.origin, kind: r.kind ?? 'text', body: r.body, status: r.status,
    createdAt: r.created_at, sentAt: r.sent_at, lastError: r.last_error, requestId: r.request_id,
    mediaPath: r.media_path, mediaMime: r.media_mime, mediaName: r.media_name, meta: r.meta ?? {},
    replyPreview: r.reply_preview, reactions: r.reactions ?? {}, editedAt: r.edited_at, deletedAt: r.deleted_at,
    providerId: r.provider_message_id,
    senderName: r.sender ? (r.sender.name?.trim() || (r.sender.phone ? `+${r.sender.phone}` : null)) : null,
    mentionDirect: Boolean(r.mention_direct), mentionEvidence: r.mention_evidence,
  };
}

export const PAGE = 50;

/** Mensagens por páginas, das mais novas para trás (cursor por `created_at`, nunca OFFSET). Devolve em ordem cronológica. */
export async function listMessages(conversationId: string, before?: string): Promise<ConversationMessage[]> {
  let q = supabase.from('conv_messages' as never).select(COLS).eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(PAGE);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage).reverse();
}

/** URLs assinadas das mídias (bucket privado), em lote. */
export async function signMedia(paths: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(paths.filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(unicos, 3600);
  if (error) return new Map();
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
}

/* ------------------------------ Envio ------------------------------ */

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export function kindForFile(file: File): OutboundKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Sobe um arquivo da equipe para `out/<uuid>/<nome>` e devolve o caminho. */
export async function uploadOutbound(file: Blob, fileName: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('O arquivo passa de 16 MB, o limite do WhatsApp para envio.');
  const limpo = fileName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'arquivo';
  const path = `out/${crypto.randomUUID()}/${limpo}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('Não foi possível subir o arquivo agora. Tente de novo.');
  return path;
}

export function sendMessage(input: {
  conversationId: string; idempotencyKey: string; kind?: OutboundKind; body?: string | null;
  mediaPath?: string | null; mime?: string | null; fileName?: string | null; replyToMessageId?: string | null;
}) {
  return call<{ message: { id: string; status: MessageStatus } }>({
    action: 'send', conversationId: input.conversationId, idempotencyKey: input.idempotencyKey,
    kind: input.kind ?? 'text', body: input.body ?? null, mediaPath: input.mediaPath ?? null,
    mime: input.mime ?? null, fileName: input.fileName ?? null, replyToMessageId: input.replyToMessageId ?? null,
  }, 'message');
}

export const reactToMessage = (messageId: string, emoji: string) => call<{ ok: true }>({ action: 'react', messageId, emoji }, 'ok');
export const editMessage = (messageId: string, body: string) => call<{ ok: true }>({ action: 'edit', messageId, body }, 'ok');
export const deleteMessage = (messageId: string) => call<{ ok: true }>({ action: 'delete', messageId }, 'ok');
export const markConversationRead = (conversationId: string) => call<{ ok: true }>({ action: 'mark-read', conversationId }, 'ok');
export const markConversationUnread = (conversationId: string) => call<{ ok: true }>({ action: 'mark-unread', conversationId }, 'ok');
export const refreshAvatar = (conversationId: string) => call<{ avatarUrl: string | null }>({ action: 'refresh-avatar', conversationId }, 'avatarUrl');
export const sendPresence = (conversationId: string, state: PresenceState) => call<{ ok: true }>({ action: 'presence', conversationId, state }, 'ok');
export const syncMessage = (messageId: string) => call<{ ok: true }>({ action: 'sync-message', messageId }, 'ok');

export const openConversation = (phone: string, name?: string) =>
  rpc<string>('conv_open_conversation', { p_phone: phone, p_name: name?.trim() || null });
export const setConversationStatus = (conversationId: string, status: ConversationStatus) =>
  rpc<void>('conv_set_status', { p_conversation: conversationId, p_status: status });
export const setConversationMeta = (conversationId: string, meta: { tags?: string[]; assignedTo?: string | null }) =>
  rpc<void>('conv_set_meta', {
    p_conversation: conversationId,
    p: { ...(meta.tags ? { tags: meta.tags } : {}), ...('assignedTo' in meta ? { assigned_to: meta.assignedTo } : {}) },
  });
export const setAiStatus = (conversationId: string, status: AiStatus) =>
  rpc<void>('conv_set_ai_status', { p_conversation: conversationId, p_status: status });

/* ------------------------------ CRM leve ------------------------------ */

export type QuickReply = { id: string; shortcut: string; title: string; body: string };
export type ChatNote = { id: string; body: string; created_at: string; author: { name: string | null } | null };
export type ChatFollowup = {
  id: string; due_at: string; note: string | null; send_body: string | null;
  status: 'pending' | 'sending' | 'sent' | 'done' | 'canceled' | 'failed'; last_error: string | null;
};
export type StaffOption = { id: string; name: string };
export type PersonHit = { kind: 'profile' | 'student'; id: string; name: string; hint: string | null };

export async function listQuickReplies(): Promise<QuickReply[]> {
  const { data, error } = await supabase.from('conv_quick_replies' as never).select('id,shortcut,title,body').order('shortcut');
  if (error) throw error;
  return (data ?? []) as unknown as QuickReply[];
}

export async function saveQuickReply(input: Omit<QuickReply, 'id'> & { id?: string }) {
  try {
    await rpc<string>('conv_save_quick_reply', {
      p_id: input.id ?? null, p_shortcut: input.shortcut.trim().toLowerCase(), p_title: input.title.trim(), p_body: input.body.trim(),
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    throw new Error(code === '23505' ? 'Já existe uma resposta com esse atalho.' : 'Não foi possível salvar a resposta rápida.');
  }
}

export async function deleteQuickReply(id: string) {
  try { await rpc<void>('conv_delete_quick_reply', { p_id: id }); } catch { throw new Error('Não foi possível apagar a resposta rápida.'); }
}

/** `{nome}` vira o primeiro nome do contato (o mesmo que o servidor faz nos retornos). */
export function fillTemplate(body: string, fullName: string): string {
  const nome = fullName.trim().split(/\s+/)[0] ?? '';
  const valido = nome && !/^\+?\d/.test(nome) ? nome : '';
  return body.replace(/\{nome\}/gi, valido).replace(/ ,/g, ',').replace(/,\s*([!?.])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export async function listNotes(conversationId: string): Promise<ChatNote[]> {
  const { data, error } = await supabase.from('conv_notes' as never)
    .select('id,body,created_at,author:profiles!author_id(name)').eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as ChatNote[];
}

export async function addNote(conversationId: string, body: string) {
  try { await rpc<string>('conv_add_note', { p_conversation: conversationId, p_body: body.trim() }); } catch { throw new Error('Não foi possível salvar a nota.'); }
}

export async function listFollowups(conversationId: string): Promise<ChatFollowup[]> {
  const { data, error } = await supabase.from('conv_followups' as never)
    .select('id,due_at,note,send_body,status,last_error').eq('conversation_id', conversationId)
    .order('due_at', { ascending: true }).limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as ChatFollowup[];
}

export async function addFollowup(input: { conversationId: string; dueAt: string; note: string; sendBody: string | null }) {
  try {
    await rpc<string>('conv_add_followup', {
      p_conversation: input.conversationId, p_due_at: input.dueAt, p_note: input.note.trim() || null, p_send_body: input.sendBody?.trim() || null,
    });
  } catch { throw new Error('Não foi possível agendar o retorno.'); }
}

export async function setFollowupStatus(id: string, status: 'done' | 'canceled') {
  try { await rpc<void>('conv_update_followup', { p_id: id, p_status: status, p_due_at: null }); } catch { throw new Error('Não foi possível atualizar o retorno.'); }
}

export async function listStaff(): Promise<StaffOption[]> {
  try { return (await rpc<StaffOption[] | null>('conv_admins')) ?? []; } catch { return []; }
}

export async function searchPeople(query: string): Promise<PersonHit[]> {
  if (query.trim().length < 2) return [];
  try { return (await rpc<PersonHit[] | null>('conv_search_people', { p_query: query })) ?? []; } catch { return []; }
}

export const linkContact = (contactId: string, target: { profileId?: string | null; studentId?: string | null }) =>
  rpc<void>('conv_link_contact', { p_contact: contactId, p_profile: target.profileId ?? null, p_student: target.studentId ?? null });
export const setOptOut = (contactId: string, optOut: boolean) => rpc<void>('conv_set_opt_out', { p_contact: contactId, p_opt_out: optOut });

/* ------------------------------ Tempo real ------------------------------ */

/**
 * Mudanças em mensagens e conversas (RLS: só administrador recebe) e "digitando" do contato
 * (difusão do webhook: só o id opaco da conversa e o estado, nunca telefone nem conteúdo).
 */
export function subscribeInbox(
  onChange: (payload: { table: string; conversationId: string | null; eventType?: string; direction?: string }) => void,
  onPresence?: (payload: { conversationId: string; state: PresenceState }) => void,
) {
  const channel = supabase
    .channel('conv-inbox')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conv_messages' }, (p) => {
      const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { conversation_id?: string; direction?: string };
      onChange({ table: 'conv_messages', conversationId: row?.conversation_id ?? null, eventType: p.eventType, direction: row?.direction });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conv_conversations' }, (p) => {
      const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { id?: string };
      onChange({ table: 'conv_conversations', conversationId: row?.id ?? null, eventType: p.eventType });
    })
    .subscribe();
  const presenca = onPresence
    ? supabase.channel('conv-inbox-presence')
      .on('broadcast', { event: 'presence' }, ({ payload }) => {
        const p = payload as { conversationId?: string; state?: PresenceState };
        if (p?.conversationId && p.state) onPresence({ conversationId: p.conversationId, state: p.state });
      })
      .subscribe()
    : null;
  return () => {
    void supabase.removeChannel(channel);
    if (presenca) void supabase.removeChannel(presenca);
  };
}

/* ------------------------------ Canal e grupos ------------------------------ */

export type Channel = {
  institutional_name: string;
  bot_phone: string | null;
  bot_lids: string[];
  inbound_token_rotated_at: string | null;
  ai_direct_enabled: boolean;
  ai_group_enabled: boolean;
  mention_verified_at: string | null;
  group_session_minutes: number;
  version: number;
};

export type WhatsappConnection = { state: 'connected' | 'connecting' | 'disconnected'; qrcode: string | null; profileName: string | null; phone: string | null };

export type ChannelGroup = {
  id: string; group_jid: string; name: string | null; status: 'detected' | 'allowed' | 'blocked'; ai_enabled: boolean;
  first_seen_at: string; last_seen_at: string; events_seen: number; last_payload_shape: Record<string, unknown> | null;
};

export async function getChannel(): Promise<Channel | null> {
  const { data, error } = await supabase.from('conv_channel' as never)
    .select('institutional_name,bot_phone,bot_lids,inbound_token_rotated_at,ai_direct_enabled,ai_group_enabled,mention_verified_at,group_session_minutes,version')
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as Channel | null;
}

export const saveChannel = (p: { institutional_name?: string; bot_phone?: string | null; bot_lids?: string[]; group_session_minutes?: number }) =>
  rpc<{ version: number }>('conv_save_channel', { p_request: newRequest(), p });
export const setMentionVerified = (verified: boolean) => rpc<void>('conv_set_mention_verified', { p_verified: verified });
export const setAiChannel = (direct: boolean, group: boolean) => rpc<void>('conv_set_ai_channel', { p_direct: direct, p_group: group });
export const setGroup = (groupId: string, status: ChannelGroup['status'], ai: boolean) =>
  rpc<void>('conv_set_group', { p_group: groupId, p_status: status, p_ai: ai });

export async function listGroups(): Promise<ChannelGroup[]> {
  const { data, error } = await supabase.from('conv_groups' as never)
    .select('id,group_jid,name,status,ai_enabled,first_seen_at,last_seen_at,events_seen,last_payload_shape')
    .order('last_seen_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelGroup[];
}

export const instanceStatus = () => call<{ connection: WhatsappConnection }>({ action: 'instance-status' }, 'connection');
export const instanceConnect = () => call<{ connection: WhatsappConnection }>({ action: 'instance-connect' }, 'connection');
export const instanceDisconnect = () => call<{ connection: WhatsappConnection }>({ action: 'instance-disconnect' }, 'connection');
export const registerWebhook = () => call<{ registered: true }>({ action: 'register-webhook' }, 'registered');
export const aiHealth = () => call<{ health: { aiConfigured: boolean; whatsappConfigured: boolean } }>({ action: 'ai-health' }, 'health');

/** Mensagens recentes de grupo com a classificação de menção: serve para conferir, com payload real, o que o provedor entrega. */
export type MentionSample = { id: string; created_at: string; mention_direct: boolean; mention_evidence: string | null; body: string | null };
export async function listMentionSamples(): Promise<MentionSample[]> {
  const { data, error } = await supabase.from('conv_messages' as never)
    .select('id,created_at,mention_direct,mention_evidence,body')
    // Só mensagens de grupo carregam a evidência de menção (o webhook a grava apenas nelas).
    .eq('direction', 'inbound').not('mention_evidence', 'is', null).order('created_at', { ascending: false }).limit(15);
  if (error) throw error;
  return ((data ?? []) as unknown as MentionSample[]);
}

/* ------------------------------ IA ------------------------------ */

export type AiSettings = {
  version: number; active: boolean; persona_name: string; model: string; instructions: string;
  business_context: string; buffer_seconds: number; max_turns: number; handoff_keywords: string[];
  daily_turn_budget: number; proposal_ttl_minutes: number;
};

export const getAiSettings = () => rpc<AiSettings | null>('conv_get_ai_settings');
export const saveAiSettings = (p: Partial<AiSettings>) => rpc<{ version: number }>('conv_save_ai_settings', { p_request: newRequest(), p });

export type BookingProposal = {
  id: string; conversation_id: string; action: 'create' | 'cancel' | 'reschedule';
  status: 'open' | 'confirmed' | 'failed' | 'expired' | 'canceled'; payload: Record<string, unknown>;
  failure_code: string | null; created_at: string; confirmed_at: string | null; reservation_id: string | null;
};

export async function listProposals(): Promise<BookingProposal[]> {
  const { data, error } = await supabase.from('conv_booking_proposals' as never)
    .select('id,conversation_id,action,status,payload,failure_code,created_at,confirmed_at,reservation_id')
    .order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as BookingProposal[];
}

/* ------------------------------ Automações ------------------------------ */

export type AutomationSource = 'finance_charge' | 'championship_notice' | 'championship_result' | 'championship_advance' | 'card_mensal' | 'audience';
export type AutomationTrigger = 'scheduled' | 'conditional' | 'event' | 'manual';
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'ended';

export type AutomationSchedule = { time?: string; weekdays?: number[]; dates?: string[]; end_date?: string };

export type Automation = {
  id: string; name: string; description: string; objective: string; source: AutomationSource; trigger_type: AutomationTrigger;
  definition: Record<string, unknown>; schedule: AutomationSchedule; message_body: string; status: AutomationStatus; version: number;
  activated_at: string | null; updated_at: string; problems: string[];
  sent: number; pending: number; failed: number; skipped: number; last_run_at: string | null;
};

export type AutomationSettings = {
  enabled: boolean; window_start: string; window_end: string; days: number[]; min_hours_between: number;
  daily_cap: number; weekly_cap: number; opt_out_keywords: string[]; updated_at: string;
};

export type AutomationPreview = {
  estimated_recipients: number; excluded_by_reason: Record<string, number>; sample: string[];
  rendered_example: string | null; rendered_for: string | null; problems: string[];
};

export type AutomationRun = {
  id: string; automation_id: string; version: number; kind: AutomationTrigger; planned_for: string;
  status: 'review' | 'running' | 'done' | 'canceled'; created_at: string; finished_at: string | null;
};

export type AutomationRecipient = {
  id: string; run_id: string; display_name: string | null; status: 'review' | 'pending' | 'processing' | 'sent' | 'failed' | 'skipped' | 'canceled';
  skip_reason: string | null; attempts: number; last_error: string | null; sent_at: string | null; body: string | null;
};

export const listAutomations = async () => (await rpc<Automation[] | null>('conv_automation_list')) ?? [];
export const getAutomationSettings = () => rpc<AutomationSettings | null>('conv_get_automation_settings');
export const saveAutomationSettings = (p: Partial<AutomationSettings>) =>
  rpc<{ ok: true }>('conv_save_automation_settings', { p_request: newRequest(), p });

export type AutomationInput = {
  name: string; description?: string; objective?: string; source: AutomationSource; trigger_type: AutomationTrigger;
  definition: Record<string, unknown>; schedule: AutomationSchedule; message_body: string;
};
export const saveAutomation = (id: string | null, p: Partial<AutomationInput>) =>
  rpc<{ id: string; version: number; problems: string[] }>('conv_save_automation', { p_request: newRequest(), p_id: id, p });
export const setAutomationStatus = (id: string, status: 'active' | 'paused' | 'ended') =>
  rpc<{ status: string; canceled?: number }>('conv_automation_set_status', { p_request: newRequest(), p_id: id, p_status: status });
export const previewAutomation = (id: string, override?: Partial<Pick<AutomationInput, 'definition' | 'schedule' | 'message_body'>>) =>
  rpc<AutomationPreview>('conv_automation_preview', { p_id: id, p_override: override ?? null });
export const prepareManualRun = (id: string) => rpc<{ run_id: string; recipients: number }>('conv_automation_prepare_manual', { p_request: newRequest(), p_id: id });
export const approveRun = (runId: string) => rpc<{ run_id: string; queued: number }>('conv_automation_approve_run', { p_request: newRequest(), p_run: runId });
export const cancelRun = (runId: string) => rpc<void>('conv_automation_cancel_run', { p_run: runId });
export const retryFailed = (runId: string) => rpc<number>('conv_automation_retry_failed', { p_run: runId });
export const testAutomation = (automationId: string) => call<{ sent: true }>({ action: 'test-automation', automationId }, 'sent');

export async function listRuns(automationId: string): Promise<AutomationRun[]> {
  const { data, error } = await supabase.from('conv_automation_runs' as never)
    .select('id,automation_id,version,kind,planned_for,status,created_at,finished_at')
    .eq('automation_id', automationId).order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []) as unknown as AutomationRun[];
}

export async function listRecipients(runId: string): Promise<AutomationRecipient[]> {
  const { data, error } = await supabase.from('conv_automation_recipients' as never)
    .select('id,run_id,display_name,status,skip_reason,attempts,last_error,sent_at,body')
    .eq('run_id', runId).order('display_name').limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as AutomationRecipient[];
}

export type ChampionshipOption = { id: string; name: string };
export async function listChampionshipOptions(): Promise<ChampionshipOption[]> {
  const { data, error } = await supabase.from('championships').select('id,name').order('name').limit(100);
  if (error) return [];
  return (data ?? []) as unknown as ChampionshipOption[];
}

/* ------------------------------ Abrir conversa a partir do cadastro ------------------------------ */

export type OpenTarget = { key: string; name: string; phone: string; hint: string };

/** Sócios e alunos (por nome) que têm telefone: o administrador abre a conversa sem digitar o número. */
export async function searchOpenTargets(query: string): Promise<OpenTarget[]> {
  const q = query.trim().replace(/[%,()]/g, ' ');
  if (q.length < 2) return [];
  const [socios, alunos] = await Promise.allSettled([
    supabase.from('profiles').select('id,name,phone').ilike('name', `%${q}%`).not('phone', 'is', null).order('name').limit(8),
    supabase.from('non_socio_students').select('id,name,phone').ilike('name', `%${q}%`).not('phone', 'is', null).order('name').limit(8),
  ]);
  const rows = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, hint: string, prefix: string): OpenTarget[] => {
    if (r.status !== 'fulfilled' || r.value.error) return [];
    return ((r.value.data ?? []) as Array<{ id: string; name: string; phone: string | null }>)
      .filter((x) => (x.phone ?? '').replace(/\D/g, '').length >= 10)
      .map((x) => ({ key: `${prefix}:${x.id}`, name: x.name, phone: x.phone as string, hint }));
  };
  return [...rows(socios, 'Sócio', 'p'), ...rows(alunos, 'Aluno', 's')];
}
